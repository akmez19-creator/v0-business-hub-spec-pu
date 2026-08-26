'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

/**
 * Admin validation of returns the storekeeper never ticked in.
 *
 * Goes through the service role plus an explicit role check rather than by
 * widening RLS: an RLS update that matches no row SUCCEEDS silently, so a
 * policy gap would look like a working button that quietly changes nothing.
 * The same reason the marketing-agent order edits are wired this way.
 */
async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not signed in' as const, user: null }

  const adminDb = createAdminClient()
  const { data: profile } = await adminDb
    .from('profiles').select('role').eq('id', user.id).single()

  if (!profile || (profile.role !== 'admin' && profile.role !== 'manager')) {
    return { error: 'Not authorized' as const, user: null }
  }
  return { error: null, user }
}

export interface ValidateTargets {
  deliveryIds?: string[]
  returnCollectionIds?: string[]
}

/**
 * Ticks rows in as received. Mirrors what the storekeeper screen writes, so a
 * row validated here is indistinguishable downstream except by who signed it -
 * `stock_verified_by` is what separates an admin catch-up from the
 * storekeeper's own count, which is why no new column is needed.
 */
export async function adminValidateReturns(targets: ValidateTargets) {
  const { error: authError, user } = await requireAdmin()
  if (!user) return { error: authError }

  const deliveryIds = targets.deliveryIds ?? []
  const returnCollectionIds = targets.returnCollectionIds ?? []
  if (deliveryIds.length === 0 && returnCollectionIds.length === 0) {
    return { error: 'Nothing selected' }
  }

  const adminDb = createAdminClient()
  const now = new Date().toISOString()
  let affected = 0

  if (deliveryIds.length > 0) {
    const { data, error } = await adminDb.from('deliveries').update({
      stock_verified: true,
      stock_verified_at: now,
      stock_verified_by: user.id,
    }).in('id', deliveryIds).select('id')
    if (error) return { error: error.message }
    affected += data?.length ?? 0
  }

  if (returnCollectionIds.length > 0) {
    const { data, error } = await adminDb.from('return_collections').update({
      verified: true,
      verified_at: now,
      verified_by: user.id,
    }).in('id', returnCollectionIds).select('id')
    if (error) return { error: error.message }
    affected += data?.length ?? 0
  }

  revalidatePath('/dashboard/admin/stock-validation')
  revalidatePath('/dashboard/storekeeper/stock-in')
  return { success: true, affected }
}

/**
 * Ticks OPENING STOCK as counted onto the van.
 *
 * Writes the same `stock_out` columns the storekeeper's dispatch screen uses,
 * so the two screens stay one source of truth. `stock_out_by` records who
 * signed it, which is the only thing distinguishing an admin catch-up from a
 * count actually done at the warehouse door.
 *
 * Worth being honest about what this button means: ticking here does NOT prove
 * the units were on the van. It records that an admin accepted the load after
 * the fact. Only the storekeeper ticking at dispatch time is a real count.
 */
export async function adminValidateOutgoing(deliveryIds: string[]) {
  const { error: authError, user } = await requireAdmin()
  if (!user) return { error: authError }
  if (!deliveryIds?.length) return { error: 'Nothing selected' }

  const adminDb = createAdminClient()
  const { data, error } = await adminDb.from('deliveries').update({
    stock_out: true,
    stock_out_at: new Date().toISOString(),
    stock_out_by: user.id,
  }).in('id', deliveryIds).select('id')
  if (error) return { error: error.message }

  revalidatePath('/dashboard/admin/stock-validation')
  revalidatePath('/dashboard/storekeeper/stock-out')
  return { success: true, affected: data?.length ?? 0 }
}

/** Undoes an outgoing tick. */
export async function adminResetOutgoing(deliveryIds: string[]) {
  const { error: authError, user } = await requireAdmin()
  if (!user) return { error: authError }
  if (!deliveryIds?.length) return { error: 'Nothing selected' }

  const adminDb = createAdminClient()
  const { data, error } = await adminDb.from('deliveries').update({
    stock_out: false, stock_out_at: null, stock_out_by: null,
  }).in('id', deliveryIds).select('id')
  if (error) return { error: error.message }

  revalidatePath('/dashboard/admin/stock-validation')
  revalidatePath('/dashboard/storekeeper/stock-out')
  return { success: true, affected: data?.length ?? 0 }
}

/** Undoes a validation, so a mistaken tick is not permanent. */
export async function adminResetReturns(targets: ValidateTargets) {
  const { error: authError, user } = await requireAdmin()
  if (!user) return { error: authError }

  const deliveryIds = targets.deliveryIds ?? []
  const returnCollectionIds = targets.returnCollectionIds ?? []
  if (deliveryIds.length === 0 && returnCollectionIds.length === 0) {
    return { error: 'Nothing selected' }
  }

  const adminDb = createAdminClient()
  let affected = 0

  if (deliveryIds.length > 0) {
    const { data, error } = await adminDb.from('deliveries').update({
      stock_verified: false, stock_verified_at: null, stock_verified_by: null,
    }).in('id', deliveryIds).select('id')
    if (error) return { error: error.message }
    affected += data?.length ?? 0
  }

  if (returnCollectionIds.length > 0) {
    const { data, error } = await adminDb.from('return_collections').update({
      verified: false, verified_at: null, verified_by: null,
    }).in('id', returnCollectionIds).select('id')
    if (error) return { error: error.message }
    affected += data?.length ?? 0
  }

  revalidatePath('/dashboard/admin/stock-validation')
  revalidatePath('/dashboard/storekeeper/stock-in')
  return { success: true, affected }
}
