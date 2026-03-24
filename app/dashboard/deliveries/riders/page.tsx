import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { RidersOverview } from '@/components/deliveries/riders-overview'
import { AddRiderDialog } from '@/components/admin/add-rider-dialog'
import type { Rider } from '@/lib/types'

export default async function RidersManagementPage() {
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

  // Fetch all active riders (including profile_id for link status)
  const { data: riders } = await adminDb
    .from('riders')
    .select('*, profile_id')
    .eq('is_active', true)
    .order('name')

  // Fetch all contractors for filter
  const { data: contractors } = await adminDb
    .from('contractors')
    .select('id, name')
    .eq('is_active', true)
    .order('name')

  // Get current month date range
  const today = new Date()
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0]
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0]

  // Fetch delivery stats for all riders (current month)
  const { data: deliveryStats } = await adminDb
    .from('deliveries')
    .select('rider_id, status, entry_date, delivery_date, index_no')
    .gte('delivery_date', monthStart)
    .lte('delivery_date', monthEnd)

  // Calculate performance for each rider
  const riderPerformance = (riders || []).map((rider: Rider) => {
    const riderDeliveries = (deliveryStats || []).filter(d => d.rider_id === rider.id)
    
    // Count unique deliveries by index_no (tracking number)
    const uniqueDeliveries = new Map<string, typeof riderDeliveries[0]>()
    for (const d of riderDeliveries) {
      const key = d.index_no || d.rider_id + Math.random() // fallback for no tracking
      if (!uniqueDeliveries.has(key)) {
        uniqueDeliveries.set(key, d)
      }
    }
    
    const uniqueList = Array.from(uniqueDeliveries.values())
    const total = uniqueList.length
    const delivered = uniqueList.filter(d => d.status === 'delivered').length
    const undelivered = uniqueList.filter(d => ['nwd', 'cms'].includes(d.status)).length
    const postponed = uniqueList.filter(d => d.entry_date && d.delivery_date && d.entry_date !== d.delivery_date).length
    
    // Calculate rating (0-5 stars)
    // Base: 100% delivered = 5 stars
    // Deduct for undelivered and postponed
    let rating = 5
    if (total > 0) {
      const deliveryRate = delivered / total
      const undeliveredRate = undelivered / total
      const postponedRate = postponed / total
      
      rating = Math.max(0, Math.min(5, 
        (deliveryRate * 5) - (undeliveredRate * 2) - (postponedRate * 0.5)
      ))
    } else {
      rating = 0 // No deliveries = no rating
    }

    return {
      ...rider,
      stats: {
        total,
        delivered,
        undelivered,
        postponed,
        deliveryRate: total > 0 ? ((delivered / total) * 100).toFixed(1) : '0',
        rating: Math.round(rating * 10) / 10
      }
    }
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Riders Management</h2>
          <p className="text-muted-foreground">
            View, add, edit riders and manage contractor assignments
          </p>
        </div>
        <AddRiderDialog contractors={contractors || []} />
      </div>
      
      <RidersOverview 
        riders={riderPerformance} 
        contractors={contractors || []}
        monthName={today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
      />
    </div>
  )
}
