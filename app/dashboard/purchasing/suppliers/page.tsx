import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { SuppliersContent, type SupplierSummary } from '@/components/purchase-orders/po-suppliers-content'

export default async function SuppliersPage() {
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

  const { data: rows } = await adminDb
    .from('purchase_orders')
    .select(
      'supplier_name, product_name, qty, total_payment_supplier, total_payment_supplier_yuan, total_cp_import, status, created_at, link',
    )
    .not('supplier_name', 'is', null)

  // Aggregate in one pass. Suppliers are identified by name because that is the
  // only supplier key the imported Excel carries - there is no suppliers table.
  const bySupplier = new Map<string, SupplierSummary>()

  for (const r of rows || []) {
    const name = (r.supplier_name || '').trim()
    if (!name) continue

    let s = bySupplier.get(name)
    if (!s) {
      s = {
        name,
        orders: 0,
        qty: 0,
        spend: 0,
        spendYuan: 0,
        landed: 0,
        products: [],
        lastOrder: null,
        statuses: {},
        sampleLink: null,
      }
      bySupplier.set(name, s)
    }

    s.orders += 1
    s.qty += r.qty || 0
    s.spend += Number(r.total_payment_supplier) || 0
    s.spendYuan += Number(r.total_payment_supplier_yuan) || 0
    s.landed += Number(r.total_cp_import) || 0

    const status = r.status || 'pending'
    s.statuses[status] = (s.statuses[status] || 0) + 1

    if (r.product_name && !s.products.includes(r.product_name)) {
      s.products.push(r.product_name)
    }
    if (r.created_at && (!s.lastOrder || r.created_at > s.lastOrder)) {
      s.lastOrder = r.created_at
    }
    if (!s.sampleLink && r.link) s.sampleLink = r.link
  }

  const suppliers = [...bySupplier.values()].sort((a, b) => b.spend - a.spend)

  return <SuppliersContent suppliers={suppliers} />
}
