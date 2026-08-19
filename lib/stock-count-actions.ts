'use server'

import { revalidatePath } from 'next/cache'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { MatchCandidate } from '@/lib/types'

/**
 * Server actions for warehouse physical stock counts.
 *
 * Every mutation re-derives the caller's identity and role from the session on
 * the server. RLS is disabled on `products` and `stock_counts`, so the role
 * check here is the only thing standing between a storekeeper and approving
 * their own count - it must never be trusted from client input.
 */

type ActionResult<T = void> = { ok: true; data?: T } | { ok: false; error: string }

/** Resolves the signed-in user's profile, or null when not authenticated. */
async function getActor() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const adminDb = createAdminClient()
  const { data: profile } = await adminDb
    .from('profiles')
    .select('id, role, name, email')
    .eq('id', user.id)
    .single()

  return profile ?? null
}

type Actor = { id: string; role: string; name: string | null; email: string | null }
/** `ok` is an explicit discriminant so narrowing works at every call site. */
type Guard = { ok: true; actor: Actor } | { ok: false; error: string }

/** Storekeepers and admins may record counts. */
async function requireCounter(): Promise<Guard> {
  const actor = await getActor()
  if (!actor) return { ok: false, error: 'Not signed in' }
  if (actor.role !== 'storekeeper' && actor.role !== 'admin') {
    return { ok: false, error: 'Not permitted to record stock counts' }
  }
  return { ok: true, actor }
}

/**
 * Only admins may approve. Deliberately stricter than the storekeeper layout
 * guard, which admits storekeepers too - otherwise the approval step the user
 * asked for would be self-serve and meaningless.
 */
async function requireApprover(): Promise<Guard> {
  const actor = await getActor()
  if (!actor) return { ok: false, error: 'Not signed in' }
  if (actor.role !== 'admin') {
    return { ok: false, error: 'Only an admin can approve stock counts' }
  }
  return { ok: true, actor }
}

/** Returns the caller's open draft session, creating one if needed. */
export async function getOrCreateDraftCount(): Promise<
  ActionResult<{ id: string; count_date: string }>
> {
  const guard = await requireCounter()
  if (!guard.ok) return { ok: false, error: guard.error }

  const adminDb = createAdminClient()

  const { data: existing } = await adminDb
    .from('stock_counts')
    .select('id, count_date')
    .eq('counted_by', guard.actor.id)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing) return { ok: true, data: existing }

  const { data, error } = await adminDb
    .from('stock_counts')
    .insert({ counted_by: guard.actor.id, status: 'draft' })
    .select('id, count_date')
    .single()

  if (error) {
    console.log('[v0] create draft count failed:', error.message)
    return { ok: false, error: 'Could not start a count session' }
  }
  return { ok: true, data }
}

/**
 * Adds or updates a counted line.
 *
 * `system_qty` and `is_baseline` are read from the database, never from the
 * client, so the recorded variance reflects real stock at the moment of
 * counting and cannot be spoofed by a tampered request.
 */
export async function saveCountItem(input: {
  countId: string
  productId: string
  countedQty: number
  notes?: string
}): Promise<ActionResult> {
  const guard = await requireCounter()
  if (!guard.ok) return { ok: false, error: guard.error }

  const qty = Number(input.countedQty)
  if (!Number.isInteger(qty) || qty < 0) {
    return { ok: false, error: 'Counted quantity must be a whole number of 0 or more' }
  }
  // Guard against a fat-fingered extra digit becoming permanent stock.
  if (qty > 1_000_000) {
    return { ok: false, error: 'That quantity looks too large - please re-check' }
  }

  const adminDb = createAdminClient()

  // Only the session owner may edit it, and only while it is still a draft.
  const { data: session } = await adminDb
    .from('stock_counts')
    .select('id, status, counted_by')
    .eq('id', input.countId)
    .single()

  if (!session) return { ok: false, error: 'Count session not found' }
  if (session.status !== 'draft') {
    return { ok: false, error: 'This count has already been submitted' }
  }
  if (session.counted_by !== guard.actor.id && guard.actor.role !== 'admin') {
    return { ok: false, error: 'This count belongs to another agent' }
  }

  const { data: product } = await adminDb
    .from('products')
    .select('id, quantity, last_counted_at')
    .eq('id', input.productId)
    .single()

  if (!product) return { ok: false, error: 'Product not found' }

  const { error } = await adminDb.from('stock_count_items').upsert(
    {
      count_id: input.countId,
      product_id: input.productId,
      counted_qty: qty,
      system_qty: product.quantity || 0,
      // Baseline means "there is no figure to compare against", which is only
      // true when stock is genuinely 0/null. A product carrying book stock that
      // was never formally counted (quantity > 0, last_counted_at null) still
      // has a real figure to reconcile against, so flagging it as a baseline
      // would silently swallow a genuine shortfall.
      is_baseline: !product.last_counted_at && !product.quantity,
      notes: input.notes || null,
    },
    { onConflict: 'count_id,product_id' },
  )

  if (error) {
    console.log('[v0] saveCountItem failed:', error.message)
    return { ok: false, error: 'Could not save this count' }
  }

  revalidatePath('/dashboard/storekeeper/stock-count')
  return { ok: true }
}

