import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { StockCountContent } from '@/components/storekeeper/stock-count-content'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function StockCountPage() {
  const supabase = await createClient()
  const adminDb = createAdminClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Catalogue for the search-and-add picker. Selected narrowly (not select('*'))
  // because this list is sent to the client on every load.
  const { data: products } = await adminDb
    .from('products')
    .select('id, name, category, quantity, image_url, last_counted_at, has_variants, shelf_code, zone')
    .order('name')
    .limit(1000)

  // Resume the agent's open draft rather than starting a fresh session, so a
  // half-finished shelf count survives closing the phone.
  const { data: draft } = await adminDb
    .from('stock_counts')
    .select('id, count_date, notes, created_at')
    .eq('counted_by', user.id)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: items } = draft
    ? await adminDb
        .from('stock_count_items')
        .select('id, product_id, counted_qty, system_qty, is_baseline, variance, notes')
        .eq('count_id', draft.id)
        .order('created_at', { ascending: false })
    : { data: [] }

  // Recent submissions give the agent feedback on what the admin did with
  // earlier counts.
  const { data: recent } = await adminDb
    .from('stock_counts')
    .select('id, count_date, status, submitted_at, reviewed_at, review_notes')
    .eq('counted_by', user.id)
    .in('status', ['submitted', 'approved', 'rejected'])
    .order('created_at', { ascending: false })
    .limit(5)

  return (
    <StockCountContent
      products={products || []}
      draft={draft || null}
      draftItems={items || []}
      recentCounts={recent || []}
    />
  )
}
