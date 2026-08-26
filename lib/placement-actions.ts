"use server"

import { createClient } from "@/lib/supabase/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { revalidatePath } from "next/cache"
import {
  buildEffectiveMap,
  diffRows,
  normLocality,
  summarise,
  type CoordRow,
  type CoordSource,
  type EffectiveEntry,
} from "@/lib/placement/effective"

const OPEN_STATUSES = ["pending", "assigned"] as const

/** Service-role client. Used ONLY for the restamp, which needs to write rows
 *  the caller's RLS policy does not cover. Paired with an explicit role check
 *  and a one-field whitelist every time - RLS grants rows, not columns. */
function adminDb() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Service role not configured")
  return createAdminClient(url, key, { auth: { persistSession: false } })
}

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: "Not signed in" as const }

  // `name`, not `full_name` - profiles has no full_name column.
  const { data: profile } = await supabase.from("profiles").select("id, role, name").eq("id", user.id).single()

  if (!profile || !["admin", "manager"].includes(profile.role)) {
    return { error: "Not authorized" as const }
  }
  return { supabase, profile }
}

export type PlacementDay = {
  date: string
  status: "draft" | "validated" | "untouched"
  changedCount: number
  copiedFrom: string | null
  validatedAt: string | null
  orders: number
}

/** Everything the placement screen needs for one day. */
export async function getDayPlacement(date: string) {
  const gate = await requireAdmin()
  if ("error" in gate) return { error: gate.error }
  const { supabase } = gate

  const [locRes, riderRes, coordRes, planRes, orderRes] = await Promise.all([
      supabase
        .from("localities")
        // `district`, NOT `region` - localities has no region column, and
        // selecting it 400s the whole query (which is why the map drew nothing).
        // `contractor_id` is REQUIRED here: only 31 of 493 localities have a
        // default_rider_id, so reading that column alone made the screen claim
        // 462 localities had nobody - while Regions showed a rider for each.
        .select("name, district, default_rider_id, contractor_id")
        .eq("is_active", true)
        .order("name"),
      supabase.from("riders").select("id, name, phone, daily_target, contractor_id").eq("is_active", true).order("name"),
      supabase.from("locality_coordinates").select("locality, lat, lng, source"),
      supabase.from("day_placements").select("*").eq("place_date", date).maybeSingle(),
      // Orders live on this day. active_date is GENERATED from rescheduled_to,
      // so it - not delivery_date - is what puts an order in the day's flow.
      supabase.from("deliveries").select("locality, rider_id, status").eq("active_date", date).in("status", OPEN_STATUSES),
    ])

  // A failed select returns data:null, and `?? []` turns that into a confident
  // "0 localities, 0 of 0 on map" - a screen asserting an empty island rather
  // than admitting it could not read. Surface the failure instead: a wrong
  // column name (this happened with `region`) must never render as a fact.
  const failed = [locRes, riderRes, coordRes, planRes, orderRes].find((r) => r.error)
  if (failed?.error) return { error: `Could not load the day: ${failed.error.message}` }

  const localities = locRes.data
  const riders = riderRes.data
  const coords = coordRes.data
  const plan = planRes.data
  const dayOrders = orderRes.data

  let exceptions = new Map<string, string>()
  if (plan?.id) {
    const { data: entries } = await supabase
      .from("day_placement_entries")
      .select("locality, rider_id")
      .eq("day_placement_id", plan.id)
    exceptions = new Map((entries ?? []).map((e) => [e.locality, e.rider_id]))
  }

  const orderCounts = new Map<string, number>()
  // Each order's CURRENT rider, so the confirmation can count what validation
  // would really rewrite rather than assuming only hand-moved localities change.
  const orderRiders = new Map<string, (string | null)[]>()
  for (const d of dayOrders ?? []) {
    if (!d.locality) continue
    const k = normLocality(d.locality)
    orderCounts.set(k, (orderCounts.get(k) ?? 0) + 1)
    const list = orderRiders.get(k)
    if (list) list.push(d.rider_id ?? null)
    else orderRiders.set(k, [d.rider_id ?? null])
  }

  const coordMap = new Map<string, CoordRow>(
    (coords ?? []).map((c) => [c.locality, c as CoordRow]),
  )

  // Active riders grouped by contractor. `riders` is already filtered to
  // is_active, so a contractor whose only rider left counts as zero and stays
  // an honest gap rather than resolving to someone inactive.
  const contractorRiders = new Map<string, string[]>()
  for (const r of riders ?? []) {
    if (!r.contractor_id) continue
    const list = contractorRiders.get(r.contractor_id)
    if (list) list.push(r.id)
    else contractorRiders.set(r.contractor_id, [r.id])
  }

  const entries = buildEffectiveMap({
    localities: localities ?? [],
    exceptions,
    coords: coordMap,
    orderCounts,
    orderRiders,
    contractorRiders,
  })

  return {
    date,
    status: (plan?.status ?? "untouched") as "draft" | "validated" | "untouched",
    validatedAt: plan?.validated_at ?? null,
    copiedFrom: plan?.copied_from ?? null,
    entries,
    riders: riders ?? [],
    summary: summarise(entries),
    diff: diffRows(entries),
    /** Orders on the day that already carry a rider, and could be restamped. */
    stampedOrders: (dayOrders ?? []).filter((d) => d.rider_id).length,
    totalOrders: (dayOrders ?? []).length,
  }
}

