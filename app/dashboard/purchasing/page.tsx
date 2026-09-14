import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { PurchaseOrdersContent } from '@/components/purchase-orders/po-content'
import type { PurchaseOrder } from '@/components/purchase-orders/po-columns'

export const metadata = {
  title: 'Imports | Business Hub',
  description: 'China imports, supplier purchasing history, pricing and shipment tracking.',
}

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ supplier?: string }>
}) {
  const { supplier: supplierParam } = await searchParams
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

  /*
   * EVERY order, in one paged read.
   *
   * This used to be `.limit(500)` on a newest-first list. With 690 orders the
   * 190 oldest were never sent to the page - including the first-ever Pest
   * Repellent PO (3,000 units) the owner asked about - while the stats card
   * beside the list, computed from a second unlimited query, said 690. Two
   * numbers on one screen that could not both be true.
   *
   * The stats and the supplier filter are now derived from THIS array, not
   * from separate queries, so the count on the card is the count in the list
   * by construction. `id` is the tiebreaker because a batch import gives every
   * row the same `created_at`.
   */
  const orders = await fetchAll<PurchaseOrder>((from, to) =>
    adminDb
      .from('purchase_orders')
      .select(`
        *,
        products:product_id (id, name, image_url)
      `)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  )

  const stats = {
    totalOrders: orders.length,
    totalQty: orders.reduce((sum, o) => sum + (o.qty || 0), 0),
    byStatus: {} as Record<string, number>,
  }

  for (const order of orders) {
    const s = order.status || 'pending'
    stats.byStatus[s] = (stats.byStatus[s] || 0) + 1
  }

  const uniqueSuppliers = [...new Set(orders.map((o) => o.supplier_name).filter(Boolean))]

  return (
    <div className="space-y-6">
      <PurchaseOrdersContent
        key={supplierParam || 'all'}
        initialOrders={orders}
        stats={stats}
        suppliers={uniqueSuppliers as string[]}
        initialSupplier={supplierParam}
      />
    </div>
  )
}
