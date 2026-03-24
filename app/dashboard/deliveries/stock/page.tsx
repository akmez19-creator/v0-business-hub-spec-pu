import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { StockOverview } from '@/components/deliveries/stock-overview'

export default async function StockPage() {
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

  // Fetch riders
  const { data: riders } = await adminDb
    .from('riders')
    .select(`
      id, name, phone, contractor_id,
      contractors (id, name)
    `)
    .eq('is_active', true)
    .order('name')

  // Get today's date
  const today = new Date().toISOString().split('T')[0]

  // Fetch today's stock for all riders
  const { data: todayStock } = await adminDb
    .from('rider_stock')
    .select('*')
    .eq('stock_date', today)

  // Fetch recent stock movements
  const { data: recentMovements } = await adminDb
    .from('stock_movements')
    .select(`
      *,
      riders (name)
    `)
    .order('created_at', { ascending: false })
    .limit(100)

  // Map stock to riders
  const riderStockMap: Record<string, typeof todayStock[0]> = {}
  for (const stock of todayStock || []) {
    riderStockMap[stock.rider_id] = stock
  }

  // Calculate totals
  const totalOpeningStock = (todayStock || []).reduce((sum, s) => sum + (s.opening_stock || 0), 0)
  const totalInTransit = (todayStock || []).reduce((sum, s) => sum + (s.in_transit || 0), 0)
  const totalDelivered = (todayStock || []).reduce((sum, s) => sum + (s.delivered || 0), 0)
  const totalReturns = (todayStock || []).reduce((sum, s) => sum + (s.returns || 0), 0)
  const totalDefective = (todayStock || []).reduce((sum, s) => sum + (s.defective || 0), 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Stock Management</h1>
        <p className="text-muted-foreground">Track rider stock - opening, in transit, returns, and defective items</p>
      </div>

      <StockOverview
        riders={riders || []}
        riderStockMap={riderStockMap}
        recentMovements={recentMovements || []}
        todayDate={today}
        totals={{
          openingStock: totalOpeningStock,
          inTransit: totalInTransit,
          delivered: totalDelivered,
          returns: totalReturns,
          defective: totalDefective
        }}
      />
    </div>
  )
}
