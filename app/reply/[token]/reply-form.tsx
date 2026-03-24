'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { submitClientReply } from '@/lib/delivery-actions'
import { MapPin, Send, CheckCircle, Package, Navigation, Loader2, FileText, Crosshair, AlertTriangle, Phone, MessageSquare, Clock, X } from 'lucide-react'
import { createPortal } from 'react-dom'

interface DeliveryInfo {
  id: string
  customer_name: string
  locality: string | null
  products: string | null
  qty: number
  amount: number
  status: string
  client_response: string | null
  delivery_notes: string | null
  latitude?: number | null
  longitude?: number | null
}

interface CompanyInfo {
  company_name: string
  company_address: string
  brn: string
  vat_number: string
  vat_rate: number
  phone: string
  email: string
}

type LocationMode = 'none' | 'gps' | 'pin' | 'manual'

interface Props {
  delivery: DeliveryInfo
  token: string
  company?: CompanyInfo | null
  regionCenter?: { lat: number; lng: number } | null
  mapboxToken?: string
}

export function ReplyForm({ delivery, token, company, regionCenter, mapboxToken }: Props) {
  const [reply, setReply] = useState('')
  const [locationUrl, setLocationUrl] = useState('')
  const [rawCoords, setRawCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [locationMode, setLocationMode] = useState<LocationMode>('none')
  const [gettingLocation, setGettingLocation] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')
  const [showInvoice, setShowInvoice] = useState(false)
  const [outsideRegion, setOutsideRegion] = useState(false)
  const [showLocationUpdate, setShowLocationUpdate] = useState(false)
  const [pinMoved, setPinMoved] = useState(false)

  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const markerRef = useRef<any>(null)

  const hasExistingReply = !!delivery.client_response
  const isDelivered = ['delivered', 'nwd', 'cms'].includes(delivery.status)

  // VAT calculation (prices are VAT inclusive)
  const vatRate = company?.vat_rate || 15
  const totalInclVat = delivery.amount
  const vatAmount = totalInclVat - (totalInclVat / (1 + vatRate / 100))
  const totalExclVat = totalInclVat - vatAmount

  // Check distance from region center
  const checkRegionDistance = useCallback((lat: number, lng: number) => {
    if (!regionCenter) return false
    const R = 6371000
    const dLat = (regionCenter.lat - lat) * Math.PI / 180
    const dLng = (regionCenter.lng - lng) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * Math.PI / 180) * Math.cos(regionCenter.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2
    const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    const isFar = dist > 5000
    setOutsideRegion(isFar)
    return isFar
  }, [regionCenter])

  // Callback ref - initializes map when the fullscreen container mounts
  const initMap = useCallback((node: HTMLDivElement | null) => {
    mapContainerRef.current = node
    if (!node || !mapboxToken || mapInstanceRef.current) return
    setPinMoved(false)

    // Inject Mapbox CSS if not present
    if (!document.querySelector('link[href*="mapbox-gl"]')) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = 'https://api.mapbox.com/mapbox-gl-js/v3.11.0/mapbox-gl.css'
      document.head.appendChild(link)
    }

    import('mapbox-gl').then(mapboxgl => {
      if (!mapContainerRef.current) return
      mapboxgl.default.accessToken = mapboxToken

      // Center on the delivery region so the client sees their delivery area
      const center = regionCenter || { lat: -20.25, lng: 57.57 }
      const map = new mapboxgl.default.Map({
        container: mapContainerRef.current,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [center.lng, center.lat],
        zoom: regionCenter ? 15 : 11,
        pitch: 50,
        bearing: -10,
        antialias: true,
      })

      map.addControl(new mapboxgl.default.NavigationControl({ showCompass: true }), 'top-right')

      // 3D buildings
      map.on('style.load', () => {
        if (!map.getLayer('3d-buildings')) {
          map.addLayer({
            id: '3d-buildings',
            source: 'composite',
            'source-layer': 'building',
            type: 'fill-extrusion',
            minzoom: 12,
            paint: {
              'fill-extrusion-color': '#1a1a2e',
              'fill-extrusion-height': ['get', 'height'],
              'fill-extrusion-base': ['get', 'min_height'],
              'fill-extrusion-opacity': 0.5,
            },
          })
        }
      })

      // Custom glowing pin marker - starts at region center
      const markerEl = document.createElement('div')
      markerEl.innerHTML = `<div style="position:relative;display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 0 12px rgba(59,130,246,0.5))">
        <style>@keyframes pinPulse{0%,100%{transform:scale(1);opacity:0.6}50%{transform:scale(2.2);opacity:0}}</style>
        <div style="position:absolute;top:2px;left:50%;transform:translateX(-50%);width:36px;height:36px;border-radius:50%;background:rgba(59,130,246,0.3);animation:pinPulse 2s ease-in-out infinite"></div>
        <div style="width:36px;height:36px;background:radial-gradient(circle,#3b82f6 40%,#1d4ed8);border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;position:relative;z-index:1">
          <svg width="18" height="18" fill="none" stroke="#fff" stroke-width="2.5" viewBox="0 0 24 24"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
        </div>
        <div style="width:2px;height:12px;background:linear-gradient(#3b82f6,transparent)"></div>
      </div>`
      const marker = new mapboxgl.default.Marker({ element: markerEl, draggable: true, anchor: 'bottom' })
        .setLngLat([center.lng, center.lat])
        .addTo(map)

      marker.on('dragend', () => {
        const lngLat = marker.getLngLat()
        const coords = { lat: lngLat.lat, lng: lngLat.lng }
        setRawCoords(coords)
        setPinMoved(true)
        setLocationUrl(`https://www.google.com/maps?q=${coords.lat},${coords.lng}`)
        checkRegionDistance(coords.lat, coords.lng)
      })

      map.on('click', (e: any) => {
        marker.setLngLat(e.lngLat)
        const coords = { lat: e.lngLat.lat, lng: e.lngLat.lng }
        setRawCoords(coords)
        setPinMoved(true)
        setLocationUrl(`https://www.google.com/maps?q=${coords.lat},${coords.lng}`)
        checkRegionDistance(coords.lat, coords.lng)
      })

      mapInstanceRef.current = map
      markerRef.current = marker
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapboxToken, regionCenter])

  // Cleanup map when leaving pin mode
  useEffect(() => {
    if (locationMode !== 'pin' && mapInstanceRef.current) {
      mapInstanceRef.current.remove()
      mapInstanceRef.current = null
      markerRef.current = null
    }
  }, [locationMode])

  async function shareGPS() {
    if (!navigator.geolocation) {
      setError('Location sharing is not supported on your device.')
      return
    }
    setGettingLocation(true)
    setError('')
    setLocationMode('gps')

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords
        const url = `https://www.google.com/maps?q=${latitude},${longitude}`
        setLocationUrl(url)
        setRawCoords({ lat: latitude, lng: longitude })
        setGettingLocation(false)
        checkRegionDistance(latitude, longitude)
      },
      (err) => {
        setGettingLocation(false)
        setLocationMode('none')
        if (err.code === 1) {
          setError('Location access denied. Please enable location in your browser settings.')
        } else {
          setError('Could not get your location. Please try again or pin on map.')
        }
      },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }

  function clearLocation() {
    setLocationUrl('')
    setRawCoords(null)
    setLocationMode('none')
    setOutsideRegion(false)
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove()
      mapInstanceRef.current = null
      markerRef.current = null
    }
  }

  async function handleSubmit() {
    if (!reply.trim() && !locationUrl) {
      setError('Please type a reply or share your location.')
      return
    }
    setSubmitting(true)
    setError('')

    const source = locationMode === 'gps' ? 'gps' : locationMode === 'pin' ? 'pin' : 'manual'
    const result = await submitClientReply(token, reply, locationUrl, rawCoords ?? undefined, source as any, regionCenter)

    if (result.error) {
      setError(result.error)
      setSubmitting(false)
    } else {
      setSubmitted(true)
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-sm">
          <div className="w-20 h-20 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto">
            <CheckCircle className="w-10 h-10 text-emerald-500" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Reply Sent!</h1>
          <p className="text-muted-foreground">
            Thank you, {delivery.customer_name}. Your delivery agent has been notified.
          </p>
          {locationUrl && <p className="text-sm text-emerald-400">Your location has been shared.</p>}
          {outsideRegion && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              <p className="text-xs text-amber-400">Note: The location you shared appears to be outside your delivery area. The rider may call you to confirm.</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto p-4 pt-6 space-y-4">
      {/* Header */}
      <div className="text-center space-y-1">
        <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
          <Package className="w-7 h-7 text-primary" />
        </div>
        {company && (
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{company.company_name}</p>
        )}
        <h1 className="text-xl font-bold text-foreground">
          {isDelivered ? 'Delivery Complete' : 'Delivery Notification'}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isDelivered
            ? <>Hi <span className="font-semibold text-foreground">{delivery.customer_name}</span>, your order has been delivered. Thank you!</>
            : <>Hi <span className="font-semibold text-foreground">{delivery.customer_name}</span>, you have a delivery coming your way.</>
          }
        </p>
      </div>

      {/* Location Section - TOP PRIORITY, only before delivery */}
      {!isDelivered && (
        <div className="relative rounded-2xl overflow-hidden">
          {/* 3D Glass card effect */}
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-cyan-500/5 to-blue-600/10 rounded-2xl" />
          <div className="absolute inset-0 rounded-2xl shadow-[inset_0_1px_1px_rgba(255,255,255,0.1),0_4px_24px_rgba(59,130,246,0.12),0_1px_2px_rgba(0,0,0,0.15)]" />
          <div className="relative p-4 space-y-3 border border-blue-500/20 rounded-2xl backdrop-blur-sm">

            {/* Already has location */}
            {hasExistingReply && delivery.latitude && !showLocationUpdate ? (
              <>
                <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 shadow-[0_2px_12px_rgba(16,185,129,0.1)]">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center shadow-[0_0_16px_rgba(16,185,129,0.2)]">
                    <CheckCircle className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-emerald-400">Location shared</p>
                    <p className="text-[10px] text-muted-foreground">Your location has been sent to the rider.</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowLocationUpdate(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-background/50 border border-border/50 text-muted-foreground hover:text-foreground hover:border-blue-500/30 transition-all"
                >
                  <MapPin className="w-4 h-4" />
                  <span className="text-xs font-medium">Update Location</span>
                </button>
              </>
            ) : (
              <>
                {/* Heading with glow icon */}
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-blue-500/15 flex items-center justify-center shadow-[0_0_20px_rgba(59,130,246,0.25),inset_0_1px_1px_rgba(255,255,255,0.1)]">
                    <Navigation className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-foreground">
                      {showLocationUpdate ? 'Update Your Location' : 'Share Your Location'}
                    </h2>
                    <p className="text-[11px] text-muted-foreground">
                      {showLocationUpdate ? 'Pick a new location to update.' : 'Help the driver find you faster.'}
                    </p>
                  </div>
                </div>

                {/* Location already captured */}
                {locationUrl ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 shadow-[0_2px_12px_rgba(59,130,246,0.08)]">
                      <Navigation className="w-5 h-5 text-blue-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-blue-400">
                          Location {rawCoords ? '(Pinned)' : locationMode === 'gps' ? '(GPS)' : '(Link)'}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate">{locationUrl}</p>
                      </div>
                      <button onClick={clearLocation} className="text-[10px] px-2 py-1 rounded-lg bg-background/50 border border-border/50 text-muted-foreground hover:text-foreground transition-colors">
                        Change
                      </button>
                    </div>
                    {outsideRegion && (
                      <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 shadow-[0_2px_12px_rgba(245,158,11,0.1)]">
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-medium text-amber-400">Location appears outside your area</p>
                          <p className="text-[10px] text-muted-foreground">
                            This seems far from {delivery.locality || 'your delivery area'}. The rider may call to confirm.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                ) : locationMode === 'pin' ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
                      <Crosshair className="w-5 h-5 text-cyan-400 shrink-0 animate-pulse" />
                      <p className="text-xs text-cyan-400 font-medium flex-1">Pinning location on map...</p>
                      <button onClick={clearLocation} className="text-[10px] px-2 py-1 rounded-lg bg-background/50 border border-border/50 text-muted-foreground hover:text-foreground transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>

                ) : (
                  /* 3 location option buttons */
                  <div className="space-y-2">
                    {/* GPS - Primary action */}
                    <button
                      onClick={shareGPS}
                      disabled={gettingLocation}
                      className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-blue-500/10 border border-blue-500/25 text-blue-400 hover:bg-blue-500/15 transition-all disabled:opacity-50 shadow-[0_2px_12px_rgba(59,130,246,0.08),inset_0_1px_1px_rgba(255,255,255,0.05)]"
                    >
                      <div className="w-9 h-9 rounded-full bg-blue-500/15 flex items-center justify-center shadow-[0_0_12px_rgba(59,130,246,0.2)]">
                        {gettingLocation
                          ? <Loader2 className="w-4 h-4 animate-spin" />
                          : <Navigation className="w-4 h-4" />}
                      </div>
                      <div className="text-left">
                        <span className="text-sm font-semibold block">{gettingLocation ? 'Getting location...' : 'Send Current Location'}</span>
                        <span className="text-[10px] text-blue-400/60">Uses your GPS - most accurate</span>
                      </div>
                    </button>
                    {/* Pin on map */}
                    {mapboxToken && (
                      <button
                        onClick={() => setLocationMode('pin')}
                        className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-cyan-500/10 border border-cyan-500/25 text-cyan-400 hover:bg-cyan-500/15 transition-all shadow-[0_2px_12px_rgba(6,182,212,0.08),inset_0_1px_1px_rgba(255,255,255,0.05)]"
                      >
                        <div className="w-9 h-9 rounded-full bg-cyan-500/15 flex items-center justify-center shadow-[0_0_12px_rgba(6,182,212,0.2)]">
                          <Crosshair className="w-4 h-4" />
                        </div>
                        <div className="text-left">
                          <span className="text-sm font-semibold block">Pin on Map</span>
                          <span className="text-[10px] text-cyan-400/60">Tap to place a pin on the map</span>
                        </div>
                      </button>
                    )}
                    {/* Paste link */}
                    <button
                      onClick={() => {
                        const url = prompt('Paste a Google Maps link or coordinates:')
                        if (url && url.trim()) {
                          setLocationUrl(url.trim())
                          setLocationMode('manual')
                          const qMatch = url.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/)
                          const atMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/)
                          const match = qMatch || atMatch
                          if (match) {
                            const coords = { lat: parseFloat(match[1]), lng: parseFloat(match[2]) }
                            setRawCoords(coords)
                            checkRegionDistance(coords.lat, coords.lng)
                          }
                        }
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-background/50 border border-border/50 text-muted-foreground hover:text-foreground hover:border-border transition-all"
                    >
                      <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
                        <MapPin className="w-4 h-4" />
                      </div>
                      <div className="text-left">
                        <span className="text-xs font-medium block">Paste a Location Link</span>
                        <span className="text-[10px] opacity-50">Share from Google Maps</span>
                      </div>
                    </button>
                  </div>
                )}

                {showLocationUpdate && (
                  <button
                    onClick={() => { setShowLocationUpdate(false); clearLocation() }}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Cancel update
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Delivery Info Card */}
      <div className="rounded-xl bg-card border border-border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">Your Order</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowInvoice(!showInvoice)} className="text-xs text-primary hover:underline flex items-center gap-1">
              <FileText className="w-3 h-3" />
              {showInvoice ? 'Hide' : 'View'} {isDelivered ? 'Invoice' : 'Proforma'}
            </button>
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium capitalize">
              {delivery.status.replace('_', ' ')}
            </span>
          </div>
        </div>
        {delivery.products && (
          <div>
            <p className="text-xs text-muted-foreground">Products</p>
            <p className="text-sm font-medium text-foreground">{delivery.products}</p>
          </div>
        )}
        <div className="flex gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Qty</p>
            <p className="text-sm font-semibold text-foreground">{delivery.qty}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Amount</p>
            <p className="text-sm font-semibold text-foreground">Rs {delivery.amount.toLocaleString()}</p>
          </div>
          {delivery.locality && (
            <div>
              <p className="text-xs text-muted-foreground">Area</p>
              <p className="text-sm font-semibold text-foreground">{delivery.locality}</p>
            </div>
          )}
        </div>
        {delivery.delivery_notes && (
          <div className="pt-2 border-t border-border/50">
            <p className="text-xs text-amber-500">Note: {delivery.delivery_notes}</p>
          </div>
        )}
      </div>

      {/* Invoice (collapsible) */}
      {showInvoice && (
        <div className="rounded-xl bg-card border border-border p-4 space-y-3">
          {/* Company header */}
          {company && (
            <div className="text-center border-b border-border pb-3 space-y-0.5">
              <p className="text-sm font-bold text-foreground">{company.company_name}</p>
              {company.company_address && <p className="text-[10px] text-muted-foreground">{company.company_address}</p>}
              <div className="flex items-center justify-center gap-3 text-[10px] text-muted-foreground">
                {company.brn && <span>BRN: {company.brn}</span>}
                {company.vat_number && <span>VAT: {company.vat_number}</span>}
              </div>
              {company.phone && <p className="text-[10px] text-muted-foreground">Tel: {company.phone}</p>}
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-foreground uppercase">
              {isDelivered ? 'Invoice' : 'Proforma Invoice'}
            </span>
            <span className="text-[10px] text-muted-foreground">{new Date().toLocaleDateString()}</span>
          </div>

          <div className="text-xs text-muted-foreground">
            <p>Customer: <span className="text-foreground font-medium">{delivery.customer_name}</span></p>
            {delivery.locality && <p>Locality: <span className="text-foreground">{delivery.locality}</span></p>}
          </div>

          {/* Line items */}
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="grid grid-cols-12 gap-1 px-3 py-1.5 bg-muted/50 text-[10px] font-bold text-muted-foreground uppercase">
              <div className="col-span-6">Item</div>
              <div className="col-span-2 text-center">Qty</div>
              <div className="col-span-4 text-right">Amount</div>
            </div>
            <div className="grid grid-cols-12 gap-1 px-3 py-2 text-xs">
              <div className="col-span-6 text-foreground">{delivery.products || 'Delivery'}</div>
              <div className="col-span-2 text-center text-muted-foreground">{delivery.qty}</div>
              <div className="col-span-4 text-right text-foreground font-medium">Rs {totalInclVat.toLocaleString()}</div>
            </div>
          </div>

          {/* Totals */}
          <div className="space-y-1 pt-2 border-t border-border">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Subtotal (excl. VAT)</span>
              <span className="text-foreground">Rs {totalExclVat.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">VAT ({vatRate}%)</span>
              <span className="text-foreground">Rs {vatAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs pt-1 border-t border-border">
              <span className="text-muted-foreground">Total (incl. VAT)</span>
              <span className="text-foreground">Rs {totalInclVat.toLocaleString()}</span>
            </div>
            {isDelivered ? (
              <div className="flex justify-between items-center pt-2 mt-1 border-t-2 border-emerald-500/30 bg-emerald-500/5 -mx-4 px-4 py-2 rounded-b-lg">
                <span className="text-sm font-bold text-emerald-500 uppercase">Paid</span>
                <span className="text-lg font-black text-emerald-500">Rs {totalInclVat.toLocaleString()}</span>
              </div>
            ) : (
              <div className="flex justify-between items-center pt-2 mt-1 border-t-2 border-primary/30 bg-primary/5 -mx-4 px-4 py-2 rounded-b-lg">
                <span className="text-sm font-bold text-primary uppercase">Amount Due</span>
                <span className="text-lg font-black text-primary">Rs {totalInclVat.toLocaleString()}</span>
              </div>
            )}
          </div>

          <p className="text-[9px] text-muted-foreground/50 text-center">
            All prices are VAT inclusive.{!isDelivered && ' This is a proforma invoice and is not a tax invoice.'}
          </p>
        </div>
      )}

      {/* Existing reply */}
      {hasExistingReply && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3">
          <p className="text-xs text-emerald-500 font-medium mb-1">Your previous reply:</p>
          <p className="text-sm text-foreground">{delivery.client_response}</p>
        </div>
      )}

      {/* Reply Text - only before delivery */}
      {!isDelivered && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            {hasExistingReply ? 'Update Your Reply' : 'Your Reply'}
          </label>
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={hasExistingReply ? "Update your message to the rider..." : "Type your message... e.g. I will be home at 2pm, leave it at the gate..."}
            rows={3}
            className="w-full px-3 py-2.5 rounded-xl bg-muted border border-border text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
          />
        </div>
      )}



      {/* Error */}
      {error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* Submit - only before delivery */}
      {!isDelivered && (
        <button
          onClick={handleSubmit}
          disabled={submitting || (!reply.trim() && !locationUrl)}
          className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Sending...</span>
            </>
          ) : (
            <>
              <Send className="w-5 h-5" />
              <span>{hasExistingReply ? 'Update Reply' : 'Send Reply'}</span>
            </>
          )}
        </button>
      )}

      {/* Need Help section - only shown after delivery */}
      {['delivered', 'nwd', 'cms', 'cancelled', 'returned'].includes(delivery.status) && (
        <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <p className="text-xs font-medium text-foreground">Need help?</p>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Having an issue with your delivery? Request a callback or drop us a message. We usually get back to you in less than 2 hours.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <a
              href={company?.phone ? `tel:${company.phone}` : '#'}
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/20 transition-colors"
            >
              <Phone className="w-4 h-4" />
              <span className="text-xs font-medium">Request Call</span>
            </a>
            <a
              href={company?.phone ? `https://wa.me/${company.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(`Hi, I need help with my delivery (${delivery.customer_name} - ${delivery.locality}). Order ref: ${delivery.id}`)}` : '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-green-500/10 border border-green-500/30 text-green-500 hover:bg-green-500/20 transition-colors"
            >
              <MessageSquare className="w-4 h-4" />
              <span className="text-xs font-medium">Message Us</span>
            </a>
          </div>
        </div>
      )}

      <p className="text-center text-[10px] text-muted-foreground/50 pb-4">
        Powered by {company?.company_name || 'Juice Dash'}
      </p>

      {/* Fullscreen Map Overlay */}
      {locationMode === 'pin' && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black flex flex-col">
          {/* Top bar */}
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/80 via-black/50 to-transparent">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center shadow-[0_0_16px_rgba(6,182,212,0.3)]">
                <Crosshair className="w-4 h-4 text-cyan-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">Pin Your Location</p>
                <p className="text-[10px] text-white/50">{delivery.locality || 'Tap or drag the pin'}</p>
              </div>
            </div>
            <button
              onClick={clearLocation}
              className="w-9 h-9 rounded-full bg-white/10 backdrop-blur-sm border border-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>

          {/* Map fills screen */}
          <div ref={initMap} className="flex-1 w-full" />

          {/* Bottom confirm bar */}
          <div className="absolute bottom-0 left-0 right-0 z-10 p-4 bg-gradient-to-t from-black/90 via-black/60 to-transparent">
            {pinMoved ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-blue-500/10 border border-blue-500/20 backdrop-blur-sm">
                  <Navigation className="w-4 h-4 text-blue-400 shrink-0" />
                  <p className="text-[11px] text-blue-400 font-mono">{rawCoords?.lat.toFixed(6)}, {rawCoords?.lng.toFixed(6)}</p>
                </div>
                {outsideRegion && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 backdrop-blur-sm">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-amber-400">This location is outside {delivery.locality || 'your delivery area'}. The rider may call to confirm.</p>
                  </div>
                )}
                <button
                  onClick={() => setLocationMode('none')}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-blue-500 text-white font-semibold text-sm hover:bg-blue-600 transition-colors shadow-[0_4px_24px_rgba(59,130,246,0.35)]"
                >
                  <CheckCircle className="w-5 h-5" />
                  <span>Confirm This Location</span>
                </button>
              </div>
            ) : (
              <div className="space-y-2 text-center py-3">
                <div className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-white/10 backdrop-blur-sm border border-white/10 animate-pulse">
                  <span className="text-lg">👆</span>
                  <span className="text-sm font-medium text-white">Tap the map or drag the pin to your location</span>
                </div>
                <p className="text-[10px] text-white/30">Move the pin to exactly where you are in {delivery.locality || 'your area'}</p>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
