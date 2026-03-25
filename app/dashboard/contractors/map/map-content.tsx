'use client'

import { useMemo, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

import { DeliveryMap, type DeliveryPin, type RegionCluster, type DeliveryRegionGroup } from '@/components/delivery-map/delivery-map'
import { getLocalityCoords } from '@/lib/mauritius-localities'
import { MapPin, Users, ChevronDown } from 'lucide-react'

const MAPS_URL_REGEX = new RegExp(
  'https?://(maps\\.app\\.goo\\.gl|goo\\.gl/maps|www\\.google\\.com/maps|maps\\.google\\.com|google\\.com/maps)[^\\s)}"\'\\]]*',
  'gi'
)

function extractCoordsFromUrl(url: string): { lat: number; lng: number } | null {
  const qMatch = url.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/)
  if (qMatch) return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) }
  const atMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/)
  if (atMatch) return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) }
  const dirMatch = url.match(/\/(-?\d+\.?\d*),(-?\d+\.?\d*)/)
  if (dirMatch) return { lat: parseFloat(dirMatch[1]), lng: parseFloat(dirMatch[2]) }
  return null
}

function extractMapsLinks(text: string): string[] {
  return text.match(MAPS_URL_REGEX) || []
}

// Parse products string to extract item name without quantity prefix
// If products is "2x Large Scale Spoon", returns { name: "Large Scale Spoon", qty: 2 }
// If products is "Large Scale Spoon", returns { name: "Large Scale Spoon", qty: fallbackQty }
function parseProductItem(products: string | null, fallbackQty: number, amount: number): { name: string; qty: number; amount: number } {
  if (!products) return { name: 'Item', qty: fallbackQty, amount }
  const match = products.match(/^(\d+)\s*x\s*(.+)$/i)
  if (match) {
    return { name: match[2].trim(), qty: parseInt(match[1], 10), amount }
  }
  return { name: products, qty: fallbackQty, amount }
}

interface MapPageContentProps {
  deliveries: any[]
  riderMap: Record<string, string>
  deliveryDate: string
  apiKey: string
  userName?: string
  userPhoto?: string | null
  warehouseLat?: number | null
  warehouseLng?: number | null
  warehouseName?: string

  customTemplates?: Record<string, string> | null
  defaultRiderId?: string | null
  riderJuicePolicies?: Record<string, string>
}