/** Save this day's exceptions as a DRAFT. A draft is inert: it routes nothing
 *  and stamps nothing until someone validates it. */
export async function saveDayDraft(
  date: string,
  exceptions: { locality: string; riderId: string }[],
  copiedFrom?: string | null,
) {
  const gate = await requireAdmin()
  if ("error" in gate) return { error: gate.error }
  const { supabase, profile } = gate

  const { data: existing } = await supabase.from("day_placements").select("id, status").eq("place_date", date).maybeSingle()

  if (existing?.status === "validated") {
    return { error: "This day is already validated. Re-open it before editing." }
  }

  let planId = existing?.id
  if (!planId) {
    const { data: created, error } = await supabase
      .from("day_placements")
      .insert({ place_date: date, status: "draft", created_by: profile.id, copied_from: copiedFrom ?? null })
      .select("id")
      .single()
    if (error) return { error: error.message }
    planId = created.id
  } else if (copiedFrom !== undefined) {
    await supabase.from("day_placements").update({ copied_from: copiedFrom }).eq("id", planId)
  }

  // Replace the exception set wholesale: the client sends the full intended set
  // and a removed exception must actually disappear.
  const { error: delErr } = await supabase.from("day_placement_entries").delete().eq("day_placement_id", planId)
  if (delErr) return { error: delErr.message }

  if (exceptions.length) {
    const { error: insErr } = await supabase.from("day_placement_entries").insert(
      exceptions.map((e) => ({
        day_placement_id: planId,
        locality: normLocality(e.locality),
        rider_id: e.riderId,
      })),
    )
    if (insErr) return { error: insErr.message }
  }

  revalidatePath("/dashboard/admin/placement")
  return { ok: true, planId, saved: exceptions.length }
}

export type RestampMove = {
  locality: string
  fromRiderId: string | null
  toRiderId: string
  orders: number
}

/**
 * Validate the day, then re-point that day's orders.
 *
 * This is the whole point of a day plan: an order taken 18 days ago carries
 * whoever the standing map named back then, and nothing re-checks it. On
 * validation we freeze the effective map and restamp the day's open orders.
 */
