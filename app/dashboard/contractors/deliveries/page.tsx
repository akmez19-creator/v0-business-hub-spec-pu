import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ContractorMobileLayout } from '@/components/contractor/mobile-layout'
import { OrdersContent } from '@/components/orders/orders-content'

export default async function ContractorOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; status?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Get profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/dashboard')

  // Get contractor record
  let contractor = null
  const { data: contractorByProfile } = await supabase
    .from('contractors')
    .select('*')
    .eq('profile_id', user.id)
    .single()

  if (contractorByProfile) {
    contractor = contractorByProfile
  } else if (profile?.contractor_id) {
    const { data: contractorById } = await supabase
      .from('contractors')
      .select('*')
      .eq('id', profile.contractor_id)
      .single()
    contractor = contractorById
  }

  if (!contractor) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Contractor profile not found</p>
      </div>
    )
  }

  // Get riders under this contractor
  const { data: allRiders } = await supabase
    .from('riders')
    .select('id, name, juice_policy')
    .eq('contractor_id', contractor.id)
    .order('name')

  const riders = allRiders || []
  const riderIds = riders.map(r => r.id)

  // Build juice policy map for payment proof requirements
  const riderJuicePolicies: Record<string, string> = {}
  for (const r of riders) {
    riderJuicePolicies[r.id] = (r as any).juice_policy || 'rider'
  }

  // Check if contractor also acts as rider
  const contractorAsRider = riders.find(r =>
    r.name?.toLowerCase() === contractor.name?.toLowerCase()
  ) || null

  // Get validated stock dates (only show orders for dates where stock is validated)
  let availableDates: string[] = []
  const { data: validatedStockDates } = await supabase
    .from('contractor_stock_validation')
    .select('stock_date')
    .eq('contractor_id', contractor.id)
    .eq('is_validated', true)
    .order('stock_date', { ascending: false })

  const validatedDateSet = new Set<string>(
    (validatedStockDates || []).map((v: any) => v.stock_date)
  )

  if (riderIds.length > 0 && validatedDateSet.size > 0) {
    // Only include dates that have validated stock AND deliveries
    const { data: dateRows } = await supabase
      .from('deliveries')
      .select('delivery_date')
      .in('rider_id', riderIds)
      .in('delivery_date', Array.from(validatedDateSet))
      .order('delivery_date', { ascending: false })

    const dateSet = new Set<string>()
    for (const row of dateRows || []) {
      if (row.delivery_date) dateSet.add(row.delivery_date)
    }
    availableDates = Array.from(dateSet).sort().reverse()
  }

  // Selected date
  const selectedDate = params.date && availableDates.includes(params.date)
    ? params.date
    : availableDates[0] || ''

  // Fetch all deliveries for the selected date (by rider_ids + by contractor_id for unassigned)
  let deliveries: any[] = []
  if (selectedDate) {
    const seen = new Set<string>()
    // 1. Deliveries assigned to this contractor's riders
    if (riderIds.length > 0) {
      const { data } = await supabase
        .from('deliveries')
        .select('id, customer_name, contact_1, contact_2, locality, status, delivery_date, rider_id, index_no, qty, products, amount, payment_method, payment_juice, payment_cash, payment_bank, payment_status, notes, delivery_notes, client_response, created_at, latitude, longitude, delivery_sequence, sales_type, return_product')
        .in('rider_id', riderIds)
        .eq('delivery_date', selectedDate)
        .order('locality', { ascending: true })
        .order('created_at', { ascending: true })

      for (const d of data || []) {
        if (!seen.has(d.id)) {
          seen.add(d.id)
          deliveries.push(d)
        }
      }
    }
    // 2. Unassigned deliveries linked to this contractor
    const { data: unassigned } = await supabase
      .from('deliveries')
      .select('id, customer_name, contact_1, contact_2, locality, status, delivery_date, rider_id, index_no, qty, products, amount, payment_method, payment_juice, payment_cash, payment_bank, payment_status, notes, delivery_notes, client_response, created_at, latitude, longitude, delivery_sequence, sales_type, return_product')
      .eq('contractor_id', contractor.id)
      .eq('delivery_date', selectedDate)
      .is('rider_id', null)
      .order('locality', { ascending: true })

    for (const d of unassigned || []) {
      if (!seen.has(d.id)) {
        seen.add(d.id)
        deliveries.push(d)
      }
    }
  }

  // Group by unique client to get correct counts
  const clientMap = new Map<string, { status: string }>()
  for (const d of deliveries) {
    const key = `${(d.customer_name || '').trim().toLowerCase()}|${(d.contact_1 || '').trim()}|${d.delivery_date}|${d.rider_id || ''}`
    if (!clientMap.has(key)) {
      clientMap.set(key, { status: d.status })
    }
  }
  const statusCounts: Record<string, number> = {}
  for (const [, v] of clientMap) {
    statusCounts[v.status] = (statusCounts[v.status] || 0) + 1
  }
  const uniqueClientCount = clientMap.size

  // If no validated dates, show a prompt to validate stock first
  if (availableDates.length === 0 || !selectedDate) {
    return (
      <ContractorMobileLayout
        profile={profile}
        companyName={contractor?.name}
        photoUrl={contractor?.photo_url}
        totalEarnings={0}
        riderCount={riders.length}
        isAlsoRider={!!contractorAsRider}
        hasPartners={contractor?.has_partners ?? false}
      >
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 flex items-center justify-center mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-7 h-7 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <h3 className="text-sm font-bold text-foreground mb-1">Stock validation required</h3>
          <p className="text-xs text-muted-foreground max-w-[260px] leading-relaxed">
            Please validate your stock first before managing orders. Go to the Stock tab to confirm what you received.
          </p>
          <a
            href="/dashboard/contractors/stock"
            className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-foreground text-background text-xs font-semibold hover:opacity-90 transition-opacity"
          >
            Go to Stock
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </a>
        </div>
      </ContractorMobileLayout>
    )
  }

  return (
      <ContractorMobileLayout
        profile={profile}
        companyName={contractor?.name}
        photoUrl={contractor?.photo_url}
        totalEarnings={0}
        riderCount={riders.length}
        isAlsoRider={!!contractorAsRider}
        hasPartners={contractor?.has_partners ?? false}
      >
        <OrdersContent
        deliveries={deliveries}
        availableDates={availableDates}
        selectedDate={selectedDate}
        riders={riders}
        statusCounts={statusCounts}
        totalCount={uniqueClientCount}
        contractorId={contractor.id}
        contractorAsRiderId={contractorAsRider?.id || null}
        customTemplates={profile?.message_templates || null}
        riderJuicePolicies={riderJuicePolicies}
      />
    </ContractorMobileLayout>
  )
}
