// The single source of truth for "who is on this locality on this day".
// Everything (map, rider rail, validation diff, restamp) reads through here so
// the screen and the write can never disagree.

export type CoordSource = "gps" | "override" | "geocoded" | "manual"

/** A position is only trustworthy if we OBSERVED it. 'geocoded' is a guess. */
export function isObserved(source: CoordSource): boolean {
  return source !== "geocoded"
}

export type LocalityRow = {
  name: string
  // `district` is the only geographic column localities actually has - there
  // is no `region`, and typing one invites selecting it.
  district: string | null
  /** An EXPLICIT standing rider. Only 31 of 493 rows have one. */
  default_rider_id: string | null
  /**
   * The real standing plan for the other 462. Every active locality has a
   * contractor, and 8 of the 10 contractors that hold localities have exactly
   * ONE active rider - so the locality's rider is already determined, just
   * indirectly. This is what the Regions page shows as the zone's rider.
   */
  contractor_id: string | null
}

/** Where a locality's standing rider came from. Kept distinct because a rider
 *  DERIVED from the contractor must never be presented as an explicit choice. */
export type StandingSource = "explicit" | "contractor" | "ambiguous" | "none"

export type CoordRow = { locality: string; lat: number; lng: number; source: CoordSource }

/** Localities keys are compared lowercased+trimmed everywhere. 127 open rows
 *  store the phone with spaces; locality names have the same whitespace habit. */
export const normLocality = (s: string) => s.trim().toLowerCase()

export type EffectiveEntry = {
  locality: string
  /** Display name as stored on `localities`. */
  name: string
  district: string | null
  /** Who is on it for this day, after exceptions are applied. */
  riderId: string | null
  /** Who the STANDING plan says. Kept so the UI can show what moved. */
  standingRiderId: string | null
  /** How `standingRiderId` was arrived at, so the UI can be honest about it. */
  standingSource: StandingSource
  /**
   * When the contractor has SEVERAL active riders we cannot tell which one
   * covers this locality, so this stays > 1 and the locality needs a real
   * choice. Guessing (e.g. the rider whose name matches the contractor) would
   * put a delivery on someone with no evidence they run it.
   */
  riderChoices: number
  /** True when this day deliberately differs from the standing plan. */
  changed: boolean
  lat: number | null
  lng: number | null
  source: CoordSource | null
  /**
   * True when the geocoder gave this locality a point it had already used for
   * another one (it fell back to a district centroid). The pin is nudged onto a
   * small ring so it stays clickable, so lat/lng above are NOT the stored
   * value - `stacked` is what stops that nudge reading as a real position.
   */
  stacked: boolean
  /** Open orders on this locality for the day being planned. */
  orderCount: number
  /**
   * Of those orders, how many currently point at someone OTHER than the
   * effective rider - i.e. how many validation would actually rewrite. This is
   * the honest number for the confirmation, because an order can be stale
   * without its locality having been touched today.
   */
  ordersToRestamp: number
  /**
   * The current rider on each open order here. Carried so an UNSAVED move can
   * recompute `ordersToRestamp` client-side - otherwise the confirmation keeps
   * quoting the server's figure and shows 0 orders affected while the user is
   * looking at a locality they just moved.
   */
  orderRiderIds: (string | null)[]
}

/** Orders here that a given rider would rewrite. One definition, used by the
 *  server build and by the client's unsaved-edit path, so they cannot drift. */
export function countToRestamp(orderRiderIds: (string | null)[], riderId: string | null): number {
  if (!riderId) return 0
  return orderRiderIds.filter((r) => r !== riderId).length
}

/**
 * Standing plan + this day's exceptions -> the effective map.
 *
 * `exceptions` holds ONLY what differs, so a day that changes nothing produces
 * no rows at all. That is deliberate: the validation diff IS the exception
 * list, never something inferred from text or from absence. Matching on text
 * is exactly why the CMS postponements were invisible for so long.
 */
