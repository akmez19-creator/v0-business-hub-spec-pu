import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { CmsEvent, CmsOrder, CmsFilters } from '@/lib/cms-log-shared'

/**
 * SERVER-ONLY read layer for the append-only CMS event log.
 *
 * The log is written by a DB trigger (trg_log_cms_event), never by app code,
 * so every writer is covered - rider app, admin edits, modifications approval,
 * CSV import and raw SQL alike.
 *
 * Types, display metadata and summarise() live in cms-log-shared.ts because
 * the admin module is a client component. Importing them from here would pull
 * next/headers into the browser bundle and break the build. The 'server-only'
 * import above turns that mistake into a clear error instead of a confusing
 * Turbopack trace.
 */

export type { CmsEvent, CmsOrder, CmsFilters, CmsSummary } from '@/lib/cms-log-shared'
export { REASON_META, reasonMeta, summarise } from '@/lib/cms-log-shared'

/**
 * Loads the full CMS picture: every logged event, grouped per order, joined to
 * the delivery and rider so the module can show detail without N+1 queries.
 */
export async function getCmsLog(filters: CmsFilters = {}) {
  const supabase = await createClient()

  let q = supabase
    .from('cms_log')
    .select('*')
    .order('changed_at', { ascending: false })
    .limit(4000)

  if (filters.from) q = q.gte('changed_at', `${filters.from}T00:00:00`)
  if (filters.to) q = q.lte('changed_at', `${filters.to}T23:59:59`)
  if (filters.reason) q = q.eq('reason_code', filters.reason)
  if (filters.riderId) q = q.eq('rider_id', filters.riderId)

  const { data: events, error } = await q
  if (error) return { orders: [] as CmsOrder[], error: error.message }
  if (!events?.length) return { orders: [] as CmsOrder[], error: null }

  const deliveryIds = [...new Set(events.map(e => e.delivery_id))]
  const riderIds = [...new Set(events.map(e => e.rider_id).filter(Boolean))] as string[]

  // `locality` is the area column on deliveries - there is no `region` column
  // here (that name belongs to clients). Asking for one made PostgREST reject
  // the WHOLE select with 42703, so every order lost its name, contact and
  // area at once and the list read "Unknown client" from top to bottom.
  const [delsRes, ridersRes] = await Promise.all([
    supabase
      .from('deliveries')
      .select('id, index_no, customer_name, contact_1, locality, amount, status, delivery_date, rider_id')
      .in('id', deliveryIds),
    riderIds.length
      ? supabase.from('riders').select('id, name').in('id', riderIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
  ])

  // Never swallow this. A failed join still renders - amount, rider and date
  // quietly fall back to the log row - so the page looks merely "empty" rather
  // than broken, and a one-word column typo can sit in production unnoticed.
  if (delsRes.error) {
    return { orders: [] as CmsOrder[], error: `Could not load orders: ${delsRes.error.message}` }
  }
  const dels = delsRes.data
  const riders = ridersRes.data

  const delMap = new Map((dels || []).map(d => [d.id, d]))
  const riderMap = new Map((riders || []).map(r => [r.id, r.name]))

  // Group events per order. Events arrive newest-first; each order's own
  // timeline is flipped to oldest-first so it reads as a story.
  const grouped = new Map<string, CmsEvent[]>()
  for (const e of events as CmsEvent[]) {
    const list = grouped.get(e.delivery_id)
    if (list) list.push(e)
    else grouped.set(e.delivery_id, [e])
  }

  let orders: CmsOrder[] = [...grouped.entries()].map(([deliveryId, evs]) => {
    const timeline = [...evs].reverse()
    const latest = evs[0] ?? null
    const d = delMap.get(deliveryId)

    // Distinct consecutive reasons - this is the history that used to be lost.
    const reasonTrail: string[] = []
    for (const e of timeline) {
      const t = (e.reason_text || '').trim()
      if (t && t !== reasonTrail[reasonTrail.length - 1]) reasonTrail.push(t)
    }

    const resolved = latest?.event === 'resolved' || (d ? d.status !== 'cms' : false)

    return {
      deliveryId,
      indexNo: d?.index_no ?? null,
      customerName: d?.customer_name ?? null,
      contact: d?.contact_1 ?? null,
      locality: d?.locality ?? null,
      amount: d?.amount ?? latest?.amount ?? null,
      currentStatus: d?.status ?? null,
      deliveryDate: d?.delivery_date ?? latest?.delivery_date ?? null,
      riderName: riderMap.get(d?.rider_id || latest?.rider_id || '') ?? null,
      events: timeline,
      reasonTrail,
      attempts: timeline.filter(e => e.event !== 'resolved').length,
      latest,
      resolved,
      postponed: !!latest?.is_postponed && !resolved,
      postponedTo: latest?.postponed_to ?? null,
      reconstructedOnly: timeline.every(e => e.backfilled),
    }
  })

  if (filters.state === 'open') orders = orders.filter(o => !o.resolved)
  if (filters.state === 'resolved') orders = orders.filter(o => o.resolved)

  if (filters.q) {
    const needle = filters.q.toLowerCase()
    orders = orders.filter(o =>
      (o.customerName || '').toLowerCase().includes(needle) ||
      (o.indexNo || '').toLowerCase().includes(needle) ||
      (o.contact || '').toLowerCase().includes(needle) ||
      o.reasonTrail.some(r => r.toLowerCase().includes(needle))
    )
  }

  orders.sort((a, b) =>
    (b.latest?.changed_at || '').localeCompare(a.latest?.changed_at || ''))

  return { orders, error: null }
}

/** Rider list for the filter dropdown. */
export async function getCmsRiders() {
  const supabase = await createClient()
  const { data } = await supabase.from('riders').select('id, name').order('name')
  return data || []
}
