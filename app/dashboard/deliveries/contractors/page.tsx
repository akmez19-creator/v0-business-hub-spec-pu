import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { ContractorsOverview } from '@/components/deliveries/contractors-overview'
import { AddContractorDialog } from '@/components/admin/add-contractor-dialog'
import type { Contractor, Rider } from '@/lib/types'

export default async function ContractorsManagementPage() {
  const supabase = await createClient()
  const adminDb = createAdminClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  
  const { data: profile } = await adminDb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()
  
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    redirect('/dashboard')
  }

  // Fetch all active contractors (including profile_id for link status)
  const { data: contractors } = await adminDb
    .from('contractors')
    .select('*, profile_id')
    .eq('is_active', true)
    .order('name')

  // Fetch all riders
  const { data: riders } = await adminDb
    .from('riders')
    .select('*')
    .eq('is_active', true)
    .order('name')

  // Fetch contractor wallets and transactions
  const { data: contractorWallets } = await adminDb
    .from('wallets')
    .select('*')
    .eq('owner_type', 'contractor')

  const { data: contractorTransactions } = await adminDb
    .from('payment_transactions')
    .select('*')
    .eq('recipient_type', 'contractor')
    .order('created_at', { ascending: false })

  const { data: pendingWithdrawals } = await adminDb
    .from('payout_requests')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  // Build contractor wallet data map
  const walletsByContractor = new Map<string, {
    balance: number
    totalEarned: number
    totalPaidOut: number
    thisMonthEarnings: number
    thisMonthDeliveries: number
    lastMonthEarnings: number
    lastMonthDeliveries: number
    recentPayouts: any[]
    pendingWithdrawals: any[]
  }>()

  // Get current month date range
  const today = new Date()
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0]
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0]
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString().split('T')[0]
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().split('T')[0]

  for (const wallet of (contractorWallets || [])) {
    const contractorId = wallet.owner_id
    const txns = (contractorTransactions || []).filter(t => t.recipient_id === contractorId)
    const payouts = txns.filter(t => t.transaction_type === 'payout')
    const withdrawals = (pendingWithdrawals || []).filter(w => w.contractor_id === contractorId)
    
    // Calculate this month and last month earnings from transactions
    const thisMonthTxns = txns.filter(t => t.transaction_type === 'earning' && t.created_at >= monthStart && t.created_at <= monthEnd + 'T23:59:59')
    const lastMonthTxns = txns.filter(t => t.transaction_type === 'earning' && t.created_at >= lastMonthStart && t.created_at <= lastMonthEnd + 'T23:59:59')

    walletsByContractor.set(contractorId, {
      balance: Number(wallet.balance) || 0,
      totalEarned: Number(wallet.total_earned) || 0,
      totalPaidOut: Number(wallet.total_paid_out) || 0,
      thisMonthEarnings: thisMonthTxns.reduce((sum, t) => sum + Number(t.amount), 0),
      thisMonthDeliveries: 0, // Will be calculated below with delivery stats
      lastMonthEarnings: lastMonthTxns.reduce((sum, t) => sum + Number(t.amount), 0),
      lastMonthDeliveries: 0,
      recentPayouts: payouts.slice(0, 10),
      pendingWithdrawals: withdrawals,
    })
  }

  // Fetch delivery stats (current month)
  const { data: deliveryStats } = await adminDb
    .from('deliveries')
    .select('rider_id, status, entry_date, delivery_date, index_no')
    .gte('delivery_date', monthStart)
    .lte('delivery_date', monthEnd)

  // Group riders by contractor
  const ridersByContractor = new Map<string, Rider[]>()
  for (const rider of (riders || []) as Rider[]) {
    if (rider.contractor_id) {
      const list = ridersByContractor.get(rider.contractor_id) || []
      list.push(rider)
      ridersByContractor.set(rider.contractor_id, list)
    }
  }

  // Calculate performance for each contractor
  const contractorPerformance = (contractors || []).map((contractor: Contractor) => {
    const contractorRiders = ridersByContractor.get(contractor.id) || []
    const riderIds = contractorRiders.map(r => r.id)
    
    // Get deliveries for this contractor's riders
    const contractorDeliveries = (deliveryStats || []).filter(d => 
      d.rider_id && riderIds.includes(d.rider_id)
    )
    
    // Count unique deliveries by index_no
    const uniqueDeliveries = new Map<string, typeof contractorDeliveries[0]>()
    for (const d of contractorDeliveries) {
      const key = d.index_no || d.rider_id + Math.random()
      if (!uniqueDeliveries.has(key)) {
        uniqueDeliveries.set(key, d)
      }
    }
    
    const uniqueList = Array.from(uniqueDeliveries.values())
    const total = uniqueList.length
    const delivered = uniqueList.filter(d => d.status === 'delivered').length
    const undelivered = uniqueList.filter(d => ['nwd', 'cms'].includes(d.status)).length
    const postponed = uniqueList.filter(d => d.entry_date && d.delivery_date && d.entry_date !== d.delivery_date).length
    
    // Calculate rating
    let rating = 5
    if (total > 0) {
      const deliveryRate = delivered / total
      const undeliveredRate = undelivered / total
      const postponedRate = postponed / total
      
      rating = Math.max(0, Math.min(5, 
        (deliveryRate * 5) - (undeliveredRate * 2) - (postponedRate * 0.5)
      ))
    } else {
      rating = 0
    }

    // Get wallet data for this contractor
    const walletData = walletsByContractor.get(contractor.id)
    
    return {
      ...contractor,
      riderCount: contractorRiders.length,
      riders: contractorRiders,
      stats: {
        total,
        delivered,
        undelivered,
        postponed,
        deliveryRate: total > 0 ? ((delivered / total) * 100).toFixed(1) : '0',
        rating: Math.round(rating * 10) / 10
      },
      wallet: walletData ? {
        balance: walletData.balance,
        totalEarned: walletData.totalEarned,
        totalPaidOut: walletData.totalPaidOut,
        thisMonthEarnings: walletData.thisMonthEarnings || (Number(contractor.rate_per_delivery || 0) * delivered),
        thisMonthDeliveries: delivered,
        lastMonthEarnings: walletData.lastMonthEarnings,
        lastMonthDeliveries: walletData.lastMonthDeliveries,
        recentPayouts: walletData.recentPayouts,
        pendingWithdrawals: walletData.pendingWithdrawals,
      } : {
        balance: 0,
        totalEarned: 0,
        totalPaidOut: 0,
        thisMonthEarnings: Number(contractor.rate_per_delivery || 0) * delivered,
        thisMonthDeliveries: delivered,
        lastMonthEarnings: 0,
        lastMonthDeliveries: 0,
        recentPayouts: [],
        pendingWithdrawals: [],
      }
    }
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Contractors Management</h2>
          <p className="text-muted-foreground">
            View, add, edit contractors and manage their riders
          </p>
        </div>
        <AddContractorDialog />
      </div>
      
      <ContractorsOverview 
        contractors={contractorPerformance}
        monthName={today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
      />
    </div>
  )
}
