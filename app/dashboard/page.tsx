import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Package, Truck, Users, CheckCircle, Clock, AlertCircle } from 'lucide-react'
import type { Profile } from '@/lib/types'

async function getStats(profile: Profile) {
  try {
    const adminDb = createAdminClient()

    // Admin/manager sees all deliveries
    const { data: deliveries } = await adminDb
      .from('deliveries')
      .select('status')

    const totalDeliveries = deliveries?.length || 0
    const pendingDeliveries = deliveries?.filter(d => d.status === 'pending').length || 0
    const assignedDeliveries = deliveries?.filter(d => d.status === 'assigned').length || 0
    const deliveredCount = deliveries?.filter(d => d.status === 'delivered').length || 0

    // Get user stats for admin/manager
    let usersCount = 0
    if (['admin', 'manager'].includes(profile.role)) {
      const { count } = await adminDb.from('profiles').select('*', { count: 'exact', head: true })
      usersCount = count || 0
    }

    // Get client stats
    let clientsCount = 0
    if (['admin', 'manager', 'marketing_agent'].includes(profile.role)) {
      const { count } = await adminDb.from('clients').select('*', { count: 'exact', head: true })
      clientsCount = count || 0
    }

    return { totalDeliveries, pendingDeliveries, assignedDeliveries, deliveredCount, usersCount, clientsCount }
  } catch {
    return { totalDeliveries: 0, pendingDeliveries: 0, assignedDeliveries: 0, deliveredCount: 0, usersCount: 0, clientsCount: 0 }
  }
}

async function getRecentDeliveries(profile: Profile) {
  try {
    const supabase = await createClient()

    let query = supabase
      .from('deliveries')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5)

    if (profile.role === 'rider') {
      query = query.eq('rider_id', profile.id)
    } else if (profile.role === 'contractor') {
      query = query.eq('contractor_id', profile.id)
    }

    const { data } = await query
    return data || []
  } catch {
    return []
  }
}

export default async function DashboardPage() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()
  
  if (!profile) {
    return null
  }

  // Redirect contractors, riders, and storekeepers to their specific dashboards
  if (profile.role === 'contractor') {
    redirect('/dashboard/contractors')
  }
  if (profile.role === 'rider') {
    redirect('/dashboard/riders')
  }
  if (profile.role === 'storekeeper') {
    redirect('/dashboard/storekeeper')
  }

  const stats = await getStats(profile as Profile)
  const recentDeliveries = await getRecentDeliveries(profile as Profile)
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">
          Welcome back, {profile.name || 'User'}
        </h2>
        <p className="text-muted-foreground">
          {"Here's an overview of your business operations"}
        </p>
      </div>
      
      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Deliveries
            </CardTitle>
            <Truck className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalDeliveries}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pending
            </CardTitle>
            <Clock className="w-4 h-4 text-warning" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.pendingDeliveries}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Assigned
            </CardTitle>
            <AlertCircle className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.assignedDeliveries}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Delivered
            </CardTitle>
            <CheckCircle className="w-4 h-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.deliveredCount}</div>
          </CardContent>
        </Card>
      </div>
      
      {/* Additional Stats for Admin/Manager */}
      {['admin', 'manager', 'marketing_agent'].includes(profile.role) && (
        <div className="grid gap-4 md:grid-cols-2">
          {['admin', 'manager'].includes(profile.role) && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Team Members
                </CardTitle>
                <Users className="w-4 h-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.usersCount}</div>
              </CardContent>
            </Card>
          )}
          
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Clients
              </CardTitle>
              <Package className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.clientsCount}</div>
            </CardContent>
          </Card>
        </div>
      )}
      
      {/* Recent Deliveries */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Deliveries</CardTitle>
          <CardDescription>Your latest delivery assignments</CardDescription>
        </CardHeader>
        <CardContent>
          {recentDeliveries.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No deliveries yet
            </p>
          ) : (
            <div className="space-y-4">
              {recentDeliveries.map((delivery) => (
                <div
                  key={delivery.id}
                  className="flex items-center justify-between p-4 rounded-lg border border-border"
                >
                  <div className="space-y-1">
                    <p className="font-medium">{delivery.customer_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {delivery.locality || 'No locality'} - {delivery.products || 'No products'}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
                      delivery.status === 'delivered' 
                        ? 'bg-success/10 text-success' 
                        : delivery.status === 'pending'
                        ? 'bg-muted text-muted-foreground'
                        : 'bg-primary/10 text-primary'
                    }`}>
                      {delivery.status}
                    </span>
                    <p className="text-sm text-muted-foreground mt-1">
                      Rs {Number(delivery.amount || 0).toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
