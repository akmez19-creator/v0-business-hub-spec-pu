import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { MarketingBackOfficeDashboard } from '@/components/marketing/back-office-dashboard'

export default async function MarketingBackOfficePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) redirect('/auth/login')

  // Get profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile || (profile.role !== 'marketing_back_office' && profile.role !== 'admin')) {
    redirect('/dashboard')
  }

  // Get today's stats
  const today = new Date().toISOString().split('T')[0]
  
  // Get deliveries count
  const { count: todayDeliveries } = await supabase
    .from('deliveries')
    .select('*', { count: 'exact', head: true })
    .eq('delivery_date', today)

  // Get delivered count
  const { count: deliveredCount } = await supabase
    .from('deliveries')
    .select('*', { count: 'exact', head: true })
    .eq('delivery_date', today)
    .eq('status', 'delivered')

  // Get total sales today
  const { data: salesData } = await supabase
    .from('deliveries')
    .select('amount')
    .eq('delivery_date', today)
    .eq('status', 'delivered')

  const totalSales = salesData?.reduce((sum, d) => sum + Number(d.amount || 0), 0) || 0

  // Get stock count
  const { data: stockData } = await supabase
    .from('stock_items')
    .select('quantity')

  const totalStock = stockData?.reduce((sum, s) => sum + Number(s.quantity || 0), 0) || 0

  // Get recent deliveries
  const { data: recentDeliveries } = await supabase
    .from('deliveries')
    .select('id, customer_name, amount, status, delivery_date, products')
    .order('created_at', { ascending: false })
    .limit(10)

  return (
    <MarketingBackOfficeDashboard
      profile={profile}
      stats={{
        todayDeliveries: todayDeliveries || 0,
        deliveredCount: deliveredCount || 0,
        totalSales,
        totalStock,
      }}
      recentDeliveries={recentDeliveries || []}
    />
  )
}
