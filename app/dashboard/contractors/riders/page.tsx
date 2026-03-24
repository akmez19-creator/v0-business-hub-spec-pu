import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { ContractorMobileLayout } from '@/components/contractor/mobile-layout'
import { ContractorRidersContent } from '@/components/contractor/riders-content'
import { NON_PAYOUT_FILTER } from '@/lib/types'

export default async function ContractorRidersPage() {
  const supabase = await createClient()
  const adminDb = createAdminClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Get profile
  const { data: profile } = await adminDb
    .from('profiles')
    .select('*, contractor_id')
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

  // Get ALL riders under this contractor
  const { data: allRiders } = await supabase
    .from('riders')
    .select('*')
    .eq('contractor_id', contractor.id)
    .order('name')

  const riders = allRiders || []
  const riderIds = riders.map(r => r.id)
  
  // Check if contractor also acts as rider
  const contractorAsRider = riders.find(r => 
    r.name?.toLowerCase() === contractor.name?.toLowerCase()
  ) || null

  // Get deliveries for all riders (last 30 days)
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  
  let allDeliveries: any[] = []
  if (riderIds.length > 0) {
    const { data } = await supabase
      .from('deliveries')
      .select('*')
      .in('rider_id', riderIds)
      .gte('delivery_date', thirtyDaysAgo.toISOString().split('T')[0])
    allDeliveries = data || []
  }

  // Get payment settings for riders
  const { data: paymentSettings } = await supabase
    .from('rider_payment_settings')
    .select('*')
    .in('rider_id', riderIds.length > 0 ? riderIds : ['no-riders'])

  // Get delivered for earnings with monthly breakdown
  const now = new Date()
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0]
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0]

  let lifetimeDeliveries: any[] = []
  if (riderIds.length > 0) {
    const { data } = await supabase
      .from('deliveries')
      .select('rider_id, customer_name, contact_1, delivery_date')
      .in('rider_id', riderIds)
      .eq('status', 'delivered')
      .not('sales_type', 'in', NON_PAYOUT_FILTER)
    lifetimeDeliveries = data || []
  }

  // Get payouts already made to each rider
  let riderPayouts: any[] = []
  if (riderIds.length > 0) {
    const { data } = await supabase
      .from('payment_transactions')
      .select('recipient_id, amount, created_at, description')
      .eq('recipient_type', 'rider')
      .eq('transaction_type', 'payout')
      .in('recipient_id', riderIds)
      .order('created_at', { ascending: false })
    riderPayouts = data || []
  }

  // Calculate rider stats
  const riderStats = riders.map(rider => {
    const riderDeliveries = allDeliveries.filter(d => d.rider_id === rider.id)
    const total = riderDeliveries.length
    const delivered = riderDeliveries.filter(d => d.status === 'delivered').length
    const failed = riderDeliveries.filter(d => ['nwd', 'cms'].includes(d.status)).length
    const pending = riderDeliveries.filter(d => ['assigned', 'picked_up'].includes(d.status)).length
    const rate = total > 0 ? Math.round((delivered / total) * 100) : 0
    const rating = total > 0 ? Math.min(5, Math.max(1, Math.round(rate / 20))) : 0

    const paymentSetting = paymentSettings?.find(p => p.rider_id === rider.id)
    const perDeliveryRate = Number(paymentSetting?.per_delivery_rate || 90)

    // Compute unique deliveries and earnings (lifetime, this month, last month)
    const rLifetime = lifetimeDeliveries.filter(d => d.rider_id === rider.id)
    const seen = new Set<string>()
    for (const d of rLifetime) {
      seen.add(`${(d.customer_name || '').trim().toLowerCase()}|${(d.contact_1 || '').trim()}|${d.delivery_date}`)
    }
    const lifetimeUniqueDelivered = seen.size
    const lifetimeEarnings = lifetimeUniqueDelivered * perDeliveryRate

    // This month
    const thisMonthRows = rLifetime.filter(d => d.delivery_date >= thisMonthStart)
    const thisMonthSeen = new Set<string>()
    for (const d of thisMonthRows) thisMonthSeen.add(`${(d.customer_name || '').trim().toLowerCase()}|${(d.contact_1 || '').trim()}|${d.delivery_date}`)
    const thisMonthDelivered = thisMonthSeen.size
    const thisMonthEarnings = thisMonthDelivered * perDeliveryRate

    // Last month
    const lastMonthRows = rLifetime.filter(d => d.delivery_date >= lastMonthStart && d.delivery_date <= lastMonthEnd)
    const lastMonthSeen = new Set<string>()
    for (const d of lastMonthRows) lastMonthSeen.add(`${(d.customer_name || '').trim().toLowerCase()}|${(d.contact_1 || '').trim()}|${d.delivery_date}`)
    const lastMonthDelivered = lastMonthSeen.size
    const lastMonthEarnings = lastMonthDelivered * perDeliveryRate

    // Payouts received
    const rPayouts = riderPayouts.filter(p => p.recipient_id === rider.id)
    const totalPaidOut = rPayouts.reduce((s: number, p: any) => s + Number(p.amount || 0), 0)

    return {
      ...rider,
      total,
      delivered,
      failed,
      pending,
      rate,
      rating,
      paymentType: paymentSetting?.payment_type || 'per_delivery',
      dailyRate: paymentSetting?.daily_rate || 0,
      perDeliveryRate,
      walletBalance: lifetimeEarnings - totalPaidOut,
      lifetimeEarnings,
      totalPaidOut,
      lifetimeUniqueDelivered,
      thisMonthEarnings,
      thisMonthDelivered,
      lastMonthEarnings,
      lastMonthDelivered,
      recentPayouts: rPayouts.slice(0, 5),
      isContractor: contractorAsRider?.id === rider.id,
      juicePolicy: (rider as any).juice_policy || 'rider',
    }
  })

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
      <ContractorRidersContent
        riders={riderStats}
        contractorAsRider={contractorAsRider}
        totalDeliveries={allDeliveries.length}
      />
    </ContractorMobileLayout>
  )
}
