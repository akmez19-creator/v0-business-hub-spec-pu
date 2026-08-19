import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { InventoryContent } from '@/components/deliveries/inventory-content'

export default async function InventoryPage() {
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

  // Stock breakdown is aggregated in SQL: purchase_orders + deliveries run to
  // thousands of rows and PostgREST silently caps selects at 1000, which would
  // under-report every total. The RPC also does the product_id -> name ->
  // product_aliases resolution that recovers ~96% of unlinked delivery rows.
  const [{ data: products }, { data: stock, error: stockError }] = await Promise.all([
    adminDb.from('products').select('*').order('name'),
    adminDb.rpc('get_product_stock_summary'),
  ])

  if (stockError) {
    console.log('[v0] stock summary failed:', stockError.message)
  }

  return (
    <InventoryContent
      products={products || []}
      // Degrade to no breakdown rather than an empty catalog: the product list
      // must still render if the stock aggregate fails.
      stock={stock?.products ?? {}}
      unresolvedDeliveries={stock?.unresolvedDeliveries ?? 0}
    />
  )
}
