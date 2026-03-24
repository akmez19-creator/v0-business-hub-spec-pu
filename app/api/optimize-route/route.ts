import { NextRequest, NextResponse } from 'next/server'

/**
 * Server proxy for Mapbox Optimization API v1.
 * Accepts coordinates, calls Optimization API with driving-traffic profile,
 * handles >12 stop chunking, returns optimized order + geometry.
 *
 * Mapbox Optimization API: max 12 coordinates per request.
 * For multi-stop delivery: source=first, destination=last, roundtrip=false
 */

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || ''
const MAX_WAYPOINTS = 12

interface CoordInput {
  lng: number
  lat: number
}

interface OptimizeRequest {
  coordinates: (CoordInput | [number, number])[]
  deliveryIds?: string[]
  profile?: string
  roundtrip?: boolean
  source?: string
}

async function callOptimizationAPI(coords: [number, number][]) {
  const coordString = coords.map(c => `${c[0]},${c[1]}`).join(';')
  const url = `https://api.mapbox.com/optimized-trips/v1/mapbox/driving-traffic/${coordString}?source=first&destination=last&roundtrip=false&geometries=geojson&overview=full&steps=true&access_token=${MAPBOX_TOKEN}`

  const res = await fetch(url)
  const data = await res.json()

  if (data.code !== 'Ok' || !data.trips?.[0]) {
    // Fallback to standard driving profile
    const fallbackUrl = `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coordString}?source=first&destination=last&roundtrip=false&geometries=geojson&overview=full&steps=true&access_token=${MAPBOX_TOKEN}`
    const fbRes = await fetch(fallbackUrl)
    const fbData = await fbRes.json()
    if (fbData.code !== 'Ok' || !fbData.trips?.[0]) {
      return { error: fbData.message || 'Optimization failed', code: fbData.code }
    }
    return fbData
  }
  return data
}

export async function POST(req: NextRequest) {
  try {
    if (!MAPBOX_TOKEN) {
      return NextResponse.json({ error: 'MAPBOX_TOKEN not configured' }, { status: 500 })
    }

    const body: OptimizeRequest = await req.json()
    const { deliveryIds } = body

    if (!body.coordinates?.length || body.coordinates.length < 2) {
      return NextResponse.json({ error: 'Need at least 2 coordinates' }, { status: 400 })
    }

    // Normalize coordinates: accept both {lng,lat} objects and [lng,lat] arrays
    const coordinates: [number, number][] = body.coordinates.map((c: any) => {
      if (Array.isArray(c)) return [c[0], c[1]] as [number, number]
      return [c.lng, c.lat] as [number, number]
    })

    // If within limit, single call
    if (coordinates.length <= MAX_WAYPOINTS) {
      const data = await callOptimizationAPI(coordinates)
      if (data.error) {
        return NextResponse.json({ error: data.error }, { status: 400 })
      }

      const trip = data.trips[0]
      const waypoints = data.waypoints || []

      // Build optimized order: waypoints[i].waypoint_index tells the optimized position
      const optimizedOrder = waypoints.map((wp: any, originalIdx: number) => ({
        originalIndex: originalIdx,
        optimizedIndex: wp.waypoint_index,
        location: wp.location,
        deliveryId: deliveryIds?.[originalIdx] || null,
      })).sort((a: any, b: any) => a.optimizedIndex - b.optimizedIndex)

      return NextResponse.json({
        geometry: trip.geometry,
        duration: trip.duration,
        distance: trip.distance,
        legs: trip.legs,
        optimizedOrder,
        waypoints,
      })
    }

    // For >12 stops: chunk into batches, chain them
    // First coordinate is always the driver's position (source)
    const driverPos = coordinates[0]
    const stops = coordinates.slice(1)
    const stopIds = deliveryIds?.slice(1) || []

    // Sort stops by proximity to driver (greedy nearest-neighbor for chunk grouping)
    const indexed = stops.map((coord, i) => ({ coord, id: stopIds[i] || null, idx: i }))
    const sorted: typeof indexed = []
    let current = driverPos
    const remaining = [...indexed]

    while (remaining.length > 0) {
      let nearestIdx = 0
      let nearestDist = Infinity
      for (let i = 0; i < remaining.length; i++) {
        const dx = remaining[i].coord[0] - current[0]
        const dy = remaining[i].coord[1] - current[1]
        const dist = dx * dx + dy * dy
        if (dist < nearestDist) { nearestDist = dist; nearestIdx = i }
      }
      sorted.push(remaining[nearestIdx])
      current = remaining[nearestIdx].coord
      remaining.splice(nearestIdx, 1)
    }

    // Chunk sorted stops into batches of MAX_WAYPOINTS - 1 (reserve 1 for driver/chain point)
    const chunkSize = MAX_WAYPOINTS - 1
    const allLegs: any[] = []
    const allGeometryCoords: any[] = []
    const optimizedOrder: any[] = []
    let chainPoint = driverPos
    let totalDuration = 0
    let totalDistance = 0
    let globalOrder = 0

    for (let c = 0; c < sorted.length; c += chunkSize) {
      const chunk = sorted.slice(c, c + chunkSize)
      const batchCoords: [number, number][] = [chainPoint, ...chunk.map(s => s.coord)]

      const data = await callOptimizationAPI(batchCoords)
      if (data.error) {
        return NextResponse.json({ error: `Chunk ${c} failed: ${data.error}` }, { status: 400 })
      }

      const trip = data.trips[0]
      const waypoints = data.waypoints || []

      // Map waypoints (skip index 0 which is the chain point)
      const batchOrdered = waypoints
        .filter((_: any, i: number) => i > 0)
        .map((wp: any, i: number) => ({
          ...chunk[i],
          optimizedIndex: wp.waypoint_index,
        }))
        .sort((a: any, b: any) => a.optimizedIndex - b.optimizedIndex)

      for (const stop of batchOrdered) {
        optimizedOrder.push({
          originalIndex: stop.idx + 1, // +1 because driver was index 0
          optimizedIndex: globalOrder,
          location: stop.coord,
          deliveryId: stop.id,
        })
        globalOrder++
      }

      // Collect geometry
      if (trip.geometry?.coordinates) {
        allGeometryCoords.push(...trip.geometry.coordinates)
      }
      if (trip.legs) allLegs.push(...trip.legs)
      totalDuration += trip.duration || 0
      totalDistance += trip.distance || 0

      // Last stop of this chunk becomes chain point for next chunk
      const lastStop = batchOrdered[batchOrdered.length - 1]
      if (lastStop) chainPoint = lastStop.coord
    }

    return NextResponse.json({
      geometry: { type: 'LineString', coordinates: allGeometryCoords },
      duration: totalDuration,
      distance: totalDistance,
      legs: allLegs,
      optimizedOrder,
      chunked: true,
    })
  } catch (e: any) {
    console.error('optimize-route error:', e)
    return NextResponse.json({ error: e.message || 'Internal error' }, { status: 500 })
  }
}
