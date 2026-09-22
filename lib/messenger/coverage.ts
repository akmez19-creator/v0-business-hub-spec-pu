import 'server-only'
import { fbGet } from '@/lib/facebook/graph'
import { getInboxPages } from '@/lib/facebook/messages'
import { connectInboxDatabase } from '@/lib/messenger/pg'
import { APPROVED_PAGES, GRAPH_VERSION, keyFor } from '@/lib/messenger/recovery/history-core.mjs'

/**
 * "Is every message really getting into my system?"
 *
 * The webhook cannot answer that: a delivery Meta never made leaves no trace on
 * our side. The only record that can is Meta's own conversation list, so this
 * check reads it for the window and compares each thread's updated_time with the
 * newest message we hold for that customer. It is the same evidence rule the
 * recovery cron uses to decide what to fetch, run on demand and reported back.
 */

/** Meta stamps updated_time a moment after the message it reflects. */
const ACTIVITY_SKEW_MS = 2_000
const GRAPH_PAGE_LIMIT = 100
const MAX_GRAPH_PAGES = 6

type GraphConversation = {
  id: string
  updated_time: string
  participants?: { data?: { id: string; name?: string }[] }
}
type GraphPage = { data?: GraphConversation[]; paging?: { next?: string } }

export type BehindThread = {
  psid: string
  name: string
  metaUpdatedAt: string
  ourLastAt: string | null
  /** null when we hold no message at all for this customer */
  minutesBehind: number | null
  recovery: { status: 'pending' | 'blocked' | 'complete' | 'not_queued' | string; retryAt: string | null }
}

export type PageCoverage = {
  id: string
  name: string
  metaActive: number
  held: number
  behind: BehindThread[]
  inbound: { total: number; live: number; recovered: number }
  recovery: { lastRunAt: string | null; pending: number; blocked: number }
  error: string | null
}

export type CoverageReport = {
  windowHours: number
  since: string
  checkedAt: string
  pages: PageCoverage[]
}

