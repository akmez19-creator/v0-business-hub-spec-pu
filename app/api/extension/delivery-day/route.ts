import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import {
  activePinnedDeliveryDate,
  computeDefaultDeliveryDate,
  upcomingDeliveryDates,
  type Holiday,
} from '@/lib/orders/quick-order'
import { mauritiusNow } from '@/lib/business-date'

export const runtime = 'nodejs'

/**
 * The general delivery date the AI draft and Quick Order offer first.
 *
 * GET explains the rule currently in force (cut-off, weekday scheme, closures -
 * all still edited in the Chrome extension) and the dates it yields today, plus
 * the optional admin pin. PUT sets or clears the pin
 * (extension_settings.pinned_delivery_date). A pin in the past is reported as
 * expired and ignored by every reader.
 */
const ALLOWED = ['admin', 'manager']

async function requireEditor() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not signed in', status: 401 as const }
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !ALLOWED.includes(profile.role)) return { error: 'Not allowed', status: 403 as const }
  return { supabase, user }
}

async function describe(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await supabase
    .from('extension_settings')
    .select('cutoff_time, delivery_day_scheme, holidays, pinned_delivery_date')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new Error(error.message)
  // The cut-off and the weekday scheme are Mauritius times, not UTC.
  const now = mauritiusNow()
  const cutoff = data?.cutoff_time || '20:00'
  const scheme = (data?.delivery_day_scheme as Record<string, string>) || {}
  const holidays: Holiday[] = Array.isArray(data?.holidays) ? data.holidays : []
  // The `date` column comes back as an ISO timestamp through PostgREST; keep the day.
  const pinned = typeof data?.pinned_delivery_date === 'string' ? data.pinned_delivery_date.slice(0, 10) : null
  const activePin = activePinnedDeliveryDate(pinned, now, holidays)
  const rule = computeDefaultDeliveryDate(now, cutoff, scheme, holidays)
  return {
    success: true,
    pinned,
    pinExpired: !!pinned && !activePin,
    ruleDate: rule.date,
    ruleReason: rule.fromScheme ? 'weekday scheme' : rule.afterCutoff ? `after ${cutoff} cut-off` : `before ${cutoff} cut-off`,
    cutoff,
    scheme,
    dates: upcomingDeliveryDates(now, cutoff, scheme, holidays, 4, pinned),
  }
}

export async function GET() {
  const auth = await requireEditor()
  if ('error' in auth) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  try {
    return NextResponse.json(await describe(auth.supabase))
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireEditor()
  if ('error' in auth) return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => ({}))
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: auth.user.id }

  if ('pinnedDeliveryDate' in body) {
    const raw = body.pinnedDeliveryDate
    const pinned = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null
    if (raw && !pinned) {
      return NextResponse.json({ success: false, error: 'Date must be YYYY-MM-DD.' }, { status: 400 })
    }
    if (pinned) {
      const { data: row } = await auth.supabase.from('extension_settings').select('holidays').eq('id', 1).single()
      const holidays: Array<{ start: string; end: string; label?: string }> = Array.isArray(row?.holidays) ? row.holidays : []
      if (!activePinnedDeliveryDate(pinned, mauritiusNow())) {
        return NextResponse.json({ success: false, error: 'The delivery date cannot be in the past.' }, { status: 400 })
      }
      if (!activePinnedDeliveryDate(pinned, mauritiusNow(), holidays)) {
        const hit = holidays.find(h => pinned >= h.start && pinned <= (h.end || h.start))
        const why = hit?.label ? `a holiday (${hit.label})` : 'a Sunday'
        return NextResponse.json({ success: false, error: `${pinned} is ${why} - no deliveries that day.` }, { status: 400 })
      }
    }
    patch.pinned_delivery_date = pinned
  }

  // Same column the Chrome extension writes (cutoff_time, "HH:MM"), so both
  // places always agree on when an order slips to the following day.
  if ('cutoffTime' in body) {
    const raw = body.cutoffTime
    if (typeof raw !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
      return NextResponse.json({ success: false, error: 'Closing time must be HH:MM (24h).' }, { status: 400 })
    }
    patch.cutoff_time = raw
  }

  if (Object.keys(patch).length === 2) {
    return NextResponse.json({ success: false, error: 'Nothing to change.' }, { status: 400 })
  }

  const { data, error } = await auth.supabase
    .from('extension_settings')
    .update(patch)
    .eq('id', 1)
    .select('id')
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  if (!data?.length) return NextResponse.json({ success: false, error: 'Settings row not found.' }, { status: 500 })

  try {
    return NextResponse.json(await describe(auth.supabase))
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 })
  }
}
