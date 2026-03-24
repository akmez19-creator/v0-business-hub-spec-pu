import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { ContractorMobileLayout } from '@/components/contractor/mobile-layout'
import { ContractorWalletContent } from '@/components/contractor/wallet-content'
import { NON_PAYOUT_FILTER } from '@/lib/types'

export default async function ContractorWalletPage() {
  const supabase = await createClient()
  const adminDb = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await adminDb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'contractor') redirect('/dashboard')

  const { data: contractor } = await adminDb
    .from('contractors')
    .select('*')
    .eq('profile_id', user.id)
    .single()

  if (!contractor) redirect('/dashboard')

  // Get all riders under this contractor
  const { data: riders } = await adminDb
    .from('riders')
    .select('id, name, contractor_id, profile_id')
    .eq('contractor_id', contractor.id)

  const allRiderIds = (riders || []).map(r => r.id)
  // Include contractor self-rider if applicable
  const { data: selfRider } = await adminDb
    .from('riders')
    .select('id, name')
    .eq('profile_id', user.id)
    .single()

  if (selfRider && !allRiderIds.includes(selfRider.id)) {
    allRiderIds.push(selfRider.id)
    riders?.push({ ...selfRider, contractor_id: contractor.id, profile_id: user.id })
  }

  // Get rider payment settings (rates)
  const { data: riderRateRows } = await adminDb
    .from('rider_payment_settings')
    .select('rider_id, per_delivery_rate')

  const riderRateMap: Record<string, number> = {}
  for (const rr of (riderRateRows || [])) {
    riderRateMap[rr.rider_id] = Number(rr.per_delivery_rate || 0)
  }

  // Get wallets for all riders
  const { data: wallets } = await adminDb
    .from('wallets')
    .select('*')
    .eq('owner_type', 'rider')
    .in('owner_id', allRiderIds.length > 0 ? allRiderIds : ['none'])

  const walletMap: Record<string, any> = {}
  for (const w of (wallets || [])) {
    walletMap[w.owner_id] = w
  }

  // Get contractor wallet
  const { data: contractorWallet } = await adminDb
    .from('wallets')
    .select('*')
    .eq('owner_type', 'contractor')
    .eq('owner_id', contractor.id)
    .single()

  // Get date ranges
  const now = new Date()
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0]
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0]

  // Unique delivered clients per rider (this month + last month)
  const { data: thisMonthDeliveries } = await supabase
    .from('deliveries')
    .select('rider_id, customer_name, contact_1, delivery_date')
    .in('rider_id', allRiderIds.length > 0 ? allRiderIds : ['none'])
    .eq('status', 'delivered')
    .not('sales_type', 'in', NON_PAYOUT_FILTER)
    .gte('delivery_date', thisMonthStart)

  const { data: lastMonthDeliveries } = await supabase
    .from('deliveries')
    .select('rider_id, customer_name, contact_1, delivery_date')
    .in('rider_id', allRiderIds.length > 0 ? allRiderIds : ['none'])
    .eq('status', 'delivered')
    .not('sales_type', 'in', NON_PAYOUT_FILTER)
    .gte('delivery_date', lastMonthStart)
    .lte('delivery_date', lastMonthEnd)

  // Get payouts to riders (from this contractor's riders)
  const { data: riderPayouts } = await adminDb
    .from('payment_transactions')
    .select('recipient_id, amount, created_at, description')
    .eq('recipient_type', 'rider')
    .eq('transaction_type', 'payout')
    .in('recipient_id', allRiderIds.length > 0 ? allRiderIds : ['none'])
    .order('created_at', { ascending: false })

  // Rider withdrawals (pending + approved)
  const { data: riderWithdrawals } = await adminDb
    .from('payout_requests')
    .select('*')
    .eq('requester_type', 'rider')
    .in('requester_id', allRiderIds.length > 0 ? allRiderIds : ['none'])
    .in('status', ['pending', 'approved'])
    .order('requested_at', { ascending: false })

  // Contractor's own withdrawal requests
  const { data: contractorPendingW } = await adminDb
    .from('payout_requests')
    .select('*')
    .eq('requester_type', 'contractor')
    .eq('requester_id', contractor.id)
    .eq('status', 'pending')
    .order('requested_at', { ascending: false })

  const { data: contractorApprovedW } = await adminDb
    .from('payout_requests')
    .select('*')
    .eq('requester_type', 'contractor')
    .eq('requester_id', contractor.id)
    .eq('status', 'approved')
    .order('requested_at', { ascending: false })

  // Helper: unique clients count
  function countUnique(rows: any[]) {
    const seen = new Set<string>()
    for (const d of rows) {
      seen.add(`${(d.customer_name || '').trim().toLowerCase()}|${(d.contact_1 || '').trim()}|${d.delivery_date}`)
    }
    return seen.size
  }

  // Build rider wallet data
  const riderWallets = (riders || []).map(r => {
    const rate = riderRateMap[r.id] || 0
    const wallet = walletMap[r.id]
    const thisMonthRows = (thisMonthDeliveries || []).filter(d => d.rider_id === r.id)
    const lastMonthRows = (lastMonthDeliveries || []).filter(d => d.rider_id === r.id)
    const thisMonthCount = countUnique(thisMonthRows)
    const lastMonthCount = countUnique(lastMonthRows)
    const payouts = (riderPayouts || []).filter(p => p.recipient_id === r.id)
    const totalPaid = payouts.reduce((s, p) => s + Number(p.amount || 0), 0)
    const pendingWithdrawals = (riderWithdrawals || []).filter(w => w.requester_id === r.id)
    const isSelf = r.profile_id === user.id

    return {
      id: r.id,
      name: r.name || 'Rider',
      isSelf,
      rate,
      thisMonthEarnings: thisMonthCount * rate,
      thisMonthDeliveries: thisMonthCount,
      lastMonthEarnings: lastMonthCount * rate,
      lastMonthDeliveries: lastMonthCount,
      walletBalance: wallet?.balance || 0,
      totalEarned: wallet?.total_earned || 0,
      totalPaidOut: totalPaid,
      recentPayouts: payouts.slice(0, 5),
      pendingWithdrawals,
    }
  })

  // Calculate total owed to OTHER riders for withdrawal cap (exclude isSelf)
  const totalOwedToRiders = riderWallets.reduce((s, r) => {
    if (r.isSelf) return s // Contractor doesn't owe themselves
    const owed = (r.thisMonthEarnings + r.lastMonthEarnings) - r.totalPaidOut
    return s + Math.max(0, owed)
  }, 0)

  const monthlySalary = Number(contractor.monthly_salary || 0)
  const contractorRate = Number(contractor.rate_per_delivery || 0)

  // Calculate REAL contractor earnings from deliveries (not wallet record)
  // All delivered rows across all riders under this contractor
  const { data: allDelivered } = await adminDb
    .from('deliveries')
    .select('customer_name, contact_1, delivery_date, rider_id')
    .in('rider_id', allRiderIds.length > 0 ? allRiderIds : ['none'])
    .eq('status', 'delivered')
    .not('sales_type', 'in', NON_PAYOUT_FILTER)

  const seenAll = new Set<string>()
  for (const d of (allDelivered || [])) {
    seenAll.add(`${(d.customer_name || '').trim().toLowerCase()}|${(d.contact_1 || '').trim()}|${d.delivery_date}|${d.rider_id}`)
  }
  const totalContractorEarnings = seenAll.size * contractorRate

  // Get payouts made TO the contractor by admin
  const { data: contractorPayouts } = await adminDb
    .from('payment_transactions')
    .select('amount')
    .eq('recipient_type', 'contractor')
    .eq('recipient_id', contractor.id)
    .eq('transaction_type', 'payout')

  const totalPaidToContractor = (contractorPayouts || []).reduce((s, p) => s + Number(p.amount || 0), 0)

  // Get transaction history for the contractor (mini bank statement)
  // Fetch transactions where contractor is recipient OR payer
  const { data: txAsRecipient } = await adminDb
    .from('payment_transactions')
    .select('*')
    .eq('recipient_type', 'contractor')
    .eq('recipient_id', contractor.id)
    .order('created_at', { ascending: false })
    .limit(25)

  const { data: txAsPayer } = await adminDb
    .from('payment_transactions')
    .select('*')
    .eq('payer_type', 'contractor')
    .eq('payer_id', contractor.id)
    .order('created_at', { ascending: false })
    .limit(25)

  // Combine and sort by date
  const transactionHistory = [...(txAsRecipient || []), ...(txAsPayer || [])]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 50)

  // Real balance = wallet.balance already contains the correct balance
  // wallet.balance = total_earned (opening balance) - total_paid_out (withdrawals)
  // We just need to ADD the delivery earnings that aren't yet in the wallet
  const walletBalance = contractorWallet ? Number(contractorWallet.balance) || 0 : 0
  const walletAdjustments = contractorWallet ? Number(contractorWallet.total_earned) || 0 : 0 // For display (opening balance)
  
  // Real balance = wallet balance + delivery earnings (rate × deliveries)
  // Wallet already has opening balance - payouts, just add delivery earnings
  const realBalance = walletBalance + totalContractorEarnings

  // Check if contractor also acts as rider (for nav)
  const isAlsoRider = !!selfRider

  return (
    <ContractorMobileLayout
      profile={profile}
      companyName={contractor?.name}
      photoUrl={contractor?.photo_url}
      totalEarnings={0}
      riderCount={riders?.length || 0}
      isAlsoRider={isAlsoRider}
      hasPartners={contractor?.has_partners ?? false}
    >
      <ContractorWalletContent
        contractor={contractor}
        contractorWallet={contractorWallet}
        riderWallets={riderWallets}
        contractorPendingWithdrawals={contractorPendingW || []}
        contractorApprovedWithdrawals={contractorApprovedW || []}
        totalOwedToRiders={totalOwedToRiders}
        monthlySalary={monthlySalary}
        realBalance={realBalance}
        transactionHistory={transactionHistory || []}
        thisMonthEarnings={totalContractorEarnings}
        walletAdjustments={walletAdjustments}
      />
    </ContractorMobileLayout>
  )
}
