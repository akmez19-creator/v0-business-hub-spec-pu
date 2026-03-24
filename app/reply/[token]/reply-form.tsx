'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { submitClientReply } from '@/lib/delivery-actions'
import { MapPin, Send, CheckCircle, Package, Navigation, Loader2, FileText, Crosshair, AlertTriangle, Phone, MessageSquare, Clock, X, ChevronRight } from 'lucide-react'
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
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center space-y-6 max-w-sm">
          {/* Success Icon with 3D effect */}
          <div className="relative mx-auto w-24 h-24">
            <div className="absolute inset-0 rounded-full bg-emerald-500/20 blur-xl animate-pulse" />
            <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-[0_8px_32px_rgba(16,185,129,0.4),inset_0_2px_0_rgba(255,255,255,0.2)]">
              <CheckCircle className="w-12 h-12 text-white" />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-foreground">Reply Sent!</h1>
            <p className="text-muted-foreground">
              Thank you, <span className="text-foreground font-medium">{delivery.customer_name}</span>. Your delivery agent has been notified.
            </p>
          </div>
          {locationUrl && (
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
              <Navigation className="w-4 h-4" />
              <span>Location shared successfully</span>
            </div>
          )}
          {outsideRegion && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4">
              <p className="text-xs text-amber-400">Note: The location you shared appears to be outside your delivery area. The rider may call you to confirm.</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-card/30">
      <div className="max-w-md mx-auto px-4 py-8 space-y-6">
        
        {/* Header with 3D Logo */}
        <header className="text-center space-y-4">
          {/* 3D Package Icon */}
          <div className="relative mx-auto w-20 h-20">
            <div className="absolute inset-0 rounded-2xl bg-primary/20 blur-xl" />
            <div 
              className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/90 to-primary flex items-center justify-center shadow-[0_12px_40px_rgba(255,150,50,0.3),inset_0_2px_0_rgba(255,255,255,0.15)]"
              style={{ transform: 'perspective(500px) rotateX(5deg) rotateY(-5deg)' }}
            >
              <Package className="w-10 h-10 text-primary-foreground" />
            </div>
          </div>
          
          {company && (
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.2em]">
              {company.company_name}
            </p>
          )}
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-foreground">
              {isDelivered ? 'Delivery Complete' : 'Delivery Notification'}
            </h1>
            <p className="text-muted-foreground">
              Hi <span className="text-foreground font-semibold">{delivery.customer_name}</span>,
              {isDelivered
                ? ' your order has been delivered. Thank you!'
                : ' you have a delivery coming your way.'}
            </p>
          </div>
        </header>

        {/* Location Section - Modern Card with 3D depth */}
        {!isDelivered && (
          <section className="relative">
            {/* 3D Card Effect */}
            <div 
              className="relative rounded-3xl overflow-hidden"
              style={{ 
                transform: 'perspective(1000px) rotateX(1deg)',
                transformStyle: 'preserve-3d'
              }}
            >
              {/* Glow effect */}
              <div className="absolute -inset-px rounded-3xl bg-gradient-to-br from-accent/30 via-transparent to-primary/20 opacity-50" />
              
              {/* Main card */}
              <div className="relative bg-card/80 backdrop-blur-xl border border-border/50 rounded-3xl p-5 space-y-4">
                
                {/* Already has location */}
                {hasExistingReply && delivery.latitude && !showLocationUpdate ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-4 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg">
                        <CheckCircle className="w-6 h-6 text-white" />
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-emerald-400">Location Shared</p>
                        <p className="text-xs text-muted-foreground">Your location has been sent to the rider</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setShowLocationUpdate(true)}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-muted/50 border border-border text-muted-foreground hover:text-foreground hover:border-accent/30 transition-all"
                    >
                      <MapPin className="w-4 h-4" />
                      <span className="text-sm font-medium">Update Location</span>
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Header */}
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent/80 to-accent flex items-center justify-center shadow-[0_4px_20px_rgba(0,200,255,0.25)]">
                        <Navigation className="w-6 h-6 text-accent-foreground" />
                      </div>
                      <div>
                        <h2 className="font-bold text-foreground">
                          {showLocationUpdate ? 'Update Your Location' : 'Share Your Location'}
                        </h2>
                        <p className="text-xs text-muted-foreground">
                          {showLocationUpdate ? 'Pick a new location to update' : 'Help the driver find you faster'}
                        </p>
                      </div>
                    </div>

                    {/* Location captured */}
                    {locationUrl ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-3 p-4 rounded-2xl bg-accent/10 border border-accent/20">
                          <Navigation className="w-5 h-5 text-accent shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-accent">
                              Location {locationMode === 'gps' ? '(GPS)' : locationMode === 'pin' ? '(Pinned)' : '(Link)'}
                            </p>
                            <p className="text-[11px] text-muted-foreground truncate">{locationUrl}</p>
                          </div>
                          <button 
                            onClick={clearLocation} 
                            className="px-3 py-1.5 rounded-lg bg-background/80 border border-border text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Change
                          </button>
                        </div>
                        {outsideRegion && (
                          <div className="flex items-start gap-3 p-4 rounded-2xl bg-warning/10 border border-warning/30">
                            <AlertTriangle className="w-5 h-5 text-warning shrink-0" />
                            <div>
                              <p className="text-sm font-medium text-warning">Outside delivery area</p>
                              <p className="text-xs text-muted-foreground">
                                This location seems far from {delivery.locality || 'your area'}. The rider may call to confirm.
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                    ) : locationMode === 'pin' ? (
                      <div className="flex items-center gap-3 p-4 rounded-2xl bg-cyan-500/10 border border-cyan-500/20">
                        <Crosshair className="w-5 h-5 text-cyan-400 animate-pulse" />
                        <p className="flex-1 text-sm font-medium text-cyan-400">Pinning location on map...</p>
                        <button 
                          onClick={clearLocation} 
                          className="px-3 py-1.5 rounded-lg bg-background/80 border border-border text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Cancel
                        </button>
                      </div>

                    ) : (
                      /* Location Options - Clean 3D buttons */
                      <div className="space-y-3">
                        {/* GPS - Primary */}
                        <button
                          onClick={shareGPS}
                          disabled={gettingLocation}
                          className="group w-full flex items-center gap-4 p-4 rounded-2xl bg-gradient-to-r from-accent/10 to-accent/5 border border-accent/25 hover:border-accent/50 transition-all disabled:opacity-50"
                        >
                          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-accent to-cyan-600 flex items-center justify-center shadow-[0_4px_16px_rgba(0,200,255,0.3)] group-hover:shadow-[0_4px_24px_rgba(0,200,255,0.4)] transition-shadow">
                            {gettingLocation ? (
                              <Loader2 className="w-5 h-5 text-white animate-spin" />
                            ) : (
                              <Navigation className="w-5 h-5 text-white" />
                            )}
                          </div>
                          <div className="flex-1 text-left">
                            <p className="font-semibold text-accent">
                              {gettingLocation ? 'Getting location...' : 'Send Current Location'}
                            </p>
                            <p className="text-xs text-muted-foreground">Uses your GPS - most accurate</p>
                          </div>
                          <ChevronRight className="w-5 h-5 text-accent/50 group-hover:text-accent transition-colors" />
                        </button>

                        {/* Pin on Map */}
                        {mapboxToken && (
                          <button
                            onClick={() => setLocationMode('pin')}
                            className="group w-full flex items-center gap-4 p-4 rounded-2xl bg-gradient-to-r from-cyan-500/10 to-cyan-500/5 border border-cyan-500/25 hover:border-cyan-500/50 transition-all"
                          >
                            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-cyan-400 to-cyan-600 flex items-center justify-center shadow-[0_4px_16px_rgba(6,182,212,0.3)] group-hover:shadow-[0_4px_24px_rgba(6,182,212,0.4)] transition-shadow">
                              <Crosshair className="w-5 h-5 text-white" />
                            </div>
                            <div className="flex-1 text-left">
                              <p className="font-semibold text-cyan-400">Pin on Map</p>
                              <p className="text-xs text-muted-foreground">Tap to place a pin on the map</p>
                            </div>
                            <ChevronRight className="w-5 h-5 text-cyan-400/50 group-hover:text-cyan-400 transition-colors" />
                          </button>
                        )}

                        {/* Paste Link */}
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
                          className="group w-full flex items-center gap-4 p-4 rounded-2xl bg-muted/30 border border-border/50 hover:border-border transition-all"
                        >
                          <div className="w-11 h-11 rounded-xl bg-muted flex items-center justify-center">
                            <MapPin className="w-5 h-5 text-muted-foreground" />
                          </div>
                          <div className="flex-1 text-left">
                            <p className="font-medium text-foreground">Paste a Location Link</p>
                            <p className="text-xs text-muted-foreground">Share from Google Maps</p>
                          </div>
                          <ChevronRight className="w-5 h-5 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
                        </button>
                      </div>
                    )}

                    {showLocationUpdate && (
                      <button
                        onClick={() => { setShowLocationUpdate(false); clearLocation() }}
                        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel update
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Order Details Card */}
        <section 
          className="relative rounded-2xl overflow-hidden"
          style={{ transform: 'perspective(1000px) rotateX(0.5deg)' }}
        >
          <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Your Order</span>
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setShowInvoice(!showInvoice)} 
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
                >
                  <FileText className="w-3.5 h-3.5" />
                  {showInvoice ? 'Hide' : 'View'} {isDelivered ? 'Invoice' : 'Proforma'}
                </button>
                <span className="px-3 py-1.5 rounded-lg bg-success/10 text-success text-xs font-semibold capitalize">
                  {delivery.status.replace('_', ' ')}
                </span>
              </div>
            </div>

            {/* Products */}
            {delivery.products && (
              <div className="p-4 rounded-xl bg-muted/30 border border-border/50">
                <p className="text-xs text-muted-foreground mb-1">Products</p>
                <p className="font-semibold text-foreground">{delivery.products}</p>
              </div>
            )}

            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-muted/30 border border-border/50 text-center">
                <p className="text-xs text-muted-foreground mb-1">Qty</p>
                <p className="text-lg font-bold text-foreground">{delivery.qty}</p>
              </div>
              <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 text-center">
                <p className="text-xs text-muted-foreground mb-1">Amount</p>
                <p className="text-lg font-bold text-primary">Rs {delivery.amount.toLocaleString()}</p>
              </div>
              {delivery.locality && (
                <div className="p-3 rounded-xl bg-muted/30 border border-border/50 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Area</p>
                  <p className="text-sm font-semibold text-foreground truncate">{delivery.locality}</p>
                </div>
              )}
            </div>

            {/* Notes */}
            {delivery.delivery_notes && (
              <div className="p-3 rounded-xl bg-warning/5 border border-warning/20">
                <p className="text-sm text-warning flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  {delivery.delivery_notes}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Invoice (collapsible) */}
        {showInvoice && (
          <section className="rounded-2xl bg-card border border-border p-5 space-y-4 animate-fadeIn">
            {/* Company header */}
            {company && (
              <div className="text-center border-b border-border pb-4 space-y-1">
                <p className="font-bold text-foreground">{company.company_name}</p>
                {company.company_address && <p className="text-xs text-muted-foreground">{company.company_address}</p>}
                <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
                  {company.brn && <span>BRN: {company.brn}</span>}
                  {company.vat_number && <span>VAT: {company.vat_number}</span>}
                </div>
                {company.phone && <p className="text-xs text-muted-foreground">Tel: {company.phone}</p>}
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-foreground uppercase">
                {isDelivered ? 'Invoice' : 'Proforma Invoice'}
              </span>
              <span className="text-xs text-muted-foreground">{new Date().toLocaleDateString()}</span>
            </div>

            <div className="text-sm text-muted-foreground">
              <p>Customer: <span className="text-foreground font-medium">{delivery.customer_name}</span></p>
              {delivery.locality && <p>Locality: <span className="text-foreground">{delivery.locality}</span></p>}
            </div>

            {/* Line items */}
            <div className="border border-border rounded-xl overflow-hidden">
              <div className="grid grid-cols-12 gap-1 px-4 py-2 bg-muted/50 text-xs font-bold text-muted-foreground uppercase">
                <div className="col-span-6">Item</div>
                <div className="col-span-2 text-center">Qty</div>
                <div className="col-span-4 text-right">Amount</div>
              </div>
              <div className="grid grid-cols-12 gap-1 px-4 py-3 text-sm">
                <div className="col-span-6 text-foreground">{delivery.products || 'Delivery'}</div>
                <div className="col-span-2 text-center text-muted-foreground">{delivery.qty}</div>
                <div className="col-span-4 text-right text-foreground font-medium">Rs {totalInclVat.toLocaleString()}</div>
              </div>
            </div>

            {/* Totals */}
            <div className="space-y-2 pt-3 border-t border-border">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal (excl. VAT)</span>
                <span className="text-foreground">Rs {totalExclVat.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">VAT ({vatRate}%)</span>
                <span className="text-foreground">Rs {vatAmount.toFixed(2)}</span>
              </div>
              {isDelivered ? (
                <div className="flex justify-between items-center pt-3 mt-2 border-t-2 border-success/30 bg-success/5 -mx-5 px-5 py-3 rounded-b-xl">
                  <span className="text-sm font-bold text-success uppercase">Paid</span>
                  <span className="text-xl font-black text-success">Rs {totalInclVat.toLocaleString()}</span>
                </div>
              ) : (
                <div className="flex justify-between items-center pt-3 mt-2 border-t-2 border-primary/30 bg-primary/5 -mx-5 px-5 py-3 rounded-b-xl">
                  <span className="text-sm font-bold text-primary uppercase">Amount Due</span>
                  <span className="text-xl font-black text-primary">Rs {totalInclVat.toLocaleString()}</span>
                </div>
              )}
            </div>

            <p className="text-[10px] text-muted-foreground/60 text-center">
              All prices are VAT inclusive.{!isDelivered && ' This is a proforma invoice and is not a tax invoice.'}
            </p>
          </section>
        )}

        {/* Existing reply */}
        {hasExistingReply && (
          <section className="rounded-2xl bg-success/5 border border-success/20 p-4">
            <p className="text-xs text-success font-semibold mb-2">Your previous reply:</p>
            <p className="text-sm text-foreground">{delivery.client_response}</p>
          </section>
        )}

        {/* Reply Text - only before delivery */}
        {!isDelivered && (
          <section className="space-y-3">
            <label className="text-sm font-semibold text-foreground">
              {hasExistingReply ? 'Update Your Reply' : 'Your Reply'}
            </label>
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={hasExistingReply ? "Update your message to the rider..." : "Type your message... e.g. I will be home at 2pm, leave it at the gate..."}
              rows={3}
              className="w-full px-4 py-3 rounded-2xl bg-muted/50 border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50 resize-none transition-all"
            />
          </section>
        )}

        {/* Error */}
        {error && (
          <div className="p-4 rounded-2xl bg-destructive/10 border border-destructive/20">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* Submit - only before delivery */}
        {!isDelivered && (
          <button
            onClick={handleSubmit}
            disabled={submitting || (!reply.trim() && !locationUrl)}
            className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl bg-gradient-to-r from-primary to-primary/80 text-primary-foreground font-semibold hover:shadow-[0_8px_32px_rgba(255,150,50,0.35)] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
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
          <section className="rounded-2xl bg-muted/30 border border-border p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                <Clock className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Need help?</p>
                <p className="text-xs text-muted-foreground">We usually respond in less than 2 hours</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <a
                href={company?.phone ? `tel:${company.phone}` : '#'}
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/20 transition-colors"
              >
                <Phone className="w-4 h-4" />
                <span className="text-sm font-medium">Call Us</span>
              </a>
              <a
                href={company?.phone ? `https://wa.me/${company.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(`Hi, I need help with my delivery (${delivery.customer_name} - ${delivery.locality}). Order ref: ${delivery.id}`)}` : '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-green-500/10 border border-green-500/30 text-green-500 hover:bg-green-500/20 transition-colors"
              >
                <MessageSquare className="w-4 h-4" />
                <span className="text-sm font-medium">WhatsApp</span>
              </a>
            </div>
          </section>
        )}

        {/* Footer */}
        <footer className="text-center pb-6">
          <p className="text-xs text-muted-foreground/50">
            Powered by {company?.company_name || 'Juice Dash'}
          </p>
        </footer>
      </div>

      {/* Fullscreen Map Overlay */}
      {locationMode === 'pin' && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black flex flex-col">
          {/* Top bar */}
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-4 bg-gradient-to-b from-black/90 via-black/60 to-transparent">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/20 flex items-center justify-center shadow-[0_0_20px_rgba(6,182,212,0.4)]">
                <Crosshair className="w-5 h-5 text-cyan-400" />
              </div>
              <div>
                <p className="font-bold text-white">Pin Your Location</p>
                <p className="text-xs text-white/50">{delivery.locality || 'Tap or drag the pin'}</p>
              </div>
            </div>
            <button
              onClick={clearLocation}
              className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-sm border border-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          </div>

          {/* Map fills screen */}
          <div ref={initMap} className="flex-1 w-full" />

          {/* Bottom confirm bar */}
          <div className="absolute bottom-0 left-0 right-0 z-10 p-5 bg-gradient-to-t from-black/95 via-black/70 to-transparent">
            {pinMoved ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-accent/10 border border-accent/20 backdrop-blur-sm">
                  <Navigation className="w-5 h-5 text-accent shrink-0" />
                  <p className="text-sm text-accent font-mono">{rawCoords?.lat.toFixed(6)}, {rawCoords?.lng.toFixed(6)}</p>
                </div>
                {outsideRegion && (
                  <div className="flex items-start gap-3 px-4 py-3 rounded-2xl bg-warning/10 border border-warning/30 backdrop-blur-sm">
                    <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
                    <p className="text-xs text-warning">This location is outside {delivery.locality || 'your delivery area'}. The rider may call to confirm.</p>
                  </div>
                )}
                <button
                  onClick={() => setLocationMode('none')}
                  className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl bg-gradient-to-r from-accent to-cyan-600 text-white font-semibold hover:shadow-[0_8px_32px_rgba(0,200,255,0.4)] transition-all"
                >
                  <CheckCircle className="w-5 h-5" />
                  <span>Confirm This Location</span>
                </button>
              </div>
            ) : (
              <div className="space-y-3 text-center py-4">
                <div className="inline-flex items-center gap-3 px-5 py-3 rounded-full bg-white/10 backdrop-blur-sm border border-white/10">
                  <span className="text-xl">👆</span>
                  <span className="font-medium text-white">Tap the map or drag the pin</span>
                </div>
                <p className="text-xs text-white/40">Move the pin to exactly where you are in {delivery.locality || 'your area'}</p>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
