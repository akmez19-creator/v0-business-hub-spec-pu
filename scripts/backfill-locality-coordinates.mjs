// One-off: give the remaining localities a position so they can appear on the
// placement map. Observed positions (gps / override / manual) are ALREADY in
// locality_coordinates and this script must never overwrite them - a geocoded
// guess is weaker evidence than a real client GPS fix.
//
// Run: node scripts/backfill-locality-coordinates.mjs
import { createClient } from "@supabase/supabase-js"

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const mapboxToken = process.env.MAPBOX_TOKEN ?? process.env.NEXT_PUBLIC_MAPBOX_TOKEN

if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
if (!mapboxToken) throw new Error("Missing MAPBOX_TOKEN")

const db = createClient(url, key, { auth: { persistSession: false } })

// Mauritius bounding box. Anything outside is a bad match, not a position:
// Mapbox will happily return a same-named town in another country.
const IN_MU = (lat, lng) => lat >= -20.6 && lat <= -19.9 && lng >= 57.2 && lng <= 57.9

const norm = (s) => s.trim().toLowerCase()

async function main() {
  const { data: localities, error: locErr } = await db.from("localities").select("name, district")
  if (locErr) throw locErr

  const { data: existing, error: exErr } = await db.from("locality_coordinates").select("locality")
  if (exErr) throw exErr

  const have = new Set((existing ?? []).map((r) => r.locality))
  const todo = (localities ?? []).filter((l) => l.name && !have.has(norm(l.name)))

  console.log(`[v0] ${localities?.length ?? 0} localities, ${have.size} already placed, ${todo.length} to geocode`)

  let placed = 0
  let rejected = 0
  let notFound = 0

  for (const [i, loc] of todo.entries()) {
    // Include the district: 493 localities over a small island produce plenty
    // of ambiguous names, and the district disambiguates them.
    const q = encodeURIComponent([loc.name, loc.district, "Mauritius"].filter(Boolean).join(", "))
    let lat = null
    let lng = null

    try {
      const res = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json` +
          `?access_token=${mapboxToken}&limit=1&country=MU&types=place,locality,neighborhood,address`,
      )
      const geo = await res.json()
      if (geo?.features?.length) {
        const [flng, flat] = geo.features[0].center
        lat = flat
        lng = flng
      }
    } catch (e) {
      console.log(`[v0] geocode failed for ${loc.name}: ${e.message}`)
    }

    if (lat == null) {
      notFound++
    } else if (!IN_MU(lat, lng)) {
      // Do not store it. An off-island pin would render as a confident fact.
      rejected++
      console.log(`[v0] rejected out-of-bounds: ${loc.name} -> ${lat},${lng}`)
    } else {
      const { error } = await db
        .from("locality_coordinates")
        // onConflict ignoreDuplicates: never clobber an observed position.
        .upsert({ locality: norm(loc.name), lat, lng, source: "geocoded" }, { onConflict: "locality", ignoreDuplicates: true })
      if (error) console.log(`[v0] insert failed for ${loc.name}: ${error.message}`)
      else placed++
    }

    if ((i + 1) % 50 === 0) console.log(`[v0] ${i + 1}/${todo.length}...`)
    // Stay well inside Mapbox's rate limit.
    await new Promise((r) => setTimeout(r, 110))
  }

  console.log(`[v0] done: ${placed} geocoded, ${notFound} no match, ${rejected} out of bounds`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
