import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { StockCountReview } from '@/components/deliveries/stock-count-review'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function StockCountsPage() {
  const supabase = await createClient()
  const adminDb = createAdminClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  // Approving rewrites products.quantity, so this page is admin/manager only.
  if (!profile || (profile.role !== 'admin' && profile.role !== 'manager')) {
    redirect('/dashboard')
  }

  // Session-level rollup comes from SQL so the list does not need to pull every
  // line item just to show variance totals.
  const { data: allSessions, error } = await adminDb.rpc('get_stock_count_summary')

  if (error) {
    console.log('[v0] stock count summary failed:', error.message)
  }

  // Drafts are an agent's work-in-progress and are not ready for review, so
  // they are kept out of the admin queue.
  const sessions = (allSessions || []).filter(
    (s: { status: string }) => s.status !== 'draft',
  )

  // Line detail for every non-draft session, joined to product names.
  const ids = sessions.map((s: { id: string }) => s.id)
  const { data: lines } = ids.length
    ? await adminDb
        .from('stock_count_items')
        .select('id, count_id, product_id, counted_qty, system_qty, is_baseline, variance, products(name)')
        .in('count_id', ids)
    : { data: [] }

  return (
    <StockCountReview
      sessions={sessions}
      lines={(lines || []) as never[]}
      canApprove={profile.role === 'admin'}
    />
  )
}
