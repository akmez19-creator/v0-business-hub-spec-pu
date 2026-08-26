'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

/**
 * RESCHEDULING ONE ORDER.
 *
 * `delivery_date` is IMMUTABLE - it is the day the goods physically went out on
 * a van, and van stock, cash reconciliation and stock validation all key off
 * it. A reschedule therefore writes `rescheduled_to`, and the generated column
 * `active_date = coalesce(rescheduled_to, delivery_date)` is what every
 * forward-looking screen reads.
 *
 * Two hard rules learned the hard way:
 *
 * 1. NEVER TOUCH `status`. `incomingToStore()` only returns the CMS leg while
 *    status is EXACTLY 'cms', so flipping status here would make the original
 *    day's returns vanish from the storekeeper's screen.
 *
 * 2. NEVER TOUCH `delivery_notes`. It holds the rider's reason for the failed
 *    attempt, which is the whole audit trail. It is also what
 *    `trg_log_cms_event` watches: changing it on a cms row would make the
 *    trigger log a bogus 'reason_changed' event on top of ours.
 */

const REVIEWED_PREFIX = '[REVIEWED] '

function isIsoDate(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())
}

function today() {
  return new Date().toISOString().split('T')[0]
}

async function getActor() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated', role: null, userId: null }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  return { error: null, role: profile?.role ?? null, userId: user.id }
}

/**
 * Admin/manager reschedule - APPLIES IMMEDIATELY.
 *
 * `targetDate` is required and explicit. There is no "+1 day" default on
 * purpose: the next day may be a holiday or an off-day for that region, and
 * silently picking it would strand the order again.
 */
