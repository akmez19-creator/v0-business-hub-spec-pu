// Central Facebook Graph client. Every route should call the Graph through
// this so the whole app shares one quota strategy:
//
// 1. READS are cached in module memory with a TTL, and stale entries are
//    served as fallback when Facebook rate-limits us (error #4/#17/#32/#613).
//    A dashboard refresh must never burn the quota needed for publishing.
// 2. WRITES (posting, boosting, duplicating) are never cached, and retry
//    automatically with exponential backoff when rate-limited, so a post or
//    boost "just works" even when the hourly window is under pressure.
// 3. App usage is tracked from Facebook's X-App-Usage response header. Once
//    usage crosses 90%, reads are served from stale cache (when available)
//    instead of making new calls, reserving the remaining budget for writes.

const GRAPH = 'https://graph.facebook.com/v21.0'

type CacheEntry = { body: unknown; at: number }
const readCache = new Map<string, CacheEntry>()
const MAX_CACHE_ENTRIES = 500

// Rolling app-usage estimate (0-100), parsed from Facebook response headers
let appUsagePct = 0
let appUsageAt = 0
const USAGE_STALE_MS = 5 * 60 * 1000

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80004, 80003, 80002, 80001, 80000])

export class FbGraphError extends Error {
  code: number | undefined
  isRateLimit: boolean
  constructor(message: string, code?: number) {
    super(message)
    this.code = code
    this.isRateLimit = code !== undefined && RATE_LIMIT_CODES.has(code)
  }
}

function trackUsage(res: Response) {
  try {
    const h = res.headers.get('x-app-usage') || res.headers.get('x-ad-account-usage')
    if (!h) return
    const j = JSON.parse(h) as { call_count?: number; total_time?: number; total_cputime?: number }
    appUsagePct = Math.max(j.call_count ?? 0, j.total_time ?? 0, j.total_cputime ?? 0)
    appUsageAt = Date.now()
  } catch {
    // header formats vary; usage tracking is best-effort
  }
}

function underPressure(): boolean {
  return Date.now() - appUsageAt < USAGE_STALE_MS && appUsagePct >= 90
}

/** Current app quota usage (0-100) as last reported by Facebook, or null. */
export function getAppUsage(): { pct: number; at: number } | null {
  return appUsageAt ? { pct: appUsagePct, at: appUsageAt } : null
}

function cacheKeyFor(url: string): string {
  // Tokens can rotate; strip them from the key so the cache survives rotation
  return url.replace(/access_token=[^&]+/g, 'access_token=x')
}

function setCache(key: string, body: unknown) {
  if (readCache.size >= MAX_CACHE_ENTRIES) {
    // Drop oldest ~10% so we never grow unbounded on long-lived instances
    const entries = [...readCache.entries()].sort((a, b) => a[1].at - b[1].at)
    for (const [k] of entries.slice(0, Math.ceil(MAX_CACHE_ENTRIES / 10))) readCache.delete(k)
  }
  readCache.set(key, { body, at: Date.now() })
}

async function rawFetch(url: string, init?: RequestInit): Promise<{ res: Response; json: Record<string, unknown> }> {
  const res = await fetch(url, init)
  trackUsage(res)
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  return { res, json }
}

function errorFrom(json: Record<string, unknown>): FbGraphError {
  const err = (json?.error ?? {}) as { message?: string; code?: number }
  return new FbGraphError(err.message || 'Facebook API error', err.code)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface FbGetOptions {
  /** Cache TTL in ms. 0 disables caching. Default 5 minutes. */
  cacheTtl?: number
  /** Serve stale cache instead of calling when app usage >= 90%. Default true. */
  staleWhenLimited?: boolean
}

/**
 * Cached GET. `url` must be the full Graph URL including the access token.
 * Throws FbGraphError on failure with no cache to fall back on.
 */
export async function fbGet<T = Record<string, unknown>>(url: string, opts: FbGetOptions = {}): Promise<T> {
  const { cacheTtl = 5 * 60 * 1000, staleWhenLimited = true } = opts
  const key = cacheKeyFor(url)
  const hit = cacheTtl > 0 ? readCache.get(key) : undefined

  // Fresh cache: no API call at all
  if (hit && Date.now() - hit.at < cacheTtl) return hit.body as T

  // Quota nearly exhausted: prefer ANY cached copy over burning a call
  if (hit && staleWhenLimited && underPressure()) return hit.body as T

  const { res, json } = await rawFetch(url)
  if (!res.ok || json.error) {
    const err = errorFrom(json)
    // Rate limited (or any failure) with an old copy available: serve stale
    if (hit) return hit.body as T
    throw err
  }
  if (cacheTtl > 0) setCache(key, json)
  return json as T
}

/**
 * Follow Graph pagination, concatenating `data` arrays across pages (cached
 * as a single unit). `firstUrl` should include limit + access token.
 */
export async function fbGetAll<T = Record<string, unknown>>(
  firstUrl: string,
  opts: FbGetOptions & { maxPages?: number } = {},
): Promise<T[]> {
  const { cacheTtl = 5 * 60 * 1000, staleWhenLimited = true, maxPages = 20 } = opts
  const key = 'all:' + cacheKeyFor(firstUrl)
  const hit = cacheTtl > 0 ? readCache.get(key) : undefined
  if (hit && Date.now() - hit.at < cacheTtl) return hit.body as T[]
  if (hit && staleWhenLimited && underPressure()) return hit.body as T[]

  const out: T[] = []
  let url: string | null = firstUrl
  let pages = 0
  try {
    while (url && pages < maxPages) {
      const { res, json } = await rawFetch(url)
      if (!res.ok || json.error) throw errorFrom(json)
      out.push(...((json.data as T[]) || []))
      url = (json.paging as { next?: string } | undefined)?.next || null
      pages++
    }
  } catch (e) {
    if (hit) return hit.body as T[] // stale beats broken
    throw e
  }
  if (cacheTtl > 0) setCache(key, out)
  return out
}

export interface FbWriteOptions {
  /** Max retry attempts on rate limit. Default 4 (waits ~2s, 8s, 30s, 75s). */
  retries?: number
  method?: 'POST' | 'DELETE'
  /** URL-encoded form body (POST only) */
  body?: URLSearchParams
}

/**
 * Rate-limit-resilient write. Retries with exponential backoff on Facebook
 * throttling errors so publishing and boosting survive quota pressure.
 * Never cached. Throws FbGraphError once retries are exhausted.
 */
export async function fbWrite<T = Record<string, unknown>>(url: string, opts: FbWriteOptions = {}): Promise<T> {
  const { retries = 4, method = 'POST', body } = opts
  const waits = [2000, 8000, 30000, 75000]
  let lastErr: FbGraphError | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    const { res, json } = await rawFetch(url, {
      method,
      ...(body ? { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body } : {}),
    })
    if (res.ok && !json.error) return json as T
    lastErr = errorFrom(json)
    // Only throttling errors are worth retrying; real errors fail fast
    if (!lastErr.isRateLimit || attempt === retries) throw lastErr
    await sleep(waits[Math.min(attempt, waits.length - 1)])
  }
  throw lastErr ?? new FbGraphError('Facebook API error')
}
