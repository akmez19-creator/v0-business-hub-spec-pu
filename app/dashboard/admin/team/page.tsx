import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AddRiderDialog } from '@/components/admin/add-rider-dialog'
import type { Profile } from '@/lib/types'
import { ROLE_LABELS, NON_PAYOUT_FILTER } from '@/lib/types'
import { Users, Bike, Building2, UserCheck } from 'lucide-react'
import { ContractorFinanceControls } from '@/components/admin/contractor-finance-controls'

export default async function TeamOverviewPage() {
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
  
  // Get all team members (use admin client to read password_plain)
  const { data: teamMembers } = await adminDb
    .from('profiles')
    .select('*')
    .eq('approved', true)
    .order('role', { ascending: true })
  
  // Get contractors with their riders
  const { data: contractors } = await adminDb
    .from('profiles')
    .select('*')
    .eq('role', 'contractor')
    .eq('approved', true)
  
  const { data: riders } = await adminDb
    .from('profiles')
    .select('*')
    .eq('role', 'rider')
    .eq('approved', true)
  
  // Get contractor records from contractors table (with rate_per_delivery)
  const { data: contractorRecords } = await supabase
    .from('contractors')
  .select('id, name, profile_id, rate_per_delivery, pay_type, monthly_salary')
  
  const contractorRateMap: Record<string, number> = {}
  const contractorPayTypeMap: Record<string, string> = {}
  const contractorMonthlySalaryMap: Record<string, number> = {}
  for (const cr of (contractorRecords || [])) {
  contractorRateMap[cr.id] = Number(cr.rate_per_delivery || 0)
  contractorPayTypeMap[cr.id] = cr.pay_type || 'per_delivery'
  contractorMonthlySalaryMap[cr.id] = Number(cr.monthly_salary || 0)
  }

  // Get all rider records under each contractor
  const { data: riderRecords } = await supabase
    .from('riders')
    .select('id, name, contractor_id')

  // Get rider payment settings
  const { data: riderRateRows } = await supabase
    .from('rider_payment_settings')
    .select('rider_id, per_delivery_rate')

  const riderRateMap: Record<string, number> = {}
  for (const rr of (riderRateRows || [])) {
    riderRateMap[rr.rider_id] = Number(rr.per_delivery_rate || 90)
  }

  // Date ranges
  const now = new Date()
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0]
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0]

  // Get delivered counts per rider (lifetime, exclude non-payout types)
  const { data: deliveryCounts } = await supabase
    .from('deliveries')
    .select('rider_id, customer_name, contact_1, delivery_date')
    .eq('status', 'delivered')
    .not('sales_type', 'in', NON_PAYOUT_FILTER)

  // Compute earnings per contractor
  const contractorEarningsMap: Record<string, number> = {}
  for (const cr of (contractorRecords || [])) {
    const rIds = (riderRecords || []).filter(r => r.contractor_id === cr.id).map(r => r.id)
    const seen = new Set<string>()
    for (const d of (deliveryCounts || [])) {
      if (rIds.includes(d.rider_id)) {
        const key = `${(d.customer_name || '').trim().toLowerCase()}|${(d.contact_1 || '').trim()}|${d.delivery_date}|${d.rider_id}`
        if (!seen.has(key)) {
          seen.add(key)
        }
      }
    }
    // Always calculate per-delivery earnings (salary is a deduction, not a replacement)
    const cRate = contractorRateMap[cr.id]
    if (cRate) {
      contractorEarningsMap[cr.id] = seen.size * cRate
    } else {
      // Fallback: sum each rider's rate * their unique deliveries
      let total = 0
      for (const rid of rIds) {
        const rSeen = new Set<string>()
        for (const d of (deliveryCounts || [])) {
          if (d.rider_id === rid) {
            rSeen.add(`${(d.customer_name || '').trim().toLowerCase()}|${(d.contact_1 || '').trim()}|${d.delivery_date}`)
          }
        }
        total += rSeen.size * (riderRateMap[rid] || 90)
      }
      contractorEarningsMap[cr.id] = total
    }
  }

  // Compute monthly earnings + delivery counts per contractor
  const contractorThisMonthMap: Record<string, number> = {}
  const contractorLastMonthMap: Record<string, number> = {}
  const contractorThisMonthCountMap: Record<string, number> = {}
  const contractorLastMonthCountMap: Record<string, number> = {}
  const contractorTotalCountMap: Record<string, number> = {}
  for (const cr of (contractorRecords || [])) {
    const rIds = (riderRecords || []).filter(r => r.contractor_id === cr.id).map(r => r.id)
    const cRate = contractorRateMap[cr.id] || 90

    // Total count
    const totalSeen = new Set<string>()
    for (const d of (deliveryCounts || [])) {
      if (rIds.includes(d.rider_id)) {
        totalSeen.add(`${(d.customer_name || '').trim().toLowerCase()}|${(d.contact_1 || '').trim()}|${d.delivery_date}|${d.rider_id}`)
      }
    }
    contractorTotalCountMap[cr.id] = totalSeen.size

    // This month
    const thisMonthSeen = new Set<string>()
    for (const d of (deliveryCounts || [])) {
      if (rIds.includes(d.rider_id) && d.delivery_date >= thisMonthStart) {
        thisMonthSeen.add(`${(d.customer_name || '').trim().toLowerCase()}|${(d.contact_1 || '').trim()}|${d.delivery_date}|${d.rider_id}`)
      }
    }
    contractorThisMonthCountMap[cr.id] = thisMonthSeen.size
    contractorThisMonthMap[cr.id] = thisMonthSeen.size * cRate

    // Last month
    const lastMonthSeen = new Set<string>()
    for (const d of (deliveryCounts || [])) {
      if (rIds.includes(d.rider_id) && d.delivery_date >= lastMonthStart && d.delivery_date <= lastMonthEnd) {
        lastMonthSeen.add(`${(d.customer_name || '').trim().toLowerCase()}|${(d.contact_1 || '').trim()}|${d.delivery_date}|${d.rider_id}`)
      }
    }
    contractorLastMonthCountMap[cr.id] = lastMonthSeen.size
    contractorLastMonthMap[cr.id] = lastMonthSeen.size * cRate
  }

  // Get payouts per contractor
  const { data: allPayouts } = await supabase
    .from('payment_transactions')
    .select('recipient_id, amount, created_at, description')
    .eq('recipient_type', 'contractor')
    .eq('transaction_type', 'payout')
    .order('created_at', { ascending: false })

  const contractorPayoutsMap: Record<string, { amount: number; created_at: string; description: string }[]> = {}
  const contractorPaidOutMap: Record<string, number> = {}
  for (const p of (allPayouts || [])) {
    if (!contractorPayoutsMap[p.recipient_id]) contractorPayoutsMap[p.recipient_id] = []
    contractorPayoutsMap[p.recipient_id].push(p)
    contractorPaidOutMap[p.recipient_id] = (contractorPaidOutMap[p.recipient_id] || 0) + Number(p.amount || 0)
  }

  // Get pending withdrawal requests for contractors
  const { data: pendingWithdrawals } = await supabase
    .from('payout_requests')
    .select('*')
    .eq('requester_type', 'contractor')
    .eq('status', 'pending')
    .order('requested_at', { ascending: false })

  const contractorWithdrawalsMap: Record<string, any[]> = {}
  for (const w of (pendingWithdrawals || [])) {
    if (!contractorWithdrawalsMap[w.requester_id]) contractorWithdrawalsMap[w.requester_id] = []
    contractorWithdrawalsMap[w.requester_id].push(w)
  }

  // Map profile ID -> contractor record ID
  const profileToContractorId: Record<string, string> = {}
  for (const cr of (contractorRecords || [])) {
    if (cr.profile_id) profileToContractorId[cr.profile_id] = cr.id
  }

  // Group riders by contractor
  const ridersByContractor: Record<string, Profile[]> = {}
  const independentRiders: Profile[] = []
  
  riders?.forEach(rider => {
    if (rider.contractor_id) {
      if (!ridersByContractor[rider.contractor_id]) {
        ridersByContractor[rider.contractor_id] = []
      }
      ridersByContractor[rider.contractor_id].push(rider)
    } else {
      independentRiders.push(rider)
    }
  })
  
  const roleGroups = {
    admin: teamMembers?.filter(m => m.role === 'admin') || [],
    manager: teamMembers?.filter(m => m.role === 'manager') || [],
    marketing_agent: teamMembers?.filter(m => m.role === 'marketing_agent') || [],
    contractor: contractors || [],
    rider: riders || [],
  }
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Team Overview</h2>
          <p className="text-muted-foreground">
            View your team structure and logistics personnel
          </p>
        </div>
        <AddRiderDialog contractors={(contractors || []) as Profile[]} />
      </div>
      
      {/* Team Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Team
            </CardTitle>
            <Users className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{teamMembers?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Contractors
            </CardTitle>
            <Building2 className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{contractors?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Riders
            </CardTitle>
            <Bike className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{riders?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Independent Riders
            </CardTitle>
            <UserCheck className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{independentRiders.length}</div>
          </CardContent>
        </Card>
      </div>
      
      {/* Contractors and Their Riders */}
      <Card>
        <CardHeader>
          <CardTitle>Contractors & Riders</CardTitle>
          <CardDescription>View contractor teams and their assigned riders</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {contractors?.map(contractor => (
              <div key={contractor.id} className="border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 text-primary font-medium">
                      {contractor.name?.charAt(0).toUpperCase() || contractor.email.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium">{contractor.name || contractor.email}</p>
                      <p className="text-sm text-muted-foreground">{contractor.email}</p>
                      {contractor.password_plain && (
                        <p className="text-xs text-muted-foreground font-mono">pw: {contractor.password_plain}</p>
                      )}
                    </div>
                  </div>
                  <Badge variant="outline">
                    {ridersByContractor[contractor.id]?.length || 0} Riders
                  </Badge>
                </div>
                
                {/* Financial Controls */}
                {(() => {
                  const cId = profileToContractorId[contractor.id]
                  if (!cId) return null
                  return (
                    <ContractorFinanceControls
                      contractorId={cId}
                      contractorName={contractor.name || contractor.email}
                      currentRate={contractorRateMap[cId] || 0}
                      payType={(contractorPayTypeMap[cId] || 'per_delivery') as 'per_delivery' | 'fixed_monthly'}
                      monthlySalary={contractorMonthlySalaryMap[cId] || 0}
                      totalEarned={contractorEarningsMap[cId] || 0}
                      totalDeliveries={contractorTotalCountMap[cId] || 0}
                      totalPaidOut={contractorPaidOutMap[cId] || 0}
                      balance={(contractorEarningsMap[cId] || 0) - (contractorPaidOutMap[cId] || 0)}
                      thisMonthEarnings={contractorThisMonthMap[cId] || 0}
                      thisMonthDeliveries={contractorThisMonthCountMap[cId] || 0}
                      lastMonthEarnings={contractorLastMonthMap[cId] || 0}
                      lastMonthDeliveries={contractorLastMonthCountMap[cId] || 0}
                      recentPayouts={contractorPayoutsMap[cId] || []}
                      pendingWithdrawals={contractorWithdrawalsMap[cId] || []}
                    />
                  )
                })()}

                {ridersByContractor[contractor.id]?.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/30">
                    <p className="text-[10px] text-muted-foreground mb-1.5">Riders (managed by contractor)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {ridersByContractor[contractor.id].map(rider => (
                        <span key={rider.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/50 text-[11px] text-muted-foreground">
                          <Bike className="w-3 h-3" />
                          {rider.name || rider.email}
                          {rider.password_plain && (
                            <span className="font-mono text-[10px] opacity-70">({rider.password_plain})</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
            
            {/* Independent Riders */}
            {independentRiders.length > 0 && (
              <div className="border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-10 h-10 rounded-full bg-muted text-muted-foreground font-medium">
                      <UserCheck className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-medium">Independent Riders</p>
                      <p className="text-sm text-muted-foreground">Not assigned to any contractor</p>
                    </div>
                  </div>
                  <Badge variant="secondary">
                    {independentRiders.length} Riders
                  </Badge>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {independentRiders.map(rider => (
                    <div key={rider.id} className="flex items-center gap-2 p-2 rounded-md bg-muted/50">
                      <Bike className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm">{rider.name || rider.email}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      
      {/* Staff by Role */}
      <Card>
        <CardHeader>
          <CardTitle>Staff by Role</CardTitle>
          <CardDescription>Team members grouped by their role</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Object.entries(roleGroups).filter(([role]) => !['contractor', 'rider'].includes(role)).map(([role, members]) => (
              <div key={role} className="border border-border rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium capitalize">{ROLE_LABELS[role as keyof typeof ROLE_LABELS]}</h4>
                  <Badge variant="outline">{members.length}</Badge>
                </div>
                {members.length > 0 ? (
                  <div className="space-y-2">
                    {members.map(member => (
                      <div key={member.id} className="flex items-center gap-2 text-sm">
                        <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-medium">
                          {member.name?.charAt(0).toUpperCase() || member.email.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="truncate">{member.name || member.email}</span>
                          {member.password_plain && (
                            <span className="text-[10px] font-mono text-muted-foreground">pw: {member.password_plain}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No members</p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
