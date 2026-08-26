"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { EffectiveEntry } from "@/lib/placement/effective"
import { UNASSIGNED_COLOR } from "@/lib/placement/colors"

// Deliberately a focused component. DeliveryMap is ~2,300 lines of driver
// tracking and route optimisation - the wrong machine for painting localities.
//
// 418 pins are drawn as ONE GeoJSON circle layer, not 418 DOM markers: colour,
// size and the observed/estimated ring are all data-driven paint properties, so
// a repaint after reassigning is a setData call rather than 418 React nodes.

const MAURITIUS_CENTER: [number, number] = [57.55, -20.28]
const MB_VERSION = "v3.11.0"

// The trailing `as any` is load-bearing: without it every `new mbgl().Map(...)`
// fails typecheck for lacking a construct signature.
const mbgl = () => (window as any).mapboxgl as any

export type PlacementMapProps = {
  entries: EffectiveEntry[]
  colorFor: (riderId: string | null) => string
  riderNames: Map<string, string>
  /** Currently armed rider - clicking a pin paints it this colour. */
  armedRiderId: string | null
  onAssign: (localities: string[], riderId: string | null) => void
  onMovePin: (locality: string, lat: number, lng: number) => void
}

export function PlacementMap({ entries, colorFor, riderNames, armedRiderId, onAssign, onMovePin }: PlacementMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const [ready, setReady] = useState(false)
  const [hover, setHover] = useState<{
    name: string
    rider: string
    estimated: boolean
    stacked: boolean
    orders: number
  } | null>(null)
  const [lassoing, setLassoing] = useState(false)

  // Keep the latest values reachable from map event handlers without re-binding
  // them on every render.
  const stateRef = useRef({ entries, armedRiderId, onAssign, colorFor, riderNames, onMovePin })
  stateRef.current = { entries, armedRiderId, onAssign, colorFor, riderNames, onMovePin }

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN

  const toGeoJSON = useCallback(() => {
    const { entries: es, colorFor: cf } = stateRef.current
    return {
      type: "FeatureCollection" as const,
      features: es
        .filter((e) => e.lat != null && e.lng != null)
        .map((e) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [e.lng!, e.lat!] },
          properties: {
            locality: e.locality,
            name: e.name,
            color: cf(e.riderId),
            // An estimated position must never render like an observed one.
            estimated: e.source === "geocoded" ? 1 : 0,
            // Nudged off a shared point to stay clickable, so its position is
            // only district-level. Says so on hover rather than implying a
            // precision it does not have.
            stacked: e.stacked ? 1 : 0,
            changed: e.changed ? 1 : 0,
            unassigned: e.riderId ? 0 : 1,
            orders: e.orderCount,
            rider: e.riderId ? (stateRef.current.riderNames.get(e.riderId) ?? "Unknown") : "Nobody",
          },
        })),
    }
  }, [])

  // ── Init ──
  useEffect(() => {
    if (!token || !containerRef.current || mapRef.current) return
    let cancelled = false

    async function init() {
      if (!document.querySelector('link[href*="mapbox-gl"]')) {
        const link = document.createElement("link")
        link.rel = "stylesheet"
        link.href = `https://api.mapbox.com/mapbox-gl-js/${MB_VERSION}/mapbox-gl.css`
        document.head.appendChild(link)
      }
      if (!mbgl()) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement("script")
          s.src = `https://api.mapbox.com/mapbox-gl-js/${MB_VERSION}/mapbox-gl.js`
          s.async = true
          s.onload = () => resolve()
          s.onerror = reject
          document.head.appendChild(s)
        })
        await new Promise<void>((r) => {
          const c = () => (mbgl() ? r() : setTimeout(c, 50))
          c()
        })
      }
      if (cancelled || !containerRef.current) return

      // `const gl = mbgl()` then `new gl.Map(...)`. Written inline as
      // `new mbgl().Map(...)` it parses as `new (mbgl())` - constructing the
      // getter itself - which is both wrong and a typecheck error.
      const gl = mbgl()
      gl.accessToken = token
      const map = new gl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: MAURITIUS_CENTER,
        zoom: 9.4,
        minZoom: 8,
        maxZoom: 17,
        attributionControl: false,
      })
      mapRef.current = map
      map.addControl(new gl.NavigationControl({ showCompass: false }), "bottom-right")

      map.on("load", () => {
        if (cancelled) return
        const data = toGeoJSON()
        map.addSource("localities", { type: "geojson", data })

        // Frame the actual pins rather than a fixed centre/zoom: this panel is
        // very wide on desktop and narrow on mobile, and a hardcoded zoom
        // pushed the island off to one corner.
        if (data.features.length) {
          let minLat = 90
          let maxLat = -90
          let minLng = 180
          let maxLng = -180
          for (const f of data.features) {
            const [lng, lat] = f.geometry.coordinates
            if (lat < minLat) minLat = lat
            if (lat > maxLat) maxLat = lat
            if (lng < minLng) minLng = lng
            if (lng > maxLng) maxLng = lng
          }
          map.fitBounds(
            [
              [minLng, minLat],
              [maxLng, maxLat],
            ],
            { padding: 48, duration: 0 },
          )
        }

        // Halo marking a locality this day deliberately moved.
        map.addLayer({
          id: "loc-changed",
          type: "circle",
          source: "localities",
          filter: ["==", ["get", "changed"], 1],
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 11, 14, 20],
            "circle-color": "transparent",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#fbbf24",
            "circle-stroke-opacity": 0.9,
          },
        })

        map.addLayer({
          id: "loc-pins",
          type: "circle",
          source: "localities",
          paint: {
            // Localities carrying orders are physically bigger: the day's real
            // weight, not just its footprint.
            "circle-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              9,
              ["case", [">", ["get", "orders"], 0], 7, 4.5],
              14,
              ["case", [">", ["get", "orders"], 0], 13, 8],
            ],
            "circle-color": ["get", "color"],
            // THE HONESTY RULE: a geocoded guess is hollow, an observed
            // position is solid.
            "circle-opacity": ["case", ["==", ["get", "estimated"], 1], 0.18, 0.92],
            "circle-stroke-width": ["case", ["==", ["get", "estimated"], 1], 2, 1],
            "circle-stroke-color": ["get", "color"],
            "circle-stroke-opacity": 1,
          },
        })

        map.addLayer({
          id: "loc-labels",
          type: "symbol",
          source: "localities",
          minzoom: 11.5,
          layout: {
            "text-field": ["get", "name"],
            "text-size": 10,
            "text-offset": [0, 1.4],
            "text-anchor": "top",
            "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
          },
          paint: {
            "text-color": "#e4e4e7",
            "text-halo-color": "#09090b",
            "text-halo-width": 1.4,
          },
        })

        setReady(true)
      })

      map.on("mousemove", "loc-pins", (e: any) => {
        map.getCanvas().style.cursor = "pointer"
        const p = e.features?.[0]?.properties
        if (p)
          setHover({
            name: p.name,
            rider: p.rider,
            estimated: p.estimated === 1,
            stacked: p.stacked === 1,
            orders: p.orders,
          })
      })
      map.on("mouseleave", "loc-pins", () => {
        map.getCanvas().style.cursor = ""
        setHover(null)
      })

      // Click paints the armed rider onto the locality. Clicking with nothing
      // armed clears it, so "take this off everyone" is reachable too.
      map.on("click", "loc-pins", (e: any) => {
        const f = e.features?.[0]
        if (!f) return
        stateRef.current.onAssign([f.properties.locality], stateRef.current.armedRiderId)
      })
    }

    init()
    return () => {
      cancelled = true
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [token, toGeoJSON])

  // ── Repaint when assignments change ──
  useEffect(() => {
    if (!ready || !mapRef.current) return
    const src = mapRef.current.getSource("localities")
    if (src) src.setData(toGeoJSON())
  }, [entries, ready, toGeoJSON])

  // ── Box select: drag a rectangle to paint many localities at once ──
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return

    const canvas = map.getCanvasContainer()
    let start: any = null
    let box: HTMLDivElement | null = null

    const mousePos = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect()
      const gl = mbgl()
      return new gl.Point(e.clientX - rect.left, e.clientY - rect.top)
    }

    const onMouseDown = (e: MouseEvent) => {
      // Shift-drag is the lasso; plain drag stays as pan, which people expect.
      if (!e.shiftKey || e.button !== 0) return
      map.dragPan.disable()
      setLassoing(true)
      start = mousePos(e)
      document.addEventListener("mousemove", onMouseMove)
      document.addEventListener("mouseup", onMouseUp)
    }

    const onMouseMove = (e: MouseEvent) => {
      const cur = mousePos(e)
      if (!box) {
        box = document.createElement("div")
        box.style.cssText =
          "position:absolute;background:rgba(245,158,11,0.12);border:1.5px solid #f59e0b;pointer-events:none;z-index:5;"
        canvas.appendChild(box)
      }
      const minX = Math.min(start.x, cur.x)
      const minY = Math.min(start.y, cur.y)
      box.style.transform = `translate(${minX}px, ${minY}px)`
      box.style.width = `${Math.abs(cur.x - start.x)}px`
      box.style.height = `${Math.abs(cur.y - start.y)}px`
    }

    const onMouseUp = (e: MouseEvent) => {
      const end = mousePos(e)
      if (box) {
        box.remove()
        box = null
      }
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
      map.dragPan.enable()
      setLassoing(false)

      const moved = Math.abs(end.x - start.x) > 3 && Math.abs(end.y - start.y) > 3
      if (moved) {
        const hits = map.queryRenderedFeatures([start, end], { layers: ["loc-pins"] })
        const localities: string[] = [...new Set<string>(hits.map((f: any) => String(f.properties.locality)))]
        if (localities.length) stateRef.current.onAssign(localities, stateRef.current.armedRiderId)
      }
      start = null
    }

    canvas.addEventListener("mousedown", onMouseDown)
    return () => canvas.removeEventListener("mousedown", onMouseDown)
  }, [ready])

  if (!token) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">Map unavailable: NEXT_PUBLIC_MAPBOX_TOKEN is not set.</p>
      </div>
    )
  }

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-border bg-card">
      <div ref={containerRef} className="h-full w-full" />

      {/* Legend. The observed/estimated distinction is the whole reason this
          exists, so it is stated rather than left for the eye to infer.
          Hidden below 640px, where it covered most of a 340px-wide map - and
          the shift-drag it documents needs a keyboard anyway. The footnote
          under the map carries the same estimated/district counts in text. */}
      <div className="pointer-events-none absolute left-3 top-3 hidden flex-col gap-1.5 rounded-lg border border-border/80 bg-background/92 p-2.5 text-[11px] backdrop-blur sm:flex">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-full bg-primary opacity-90" />
          <span className="text-muted-foreground">Real position (GPS or corrected)</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-full border-2 border-primary bg-primary/20" />
          <span className="text-muted-foreground">Estimated - geocoded guess</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-full border-2 border-amber-400 bg-transparent" />
          <span className="text-muted-foreground">Moved for this day</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: UNASSIGNED_COLOR }} />
          <span className="text-muted-foreground">Nobody assigned</span>
        </div>
        <div className="mt-0.5 border-t border-border/60 pt-1 text-[10px] text-muted-foreground/80">
          Bigger pin = has orders. Shift-drag to select many.
        </div>
      </div>

      {hover && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-border bg-background/95 px-3 py-2 backdrop-blur">
          <p className="text-sm font-medium text-foreground">{hover.name}</p>
          <p className="text-xs text-muted-foreground">
            {hover.rider}
            {hover.orders > 0 && ` · ${hover.orders} order${hover.orders === 1 ? "" : "s"}`}
          </p>
          {hover.estimated && (
            <p className="mt-0.5 text-[11px] text-amber-400">
              {hover.stacked ? "District area only - exact spot unknown" : "Estimated position"}
            </p>
          )}
        </div>
      )}

      {lassoing && (
        <div className="pointer-events-none absolute right-3 top-3 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground">
          Selecting
        </div>
      )}
    </div>
  )
}