async function metaActiveThreads(pageId: string, token: string, since: Date): Promise<GraphConversation[]> {
  const first = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/conversations`)
  first.search = new URLSearchParams({
    access_token: token,
    fields: 'id,updated_time,participants{id,name}',
    limit: String(GRAPH_PAGE_LIMIT),
  }).toString()

  const active: GraphConversation[] = []
  let url: string | undefined = first.toString()
  for (let page = 0; url && page < MAX_GRAPH_PAGES; page++) {
    const body: GraphPage = await fbGet<GraphPage>(url, { cacheTtl: 0, staleWhenLimited: false })
    let reachedWindowEnd = false
    for (const row of body.data ?? []) {
      if (!row?.id || !row.updated_time) continue
      if (Date.parse(row.updated_time) < since.getTime()) { reachedWindowEnd = true; break }
      active.push(row)
    }
    if (reachedWindowEnd) break
    const next = body.paging?.next
    // Meta lists conversations newest first; only follow its own pagination links.
    url = next && new URL(next).origin === 'https://graph.facebook.com' ? next : undefined
  }
  return active
}

function customerOf(row: GraphConversation, pageId: string): { psid: string; name: string } | null {
  const others = (row.participants?.data ?? []).filter(p => p?.id && p.id !== pageId)
  if (others.length !== 1) return null
  return { psid: others[0].id, name: others[0].name?.trim() || `Customer …${others[0].id.slice(-4)}` }
}

export async function checkCoverage(windowHours: number): Promise<CoverageReport> {
  const since = new Date(Date.now() - windowHours * 3_600_000)
  const sinceIso = since.toISOString()
  const configured = await getInboxPages().catch(() => [])
  const fallbackToken = process.env.FACEBOOK_ACCESS_TOKEN ?? ''

  const client = await connectInboxDatabase()
  try {
    const inboundRows = await client.query<{ page_id: string; total: string; live: string; recovered: string }>(
      `SELECT page_id, COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE inserted_at - created_at < interval '60 seconds')::text AS live,
              COUNT(*) FILTER (WHERE inserted_at - created_at >= interval '60 seconds')::text AS recovered
         FROM messenger_messages
        WHERE direction = 'in' AND created_at > $1::timestamptz
        GROUP BY page_id`, [sinceIso])
    const inboundByPage = new Map(inboundRows.rows.map(r => [r.page_id, { total: Number(r.total), live: Number(r.live), recovered: Number(r.recovered) }]))

    const queueRows = await client.query<{ page_id: string; pending: string; blocked: string }>(
      `SELECT cursor::jsonb->>'pageId' AS page_id,
              COUNT(*) FILTER (WHERE cursor::jsonb->>'status' = 'pending')::text AS pending,
              COUNT(*) FILTER (WHERE cursor::jsonb->>'status' = 'blocked')::text AS blocked
         FROM inbox_sync_state
        WHERE key LIKE 'messenger:history:v1:%'
          AND cursor::jsonb->>'mode' = 'recent' AND cursor::jsonb->>'kind' = 'thread'
        GROUP BY 1`)
    const queueByPage = new Map(queueRows.rows.map(r => [r.page_id, { pending: Number(r.pending), blocked: Number(r.blocked) }]))

    const pages: PageCoverage[] = []
    for (const pageId of APPROVED_PAGES as string[]) {
      const page = configured.find(p => p.id === pageId)
      const name = page?.name ?? pageId
      const inbound = inboundByPage.get(pageId) ?? { total: 0, live: 0, recovered: 0 }
      const discovery = await client.query<{ last_run_at: string | null }>(
        'SELECT last_run_at FROM inbox_sync_state WHERE key = $1', [keyFor(pageId)])
      const recovery = {
        lastRunAt: discovery.rows[0]?.last_run_at ? new Date(discovery.rows[0].last_run_at).toISOString() : null,
        ...(queueByPage.get(pageId) ?? { pending: 0, blocked: 0 }),
      }

      let active: GraphConversation[]
      try {
        active = await metaActiveThreads(pageId, page?.access_token ?? fallbackToken, since)
      } catch {
        pages.push({ id: pageId, name, metaActive: 0, held: 0, behind: [], inbound, recovery,
          error: 'Meta did not answer the conversation list; try again in a minute.' })
        continue
      }

      const customers = active.map(row => ({ row, customer: customerOf(row, pageId) }))
        .filter((x): x is { row: GraphConversation; customer: { psid: string; name: string } } => x.customer !== null)
      const psids = customers.map(x => x.customer.psid)
      const ours = psids.length
        ? await client.query<{ psid: string; last_at: string }>(
            `SELECT psid, MAX(created_at) AS last_at FROM messenger_messages
              WHERE page_id = $1 AND psid = ANY($2::text[]) GROUP BY psid`, [pageId, psids])
        : { rows: [] as { psid: string; last_at: string }[] }
      const ourLast = new Map(ours.rows.map(r => [r.psid, Date.parse(r.last_at)]))

      const behindRaw = customers.flatMap(({ row, customer }) => {
        const meta = Date.parse(row.updated_time)
        const held = ourLast.get(customer.psid)
        if (held !== undefined && meta - held <= ACTIVITY_SKEW_MS) return []
        return [{ row, customer, meta, held: held ?? null }]
      })

      const jobKeys = behindRaw.map(b => keyFor(pageId, b.row.id) as string)
      const jobs = jobKeys.length
        ? await client.query<{ key: string; status: string | null; retry_at: string | null }>(
            `SELECT key, cursor::jsonb->>'status' AS status, cursor::jsonb->>'retryAt' AS retry_at
               FROM inbox_sync_state WHERE key = ANY($1::text[])`, [jobKeys])
        : { rows: [] as { key: string; status: string | null; retry_at: string | null }[] }
      const jobByKey = new Map(jobs.rows.map(j => [j.key, j]))

      const behind: BehindThread[] = behindRaw.map((b, i) => {
        const job = jobByKey.get(jobKeys[i])
        return {
          psid: b.customer.psid,
          name: b.customer.name,
          metaUpdatedAt: new Date(b.meta).toISOString(),
          ourLastAt: b.held === null ? null : new Date(b.held).toISOString(),
          minutesBehind: b.held === null ? null : Math.max(1, Math.round((b.meta - b.held) / 60_000)),
          recovery: {
            status: job?.status ?? 'not_queued',
            retryAt: job?.retry_at ? new Date(job.retry_at).toISOString() : null,
          },
        }
      }).sort((a, b) => Date.parse(b.metaUpdatedAt) - Date.parse(a.metaUpdatedAt))

      pages.push({ id: pageId, name, metaActive: customers.length, held: customers.length - behind.length, behind, inbound, recovery, error: null })
    }

    return { windowHours, since: sinceIso, checkedAt: new Date().toISOString(), pages }
  } finally {
    await client.end().catch(() => {})
  }
}
