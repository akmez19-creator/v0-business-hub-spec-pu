import { FbGraphError } from './graph'

const GRAPH = 'https://graph.facebook.com/v21.0'

/** The error envelope Graph returns inside a 200-status body. */
type FbErrorBody = { message?: string; code?: number; is_transient?: boolean }

function toGraphError(e: FbErrorBody): FbGraphError {
  const err = new FbGraphError(e.message ?? 'Facebook request failed', e.code)
  // Graph flags some throttles only via is_transient, so trust it too rather
  // than relying solely on the known-codes list.
  if (e.is_transient) err.isRateLimit = true
  return err
}

export type FbPage = {
  id: string
  name: string
  access_token: string
  /**
   * True when the Page came from /me/accounts, i.e. it was explicitly granted
   * to the app during login. Pages found only through ad-account discovery are
   * manageable but were never deliberately connected, so anything that has to
   * pick ONE Page on the user's behalf should prefer a granted one.
   */
  direct?: boolean
}

// Discovery costs 10+ Graph calls, and Facebook enforces an app-wide hourly
// request limit (error #4). Page lists change rarely, so cache per token for
// 10 minutes. Module-level cache survives across warm serverless invocations.
const cache = new Map<string, { pages: FbPage[]; at: number }>()
const CACHE_TTL_MS = 10 * 60 * 1000

// Facebook's /me/accounts only returns pages granted during the app's login
// flow (granular scoping) - it can silently hide pages the user actually
// manages. So we ALSO discover pages through the ad accounts' promote_pages
// edge and try to resolve a page access token for each directly. Any page
// that hands us a token is manageable and gets included.
export async function getManageablePages(token: string): Promise<FbPage[]> {
  const cacheKey = token.slice(-24)
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.pages

  const enc = encodeURIComponent(token)
  const byId = new Map<string, FbPage>()
  // A transient failure (rate limit) looks EXACTLY like "this token sees no
  // pages" once the body is discarded, and the UI turns that into a "your
  // token is broken, regenerate it" errand. That advice is actively harmful:
  // a Graph Explorer token is short-lived, so following it would replace a
  // working never-expiring token with one that dies in ~2 hours. Remember
  // why the list was empty so the caller can tell the two apart.
  let transient: FbGraphError | null = null

  // 1. The straightforward path: pages granted to the app
  try {
    const res = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token&limit=100&access_token=${enc}`)
    const json = (await res.json()) as { data?: FbPage[]; error?: FbErrorBody }
    if (json.error) {
      const err = toGraphError(json.error)
      if (err.isRateLimit || json.error.is_transient) transient = err
    }
    for (const p of json.data ?? []) {
      if (p.access_token) byId.set(p.id, { ...p, direct: true })
    }
  } catch {
    // fall through to discovery
  }

  // 2. Discovery: pages promotable from the user's ad accounts
  const candidates = new Map<string, string>() // id -> name
  try {
    const acctRes = await fetch(`${GRAPH}/me/adaccounts?fields=id&limit=50&access_token=${enc}`)
    const acctJson = (await acctRes.json()) as { data?: { id: string }[] }
    const accounts = (acctJson.data ?? []).slice(0, 10)
    const results = await Promise.all(
      accounts.map(async (a) => {
        try {
          const r = await fetch(`${GRAPH}/${a.id}/promote_pages?fields=id,name&limit=50&access_token=${enc}`)
          const j = (await r.json()) as { data?: { id: string; name: string }[] }
          return j.data ?? []
        } catch {
          return []
        }
      }),
    )
    for (const list of results) {
      for (const p of list) {
        if (!byId.has(p.id)) candidates.set(p.id, p.name)
      }
    }
  } catch {
    // me/accounts result stands alone
  }

  // 3. Resolve page tokens for candidates - only works where the user has a
  // page role, which is exactly the filter we want
  const entries = Array.from(candidates.entries())
  const resolved = await Promise.all(
    entries.map(async ([id, name]) => {
      try {
        const r = await fetch(`${GRAPH}/${id}?fields=access_token&access_token=${enc}`)
        const j = (await r.json()) as { access_token?: string }
        return j.access_token ? { id, name, access_token: j.access_token } : null
      } catch {
        return null
      }
    }),
  )
  for (const p of resolved) {
    if (p) byId.set(p.id, p)
  }

  const pages = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name))
  // Empty AND we know Facebook throttled us: report the throttle rather than
  // letting it masquerade as a permissions problem.
  if (pages.length === 0 && transient) throw transient
  // Don't cache empty results - a rate-limited or failed pass shouldn't
  // stick for 10 minutes and hide every page
  if (pages.length > 0) cache.set(cacheKey, { pages, at: Date.now() })
  return pages
}
