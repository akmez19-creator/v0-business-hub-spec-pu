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
        threads: [],
        manualProducts: [],
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

  // Conversations captured from the 1688 messenger by the browser extension.
  const { data: threads } = await adminDb
    .from('supplier_threads')
    .select('id, supplier_name, chat_handle, platform, message_count, history_complete, last_captured_at')
    .order('last_captured_at', { ascending: false })

  for (const t of threads || []) {
    const s = bySupplier.get((t.supplier_name || '').trim())
    if (!s) continue
    s.threads.push({
      id: t.id,
      handle: t.chat_handle,
      platform: t.platform,
      messages: t.message_count || 0,
      complete: !!t.history_complete,
      lastCaptured: t.last_captured_at,
    })
  }

  // Products attached by hand - things discussed but never ordered, which by
  // definition cannot come from purchase_orders.
  const { data: manual } = await adminDb
    .from('supplier_products')
    .select('supplier_name, source, products(id, name)')
    .eq('source', 'manual')

  for (const m of manual || []) {
    const s = bySupplier.get((m.supplier_name || '').trim())
    const p = m.products as unknown as { id: string; name: string } | null
    if (!s || !p) continue
    s.manualProducts.push({ id: p.id, name: p.name })
  }

  const suppliers = [...bySupplier.values()].sort((a, b) => b.spend - a.spend)

  // Only products that are still active are worth offering as new links.
  const { data: allProducts } = await adminDb
    .from('products')
    .select('id, name')
    .order('name')

  return (
    <SuppliersContent
      suppliers={suppliers}
      allProducts={(allProducts || []).map(p => ({ id: p.id, name: p.name }))}
    />
  )
}
