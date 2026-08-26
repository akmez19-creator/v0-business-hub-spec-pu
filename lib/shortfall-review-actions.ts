'use server'

/**
 * Admin sign-off on a rider-reported stock shortage.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS SEPARATE FROM is_validated
 *
 * `contractor_daily_stock.is_validated` is the CONTRACTOR confirming his own
 * load, set from his own screen. Using it as the approval would mean the
 * person reporting the shortage is also the person approving it, and a
 * mistaken or dishonest report would silently erase units from the
 * storekeeper's expected count with nobody signing for it.
 *
 * So a shortage now has two independent steps:
 *   1. the rider reports it   (received_qty < expected_qty, is_validated)
 *   2. an admin/manager rules on it  (shortfall_review)
 *
 * Only step 2 removes anything from the storekeeper's returns list.
 * Until then the units stay on his screen, flagged as unconfirmed.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type ShortfallRuling = 'confirmed' | 'rejected'

/** Every screen whose numbers move when a shortage is ruled on. */
const AFFECTED_PATHS = [
  '/dashboard/admin/stock-validation',
  '/dashboard/storekeeper/stock-in',
  '/dashboard/contractors/returns',
  '/dashboard/contractors/stock',
]

/**
 * Confirm or reject one reported shortage (one contractor + day + product).
 *
 * `confirmed` = the goods never left the store, so drop them from the
 * storekeeper's returns count.
 * `rejected`  = the goods did go out, so they belong back on the count and
 * must be physically returned.
 */
export async function reviewStockShortfall(params: {
  contractorId: string
  stockDate: string
  product: string
  ruling: ShortfallRuling
  note?: string
}) {
  const { contractorId, stockDate, product, ruling, note } = params

  if (ruling !== 'confirmed' && ruling !== 'rejected') {
    return { error: 'Invalid ruling' }
  }
  if (!contractorId || !stockDate || !product) {
    return { error: 'Missing contractor, date or product' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  // Riders and marketing agents must never sign off a shortage - a rider would
  // be approving his own report. Same gate the rest of the admin actions use.
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Not authorised to review stock shortages' }
  }

  // The row is written through the service role after an explicit role check,
  // rather than by widening RLS: RLS grants ROWS, not COLUMNS, and a rider
  // already needs UPDATE on this table to report his own received counts.
  const adminDb = createAdminClient()

  const { data: updated, error } = await adminDb
    .from('contractor_daily_stock')
    .update({
      shortfall_review: ruling,
      shortfall_reviewed_by: user.id,
      shortfall_reviewed_at: new Date().toISOString(),
      shortfall_review_note: note?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('contractor_id', contractorId)
    .eq('stock_date', stockDate)
    .eq('product', product)
    .select('id')

  if (error) return { error: error.message }

  // An UPDATE that matches no row succeeds silently and returns 204 with a
  // null error, so the caller would show a success toast over a write that
  // never happened. Treat "nothing changed" as the failure it is.
  if (!updated || updated.length === 0) {
    return { error: 'That stock line no longer exists - reload and try again.' }
  }

  for (const p of AFFECTED_PATHS) revalidatePath(p)
  return { success: true, reviewed: updated.length }
}

/** Undo a ruling, putting the shortage back in the awaiting-review queue. */
export async function clearStockShortfallReview(params: {
  contractorId: string
  stockDate: string
  product: string
}) {
  const { contractorId, stockDate, product } = params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Not authorised to review stock shortages' }
  }

  const adminDb = createAdminClient()
  const { data: updated, error } = await adminDb
    .from('contractor_daily_stock')
    .update({
      shortfall_review: null,
      shortfall_reviewed_by: null,
      shortfall_reviewed_at: null,
      shortfall_review_note: null,
      updated_at: new Date().toISOString(),
    })
    .eq('contractor_id', contractorId)
    .eq('stock_date', stockDate)
    .eq('product', product)
    .select('id')

  if (error) return { error: error.message }
  if (!updated || updated.length === 0) {
    return { error: 'That stock line no longer exists - reload and try again.' }
  }

  for (const p of AFFECTED_PATHS) revalidatePath(p)
  return { success: true }
}