export async function validateDayPlacement(date: string) {
  const gate = await requireAdmin()
  if ("error" in gate) return { error: gate.error }
  const { supabase, profile } = gate

  const loaded = await getDayPlacement(date)
  if ("error" in loaded) return { error: loaded.error }

  const { data: plan } = await supabase.from("day_placements").select("id, status").eq("place_date", date).maybeSingle()
  if (!plan) return { error: "Nothing to validate for this day yet." }
  if (plan.status === "validated") return { error: "This day is already validated." }

  const effective = new Map<string, string | null>(loaded.entries.map((e: EffectiveEntry) => [e.locality, e.riderId]))

  // Freeze the full map. Exceptions alone would silently drift if the standing
  // plan changed later, and a validated day has to stay auditable.
  const snapshot: Record<string, string | null> = {}
  for (const [k, v] of effective) if (v) snapshot[k] = v

  const db = adminDb()

  // Only ever open orders on this day. Never delivered/cms rows, and never
  // delivery_date - that is the day goods physically went out and is immutable.
  const { data: orders, error: ordErr } = await db
    .from("deliveries")
    .select("id, locality, rider_id")
    .eq("active_date", date)
    .in("status", OPEN_STATUSES)
  if (ordErr) return { error: ordErr.message }

  // Group the orders that need to move by their target rider, so each rider is
  // one guarded update instead of one per order.
  const byTarget = new Map<string, string[]>()
  const moves = new Map<string, RestampMove>()

  for (const o of orders ?? []) {
    if (!o.locality) continue
    const key = normLocality(o.locality)
    const target = effective.get(key) ?? null
    if (!target || target === o.rider_id) continue

    const list = byTarget.get(target) ?? []
    list.push(o.id)
    byTarget.set(target, list)

    const mk = `${key}->${target}`
    const m = moves.get(mk) ?? { locality: key, fromRiderId: o.rider_id ?? null, toRiderId: target, orders: 0 }
    m.orders++
    moves.set(mk, m)
  }

  let restamped = 0
  for (const [riderId, ids] of byTarget) {
    // GUARDED WRITE. An update matching no row SUCCEEDS silently - a 204 with
    // error === null can write nothing at all. `error === null` is not "it
    // saved", so count the returned rows and fail loudly if they are short.
    // Whitelist: rider_id only.
    const { data: written, error } = await db
      .from("deliveries")
      .update({ rider_id: riderId })
      .in("id", ids)
      .select("id")

    if (error) return { error: `Restamp failed: ${error.message}` }
    if (!written || written.length < ids.length) {
      return {
        error: `Restamp wrote ${written?.length ?? 0} of ${ids.length} orders. Nothing has been validated - try again.`,
      }
    }
    restamped += written.length
  }

  const { error: valErr } = await supabase
    .from("day_placements")
    .update({
      status: "validated",
      validated_by: profile.id,
      validated_at: new Date().toISOString(),
      effective_map: snapshot,
    })
    .eq("id", plan.id)
  if (valErr) return { error: valErr.message }

  revalidatePath("/dashboard/admin/placement")
  revalidatePath("/dashboard/admin/regions")

  return {
    ok: true,
    restamped,
    moves: [...moves.values()].sort((a, b) => b.orders - a.orders),
    ridersAffected: byTarget.size,
    localitiesChanged: loaded.summary.changed,
  }
}

/** Re-open a validated day so it can be edited again. Does NOT un-restamp:
 *  those orders already moved, and silently reverting them would be a second
 *  invisible change. */
export async function reopenDayPlacement(date: string) {
  const gate = await requireAdmin()
  if ("error" in gate) return { error: gate.error }
  const { supabase } = gate

  const { error } = await supabase
    .from("day_placements")
    .update({ status: "draft", validated_at: null, validated_by: null, effective_map: null })
    .eq("place_date", date)
  if (error) return { error: error.message }

  revalidatePath("/dashboard/admin/placement")
  return { ok: true }
}

export type PastDay = {
  date: string
  riders: number
  localities: number
  deliveries: number
}

/**
 * Real past working days, each with its TRUE size.
 *
 * Deliberately not a weekday average: there are only a handful of working days
 * on record and one of them has 5 deliveries. Showing the size next to the date
 * is what stops a thin day being copied as if it were a full template.
 */