export async function rescheduleDelivery(
  deliveryId: string,
  targetDate: string,
  reason: string,
) {
  const { error: authError, role, userId } = await getActor()
  if (authError) return { error: authError }
  if (!role || !['admin', 'manager'].includes(role)) {
    return { error: 'Only an admin or manager can apply a reschedule' }
  }

  if (!isIsoDate(targetDate)) return { error: 'Pick a valid date' }
  if (!reason?.trim()) return { error: 'A reason is required' }

  const adminDb = createAdminClient()

  const { data: delivery, error: fetchError } = await adminDb
    .from('deliveries')
    .select('id, status, delivery_date, rescheduled_to, delivery_notes, rider_id, contractor_id, amount, customer_name')
    .eq('id', deliveryId)
    .single()

  if (fetchError || !delivery) return { error: 'Order not found' }

  // A delivered order has already happened - moving its date would rewrite
  // history and corrupt the day's cash and earnings figures.
  if (delivery.status === 'delivered') {
    return { error: 'This order is already delivered and cannot be rescheduled' }
  }

  if (targetDate === delivery.delivery_date && !delivery.rescheduled_to) {
    return { error: 'That is already the order\'s date' }
  }
  // Moving a re-attempt into the past cannot be acted on. The ORIGINAL
  // delivery_date is allowed to be in the past - that is history, not a target.
  if (targetDate < today()) {
    return { error: 'Pick today or a later date - a re-attempt cannot be in the past' }
  }

  const { error: updateError, data: updated } = await adminDb
    .from('deliveries')
    .update({
      rescheduled_to: targetDate,
      // A rider proposal is now settled, so clear it either way.
      reschedule_requested_to: null,
      reschedule_reason: reason.trim(),
      reschedule_by: userId,
      reschedule_at: new Date().toISOString(),
      // THE VALIDATION STAMP. Reaching this function IS the confirm step - it
      // is called from the validation queue, or by an admin who typed the date
      // himself. Either way a named person has now approved the day, so the
      // order stops showing as "awaiting validation".
      //
      // Why the stamp is needed at all: `active_date` is GENERATED as
      // `coalesce(rescheduled_to, delivery_date)`, so writing a date puts the
      // order into the flow the same instant. 28 of the 32 postponed orders got
      // in that way with no audit row at all, so the date alone can never tell
      // us whether anyone agreed to it. This column can.
      reschedule_validated_by: userId,
      reschedule_validated_at: new Date().toISOString(),
      // A previous rejection is now moot.
      reschedule_declined_at: null,
    })
    .eq('id', deliveryId)
    // `.select()` so a silently-zero-row update (RLS or a bad id) is caught
    // rather than reported as success - an update that matches no row returns
    // no error at all.
    .select('id, active_date')

  if (updateError) return { error: 'Could not reschedule: ' + updateError.message }
  if (!updated || updated.length === 0) {
    return { error: 'Nothing was saved - the order may have been changed by someone else' }
  }

  // `trg_log_cms_event` only fires on a status change or a note change, so a
  // pure reschedule logs NOTHING. Insert the history row ourselves. Wrapped so
  // history can never block the reschedule itself, matching the trigger's own
  // exception handling.
  if (delivery.status === 'cms') {
    await adminDb.from('cms_log').insert({
      delivery_id: deliveryId,
      event: 'rescheduled',
      old_status: delivery.status,
      new_status: delivery.status,
      reason_text: reason.trim(),
      is_postponed: true,
      postponed_to: targetDate,
      rider_id: delivery.rider_id,
      contractor_id: delivery.contractor_id,
      delivery_date: delivery.delivery_date,
      amount: delivery.amount,
      changed_by: userId,
      note: delivery.rescheduled_to
        ? `Moved from ${delivery.rescheduled_to} to ${targetDate}`
        : `Moved from ${delivery.delivery_date} to ${targetDate}`,
    })
  }

  // RECORD THE ATTEMPTS.
  // One `status` column cannot describe two days: after a reschedule it still
  // reads 'cms', which is the outcome of the attempt that FAILED, while the
  // order is live again for the new date. That single overloaded value is why
  // the CMS/returning figures kept reappearing on the new day.
  // `delivery_attempts` splits them - the failed attempt keeps its outcome, the
  // re-attempt starts with no outcome yet - and both carry the same Order ID.
  // `deliveries` deliberately stays ONE row: it is the unit of money and of the
  // client's order count, so a second row there would double the amount and the
  // rating, and trip the duplicate-order detector.
  try {
    // Close off the attempt that just failed, using the status stored BEFORE
    // this reschedule. `upsert` on (delivery_id, attempt_no) keeps this
    // idempotent when an order is moved more than once.
    await adminDb.from('delivery_attempts').upsert({
      delivery_id: deliveryId,
      attempt_no: 1,
      attempt_date: delivery.delivery_date,
      status: ['cms', 'nwd'].includes(delivery.status) ? delivery.status : 'not_attempted',
      rider_id: delivery.rider_id,
      notes: reason.trim(),
    }, { onConflict: 'delivery_id,attempt_no' })

    // The re-attempt. Its outcome is NOT known yet, so it must never inherit
    // the old 'cms' - it is assigned when a rider is already carrying the
    // goods, otherwise pending.
    const { data: prior } = await adminDb
      .from('delivery_attempts')
      .select('attempt_no')
      .eq('delivery_id', deliveryId)
      .order('attempt_no', { ascending: false })
      .limit(1)

    await adminDb.from('delivery_attempts').upsert({
      delivery_id: deliveryId,
      attempt_no: Math.max(2, (prior?.[0]?.attempt_no ?? 1) + 1),
      attempt_date: targetDate,
      status: delivery.rider_id ? 'assigned' : 'pending',
      rider_id: delivery.rider_id,
      notes: reason.trim(),
    }, { onConflict: 'delivery_id,attempt_no' })
  } catch {
    // Never let history block the reschedule itself - same rule the cms_log
    // insert above follows.
  }

  revalidatePath('/dashboard/admin/cms')
  revalidatePath('/dashboard/deliveries/all')
  revalidatePath('/dashboard/riders')
  revalidatePath('/dashboard/riders/stock')
  revalidatePath('/dashboard/storekeeper/stock-out')
  return { success: true, activeDate: updated[0]?.active_date ?? targetDate }
}

/**
 * Undo a reschedule - the order returns to its original `delivery_date`.
 *
 * Kept separate from `rescheduleDelivery` because clearing is not "moving to
 * the old date": it nulls `rescheduled_to` so `active_date` falls back to
 * `delivery_date`, leaving no stale target behind.
 */
