import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { StockCountReview } from '@/components/deliveries/stock-count-review'
import { UnidentifiedCaptures } from '@/components/deliveries/unidentified-captures'

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

  // Photos counted on the shelf that nobody has matched to a product yet.
  // Deliberately NOT filtered by session status: an unresolved capture holds a
  // real quantity, so it needs resolving whether or not the agent has finished
  // their session.
  const { data: rawCaptures } = await adminDb
    .from('stock_count_captures')
    .select(
      // Two FKs point at profiles (created_by, resolved_by), so the join must be
      // named explicitly or Postgres cannot tell which one is meant.
      'id, photo_url, counted_qty, shelf_code, zone, status, ai_label, ai_candidates, ai_error, created_at, count_id, stock_counts(status), profiles!stock_count_captures_created_by_fkey(name)',
    )
    .neq('status', 'resolved')
    .order('created_at', { ascending: false })

  // An embedded row can arrive as an object or a single-element array depending
  // on how the relationship is inferred, so both shapes are unwrapped.
  const firstOf = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

  const captures = ((rawCaptures || []) as unknown[]).map(row => {
    const c = row as Record<string, unknown>
    return {
      id: c.id as string,
      photo_url: c.photo_url as string,
      counted_qty: c.counted_qty as number,
      shelf_code: (c.shelf_code as string | null) ?? null,
      zone: (c.zone as string | null) ?? null,
      status: c.status as string,
      ai_label: (c.ai_label as string | null) ?? null,
      ai_candidates: (c.ai_candidates as unknown[] | null) ?? null,
      ai_error: (c.ai_error as string | null) ?? null,
      created_at: c.created_at as string,
      count_status: firstOf(c.stock_counts as { status: string })?.status || 'draft',
      counted_by_name: firstOf(c.profiles as { name: string })?.name || 'Unknown agent',
    }
  })

  // Only needed for the manual product picker in the queue, so keep it light.
  const { data: productOptions } = captures.length
    ? await adminDb
        .from('products')
        .select('id, name, category, image_url')
        .eq('is_active', true)
        .order('name')
    : { data: [] }

  return (
    <div className="flex flex-col gap-4">
      <UnidentifiedCaptures
        captures={captures as never[]}
        products={(productOptions || []) as never[]}
      />
      <StockCountReview
        sessions={sessions}
        lines={(lines || []) as never[]}
        canApprove={profile.role === 'admin'}
      />
    </div>
  )
}
