import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { fetchInboundReturns, buildContractorData } from '@/lib/returns-inbound'
import { fetchOutgoingLoads, buildOutgoingData } from '@/lib/stock-outgoing'
import { fetchShortageReports, buildShortages } from '@/lib/stock-availability'
import { pickActiveDate, todayInMauritius, yesterdayInMauritius } from '@/lib/business-date'
import { StockValidation } from '@/components/admin/stock-validation'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata = {
  title: 'Stock Validation',
  description: 'Returns that left with a rider and were never counted back in.',
}

type Scope = 'round' | 'yesterday' | 'range' | 'all'

export default async function StockValidationPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; from?: string; to?: string; view?: string }>
}) {
  const params = await searchParams
  // Outgoing leads by default: it is the check that can still be acted on
  // while the rider is in the warehouse, whereas returns are reviewed later.
  const view: 'out' | 'in' | 'nostock' =
    params.view === 'in' ? 'in' : params.view === 'nostock' ? 'nostock' : 'out'
  const supabase = await createClient()
  const adminDb = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await adminDb
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'admin' && profile.role !== 'manager')) {
    redirect('/dashboard')
  }

  // Exactly the same loader the storekeeper screen uses, so the two screens
  // cannot disagree about what is outstanding.
  const { deliveries, returnCollections, ctx, dates, shortfallCaps } =
    await fetchInboundReturns(adminDb)

  const today = todayInMauritius()
  const lastRound = pickActiveDate(dates, today)
  const yesterday = yesterdayInMauritius(today)

  const scope: Scope = params.from || params.to
    ? 'range'
    : (['round', 'yesterday', 'all'].includes(params.scope || '') ? params.scope as Scope : 'round')

  // Resolve the scope to an inclusive window. 'all' deliberately has none:
  // the point of that view is the backlog no date filter would ever surface.
  let from: string | null = null
  let to: string | null = null
  if (scope === 'round') { from = lastRound; to = lastRound }
  else if (scope === 'yesterday') { from = yesterday; to = yesterday }
  else if (scope === 'range') {
    from = params.from || params.to || null
    to = params.to || params.from || null
    if (from && to && from > to) [from, to] = [to, from]
  }

  const inWindow = (d: string) => (!from || d >= from) && (!to || d <= to)

  const scopedDeliveries = deliveries.filter(d => inWindow(d.delivery_date))
  const scopedCollections = returnCollections.filter(r => inWindow(r.collection_date))

  const contractors = buildContractorData(scopedDeliveries, scopedCollections, ctx, shortfallCaps)

  // The whole backlog, ignoring the window, so the header can say how much is
  // outstanding overall - otherwise a clean day reads as "nothing wrong" while
  // older rows sit unvalidated forever.
  const backlog = buildContractorData(
    deliveries.filter(d => !d.stock_verified),
    returnCollections.filter(r => !r.verified),
    ctx,
    shortfallCaps,
  )
  const backlogUnits = backlog.reduce((s, c) => s + c.pendingQty, 0)
  const oldestOutstanding = backlog
    .flatMap(c => c.items.filter(i => !i.verified).map(i => i.date))
    .sort()[0] ?? null

  // OPENING STOCK: what should have been counted ONTO each van before the
  // round started. Same window as the returns view so the two tabs describe
  // the same day rather than silently drifting apart.
  const { rows: outgoingRows, nameById } = await fetchOutgoingLoads(adminDb)
  const outgoing = buildOutgoingData(
    outgoingRows.filter(r => inWindow(r.delivery_date)),
    nameById,
  )

  // The whole uncounted-out backlog, ignoring the window, for the same reason
  // the returns view carries one: a tidy day must not read as "all fine" while
  // older loads sit unverified. Future-dated rounds are excluded - a van that
  // has not been loaded yet is not a missed count.
  const outgoingBacklogUnits = buildOutgoingData(
    outgoingRows.filter(r => r.delivery_date <= today),
    nameById,
  ).reduce((s, c) => s + c.pendingQty, 0)

  // "There was none to give." REPORTED, never inferred - by the storekeeper as
  // he validates stock out, or by the rider as he counts his load in the
  // morning. The catalogue is not consulted at all: its quantity and zone
  // columns vary far too much to accuse anyone with. Same window as the rest of
  // the page, and future rounds are dropped - a van not yet loaded cannot be a
  // shortage.
  const { storekeeperRows, riderRows } = await fetchShortageReports(adminDb)
  const shortages = buildShortages(
    storekeeperRows.filter(r => inWindow(r.delivery_date) && r.delivery_date <= today),
    riderRows.filter(r => inWindow(r.stock_date) && r.stock_date <= today),
    nameById,
  )
  // Every unit is a real report from a named person, so unlike the old guessed
  // count this one can be shown whole without qualification.
  const shortageUnits = shortages.reduce((s, g) => s + g.qty, 0)

  // Who signed off each already-validated row, so an admin catch-up is
  // distinguishable from the storekeeper's own count.
  const verifierIds = [...new Set([
    ...contractors.flatMap(c => c.items.map(i => i.verifiedBy)),
    ...outgoing.flatMap(c => c.products.flatMap(p => p.items.map(i => i.validatedBy))),
  ].filter(Boolean))] as string[]
  const { data: verifiers } = verifierIds.length
    ? await adminDb.from('profiles').select('id, name, email, role').in('id', verifierIds)
    : { data: [] }
  const verifierMap = Object.fromEntries(
    (verifiers || []).map(v => [v.id, { name: v.name || v.email || 'Unknown', role: v.role }]),
  )

  return (
    <StockValidation
      contractors={contractors}
      outgoing={outgoing}
      view={view}
      outgoingBacklogUnits={outgoingBacklogUnits}
      shortages={shortages}
      shortageUnits={shortageUnits}
      // The redirect above already turns away anyone who is not admin or
      // manager, so anybody who reaches this render may rule on a shortage.
      // Passed explicitly rather than hard-coded true so the button and the
      // server action are reading the same rule.
      canReview={profile.role === 'admin' || profile.role === 'manager'}
      scope={scope}
      from={from}
      to={to}
      today={today}
      lastRound={lastRound}
      yesterday={yesterday}
      availableDates={dates}
      backlogUnits={backlogUnits}
      backlogContractors={backlog.length}
      oldestOutstanding={oldestOutstanding}
      verifierMap={verifierMap}
    />
  )
}