export async function getPastWorkingDays(limit = 20): Promise<PastDay[]> {
  const gate = await requireAdmin()
  if ("error" in gate) return []
  const { supabase } = gate

  const { data } = await supabase
    .from("deliveries")
    .select("delivery_date, rider_id, locality")
    .not("rider_id", "is", null)
    .not("delivery_date", "is", null)
    .order("delivery_date", { ascending: false })
    .limit(6000)

  const byDate = new Map<string, { riders: Set<string>; locs: Set<string>; n: number }>()
  for (const d of data ?? []) {
    const k = d.delivery_date as string
    let e = byDate.get(k)
    if (!e) {
      e = { riders: new Set(), locs: new Set(), n: 0 }
      byDate.set(k, e)
    }
    e.riders.add(d.rider_id as string)
    if (d.locality) e.locs.add(normLocality(d.locality))
    e.n++
  }

  return [...byDate.entries()]
    .map(([date, e]) => ({ date, riders: e.riders.size, localities: e.locs.size, deliveries: e.n }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
}

/** Load a past date's actual rider-per-locality allocation as draft exceptions. */
export async function getPastDayAllocation(date: string) {
  const gate = await requireAdmin()
  if ("error" in gate) return { error: gate.error }
  const { supabase } = gate

  const { data } = await supabase
    .from("deliveries")
    .select("locality, rider_id")
    .eq("delivery_date", date)
    .not("rider_id", "is", null)

  // A locality can appear several times on one day; the rider who took the most
  // of its orders is the one that day actually belonged to.
  const tally = new Map<string, Map<string, number>>()
  for (const d of data ?? []) {
    if (!d.locality) continue
    const k = normLocality(d.locality)
    const m = tally.get(k) ?? new Map<string, number>()
    m.set(d.rider_id as string, (m.get(d.rider_id as string) ?? 0) + 1)
    tally.set(k, m)
  }

  const allocation: { locality: string; riderId: string }[] = []
  for (const [loc, riders] of tally) {
    const best = [...riders.entries()].sort((a, b) => b[1] - a[1])[0]
    if (best) allocation.push({ locality: loc, riderId: best[0] })
  }
  return { allocation }
}

/** Days that already have a plan, for the day strip. */
export async function getPlacementDays(from: string, to: string) {
  const gate = await requireAdmin()
  if ("error" in gate) return []
  const { supabase } = gate

  const { data: plans } = await supabase
    .from("day_placements")
    .select("place_date, status, copied_from, validated_at, id")
    .gte("place_date", from)
    .lte("place_date", to)

  const ids = (plans ?? []).map((p) => p.id)
  const counts = new Map<string, number>()
  if (ids.length) {
    const { data: entries } = await supabase.from("day_placement_entries").select("day_placement_id").in("day_placement_id", ids)
    for (const e of entries ?? []) {
      counts.set(e.day_placement_id, (counts.get(e.day_placement_id) ?? 0) + 1)
    }
  }

  const { data: orders } = await supabase
    .from("deliveries")
    .select("active_date")
    .gte("active_date", from)
    .lte("active_date", to)
    .in("status", OPEN_STATUSES)

  const orderCounts = new Map<string, number>()
  for (const o of orders ?? []) {
    if (!o.active_date) continue
    orderCounts.set(o.active_date, (orderCounts.get(o.active_date) ?? 0) + 1)
  }

  return (plans ?? []).map((p) => ({
    date: p.place_date,
    status: p.status as "draft" | "validated",
    changedCount: counts.get(p.id) ?? 0,
    copiedFrom: p.copied_from,
    validatedAt: p.validated_at,
    orders: orderCounts.get(p.place_date) ?? 0,
  }))
}

/** Move a pin. Writes source='manual' - a corrected position is observed,
 *  not a guess, and must stop rendering as one. */
export async function setLocalityCoordinate(locality: string, lat: number, lng: number) {
  const gate = await requireAdmin()
  if ("error" in gate) return { error: gate.error }
  const { supabase } = gate

  // Reject out-of-bounds outright. A bad drag must not become a stored fact.
  if (lat < -20.6 || lat > -19.9 || lng < 57.2 || lng > 57.9) {
    return { error: "That position is outside Mauritius." }
  }

  const { error } = await supabase.from("locality_coordinates").upsert(
    { locality: normLocality(locality), lat, lng, source: "manual" as CoordSource, updated_at: new Date().toISOString() },
    { onConflict: "locality" },
  )
  if (error) return { error: error.message }

  revalidatePath("/dashboard/admin/placement")
  return { ok: true }
}
