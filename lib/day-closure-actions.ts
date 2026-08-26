'use server'

/**
 * Closing a whole delivery day and pushing its work to another day.
 *
 * The day the vans do not run (cyclone, heavy rain, a breakdown) is a real and
 * recurring event that previously had no single answer: every order had to be
 * re-dated by hand, and nothing recorded WHY the day moved. This does both in
 * one pass, and records the reason on each order so the history survives.
 */

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { nextWorkingDay, type Holiday } from '@/lib/orders/quick-order'
import {
  MOVABLE_STATUSES, CLOSURE_REASONS,
  type ClosurePreview, type CloseDayInput,
} from '@/lib/day-closure'
import { formatPostponeDate } from '@/lib/reschedule'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not signed in' as const, user: null, admin: null }

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles').select('role').eq('id', user.id).single()

  // Explicit role check against the service-role client, the same shape the
  // rest of the admin writes use. RLS grants rows, not columns, so a bulk
  // re-date has to be gated here rather than by widening a policy.
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Not allowed' as const, user: null, admin: null }
  }
  return { error: null, user, admin }
}

async function readHolidays(admin: ReturnType<typeof createAdminClient>): Promise<Holiday[]> {
  const { data } = await admin.from('extension_settings').select('holidays').eq('id', 1).single()
  return Array.isArray(data?.holidays) ? (data.holidays as Holiday[]) : []
}

/**
 * What WOULD happen, with nothing written.
 *
 * The confirm step has to state the real numbers - moving 33 orders onto a day
 * that already holds 95 is a 128-order day, and that is a decision the person
 * clicking needs to see before committing, not discover tomorrow morning.
 */
export async function previewDayClosure(date: string): Promise<ClosurePreview> {
  const empty = {
    movable: { pending: 0, assigned: 0, total: 0, units: 0 },
    staying: [], suggested: date, suggestedExisting: 0,
    stockWarning: null, alreadyClosed: false,
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'Bad date', ...empty }

  const { error, admin } = await requireAdmin()
  if (error || !admin) return { ok: false, error: error || 'Not allowed', ...empty }

  const holidays = await readHolidays(admin)
  const suggested = nextWorkingDay(date, holidays)

  // active_date: closing a day acts on the work SCHEDULED for that day, which
  // includes anything already rescheduled onto it and excludes anything moved
  // off it. For an order that was never rescheduled the two are identical.
  const [dayRows, targetCount, dailyStock, stockOut] = await Promise.all([
    admin.from('deliveries').select('status, qty').eq('active_date', date),
    admin.from('deliveries')
      .select('id', { count: 'exact', head: true })
      .eq('active_date', suggested)
      .in('status', MOVABLE_STATUSES as unknown as string[]),
    admin.from('contractor_daily_stock')
      .select('id', { count: 'exact', head: true }).eq('stock_date', date),
    admin.from('deliveries')
      .select('id', { count: 'exact', head: true })
      .eq('active_date', date).eq('stock_out', true),
  ])

  const rows = dayRows.data || []
  const movable = { pending: 0, assigned: 0, total: 0, units: 0 }
  const stayMap = new Map<string, number>()
  for (const r of rows) {
    const status = (r.status || 'unknown') as string
    if ((MOVABLE_STATUSES as readonly string[]).includes(status)) {
      if (status === 'pending') movable.pending++
      else movable.assigned++
      movable.total++
      movable.units += Number(r.qty) || 0
    } else {
      stayMap.set(status, (stayMap.get(status) || 0) + 1)
    }
  }

  // A van that has already been counted out is the one case where moving the
  // orders silently would be wrong: the load was validated against THIS date,
  // so the storekeeper's count would be left pointing at a day with no work.
  // Surfaced rather than blocked - the person closing the day knows whether
  // the van was actually loaded.
  const loaded = (stockOut.count || 0)
  const generated = (dailyStock.count || 0)
  const stockWarning = loaded > 0 || generated > 0
    ? `This day already has stock counted out (${loaded} order${loaded === 1 ? '' : 's'} ticked, ` +
      `${generated} daily-stock row${generated === 1 ? '' : 's'}). Those counts stay on ${date} ` +
      `and will need re-issuing on the new day.`
    : null

  return {
    ok: true,
    movable,
    staying: [...stayMap.entries()].map(([status, rows]) => ({ status, rows }))
      .sort((a, b) => b.rows - a.rows),
    suggested,
    suggestedExisting: targetCount.count || 0,
    stockWarning,
    alreadyClosed: holidays.some(h => h.start && date >= h.start && date <= (h.end || h.start)),
  }
}

/**
 * Moves the day's live orders and records why.
 *
 * The `cms_log` trigger only fires when a row enters, leaves, or changes reason
 * WHILE its status is 'cms'. A pending order changing date fires NOTHING, so a
 * bulk re-date would otherwise leave no trace at all - the audit rows here are
 * written explicitly, and cannot double up with the trigger because the status
 * is untouched by design.
 */