export async function clearReschedule(deliveryId: string) {
  const { error: authError, role, userId } = await getActor()
  if (authError) return { error: authError }
  if (!role || !['admin', 'manager'].includes(role)) {
    return { error: 'Only an admin or manager can undo a reschedule' }
  }

  const adminDb = createAdminClient()
  const { error, data } = await adminDb
    .from('deliveries')
    .update({
      rescheduled_to: null,
      reschedule_requested_to: null,
      reschedule_reason: null,
      reschedule_by: userId,
      reschedule_at: new Date().toISOString(),
    })
    .eq('id', deliveryId)
    .select('id')

  if (error) return { error: 'Could not undo: ' + error.message }
  if (!data || data.length === 0) return { error: 'Nothing was changed' }

  revalidatePath('/dashboard/admin/cms')
  revalidatePath('/dashboard/deliveries/all')
  revalidatePath('/dashboard/riders')
  return { success: true }
}

/**
 * Rider PROPOSES a new day - `active_date` does NOT move.
 *
 * Deliberately writes `reschedule_requested_to`, not `rescheduled_to`: a rider
 * saying "try Thursday" must not silently re-plan the warehouse's load. An
 * admin confirms it via `confirmRequestedReschedule`.
 */
export async function requestReschedule(
  deliveryId: string,
  targetDate: string,
  reason: string,
) {
  const { error: authError, role, userId } = await getActor()
  if (authError) return { error: authError }
  if (!role) return { error: 'Not authorized' }

  if (!isIsoDate(targetDate)) return { error: 'Pick a valid date' }
  if (targetDate < today()) return { error: 'Pick today or a later date' }
  if (!reason?.trim()) return { error: 'A reason is required' }

  const adminDb = createAdminClient()

  // A rider may only propose for his OWN order. Checked explicitly because
  // this path uses the service role and therefore bypasses RLS.
  if (role === 'rider') {
    const supabase = await createClient()
    const { data: rider } = await supabase
      .from('riders')
      .select('id')
      .eq('profile_id', userId)
      .single()

    const { data: own } = await adminDb
      .from('deliveries')
      .select('id')
      .eq('id', deliveryId)
      .eq('rider_id', rider?.id ?? '')
      .maybeSingle()

    if (!own) return { error: 'That order is not on your round' }
  }

  const { error, data } = await adminDb
    .from('deliveries')
    .update({
      reschedule_requested_to: targetDate,
      reschedule_reason: reason.trim(),
      reschedule_by: userId,
      reschedule_at: new Date().toISOString(),
    })
    .eq('id', deliveryId)
    .select('id')

  if (error) return { error: 'Could not send the request: ' + error.message }
  if (!data || data.length === 0) return { error: 'Nothing was saved' }

  revalidatePath('/dashboard/admin/cms')
  revalidatePath('/dashboard/riders/deliveries')
  return { success: true }
}

/** Admin confirms a rider's proposal - only now does `active_date` move. */
export async function confirmRequestedReschedule(deliveryId: string, accept: boolean) {
  const { error: authError, role, userId } = await getActor()
  if (authError) return { error: authError }
  if (!role || !['admin', 'manager'].includes(role)) {
    return { error: 'Only an admin or manager can confirm a reschedule' }
  }

  const adminDb = createAdminClient()
  const { data: delivery } = await adminDb
    .from('deliveries')
    .select('id, reschedule_requested_to, reschedule_reason, status, delivery_date, rider_id, contractor_id, amount')
    .eq('id', deliveryId)
    .single()

  if (!delivery) return { error: 'Order not found' }
  if (!delivery.reschedule_requested_to) return { error: 'There is no pending request on this order' }

  if (!accept) {
    const { error } = await adminDb
      .from('deliveries')
      .update({ reschedule_requested_to: null })
      .eq('id', deliveryId)
    if (error) return { error: 'Could not decline: ' + error.message }
    revalidatePath('/dashboard/admin/cms')
    return { success: true, declined: true }
  }

  return rescheduleDelivery(
    deliveryId,
    delivery.reschedule_requested_to,
    delivery.reschedule_reason || 'Confirmed rider request',
  )
}

