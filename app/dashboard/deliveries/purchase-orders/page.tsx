import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { PurchaseOrdersContent } from '@/components/purchase-orders/po-content'

export default async function PurchaseOrdersPage() {
  const supabase = await createClient()
  const adminDb = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    redirect('/dashboard')
  }

  // Fetch purchase orders with product info
  const { data: orders } = await adminDb
    .from('purchase_orders')
    .select(`
      *,
      products:product_id (id, name, image_url)
    `)
    .order('created_at', { ascending: false })
    .limit(500)

  // Fetch summary stats
  const { data: allOrders } = await adminDb
    .from('purchase_orders')
    .select('status, total_payment_supplier, qty')

  const stats = {
    totalOrders: allOrders?.length || 0,
    totalQty: allOrders?.reduce((sum, o) => sum + (o.qty || 0), 0) || 0,
    totalValue: allOrders?.reduce((sum, o) => sum + (Number(o.total_payment_supplier) || 0), 0) || 0,
    byStatus: {} as Record<string, number>,
  }

  for (const order of allOrders || []) {
    const s = order.status || 'pending'
    stats.byStatus[s] = (stats.byStatus[s] || 0) + 1
  }

  // Fetch unique suppliers
  const { data: suppliers } = await adminDb
    .from('purchase_orders')
    .select('supplier_name')
    .not('supplier_name', 'is', null)

  const uniqueSuppliers = [...new Set((suppliers || []).map(s => s.supplier_name).filter(Boolean))]

  return (
    <div className="space-y-6">
      <PurchaseOrdersContent
        initialOrders={orders || []}
        stats={stats}
        suppliers={uniqueSuppliers as string[]}
      />
    </div>
  )
}
