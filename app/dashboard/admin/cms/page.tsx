import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, Phone, MapPin, Calendar, Clock, Bike, Building2, Package, StickyNote, RefreshCw, DollarSign, Edit, RotateCcw } from 'lucide-react'
import Link from 'next/link'
import { getPendingCmsModifications } from '@/lib/admin-actions'
import { CmsReviewActions } from '@/components/admin/cms-review-actions'
import { CmsEditActions } from '@/components/admin/cms-edit-actions'

export default async function CMSAdminPage() {
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

  // Get CMS modifications for review
  const { modifications: cmsModifications } = await getPendingCmsModifications()
  const pendingModifications = cmsModifications?.filter(m => m.status === 'pending') || []
  const reviewedModifications = cmsModifications?.filter(m => m.status !== 'pending') || []
  
  // Get all CMS deliveries with related data
  const { data: cmsDeliveries } = await supabase
    .from('deliveries')
    .select(`
      id,
      customer_name,
      contact_1,
      contact_2,
      locality,
      products,
      qty,
      amount,
      status,
      delivery_notes,
      delivery_date,
      status_updated_at,
      rider_id,
      contractor_id,
      latitude,
      longitude,
      sales_type
    `)
    .eq('status', 'cms')
    .order('status_updated_at', { ascending: false })
  
  // Fetch ALL riders from the riders table (rider_id in deliveries references riders.id, NOT profiles.id)
  const { data: allRidersData } = await adminDb
    .from('riders')
    .select('id, name, first_name, surname, phone, contractor_id, is_active')
    .eq('is_active', true)
    .order('name')
  
  // Also fetch contractors from profiles (for contractor_id mapping)
  const { data: contractorProfiles } = await adminDb
    .from('profiles')
    .select('id, name, email')
    .eq('role', 'contractor')
  
  const riderMap: Record<string, string> = {}
  const contractorMap: Record<string, string> = {}
  
  // Build rider map from riders table
  for (const r of (allRidersData || [])) {
    const displayName = r.name || (r.first_name && r.surname ? `${r.first_name} ${r.surname}` : r.first_name || r.surname) || 'Unnamed Rider'
    riderMap[r.id] = displayName
  }
  
  // Build contractor map from profiles
  for (const c of (contractorProfiles || [])) {
    contractorMap[c.id] = c.name || c.email || 'Unknown Contractor'
  }
  
  // All riders for dropdown
  const allRiders = (allRidersData || []).map(r => ({
    id: r.id,
    name: r.name || (r.first_name && r.surname ? `${r.first_name} ${r.surname}` : r.first_name || r.surname) || 'Unnamed Rider',
    email: r.phone || '',
    role: 'rider' as const
  }))
  
  // Get all regions for editing
  const { data: regions } = await adminDb
    .from('deliveries')
    .select('locality')
    .not('locality', 'is', null)
  const uniqueRegions = [...new Set((regions || []).map(r => r.locality).filter(Boolean))].sort()
  
  // Get all products for editing
  const { data: productsData } = await adminDb
    .from('products')
    .select('name')
    .eq('is_active', true)
    .order('name')
  const allProducts = (productsData || []).map(p => p.name)
  
  // Group by reason
  const reasonCounts: Record<string, number> = {}
  for (const d of (cmsDeliveries || [])) {
    const reason = d.delivery_notes || 'No Reason Given'
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1
  }
  
  // Group by rider
  const riderCounts: Record<string, { name: string, count: number, deliveries: typeof cmsDeliveries }> = {}
  for (const d of (cmsDeliveries || [])) {
    const riderId = d.rider_id || 'unassigned'
    const riderName = d.rider_id ? (riderMap[d.rider_id] || 'Unknown Rider') : 'Unassigned'
    if (!riderCounts[riderId]) {
      riderCounts[riderId] = { name: riderName, count: 0, deliveries: [] }
    }
    riderCounts[riderId].count++
    riderCounts[riderId].deliveries?.push(d)
  }
  
  // Sort riders by CMS count (highest first)
  const sortedRiders = Object.entries(riderCounts)
    .sort((a, b) => b[1].count - a[1].count)
  
  // Group by date
  const today = new Date().toISOString().split('T')[0]
  const todayCms = (cmsDeliveries || []).filter(d => d.delivery_date === today)
  const olderCms = (cmsDeliveries || []).filter(d => d.delivery_date !== today)
  
  // Format time
  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return '-'
    const date = new Date(dateStr)
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }
  
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  }
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-amber-500" />
            CMS Management
          </h2>
          <p className="text-muted-foreground">
            Review and manage all &quot;Could Not Serve&quot; deliveries
          </p>
        </div>
        <Link href="/dashboard/admin/cms" className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 text-sm font-medium transition-colors">
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Link>
      </div>
      
      {/* Stats Overview */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total CMS
            </CardTitle>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-500">{cmsDeliveries?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Today&apos;s CMS
            </CardTitle>
            <Calendar className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{todayCms.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Riders with CMS
            </CardTitle>
            <Bike className="w-4 h-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-500">{sortedRiders.filter(([id]) => id !== 'unassigned').length}</div>
            <p className="text-xs text-muted-foreground">
              {sortedRiders.length > 0 && sortedRiders[0][1].count > 0 ? `Highest: ${sortedRiders[0][1].count}` : ''}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Price Reviews
            </CardTitle>
            <DollarSign className="w-4 h-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-500">{pendingModifications.length}</div>
            <p className="text-xs text-muted-foreground">Pending approval</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Unique Reasons
            </CardTitle>
            <StickyNote className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{Object.keys(reasonCounts).length}</div>
          </CardContent>
        </Card>
      </div>
      
      {/* Pending Price Reviews - Priority Section */}
      {pendingModifications.length > 0 && (
        <Card className="border-purple-500/30 bg-purple-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-purple-600">
              <DollarSign className="w-5 h-5" />
              Price Adjustments Pending Review ({pendingModifications.length})
            </CardTitle>
            <CardDescription>
              Riders have made price adjustments that need your approval
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {pendingModifications.map(mod => (
                <div 
                  key={mod.id} 
                  className="p-4 rounded-lg border border-purple-500/20 bg-background"
                >
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    {/* Order Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="font-semibold truncate">{mod.customer_name}</h4>
                        <Badge variant="outline" className="bg-purple-500/10 text-purple-600 border-purple-500/20 text-[10px]">
                          Price Review
                        </Badge>
                      </div>
                      
                      <div className="mb-3 p-2 rounded-md bg-muted/50">
                        <p className="text-sm font-medium">{mod.qty}x {mod.product_name}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          CMS Reason: <span className="font-medium">{mod.notes}</span>
                        </p>
                      </div>
                      
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <MapPin className="w-3.5 h-3.5" />
                          <span className="truncate">{mod.locality}</span>
                        </div>
                        {mod.rider_name && (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Bike className="w-3.5 h-3.5" />
                            <span>{mod.rider_name}</span>
                          </div>
                        )}
                        {mod.contractor_name && (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Building2 className="w-3.5 h-3.5" />
                            <span>{mod.contractor_name}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Review Actions */}
                    <div className="lg:w-64 shrink-0">
                      <CmsReviewActions modification={mod} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* All CMS Deliveries - Unified View */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            All CMS Deliveries ({cmsDeliveries?.length || 0})
          </CardTitle>
          <CardDescription>All failed deliveries sorted by date - newest first</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {(cmsDeliveries || []).map(delivery => (
              <div 
                key={delivery.id} 
                className={`p-4 rounded-lg border transition-colors ${
                  delivery.delivery_date === today 
                    ? 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10' 
                    : 'border-border bg-muted/30 hover:bg-muted/50'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  {/* Customer & Delivery Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span className="font-semibold truncate">{delivery.customer_name}</span>
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[10px] shrink-0">
                        {delivery.delivery_notes || 'No reason'}
                      </Badge>
                      {delivery.delivery_date === today && (
                        <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-[10px] shrink-0">
                          Today
                        </Badge>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {delivery.contact_1}
                      </span>
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {delivery.locality}
                      </span>
                      <span className="flex items-center gap-1">
                        <Package className="w-3 h-3" />
                        {delivery.qty || 1}x {delivery.products}
                      </span>
                      {delivery.rider_id && riderMap[delivery.rider_id] && (
                        <span className="flex items-center gap-1">
                          <Bike className="w-3 h-3" />
                          {riderMap[delivery.rider_id]}
                        </span>
                      )}
                    </div>
                  </div>
                  
                  {/* Amount, Date & Actions */}
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <span className="font-mono text-sm font-medium">Rs {delivery.amount || 0}</span>
                      <p className="text-xs text-muted-foreground">{formatDate(delivery.delivery_date)}</p>
                    </div>
                    <CmsEditActions
                      delivery={delivery}
                      riders={allRiders || []}
                      regions={uniqueRegions}
                      products={allProducts}
                      riderMap={riderMap}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      
      {/* Empty State */}
      {(cmsDeliveries?.length || 0) === 0 && (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <AlertTriangle className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-muted-foreground">No CMS Deliveries</h3>
              <p className="text-sm text-muted-foreground/70">All deliveries have been completed successfully</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
