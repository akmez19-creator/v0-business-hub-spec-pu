/**
 * Pure CMS log types, display metadata and aggregation.
 *
 * Deliberately has NO import of '@/lib/supabase/server'. The admin module is a
 * client component, and importing anything from a module that pulls in
 * next/headers drags the server client into the browser bundle and fails the
 * Turbopack build. Keep this file free of server-only imports.
 */

/** Display metadata for each normalised reason bucket. */
export const REASON_META: Record<string, { label: string; tone: string; failure: boolean }> = {
  postponed:       { label: 'Postponed',       tone: 'text-violet-400 bg-violet-500/10 border-violet-500/25', failure: false },
  no_answer:       { label: 'No answer',       tone: 'text-amber-400 bg-amber-500/10 border-amber-500/25',    failure: true },
  cancelled:       { label: 'Cancelled',       tone: 'text-rose-400 bg-rose-500/10 border-rose-500/25',       failure: true },
  refused:         { label: 'Refused',         tone: 'text-rose-400 bg-rose-500/10 border-rose-500/25',       failure: true },
  switched_off:    { label: 'Phone off',       tone: 'text-amber-400 bg-amber-500/10 border-amber-500/25',    failure: true },
  wrong_number:    { label: 'Wrong number',    tone: 'text-orange-400 bg-orange-500/10 border-orange-500/25', failure: true },
  wrong_product:   { label: 'Wrong product',   tone: 'text-orange-400 bg-orange-500/10 border-orange-500/25', failure: true },
  out_of_stock:    { label: 'Out of stock',    tone: 'text-sky-400 bg-sky-500/10 border-sky-500/25',          failure: true },
  not_at_home:     { label: 'Not at home',     tone: 'text-amber-400 bg-amber-500/10 border-amber-500/25',    failure: true },
  address_problem: { label: 'Address problem', tone: 'text-orange-400 bg-orange-500/10 border-orange-500/25', failure: true },
  revert_back:     { label: 'Revert back',     tone: 'text-sky-400 bg-sky-500/10 border-sky-500/25',          failure: true },
  other:           { label: 'Other',           tone: 'text-muted-foreground bg-muted border-border',          failure: true },
  unspecified:     { label: 'No reason given', tone: 'text-muted-foreground bg-muted border-border',          failure: true },
}

export function reasonMeta(code: string | null) {
  return REASON_META[code || 'unspecified'] || REASON_META.other
}

export type CmsEvent = {
  id: number
  delivery_id: string
  event: string
  old_status: string | null
  new_status: string | null
  reason_text: string | null
  reason_code: string | null
  is_postponed: boolean
  postponed_to: string | null
  rider_id: string | null
  delivery_date: string | null
  amount: number | null
  changed_at: string
  backfilled: boolean
  note: string | null
}

export type CmsOrder = {
  deliveryId: string
  indexNo: string | null
  customerName: string | null
  contact: string | null
  /** Named after the real deliveries column. There is NO `region` column on
   *  deliveries - that name belongs to clients, and asking for it here kills
   *  the whole select. */
  locality: string | null
  amount: number | null
  currentStatus: string | null
  deliveryDate: string | null
  riderName: string | null
  events: CmsEvent[]
  /** Every distinct reason this order has ever carried, oldest first. */
  reasonTrail: string[]
  attempts: number
  latest: CmsEvent | null
  resolved: boolean
  /** True when the CURRENT reason is a reschedule rather than a failure. */
  postponed: boolean
  postponedTo: string | null
  /** No observed events at all - history predates the log. */
  reconstructedOnly: boolean
}

export type CmsFilters = {
  from?: string
  to?: string
  reason?: string
  riderId?: string
  /** 'open' = still CMS, 'resolved' = left CMS, 'all' */
  state?: string
  q?: string
}

/** Aggregate view used by the module header. Pure - safe on both sides. */
export function summarise(orders: CmsOrder[]) {
  const open = orders.filter(o => !o.resolved)
  const postponed = open.filter(o => o.postponed)
  // A repeat is an order that carried more than one DIFFERENT reason over time.
  const repeats = orders.filter(o => o.reasonTrail.length > 1)

  const byReason = new Map<string, number>()
  for (const o of open) {
    const code = o.latest?.reason_code || 'unspecified'
    byReason.set(code, (byReason.get(code) || 0) + 1)
  }

  const byRider = new Map<string, { total: number; postponed: number; failed: number }>()
  for (const o of open) {
    const name = o.riderName || 'Unassigned'
    const cur = byRider.get(name) || { total: 0, postponed: 0, failed: 0 }
    cur.total++
    if (o.postponed) cur.postponed++
    else cur.failed++
    byRider.set(name, cur)
  }

  const upcoming = new Map<string, number>()
  for (const o of postponed) {
    if (!o.postponedTo) continue
    upcoming.set(o.postponedTo, (upcoming.get(o.postponedTo) || 0) + 1)
  }

  return {
    total: orders.length,
    open: open.length,
    resolved: orders.length - open.length,
    postponed: postponed.length,
    genuineFailures: open.length - postponed.length,
    repeats: repeats.length,
    valueAtRisk: open.filter(o => !o.postponed)
      .reduce((s, o) => s + (Number(o.amount) || 0), 0),
    observedEvents: orders.reduce(
      (s, o) => s + o.events.filter(e => !e.backfilled).length, 0),
    reconstructed: orders.filter(o => o.reconstructedOnly).length,
    byReason: [...byReason.entries()].sort((a, b) => b[1] - a[1]),
    byRider: [...byRider.entries()].sort((a, b) => b[1].total - a[1].total),
    upcoming: [...upcoming.entries()].sort((a, b) => a[0].localeCompare(b[0])),
  }
}

export type CmsSummary = ReturnType<typeof summarise>
