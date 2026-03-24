import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { MarketingFrontOfficeDashboard } from '@/components/marketing/front-office-dashboard'

export default async function MarketingFrontOfficePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) redirect('/auth/login')

  // Get profile
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile || (profile.role !== 'marketing_front_office' && profile.role !== 'admin')) {
    redirect('/dashboard')
  }

  // Get today's orders created by this user
  const today = new Date().toISOString().split('T')[0]
  
  const { count: todayOrders } = await supabase
    .from('deliveries')
    .select('*', { count: 'exact', head: true })
    .eq('created_by', user.id)
    .gte('created_at', `${today}T00:00:00`)

  // Get total clients
  const { count: totalClients } = await supabase
    .from('clients')
    .select('*', { count: 'exact', head: true })

  // Get pending follow-ups (deliveries with status pending or nwd created by this user)
  const { count: pendingFollowUps } = await supabase
    .from('deliveries')
    .select('*', { count: 'exact', head: true })
    .eq('created_by', user.id)
    .in('status', ['pending', 'nwd'])

  // Get recent orders by this user
  const { data: recentOrders } = await supabase
    .from('deliveries')
    .select('id, customer_name, amount, status, created_at, products')
    .eq('created_by', user.id)
    .order('created_at', { ascending: false })
    .limit(10)

  return (
    <MarketingFrontOfficeDashboard
      profile={profile}
      stats={{
        todayOrders: todayOrders || 0,
        totalClients: totalClients || 0,
        pendingFollowUps: pendingFollowUps || 0,
      }}
      recentOrders={recentOrders || []}
    />
  )
}