/* ------------------------------------------------------------------ *
 * Photo-first counting
 *
 * The agent photographs an item and records a quantity before anyone knows
 * which product it is. That row cannot go straight into `stock_count_items`
 * (product_id is NOT NULL there), so it is staged as a capture and promoted to
 * a real count line once a human confirms the product.
 * ------------------------------------------------------------------ */

/** Shared shelf-code validation, so every entry path agrees on the shape. */
function normaliseShelf(raw: string | null | undefined): { value: string | null; error?: string } {
  const normalised = (raw || '').replace(/\s+/g, '').toUpperCase()
  if (!normalised) return { value: null }
  if (!/^[A-Z]{1,3}\d{0,4}[A-Z]?$/.test(normalised)) {
    return { value: null, error: 'Use a shelf code like E1' }
  }
  return { value: normalised }
}

/**
 * Store the photo and quantity immediately, before any AI runs.
 *
 * Written first on purpose: the agent's work is saved the moment they press the
 * button, so a dropped signal, a closed tab or a failed vision call can never
 * cost them a count they already did.
 */
export async function createCapture(input: {
  countId: string
  photoUrl: string
  countedQty: number
  shelfCode?: string | null
  /**
   * Matching usually finishes while the agent is still typing the quantity, so
   * the result is passed in here rather than recomputed - re-running two vision
   * calls per capture would double the cost and the wait for no benefit.
   */
  aiLabel?: string | null
  aiCandidates?: MatchCandidate[] | null
  aiStatus?: 'analysing' | 'suggested' | 'unmatched'
}): Promise<ActionResult<{ id: string }>> {
  const guard = await requireCounter()
  if (!guard.ok) return { ok: false, error: guard.error }

  const qty = Number(input.countedQty)
  if (!Number.isInteger(qty) || qty < 0) {
    return { ok: false, error: 'Counted quantity must be a whole number of 0 or more' }
  }
  if (qty > 1_000_000) {
    return { ok: false, error: 'That quantity looks too large - please re-check' }
  }
  if (!input.photoUrl) return { ok: false, error: 'A photo is required' }

  const shelf = normaliseShelf(input.shelfCode)
  if (shelf.error) return { ok: false, error: shelf.error }

  const adminDb = createAdminClient()

  const { data: session } = await adminDb
    .from('stock_counts')
    .select('id, status, counted_by')
    .eq('id', input.countId)
    .single()

  if (!session) return { ok: false, error: 'Count session not found' }
  if (session.status !== 'draft') {
    return { ok: false, error: 'This count has already been submitted' }
  }
  if (session.counted_by !== guard.actor.id && guard.actor.role !== 'admin') {
    return { ok: false, error: 'This count belongs to another agent' }
  }

  const { data, error } = await adminDb
    .from('stock_count_captures')
    .insert({
      count_id: input.countId,
      photo_url: input.photoUrl,
      counted_qty: qty,
      shelf_code: shelf.value,
      // Defaults to 'analysing' so an interrupted match is visibly unfinished
      // rather than silently looking like "nothing found".
      status: input.aiStatus || 'analysing',
      ai_label: input.aiLabel || null,
      ai_candidates: input.aiCandidates || null,
      ai_confidence: input.aiCandidates?.[0]?.confidence ?? null,
      created_by: guard.actor.id,
    })
    .select('id')
    .single()

  if (error || !data) {
    console.log('[v0] createCapture failed:', error?.message)
    return { ok: false, error: 'Could not save this photo count' }
  }

  return { ok: true, data: { id: data.id } }
}

/**
 * Promote a capture into a real count line once a product is confirmed.
 *
 * Nothing reaches this point automatically - a human always taps the product,
 * because a confident-but-wrong AI match is indistinguishable on screen from a
 * correct one and this figure rewrites real stock on approval.
 */
