'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { updateWarehouseLocation } from '@/lib/company-settings-actions'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Save, Loader2, MapPin, X } from 'lucide-react'

interface Props {
  warehouseName: string | null
  warehouseLat: number | null
  warehouseLng: number | null
  mapboxToken: string
}

export function WarehouseMapPicker({ warehouseName, warehouseLat, warehouseLng, mapboxToken }: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const markerRef = useRef<any>(null)
  const [name, setName] = useState(warehouseName || 'Warehouse')
  const [lat, setLat] = useState<number | null>(warehouseLat)
  const [lng, setLng] = useState<number | null>(warehouseLng)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const updateMarker = useCallback((newLat: number, newLng: number) => {
    setLat(newLat)
    setLng(newLng)
    if (markerRef.current) {
      markerRef.current.setLngLat([newLng, newLat])
    }
  }, [])

  useEffect(() => {
    if (!mapContainerRef.current) return

    let cancelled = false

    async function init() {
      const mbgl = (await import('mapbox-gl')).default
      await import('mapbox-gl/dist/mapbox-gl.css')
      
      if (cancelled || !mapContainerRef.current) return

      mbgl.accessToken = mapboxToken

      const centerLng = warehouseLng || 57.55
      const centerLat = warehouseLat || -20.25

      const map = new mbgl.Map({
        container: mapContainerRef.current,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [centerLng, centerLat],
        zoom: warehouseLat ? 14 : 9,
        attributionControl: false,
      })

      mapRef.current = map

      // Add warehouse marker if location exists
      if (warehouseLat && warehouseLng) {
        const el = createMarkerEl()
        markerRef.current = new mbgl.Marker({ element: el, draggable: true })
          .setLngLat([warehouseLng, warehouseLat])
          .addTo(map)

        markerRef.current.on('dragend', () => {
          const lngLat = markerRef.current.getLngLat()
          setLat(lngLat.lat)
          setLng(lngLat.lng)
        })
      }

      // Click to place/move marker
      map.on('click', (e: any) => {
        const newLat = e.lngLat.lat
        const newLng = e.lngLat.lng
        setLat(newLat)
        setLng(newLng)

        if (markerRef.current) {
          markerRef.current.setLngLat([newLng, newLat])
        } else {
          const el = createMarkerEl()
          markerRef.current = new mbgl.Marker({ element: el, draggable: true })
            .setLngLat([newLng, newLat])
            .addTo(map)

          markerRef.current.on('dragend', () => {
            const lngLat = markerRef.current.getLngLat()
            setLat(lngLat.lat)
            setLng(lngLat.lng)
          })
        }
      })
    }

    init()
    return () => { cancelled = true; mapRef.current?.remove() }
  }, [warehouseLat, warehouseLng])

  function createMarkerEl() {
    const el = document.createElement('div')
    el.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:grab;filter:drop-shadow(0 2px 8px rgba(0,0,0,0.5));'
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;background:rgba(245,158,11,0.15);border:2px solid #f59e0b;backdrop-filter:blur(8px);">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#f59e0b" stroke-width="2.5"><path d="M3 21V8l9-5 9 5v13"/><rect x="7" y="13" width="4" height="8"/><rect x="13" y="13" width="4" height="4"/></svg>
        <span style="font-size:11px;font-weight:800;color:#f59e0b;letter-spacing:1px;white-space:nowrap;text-transform:uppercase;">WAREHOUSE</span>
      </div>
      <div style="width:2px;height:16px;background:#f59e0b;opacity:0.6;"></div>
      <div style="width:8px;height:8px;border-radius:50%;background:#f59e0b;box-shadow:0 0 12px #f59e0b;"></div>
    `
    return el
  }

  async function handleSave() {
    if (!lat || !lng) return
    setSaving(true)
    setMessage(null)

    const result = await updateWarehouseLocation(name, lat, lng)

    if (result.error) {
      setMessage({ type: 'error', text: result.error })
    } else {
      setMessage({ type: 'success', text: 'Warehouse location saved' })
    }
    setSaving(false)
    setTimeout(() => setMessage(null), 3000)
  }

  function handleRemove() {
    setLat(null)
    setLng(null)
    if (markerRef.current) {
      markerRef.current.remove()
      markerRef.current = null
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <MapPin className="w-5 h-5 text-amber-500" />
        <h3 className="text-lg font-semibold">Warehouse / Pickup Location</h3>
      </div>
      <p className="text-sm text-muted-foreground">
        Click on the map to pin your warehouse location. All contractors will pick up products here. You can drag the pin to adjust.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Name</label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="Warehouse name" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Latitude</label>
          <Input value={lat?.toFixed(6) || ''} readOnly className="bg-muted/50 font-mono text-sm" placeholder="Click map to set" />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Longitude</label>
          <Input value={lng?.toFixed(6) || ''} readOnly className="bg-muted/50 font-mono text-sm" placeholder="Click map to set" />
        </div>
      </div>

      {/* Map */}
      <div ref={mapContainerRef} className="w-full h-[350px] rounded-xl border border-border overflow-hidden" />

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving || !lat || !lng}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
          Save Warehouse Location
        </Button>
        {lat && lng && (
          <Button variant="outline" onClick={handleRemove} className="text-red-500 border-red-500/20 hover:bg-red-500/10">
            <X className="w-4 h-4 mr-1" /> Remove
          </Button>
        )}
        {message && (
          <p className={`text-sm font-medium ${message.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  )
}
