import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertTriangle, Calendar, Clock, RefreshCw, DollarSign, Truck, ShieldCheck, Check } from 'lucide-react'
import { buildVanPiles, vanTotal, carriedOverTotal } from '@/lib/van-stock'
import Link from 'next/link'
import { getPendingCmsModifications } from '@/lib/admin-actions'
import { cmsStage } from '@/components/admin/cms-delivery-row'
import { CmsStageSection } from '@/components/admin/cms-stage-section'
import { CmsVanStock } from '@/components/admin/cms-van-stock'
import { CmsPriceReview } from '@/components/admin/cms-price-review'

export default async function CMSAdminPage() {
  const supabase = await createClient()
  const adminDb = createAdminClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  
  const { data: currentProfile } = await adminDb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()
  
  if (!currentProfile || !['admin', 'manager'].includes(currentProfile.role)) {
    redirect('/dashboard')
  }

  // Get CMS modifications for review
  const { modifications: cmsModifications } = await getPendingCmsModifications()
  const pendingModifications = cmsModifications?.filter(m => m.status === 'pending') || []
  const reviewedModifications = cmsModifications?.filter(m => m.status !== 'pending') || []
  
  // Get all CMS deliveries with related data
  const { data: cmsDeliveries } = await supabase
    .from('deliveries')
    .select(`
      id,
      order_code,
      customer_name,
      contact_1,
      contact_2,
      locality,
      products,
      qty,
      amount,
      status,
      delivery_notes,
      delivery_date,
      rescheduled_to,
      reschedule_requested_to,
      reschedule_reason,
      reschedule_validated_at,
      reschedule_declined_at,
      active_date,
      status_updated_at,
      rider_id,
      contractor_id,
      latitude,
      longitude,
      sales_type
    `)
    .eq('status', 'cms')
    .order('status_updated_at', { ascending: false })
  
  // NWD - refused on delivery, goods STAYED ON THE VAN (owner-confirmed).
  //
  // Queried SEPARATELY rather than widening the CMS query above to
  // `.in('status', ['cms','nwd'])`, on purpose: every stat card, reason group
  // and rider group on this page means "CMS". Folding NWD in would silently
  // turn "Total CMS 114" into 172 and mix in 58 rows whose goods are on a van,
  // not in the store. Two different physical facts must not share one number.
  //
  // NOT date-filtered: nothing collects NWD, so it carries over. All 58 live
  // rows sit on 24 Aug - a date filter is what made them invisible everywhere.
  const { data: nwdRows } = await adminDb
    .from('deliveries')
    .select(`
      id, customer_name, contact_1, locality, products, qty, amount,
      status, delivery_notes, delivery_date, rescheduled_to, rider_id
    `)
    // `IS NOT TRUE`, never `= false`: `= false` drops NULLs in Postgres and
    // would hide van stock instead of surfacing it.
    .eq('status', 'nwd')
    .not('stock_verified', 'is', true)
    .order('delivery_date', { ascending: false })

  // Fetch ALL riders from the riders table (rider_id in deliveries references riders.id, NOT profiles.id)
  const { data: allRidersData } = await adminDb
    .from('riders')
    .select('id, name, first_name, surname, phone, contractor_id, is_active')
    .eq('is_active', true)
    .order('name')
  
  // Also fetch contractors from profiles (for contractor_id mapping)
  const { data: contractorProfiles } = await adminDb
    .from('profiles')
    .select('id, name, email')
    .eq('role', 'contractor')
  
  const riderMap: Record<string, string> = {}
  const contractorMap: Record<string, string> = {}
  
  // Build rider map from riders table
  for (const r of (allRidersData || [])) {
    const displayName = r.name || (r.first_name && r.surname ? `${r.first_name} ${r.surname}` : r.first_name || r.surname) || 'Unnamed Rider'
    riderMap[r.id] = displayName
  }
  
  // Build contractor map from profiles
  for (const c of (contractorProfiles || [])) {
    contractorMap[c.id] = c.name || c.email || 'Unknown Contractor'
  }
  
  // All riders for dropdown
  const allRiders = (allRidersData || []).map(r => ({
    id: r.id,
    name: r.name || (r.first_name && r.surname ? `${r.first_name} ${r.surname}` : r.first_name || r.surname) || 'Unnamed Rider',
    email: r.phone || '',
    role: 'rider' as const
  }))
  
  // Get all regions for editing
  const { data: regions } = await adminDb
    .from('deliveries')
    .select('locality')
    .not('locality', 'is', null)
  const uniqueRegions = [...new Set((regions || []).map(r => r.locality).filter(Boolean))].sort()
  
  // Get all products for editing
  const { data: productsData } = await adminDb
    .from('products')
    .select('name')
    .eq('is_active', true)
    .order('name')
  const allProducts = (productsData || []).map(p => p.name)
  
  // STAGES OF THE FLOW - one classifier, shared with the row component, so a
  // section, a stat card and a row badge can never contradict each other.
  //
  // Replaces three overlapping note-text filters. Those read only
  // `delivery_notes` for the word "Postponed to", which misses every order
  // whose new day lives in `rescheduled_to` / `reschedule_requested_to` and
  // nowhere in the text - and 28 of the 32 live postponements are exactly that
  // shape, written by day-closure with no note and no audit row.
  const staged = (cmsDeliveries || []).map(d => ({ d, stage: cmsStage(d) }))

  // Needs a decision from this page. Soonest day first: the order due tomorrow
  // matters more than the one due next week.
  const toValidate = staged
    .filter(s => s.stage.kind === 'validate')
    .sort((a, b) => (a.stage.postponedTo || '').localeCompare(b.stage.postponedTo || ''))
  const scheduledCms = staged.filter(s => s.stage.kind === 'scheduled')
  const pendingCms = staged.filter(s => s.stage.kind === 'pending')
  const reviewedCms = staged.filter(s => s.stage.kind === 'reviewed')

  // Everything the row component needs, passed once instead of at five call sites.
  const rowProps = {
    riderMap,
    riders: allRiders || [],
    regions: uniqueRegions,
    products: allProducts,
    today: new Date().toISOString().split('T')[0],
  }
  
  // `reasonCounts`, `riderCounts`, `sortedRiders` and `olderCms` used to be
  // built here. All four were computed on every request and rendered nowhere -
  // three of them looping the full CMS list to produce groupings no section
  // consumed. Removed rather than left as decoration; the stage sections below
  // are what this page actually shows.
  const today = new Date().toISOString().split('T')[0]
  const todayCms = (cmsDeliveries || []).filter(d => d.delivery_date === today)

  // Van stock grouped BY RIDER, then merged per product.
  //
  // By rider first because the goods are physically on ONE named van - a
  // company-wide product total would tell him 6 Salt Cups exist somewhere but
  // not whose van to call. Product merge inside each rider reuses the same
  // `buildVanPiles` as the rider and contractor screens, so a product collapses
  // identically on every screen.
  const nwdByRider = new Map<string, { name: string; rows: typeof nwdRows }>()
  for (const d of (nwdRows || [])) {
    const key = d.rider_id || 'unassigned'
    const name = d.rider_id ? (riderMap[d.rider_id] || 'Unknown rider') : 'Unassigned'
    if (!nwdByRider.has(key)) nwdByRider.set(key, { name, rows: [] })
    nwdByRider.get(key)!.rows!.push(d)
  }

  const vanByRider = [...nwdByRider.entries()]
    .map(([riderId, v]) => {
      const piles = buildVanPiles(
        (v.rows || []).map(r => ({
          id: r.id,
          product: r.products,
          qty: r.qty,
          status: r.status,
          deliveryDate: r.delivery_date,
          customerName: r.customer_name,
        })),
        today,
      )
      return {
        riderId,
        name: v.name,
        piles,
        units: vanTotal(piles),
        orders: (v.rows || []).length,
        stuckUnits: carriedOverTotal(piles, today),
      }
    })
    // Most stuck stock first - that is the rider to chase.
    .sort((a, b) => b.stuckUnits - a.stuckUnits || b.units - a.units)

  const vanUnitsTotal = vanByRider.reduce((s, r) => s + r.units, 0)
  const vanStuckTotal = vanByRider.reduce((s, r) => s + r.stuckUnits, 0)
  
  // `formatTime` and `formatDate` lived here and were never called - date
  // formatting belongs to the row and section components that actually render
  // dates, and each already has it.

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-amber-500" />
            CMS Management
          </h2>
          <p className="text-muted-foreground">
            Review &quot;Could Not Serve&quot; deliveries, plus refused stock still on the vans
          </p>
        </div>
        <Link href="/dashboard/admin/cms" className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-sm font-medium transition-colors">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Link>
      </div>
      
      {/* NEEDS YOU vs FOR REFERENCE.
          The six cards used to sit in one undifferentiated strip, so a figure
          you must act on looked exactly like a figure you cannot act on. Split
          into two labelled bands instead. */}
      <section aria-labelledby="needs-you">
        <h3 id="needs-you" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Waiting on you
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className={toValidate.length > 0 ? 'border-amber-500/40' : undefined}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                To validate
              </CardTitle>
              <ShieldCheck className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-500">{toValidate.length}</div>
              <p className="text-xs text-muted-foreground">Postponed, not yet confirmed</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                To review
              </CardTitle>
              <Clock className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-500">{pendingCms.length}</div>
              <p className="text-xs text-muted-foreground">Failed, no decision yet</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Price reviews
              </CardTitle>
              <DollarSign className="h-4 w-4 text-violet-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-violet-500">{pendingModifications.length}</div>
              <p className="text-xs text-muted-foreground">Pending approval</p>
            </CardContent>
          </Card>
        </div>
      </section>

      <section aria-labelledby="for-reference">
        <h3 id="for-reference" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          For reference
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total CMS
              </CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{cmsDeliveries?.length || 0}</div>
              <p className="text-xs text-muted-foreground">{todayCms.length} today</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Confirmed for a new day
              </CardTitle>
              <Calendar className="h-4 w-4 text-violet-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-violet-500">{scheduledCms.length}</div>
              <p className="text-xs text-muted-foreground">Validated, in the flow</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Reviewed
              </CardTitle>
              <Check className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-500">{reviewedCms.length}</div>
              <p className="text-xs text-muted-foreground">Handled by admin</p>
            </CardContent>
          </Card>
          {/* Kept as its OWN figure, never added to "Total CMS": CMS goods come
              back to the store, these stayed on a van. One number cannot mean
              both places. */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                On vans (NWD)
              </CardTitle>
              <Truck className="h-4 w-4 text-sky-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-sky-500">{vanUnitsTotal}</div>
              <p className="text-xs text-muted-foreground">
                {vanStuckTotal > 0 ? `${vanStuckTotal} carried over` : 'Not in store stock'}
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* STAGE 1 - THE GATE. First on the page because it is the only section
          where an order is waiting on a decision that changes where it goes.
          A postponed date is NOT a plan until somebody validates it. */}
      <CmsStageSection
        title="Postponements to validate"
        description="Soonest day first. Validate to confirm the order into the flow, change the day if it does not suit, or reject to put it back on its original date."
        icon={<ShieldCheck className="h-5 w-5" />}
        rows={toValidate}
        rowProps={rowProps}
        cardClassName="border-amber-500/40 bg-amber-500/[0.04]"
        titleClassName="text-amber-500"
      />
      
      {/* PRICE ADJUSTMENTS - pending above, already-decided collapsed at the
          foot of its own component. The decided half was computed on this page
          and never rendered; it is now shown. */}
      <CmsPriceReview pending={pendingModifications} reviewed={reviewedModifications} />

      {/* NWD / STILL ON THE VANS - above the CMS list because these goods are
          in the field, not in the store, and nothing has ever reviewed them:
          all 58 live rows were unreviewed because this page filtered on
          status='cms' and never showed them at all. */}
      <CmsVanStock
        vanByRider={vanByRider}
        vanUnitsTotal={vanUnitsTotal}
        vanStuckTotal={vanStuckTotal}
      />

      {/* STAGE 2 - failed, and nobody has decided anything yet. */}
      <CmsStageSection
        title="Awaiting a decision"
        description="The rider could not serve these and no one has reviewed, postponed or resolved them yet."
        icon={<Clock className="h-5 w-5 text-amber-500" />}
        rows={pendingCms}
        rowProps={rowProps}
        cardClassName="border-amber-500/25"
      />

      {/* STAGE 3 - validated, so these ARE the plan now. */}
      <CmsStageSection
        title="Confirmed for a new day"
        description="Validated by an admin, so these are counted in the flow for the day shown. Use Reschedule to move one again - it will come back for validation."
        icon={<Calendar className="h-5 w-5" />}
        rows={scheduledCms}
        rowProps={rowProps}
        cardClassName="border-violet-500/25"
        titleClassName="text-violet-500"
      />

      {/* STAGE 4 - done. Collapsed: it is the longest list and the least
          urgent, and it used to sit interleaved with live work. */}
      <CmsStageSection
        title="Reviewed and closed"
        icon={<Check className="h-5 w-5 text-emerald-500" />}
        rows={reviewedCms}
        rowProps={rowProps}
        collapsible
      />

      {/* Empty State */}
      {/* Only claims success when BOTH lists are empty. With no CMS rows but
          refused stock on a van, "all deliveries completed successfully" would
          be a false all-clear. */}
      {(cmsDeliveries?.length || 0) === 0 && (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <AlertTriangle className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-muted-foreground">No CMS Deliveries</h3>
              <p className="text-sm text-muted-foreground/70">
                {vanUnitsTotal > 0
                  ? `No client was missed, but ${vanUnitsTotal} refused ${vanUnitsTotal === 1 ? 'unit is' : 'units are'} still on a van above.`
                  : 'All deliveries have been completed successfully'}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