export async function closeDayAndReschedule(input: CloseDayInput) {
  const { date, targetDate, reasonCode, blockNewOrders } = input
  const note = (input.note || '').trim().slice(0, 200)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return { ok: false, error: 'Bad date' }
  }
  if (targetDate === date) return { ok: false, error: 'Pick a different day to move the work to' }
  if (targetDate < date) return { ok: false, error: 'Cannot move deliveries into the past' }

  const reason = CLOSURE_REASONS.find(r => r.code === reasonCode)
  if (!reason) return { ok: false, error: 'Pick a reason' }
  // "Other" with no explanation records nothing useful a month from now.
  if (reasonCode === 'other' && !note) return { ok: false, error: 'Describe the reason' }

  const { error: authError, user, admin } = await requireAdmin()
  if (authError || !admin || !user) return { ok: false, error: authError || 'Not allowed' }

  const label = note ? `${reason.label} - ${note}` : reason.label

  // Read the rows FIRST: after the update they no longer carry the old date,
  // so the audit trail could not be reconstructed.
  const { data: rows, error: readError } = await admin
    .from('deliveries')
    .select('id, status, rider_id, contractor_id, amount, delivery_notes, delivery_date')
    .eq('active_date', date)
    .in('status', MOVABLE_STATUSES as unknown as string[])

  if (readError) return { ok: false, error: readError.message }
  const ids = (rows || []).map(r => r.id)
  if (ids.length === 0) return { ok: false, error: `No pending or assigned orders on ${date}` }

  // The rider and status ride along unchanged - the same person keeps the job,
  // it just happens on a different day.
  const { data: moved, error: moveError } = await admin
    .from('deliveries')
    .update({
      // delivery_date is NOT touched. It is the day the goods physically went
      // out, and the day's stock counts, returns and cash records are all keyed
      // to it. The new day goes in rescheduled_to, which feeds the generated
      // active_date that every forward-looking screen reads.
      rescheduled_to: targetDate,
      reschedule_reason: `Day closed: ${label}`,
      reschedule_by: user.id,
      reschedule_at: new Date().toISOString(),
      // DD Mon YYYY, NOT ISO. cms_postponed_date() and the admin CMS page parse
      // the day back out of this text with a `DD Mon YYYY` pattern - verified
      // live, 'Postponed to 2026-08-26' parses to NULL while
      // 'Postponed to 26 Aug 2026' works, and all 31 pre-existing rows use the
      // long form.
      delivery_notes: `Postponed to ${formatPostponeDate(targetDate)} - day closed: ${label}`,
    })
    .in('id', ids)
    .select('id')

  if (moveError) return { ok: false, error: moveError.message }

  // An update that matches no row SUCCEEDS silently in PostgREST. Compare the
  // returned rows against what was asked for rather than trusting the absence
  // of an error.
  const movedCount = (moved || []).length
  if (movedCount === 0) {
    return { ok: false, error: 'Nothing was saved - your session may have expired. Sign in and try again.' }
  }

  await admin.from('cms_log').insert(
    (rows || []).filter(r => (moved || []).some(m => m.id === r.id)).map(r => ({
      delivery_id: r.id,
      event: 'day_closed',
      old_status: r.status,
      new_status: r.status,
      reason_text: `Day closed (${date}): ${label}`,
      reason_code: reasonCode,
      is_postponed: true,
      postponed_to: targetDate,
      rider_id: r.rider_id,
      contractor_id: r.contractor_id,
      // The log keeps the ORIGINAL van-day so the history stays readable.
      delivery_date: r.delivery_date,
      amount: r.amount,
      changed_by: user.id,
      note: label,
    })),
  )

  // Stops an agent booking a fresh order onto a day nobody is driving. Written
  // into the SAME list the extension, quick-order and the AI reply already
  // read, so one entry closes the day everywhere instead of only here.
  let closureAdded = false
  if (blockNewOrders) {
    const holidays = await readHolidays(admin)
    if (!holidays.some(h => h.start === date && (h.end || h.start) === date)) {
      const { error: closeError } = await admin.from('extension_settings').update({
        holidays: [...holidays, {
          id: `closed-${date}`,
          start: date,
          end: date,
          label: label.slice(0, 80),
          // 'adhoc' is the existing type for an instant closure, as opposed to
          // a fixed or moon-based public holiday.
          type: 'adhoc',
        }],
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      }).eq('id', 1)
      closureAdded = !closeError
    } else {
      closureAdded = true
    }
  }

  revalidatePath('/dashboard/deliveries/all')
  revalidatePath('/dashboard/deliveries')
  revalidatePath('/dashboard')

  return { ok: true, moved: movedCount, targetDate, closureAdded, label }
}