export async function confirmCaptureMatch(input: {
  captureId: string
  productId: string
}): Promise<ActionResult> {
  const guard = await requireCounter()
  if (!guard.ok) return { ok: false, error: guard.error }

  const adminDb = createAdminClient()

  const { data: capture } = await adminDb
    .from('stock_count_captures')
    .select('id, count_id, counted_qty, shelf_code, photo_url, status')
    .eq('id', input.captureId)
    .single()

  if (!capture) return { ok: false, error: 'Capture not found' }
  if (capture.status === 'resolved') {
    return { ok: false, error: 'This photo has already been matched' }
  }

  // Reuses the existing count-line path, so photo counts land in exactly the
  // same shape as typed ones and the approval flow needs no special case.
  const saved = await saveCountItem({
    countId: capture.count_id,
    productId: input.productId,
    countedQty: capture.counted_qty,
    notes: 'Counted from photo',
  })
  if (!saved.ok) return saved

  // Record the shelf the agent read off the rack while they were standing there.
  if (capture.shelf_code) {
    await adminDb
      .from('products')
      .update({ shelf_code: capture.shelf_code })
      .eq('id', input.productId)
  }

  // Backfill the product image only when there isn't one. 66 products have no
  // photo, and every one filled in makes the next visual match better - but a
  // curated catalogue image must never be replaced by a shelf snapshot.
  const { data: product } = await adminDb
    .from('products')
    .select('id, image_url')
    .eq('id', input.productId)
    .single()

  if (product && !product.image_url) {
    await adminDb
      .from('products')
      .update({ image_url: capture.photo_url })
      .eq('id', input.productId)
  }

  const { error } = await adminDb
    .from('stock_count_captures')
    .update({
      status: 'resolved',
      matched_product_id: input.productId,
      resolved_by: guard.actor.id,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', input.captureId)

  if (error) {
    console.log('[v0] confirmCaptureMatch failed:', error.message)
    return { ok: false, error: 'Counted, but could not close off the photo' }
  }

  revalidatePath('/dashboard/storekeeper/stock-count')
  revalidatePath('/dashboard/deliveries/stock-count')
  return { ok: true }
}

/** Discard a capture - a duplicate photo, or a shot too poor to use. */
export async function discardCapture(captureId: string): Promise<ActionResult> {
  const guard = await requireCounter()
  if (!guard.ok) return { ok: false, error: guard.error }

  const adminDb = createAdminClient()
  const { data: capture } = await adminDb
    .from('stock_count_captures')
    .select('id, status')
    .eq('id', captureId)
    .single()

  if (!capture) return { ok: false, error: 'Capture not found' }
  if (capture.status === 'resolved') {
    // The count line already exists; removing the photo would orphan it.
    return { ok: false, error: 'Already counted - remove the count line instead' }
  }

  const { error } = await adminDb
    .from('stock_count_captures')
    .delete()
    .eq('id', captureId)

  if (error) return { ok: false, error: 'Could not discard this photo' }

  revalidatePath('/dashboard/storekeeper/stock-count')
  return { ok: true }
}

export async function removeCountItem(itemId: string): Promise<ActionResult> {
  const guard = await requireCounter()
  if (!guard.ok) return { ok: false, error: guard.error }

  const adminDb = createAdminClient()
  const { data: item } = await adminDb
    .from('stock_count_items')
    .select('id, count_id, stock_counts(status, counted_by)')
    .eq('id', itemId)
    .single<{ id: string; count_id: string; stock_counts: { status: string; counted_by: string } }>()

  if (!item) return { ok: false, error: 'Line not found' }
  if (item.stock_counts.status !== 'draft') {
    return { ok: false, error: 'This count has already been submitted' }
  }
  if (item.stock_counts.counted_by !== guard.actor.id && guard.actor.role !== 'admin') {
    return { ok: false, error: 'This count belongs to another agent' }
  }

  const { error } = await adminDb.from('stock_count_items').delete().eq('id', itemId)
  if (error) return { ok: false, error: 'Could not remove this line' }

  revalidatePath('/dashboard/storekeeper/stock-count')
  return { ok: true }
}

/** Submits a draft for admin review. Does NOT change stock. */
export async function submitCount(countId: string, notes?: string): Promise<ActionResult> {
  const guard = await requireCounter()
  if (!guard.ok) return { ok: false, error: guard.error }

  const adminDb = createAdminClient()

  const { data: session } = await adminDb
    .from('stock_counts')
    .select('id, status, counted_by')
    .eq('id', countId)
    .single()

  if (!session) return { ok: false, error: 'Count session not found' }
  if (session.status !== 'draft') {
    return { ok: false, error: 'This count has already been submitted' }
  }
  if (session.counted_by !== guard.actor.id && guard.actor.role !== 'admin') {
    return { ok: false, error: 'This count belongs to another agent' }
  }

  // An empty submission would create a no-op review task for the admin.
  const { count } = await adminDb
    .from('stock_count_items')
    .select('id', { count: 'exact', head: true })
    .eq('count_id', countId)

  if (!count) return { ok: false, error: 'Add at least one product before submitting' }

  const { error } = await adminDb
    .from('stock_counts')
    .update({
      status: 'submitted',
      submitted_at: new Date().toISOString(),
      notes: notes || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', countId)
    // Re-assert draft state so two taps cannot submit twice.
    .eq('status', 'draft')

  if (error) {
    console.log('[v0] submitCount failed:', error.message)
    return { ok: false, error: 'Could not submit this count' }
  }

  revalidatePath('/dashboard/storekeeper/stock-count')
  revalidatePath('/dashboard/deliveries/stock-counts')
  return { ok: true }
}

/**
 * Approves a count and writes the counted figures into products.quantity.
 *
 * The apply loop lives in the approve_stock_count() SQL function so the whole
 * session commits atomically.
 */
export async function approveCount(
  countId: string,
  reviewNotes?: string,
): Promise<ActionResult<{ productsUpdated: number }>> {
  const guard = await requireApprover()
  if (!guard.ok) return { ok: false, error: guard.error }

  const adminDb = createAdminClient()
  const { data, error } = await adminDb.rpc('approve_stock_count', {
    p_count_id: countId,
    p_reviewer: guard.actor.id,
    p_review_notes: reviewNotes || null,
  })

  if (error) {
    console.log('[v0] approveCount failed:', error.message)
    return { ok: false, error: 'Could not approve this count' }
  }
  if (!data?.ok) {
    return { ok: false, error: data?.error || 'Could not approve this count' }
  }

  revalidatePath('/dashboard/deliveries/stock-counts')
  revalidatePath('/dashboard/deliveries/inventory')
  return { ok: true, data: { productsUpdated: data.productsUpdated } }
}

/** Rejects a submitted count, leaving stock untouched. */
export async function rejectCount(countId: string, reviewNotes?: string): Promise<ActionResult> {
  const guard = await requireApprover()
  if (!guard.ok) return { ok: false, error: guard.error }

  const adminDb = createAdminClient()
  const { error } = await adminDb
    .from('stock_counts')
    .update({
      status: 'rejected',
      reviewed_by: guard.actor.id,
      reviewed_at: new Date().toISOString(),
      review_notes: reviewNotes || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', countId)
    .eq('status', 'submitted')

  if (error) {
    console.log('[v0] rejectCount failed:', error.message)
    return { ok: false, error: 'Could not reject this count' }
  }

  revalidatePath('/dashboard/deliveries/stock-counts')
  return { ok: true }
}

/**
 * Records where a product physically sits, e.g. shelf "E1" in zone "E".
 *
 * Unlike a counted quantity this applies immediately with no approval step: a
 * shelf label is descriptive metadata, not a stock figure, so a wrong value
 * misdirects someone for a minute rather than corrupting inventory numbers.
 *
 * `zone` is never written - it is a generated column derived from shelf_code by
 * Postgres, which also normalises the code (trim/upper) via trigger.
 */
export async function setProductShelf(
  productId: string,
  shelfCode: string | null,
): Promise<ActionResult<{ shelf_code: string | null; zone: string | null }>> {
  const guard = await requireCounter()
  if (!guard.ok) return { ok: false, error: guard.error }

  // Shared with the photo-capture path so both entry points normalise and
  // validate identically - an emptied field becomes NULL ("location unknown").
  const shelf = normaliseShelf(shelfCode)
  if (shelf.error) return { ok: false, error: shelf.error }
  const value = shelf.value

  const adminDb = createAdminClient()
  const { data, error } = await adminDb
    .from('products')
    .update({ shelf_code: value, updated_at: new Date().toISOString() })
    .eq('id', productId)
    .select('shelf_code, zone')
    .single()

  if (error) {
    console.log('[v0] setProductShelf failed:', error.message)
    return { ok: false, error: 'Could not save the shelf location' }
  }

  revalidatePath('/dashboard/storekeeper/stock-count')
  revalidatePath('/dashboard/deliveries/inventory')
  return { ok: true, data }
}