export function MapPageContent({ deliveries, riderMap, deliveryDate, apiKey, userName, userPhoto, warehouseLat, warehouseLng, warehouseName, customTemplates, defaultRiderId, riderJuicePolicies = {} }: MapPageContentProps) {
  const router = useRouter()
  // Default to the contractor's own rider if they have multiple riders
  const [selectedRiderId, setSelectedRiderId] = useState<string>(
    defaultRiderId && Object.keys(riderMap).length > 1 ? defaultRiderId : 'all'
  )
  const [riderDropdownOpen, setRiderDropdownOpen] = useState(false)

  const RIDER_COLORS = ['#b45309', '#1d4ed8', '#047857', '#c2410c', '#6d28d9', '#b91c1c', '#0d9488', '#7c3aed', '#ca8a04', '#4f46e5']

  const riderEntries = useMemo(() => Object.entries(riderMap), [riderMap])
  const hasMultipleRiders = riderEntries.length > 1

  // Build color map for riders
  const riderColorMapData = useMemo(() => {
    const map: Record<string, { color: string; name: string }> = {}
    riderEntries.forEach(([id, name], i) => {
      map[id] = { color: RIDER_COLORS[i % RIDER_COLORS.length], name }
    })
    map['unassigned'] = { color: '#6b7280', name: 'Unassigned' }
    return map
  }, [riderEntries])

  // Filter deliveries by selected rider
  const filteredDeliveries = useMemo(() => {
    if (selectedRiderId === 'all') return deliveries
    return deliveries.filter(d => d.rider_id === selectedRiderId || (!d.rider_id && selectedRiderId === 'unassigned'))
  }, [deliveries, selectedRiderId])

  // Real-time: auto-refresh when a client shares their location
  useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseKey) return

    const supabase = createBrowserClient(supabaseUrl, supabaseKey)
    const deliveryIds = deliveries.map(d => d.id)
    if (deliveryIds.length === 0) return

    const channel = supabase
      .channel('map-delivery-updates')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'deliveries',
      }, (payload) => {
        // Only refresh if it's one of our deliveries and location/response changed
        if (deliveryIds.includes(payload.new.id)) {
          const oldRec = payload.old as Record<string, unknown>
          const newRec = payload.new as Record<string, unknown>
          if (
            newRec.latitude !== oldRec.latitude ||
            newRec.longitude !== oldRec.longitude ||
            newRec.client_response !== oldRec.client_response ||
            newRec.status !== oldRec.status
          ) {
            router.refresh()
          }
        }
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [router])

  const { exactPins, regions, regionGroups, totalMapped, totalUnmapped } = useMemo(() => {
    console.log("[v0] filteredDeliveries count:", filteredDeliveries.length)
    console.log("[v0] filteredDeliveries sample:", filteredDeliveries[0])
    const exact: DeliveryPin[] = []
    // Step 1: Group deliveries by client (same name+contact = same client, like orders page)
    const clientMap: Record<string, typeof filteredDeliveries> = {}
    for (const d of filteredDeliveries) {
      const clientKey = `${(d.customer_name || '').trim().toLowerCase()}|${(d.contact_1 || '').trim()}|${(d.locality || '').trim().toLowerCase()}`
      if (!clientMap[clientKey]) clientMap[clientKey] = []
      clientMap[clientKey].push(d)
    }

    // Step 2: Build pins per client group
    const localityMap: Record<string, DeliveryPin[]> = {}
    let unmapped = 0

    for (const items of Object.values(clientMap)) {
      const first = items[0]
      const allIds = items.map(d => d.id)

      // Find best coordinates from any item in the group
      // Priority: 1) client_lat/client_lng (real GPS/pin/shared) 2) response links 3) latitude/longitude (geocoded from import)
      let lat: number | null = null
      let lng: number | null = null
      let source: 'gps' | 'response' | 'geocoded' = 'geocoded'

      // 1) Check for REAL client-provided location (client_lat/client_lng set by GPS, rider pin, or pasted link)
      for (const d of items) {
        if (d.client_lat && d.client_lng) {
          lat = d.client_lat; lng = d.client_lng
          source = d.location_source === 'shared' ? 'response' : 'gps'
          break
        }
      }
      // 2) Check client_response for maps links
      if (!lat) {
        for (const d of items) {
          if (d.client_response) {
            for (const link of extractMapsLinks(d.client_response)) {
              const coords = extractCoordsFromUrl(link)
              if (coords) { lat = coords.lat; lng = coords.lng; source = 'response'; break }
            }
            if (lat) break
          }
        }
      }
      // 3) Check delivery_notes for maps links
      if (!lat) {
        for (const d of items) {
          if (d.delivery_notes) {
            for (const link of extractMapsLinks(d.delivery_notes)) {
              const coords = extractCoordsFromUrl(link)
              if (coords) { lat = coords.lat; lng = coords.lng; source = 'response'; break }
            }
            if (lat) break
          }
        }
      }
      // 4) Fallback: use geocoded latitude/longitude from data import (NOT real location)
      if (!lat) {
        for (const d of items) {
          if (d.latitude && d.longitude) {
            lat = d.latitude; lng = d.longitude; source = 'geocoded'; break
          }
        }
      }

      // Merge product names and sum amounts across items
      const products = [...new Set(items.map(d => d.products).filter(Boolean))].join(', ')
      const totalQty = items.reduce((s, d) => s + (d.qty || 1), 0)
      const totalAmount = items.reduce((s, d) => s + (d.amount || 0), 0)
      // Use the "worst" status for the group (pending > assigned > picked_up > delivered)
      const statusPriority: Record<string, number> = { pending: 0, assigned: 1, picked_up: 2, nwd: 3, delivered: 4, cms: 5 }
      const worstStatus = items.reduce((worst, d) => {
        const s = d.status || 'pending'
        return (statusPriority[s] ?? 0) < (statusPriority[worst] ?? 0) ? s : worst
      }, items[0].status || 'pending')

      const pin: DeliveryPin = {
        id: first.id,
        itemIds: allIds,
        customerName: first.customer_name || 'Unknown',
        contact1: first.contact_1,
        locality: first.locality,
        products: products || null,
        qty: totalQty,
        amount: totalAmount,
        status: worstStatus,
        lat: lat || 0,
        lng: lng || 0,
        source,
        riderId: first.rider_id || null,
        riderName: first.rider_id ? riderMap[first.rider_id] || null : null,
        deliveryNotes: items.map(d => d.delivery_notes).filter(Boolean).join('\n') || null,
        clientResponse: items.map(d => d.client_response).filter(Boolean).join('\n') || null,
        locationFlagged: items.some(d => d.location_flagged),
        isModified: items.some(d => d.is_modified),
        modificationCount: items.reduce((sum, d) => sum + (d.modification_count || 0), 0),
        items: items.map(d => parseProductItem(d.products, d.qty || 1, d.amount || 0)),
        salesType: first.sales_type || null,
        returnProduct: first.return_product || null,
      }


      if (lat && lng) {
        exact.push({ ...pin, lat, lng })
      } else if (first.locality) {
        const key = first.locality.trim().toLowerCase()
        if (!localityMap[key]) localityMap[key] = []
        localityMap[key].push(pin)
      } else {
        unmapped++
      }
    }

    // Build region clusters from localities
    const regionClusters: RegionCluster[] = []
    const ungeocodedPins: DeliveryPin[] = []
    for (const [key, pins] of Object.entries(localityMap)) {
      const coords = getLocalityCoords(pins[0].locality || key)
      if (!coords) {
        // No coords but still have locality — add to ungeocodedPins for region grouping
        ungeocodedPins.push(...pins)
        unmapped += pins.length
        continue
      }

      const statuses: Record<string, number> = {}
      pins.forEach(p => { statuses[p.status] = (statuses[p.status] || 0) + 1 })

      regionClusters.push({
        locality: pins[0].locality || key,
        lat: coords.lat,
        lng: coords.lng,
        count: pins.length,
        deliveries: pins.map(p => ({ ...p, lat: coords.lat, lng: coords.lng, source: 'geocoded' as const })),
        statuses,
      })
    }

    // Build region groups: group ALL deliveries by LOCALITY (matching orders page)
    // Include exact pins, geocoded cluster pins, AND ungeocoded pins (with locality but no coords)
    const localityGroupMap: Record<string, { routable: DeliveryPin[]; unreachable: DeliveryPin[]; parentRegion: string }> = {}
    const allPinsForGrouping = [
      ...exact,
      ...regionClusters.flatMap(r => r.deliveries),
      ...ungeocodedPins,
    ]
    for (const pin of allPinsForGrouping) {
      const locRaw = (pin.locality || '').trim()
      const locKey = locRaw || 'Unassigned'
      if (!localityGroupMap[locKey]) localityGroupMap[locKey] = { routable: [], unreachable: [], parentRegion: '' }
      // Only clients with REAL location (GPS from client, rider-pinned, or pasted link) are routable
      // 'geocoded' means approximate locality center - NOT a real location
      const hasRealLocation = pin.source === 'gps' || pin.source === 'response'

      if (hasRealLocation && pin.lat && pin.lng) {
        localityGroupMap[locKey].routable.push(pin)
      } else {
        localityGroupMap[locKey].unreachable.push(pin)
      }
    }
    // Also add fully unmapped deliveries (no locality at all)
    for (const d of deliveries) {
      if (!d.latitude && !d.longitude && !d.client_response && !d.delivery_notes && !d.locality) {
        const pin: DeliveryPin = {
          id: d.id, itemIds: [d.id], customerName: d.customer_name || 'Unknown', contact1: d.contact_1,
          locality: d.locality, products: d.products, qty: d.qty || 1, amount: d.amount || 0,
          status: d.status || 'pending', lat: 0, lng: 0, source: 'geocoded',
          riderName: d.rider_id ? riderMap[d.rider_id] || null : null,
          deliveryNotes: d.delivery_notes, clientResponse: d.client_response,
          locationFlagged: !!d.location_flagged,
          isModified: !!d.is_modified,
          modificationCount: d.modification_count || 0,
          items: [parseProductItem(d.products, d.qty || 1, d.amount || 0)],
        }
        if (!localityGroupMap['Unassigned']) localityGroupMap['Unassigned'] = { routable: [], unreachable: [], parentRegion: '' }
        localityGroupMap['Unassigned'].unreachable.push(pin)
      }
    }

    const regionGroups: DeliveryRegionGroup[] = Object.entries(localityGroupMap)
      .map(([locality, { routable, unreachable, parentRegion }]) => ({
        region: locality,
        parentRegion,
        routable,
        unreachable,
        totalCount: routable.length + unreachable.length,
      }))
      .sort((a, b) => b.totalCount - a.totalCount)

    console.log("[v0] exact pins:", exact.length, "regions:", regionClusters.length, "groups:", regionGroups.length)
    console.log("[v0] localityMap keys:", Object.keys(localityMap))
    return {
      exactPins: exact,
      regions: regionClusters,
      regionGroups,
      totalMapped: exact.length + regionClusters.reduce((sum, r) => sum + r.count, 0),
      totalUnmapped: unmapped,
    }
  }, [filteredDeliveries, riderMap])

  const totalRegionClients = regions.reduce((sum, r) => sum + r.count, 0)

  return (
    <div className="h-screen w-screen relative overflow-hidden bg-black">
      {/* Rider filter — positioned below back/fullscreen buttons */}
      {hasMultipleRiders && (
        <div className="absolute top-16 left-3 z-[60]">
          <div className="relative">
            <button
              onClick={() => setRiderDropdownOpen(!riderDropdownOpen)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black/80 backdrop-blur-sm border border-white/10 text-xs text-white/90 hover:bg-white/10 transition-colors shadow-lg"
            >
              <Users className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-medium">
                {selectedRiderId === 'all'
                  ? `All (${deliveries.length})`
                  : selectedRiderId === 'unassigned'
                  ? `Unassigned (${deliveries.filter(d => !d.rider_id).length})`
                  : `${riderMap[selectedRiderId] || 'Rider'} (${filteredDeliveries.length})`}
              </span>
              <ChevronDown className={`w-3 h-3 transition-transform ${riderDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {riderDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 min-w-[160px] rounded-xl bg-black/90 backdrop-blur-sm border border-white/10 shadow-xl overflow-hidden">
                <button
                  onClick={() => { setSelectedRiderId('all'); setRiderDropdownOpen(false) }}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-white/10 transition-colors ${selectedRiderId === 'all' ? 'text-amber-400 bg-white/5' : 'text-white/80'}`}
                >
                  All Riders ({deliveries.length})
                </button>
                {riderEntries.map(([id, name]) => {
                  const count = deliveries.filter(d => d.rider_id === id).length
                  const rColor = riderColorMapData[id]?.color || '#6b7280'
                  return (
                    <button
                      key={id}
                      onClick={() => { setSelectedRiderId(id); setRiderDropdownOpen(false) }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-white/10 transition-colors flex items-center gap-2 ${selectedRiderId === id ? 'bg-white/5' : 'text-white/80'}`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: rColor }} />
                      <span className={selectedRiderId === id ? 'text-amber-400' : ''}>{name} ({count})</span>
                    </button>
                  )
                })}
                {deliveries.some(d => !d.rider_id) && (
                  <button
                    onClick={() => { setSelectedRiderId('unassigned'); setRiderDropdownOpen(false) }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-white/10 transition-colors ${selectedRiderId === 'unassigned' ? 'text-amber-400 bg-white/5' : 'text-white/80'}`}
                  >
                    Unassigned ({deliveries.filter(d => !d.rider_id).length})
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {(exactPins.length > 0 || regions.length > 0) ? (
        <DeliveryMap deliveries={exactPins} regions={regions} regionGroups={regionGroups} apiKey={apiKey} userName={userName} userPhoto={userPhoto} warehouseLat={warehouseLat} warehouseLng={warehouseLng} warehouseName={warehouseName} className="h-full w-full" backHref="/dashboard/contractors" customTemplates={customTemplates} riderColorMap={hasMultipleRiders ? riderColorMapData : undefined} riderJuicePolicies={riderJuicePolicies} />
      ) : (
        <div className="h-full flex items-center justify-center">
          <div className="text-center space-y-3 px-6">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mx-auto">
              <MapPin className="w-8 h-8 text-white/20" />
            </div>
            <p className="text-sm font-medium text-white/60">No locations available</p>
            <p className="text-xs text-white/30 max-w-xs">Pins appear when clients share GPS or addresses are geocoded.</p>
          </div>
        </div>
      )}
    </div>
  )
}
