import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { SuppliersContent, type SupplierSummary } from '@/components/purchase-orders/po-suppliers-content'

import { loadSupplierQuality } from '@/lib/purchase-orders/supplier-quality'

export const metadata = { title: 'China Import Suppliers | Business Hub', description: 'China import suppliers, separate 1688 and internal ratings, dated quality notes, original purchasing history and saved conversations.' }

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ supplier?: string }> }) {
  const { supplier: initialOpenName } = await searchParams
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

  // Every order - a supplier's total spend is wrong by however many rows the
  // 1000-row default cap would drop, with no error to say so.
  const rows = await fetchAll<{
    id: string
    index_no: string | null
    product_id: string | null
    supplier_name: string | null
    product_name: string | null
    qty: number | null
    total_payment_supplier: number | null
    total_payment_supplier_yuan: number | null
    total_cp_import: number | null
    status: string | null
    created_at: string
    order_date: string | null
    link: string | null
  }>((from, to) =>
    adminDb
      .from('purchase_orders')
      .select(
        'id,index_no,product_id,supplier_name, product_name, qty, total_payment_supplier, total_payment_supplier_yuan, total_cp_import, status, created_at, order_date, link',
      )
      .not('supplier_name', 'is', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
  )

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
        imports: [],
      }
      bySupplier.set(name, s)
    }

    s.imports!.push({ id: r.id, caption: `${r.index_no || r.id.slice(0, 8)} · ${r.product_name || 'Product'}${r.order_date ? ` · ${r.order_date}` : ''}`, productId: r.product_id })
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
    if (r.order_date && (!s.lastActualOrder || r.order_date > s.lastActualOrder)) s.lastActualOrder = r.order_date
    if (r.created_at && (!s.lastOrder || r.created_at > s.lastOrder)) {
      s.lastOrder = r.created_at
    }
    if (!s.sampleLink && r.link) s.sampleLink = r.link
  }

  // Conversations captured from the 1688 messenger by the browser extension.
  const threads = await fetchAll<{ id: string; supplier_name: string; chat_handle: string; platform: string; message_count: number; history_complete: boolean; last_captured_at: string | null }>((from, to) => adminDb
    .from('supplier_threads')
    .select('id, supplier_name, chat_handle, platform, message_count, history_complete, last_captured_at')
    .order('last_captured_at', { ascending: false }).order('id').range(from, to))

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
  const manual = await fetchAll<{ supplier_name: string; source: string; products: unknown }>((from, to) => adminDb
    .from('supplier_products')
    .select('supplier_name, source, products(id, name)')
    .eq('source', 'manual').order('id').range(from, to))

  for (const m of manual || []) {
    const s = bySupplier.get((m.supplier_name || '').trim())
    const p = m.products as unknown as { id: string; name: string } | null
    if (!s || !p) continue
    s.manualProducts.push({ id: p.id, name: p.name })
  }

  const [quality, allProducts] = await Promise.all([
    loadSupplierQuality(adminDb),
    // Only products that are still active are worth offering as new links.
    fetchAll<{ id: string; name: string }>((from, to) => adminDb.from('products').select('id,name').order('name').order('id').range(from, to)),
  ])
  const byAlias = new Map(quality.flatMap(profile => profile.aliases.map(name => [name, profile] as const)))
  for (const supplier of bySupplier.values()) supplier.quality = byAlias.get(supplier.name) ?? null
  const suppliers = [...bySupplier.values()].sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name))

  return (
    <SuppliersContent
      suppliers={suppliers}
      initialOpenName={initialOpenName && bySupplier.has(initialOpenName) ? initialOpenName : null}
      allProducts={(allProducts || []).map(p => ({ id: p.id, name: p.name }))}
    />
  )
}