export function buildEffectiveMap(args: {
  localities: LocalityRow[]
  exceptions: Map<string, string>
  coords: Map<string, CoordRow>
  orderCounts: Map<string, number>
  /**
   * Current rider on each open order for the day, keyed by locality. Needed
   * because the restamp compares every order's rider against the effective map
   * - not just the localities that were moved by hand. Counting only the moved
   * ones would let validation understate what it is about to change.
   */
  orderRiders?: Map<string, (string | null)[]>
  /**
   * Active riders per contractor. A contractor with exactly one is a resolved
   * standing assignment; with several it is a genuine unknown. Without this the
   * screen called 462 of 493 localities "nobody assigned" while the Regions
   * page displayed a rider for every one of them.
   */
  contractorRiders?: Map<string, string[]>
}): EffectiveEntry[] {
  const { localities, exceptions, coords, orderCounts, orderRiders, contractorRiders } = args

  // How many localities share each exact point. The geocoder falls back to a
  // district centroid when it cannot find a village, so 121 of 418 pins land on
  // just 19 points - drawn as-is, only the last one of each stack is clickable
  // and a lasso over it silently grabs 25 localities the user never saw.
  const atPoint = new Map<string, string[]>()
  for (const l of localities) {
    const c = coords.get(normLocality(l.name))
    if (!c) continue
    const pt = `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`
    const list = atPoint.get(pt)
    if (list) list.push(normLocality(l.name))
    else atPoint.set(pt, [normLocality(l.name)])
  }
  // Sort each stack so the nudge is stable across reloads - a pin that moves
  // every refresh is worse than one that overlaps.
  for (const list of atPoint.values()) list.sort()

  return localities.map((l) => {
    const key = normLocality(l.name)

    // Resolve the standing plan: an explicit rider wins, otherwise fall through
    // to the contractor's rider when there is exactly one. Only a contractor
    // with several active riders is a real unknown - and it stays unknown
    // rather than being guessed, because Divesh's 31 localities show the owner
    // settles that case by setting default_rider_id by hand.
    const crew = l.contractor_id ? (contractorRiders?.get(l.contractor_id) ?? []) : []
    let standing: string | null = null
    let standingSource: StandingSource = "none"
    let riderChoices = 0
    if (l.default_rider_id) {
      standing = l.default_rider_id
      standingSource = "explicit"
    } else if (crew.length === 1) {
      standing = crew[0]
      standingSource = "contractor"
    } else if (crew.length > 1) {
      standingSource = "ambiguous"
      riderChoices = crew.length
    }

    const override = exceptions.get(key)
    const c = coords.get(key)

    // Nudge members of a stack onto a small ring (~400m) so each is separately
    // clickable. Never applied to a lone pin: an observed position must keep
    // its exact coordinates.
    let lat = c?.lat ?? null
    let lng = c?.lng ?? null
    let stacked = false
    if (c) {
      const pt = `${c.lat.toFixed(5)},${c.lng.toFixed(5)}`
      const group = atPoint.get(pt)
      if (group && group.length > 1) {
        stacked = true
        const i = group.indexOf(key)
        const angle = (2 * Math.PI * i) / group.length
        // Radius grows with stack size so a 25-deep stack does not overlap.
        const r = 0.0035 + 0.0012 * Math.floor(i / 8)
        lat = c.lat + r * Math.sin(angle)
        lng = c.lng + r * Math.cos(angle)
      }
    }

    return {
      locality: key,
      name: l.name,
      district: l.district,
      riderId: override ?? standing,
      standingRiderId: standing,
      standingSource,
      riderChoices,
      // An exception that names the same rider as the standing plan is NOT a
      // change - it would otherwise inflate the diff with no-ops.
      changed: override != null && override !== standing,
      lat,
      lng,
      source: c?.source ?? null,
      stacked,
      orderCount: orderCounts.get(key) ?? 0,
      // Mirrors the restamp's own test exactly: a null target never rewrites an
      // order (we do not strip a rider off an order to assign nobody).
      ordersToRestamp: countToRestamp(orderRiders?.get(key) ?? [], override ?? standing),
      orderRiderIds: orderRiders?.get(key) ?? [],
    }
  })
}