/**
 * THE VALIDATION STEP for the CMS queue: "postponed, then validated, then it
 * counts for the flow."
 *
 * Handles BOTH shapes a postponement can arrive in, because they both mean
 * "somebody wants this order moved and nobody has checked it":
 *
 *   - a rider PROPOSAL (`reschedule_requested_to`) - not yet live, and
 *   - a date already written to `rescheduled_to` with no validation stamp.
 *     32 orders are in this state today; 28 of them have no audit trail
 *     whatsoever, so nobody ever agreed to the day they are sitting on.
 *
 * `accept` routes to `rescheduleDelivery`, which is the single place that
 * writes a live date, logs to `cms_log` and stamps the validation - so the
 * queue cannot drift from the dialog. `overrideDate` lets the admin validate a
 * DIFFERENT day than the one asked for, which is the common case when the
 * requested day turns out to be a holiday.
 */
export async function validateReschedule(
  deliveryId: string,
  accept: boolean,
  overrideDate?: string,
) {
  const { error: authError, role, userId } = await getActor()
  if (authError) return { error: authError }
  if (!role || !['admin', 'manager'].includes(role)) {
    return { error: 'Only an admin or manager can validate a postponement' }
  }

  const adminDb = createAdminClient()
  const { data: delivery } = await adminDb
    .from('deliveries')
    .select('id, delivery_date, rescheduled_to, reschedule_requested_to, reschedule_reason, status, rider_id, contractor_id, amount')
    .eq('id', deliveryId)
    .single()

  if (!delivery) return { error: 'Order not found' }

  // The proposal wins when both exist: it is the newer intent.
  const proposed = delivery.reschedule_requested_to || delivery.rescheduled_to
  if (!proposed) return { error: 'There is no postponement on this order to validate' }

  if (!accept) {
    // DECLINED - the order falls back to its original day. `rescheduled_to` is
    // nulled rather than set to `delivery_date` so `active_date` resolves
    // through its COALESCE instead of carrying a stale target.
    //
    // `delivery_notes` and `status` are deliberately untouched: notes are the
    // rider's reason for the failed attempt and are watched by
    // `trg_log_cms_event`, and flipping status off 'cms' would make the
    // original day's returns vanish from the storekeeper's screen.
    const { error, data } = await adminDb
      .from('deliveries')
      .update({
        rescheduled_to: null,
        reschedule_requested_to: null,
        reschedule_validated_by: userId,
        reschedule_validated_at: null,
        reschedule_declined_at: new Date().toISOString(),
      })
      .eq('id', deliveryId)
      .select('id')

    if (error) return { error: 'Could not decline: ' + error.message }
    if (!data || data.length === 0) return { error: 'Nothing was changed' }

    if (delivery.status === 'cms') {
      await adminDb.from('cms_log').insert({
        delivery_id: deliveryId,
        event: 'reschedule_declined',
        old_status: delivery.status,
        new_status: delivery.status,
        reason_text: delivery.reschedule_reason || 'Postponement rejected',
        is_postponed: false,
        rider_id: delivery.rider_id,
        contractor_id: delivery.contractor_id,
        delivery_date: delivery.delivery_date,
        amount: delivery.amount,
        changed_by: userId,
        note: `Postponement to ${proposed} rejected - back on ${delivery.delivery_date}`,
      })
    }

    revalidatePath('/dashboard/admin/cms')
    revalidatePath('/dashboard/deliveries/all')
    revalidatePath('/dashboard/riders')
    return { success: true, declined: true }
  }

  const target = overrideDate || proposed
  return rescheduleDelivery(
    deliveryId,
    target,
    delivery.reschedule_reason?.trim() || 'Postponement validated',
  )
}

/** Exported for the dialog so the [REVIEWED] prefix is stripped in one place. */
export async function stripReviewedPrefix(note: string | null) {
  if (!note) return ''
  return note.startsWith(REVIEWED_PREFIX) ? note.slice(REVIEWED_PREFIX.length) : note
}