export type PlacementSummary = {
  total: number
  /** Localities with someone on them for this day. */
  assigned: number
  /** No rider at all for this day. */
  unassigned: number
  /** Deliberately moved off the standing plan. */
  changed: number
  /** Cannot be drawn: no coordinates at all. */
  notOnMap: number
  /** Position is a geocoded guess, not observed. */
  estimated: number
  /**
   * Localities the geocoder dropped onto a point it already used (it fell back
   * to a district centroid). 121 of 418 sit in 19 such stacks, so without this
   * a third of the map is buried under whichever pin drew last.
   */
  stacked: number
  /** Open orders across the whole day. */
  orders: number
  /**
   * The only gap that actually costs money: a locality with orders on this day
   * and nobody on it. "493/493 assigned" hides this completely, because it
   * counts localities rather than work.
   */
  unassignedWithOrders: number
  ordersUnassigned: number
  /**
   * Of the unassigned, how many are unassigned because their contractor has
   * SEVERAL riders and nobody has said which. These are the only ones that
   * genuinely need a human decision - separating them stops a screen from
   * demanding 462 choices when 451 are already determined.
   */
  ambiguous: number
  /** Localities with a rider inherited from the contractor rather than set. */
  viaContractor: number
  /**
   * Orders validation will actually rewrite. Counted from every order on the
   * day, not from the moved localities, so it can never promise less than the
   * restamp does.
   */
  ordersToRestamp: number
}

export function summarise(entries: EffectiveEntry[]): PlacementSummary {
  let assigned = 0
  let changed = 0
  let notOnMap = 0
  let estimated = 0
  let stacked = 0
  let orders = 0
  let unassignedWithOrders = 0
  let ordersUnassigned = 0
  let ordersToRestamp = 0
  let ambiguous = 0
  let viaContractor = 0

  for (const e of entries) {
    if (e.riderId) assigned++
    if (!e.riderId && e.standingSource === "ambiguous") ambiguous++
    if (e.standingSource === "contractor") viaContractor++
    if (e.changed) changed++
    if (e.lat == null) notOnMap++
    else if (e.source === "geocoded") estimated++
    if (e.stacked) stacked++
    orders += e.orderCount
    ordersToRestamp += e.ordersToRestamp
    if (!e.riderId && e.orderCount > 0) {
      unassignedWithOrders++
      ordersUnassigned += e.orderCount
    }
  }

  return {
    total: entries.length,
    assigned,
    unassigned: entries.length - assigned,
    changed,
    notOnMap,
    estimated,
    stacked,
    orders,
    unassignedWithOrders,
    ordersUnassigned,
    ambiguous,
    viaContractor,
    ordersToRestamp,
  }
}

export type RiderLoad = {
  riderId: string
  localities: number
  orders: number
  /** How many of this rider's localities were moved onto them for this day. */
  gained: number
  /** How many were moved off them for this day. */
  lost: number
}

/** Per-rider load for the day, including what this day moved on and off them. */
export function riderLoads(entries: EffectiveEntry[]): Map<string, RiderLoad> {
  const out = new Map<string, RiderLoad>()
  const get = (id: string) => {
    let r = out.get(id)
    if (!r) {
      r = { riderId: id, localities: 0, orders: 0, gained: 0, lost: 0 }
      out.set(id, r)
    }
    return r
  }

  for (const e of entries) {
    if (e.riderId) {
      const r = get(e.riderId)
      r.localities++
      r.orders += e.orderCount
      if (e.changed) r.gained++
    }
    // A locality moved AWAY still has to show up against the rider who lost it,
    // otherwise a rider emptied out by this day looks untouched.
    if (e.changed && e.standingRiderId && e.standingRiderId !== e.riderId) {
      get(e.standingRiderId).lost++
    }
  }
  return out
}

/** One line per locality that this day moves. This is the validation diff. */
export type DiffRow = {
  locality: string
  name: string
  fromRiderId: string | null
  toRiderId: string | null
  orderCount: number
}

export function diffRows(entries: EffectiveEntry[]): DiffRow[] {
  return entries
    .filter((e) => e.changed)
    .map((e) => ({
      locality: e.locality,
      name: e.name,
      fromRiderId: e.standingRiderId,
      toRiderId: e.riderId,
      orderCount: e.orderCount,
    }))
    .sort((a, b) => b.orderCount - a.orderCount || a.name.localeCompare(b.name))
}
