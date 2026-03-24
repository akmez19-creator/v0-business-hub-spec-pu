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
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null)
  const [showGpsConfirm, setShowGpsConfirm] = useState(false)
  const [pendingGpsCoords, setPendingGpsCoords] = useState<{ lat: number; lng: number } | null>(null)

  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const markerRef = useRef<any>(null)

  const hasExistingReply = !!delivery.client_response
  // Status meanings:
  // - delivered: Successfully completed delivery
  // - nwd: Next Working Day - client requested reschedule, NOT delivered
  // - cms: Customer Service Center - client needs CS attention, NOT delivered
  const normalizedStatus = delivery.status?.toLowerCase()
  const isDelivered = normalizedStatus === 'delivered'
  const isNWD = normalizedStatus === 'nwd'
  const isCMS = normalizedStatus === 'cms'
  const isFailed = isNWD || isCMS

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

    // Use watchPosition to get progressively more accurate readings
    let bestAccuracy = Infinity
    let bestPosition: { lat: number; lng: number } | null = null
    let attempts = 0
    const maxAttempts = 5
    
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        attempts++
        const { latitude, longitude, accuracy } = position.coords
        
        // Keep the most accurate reading
        if (accuracy < bestAccuracy) {
          bestAccuracy = accuracy
          bestPosition = { lat: latitude, lng: longitude }
        }
        
        // If we have good accuracy (under 15m) or max attempts, use it
        if (accuracy <= 15 || attempts >= maxAttempts) {
          navigator.geolocation.clearWatch(watchId)
          
          if (bestPosition) {
            // Always show confirmation step with accuracy
            setPendingGpsCoords(bestPosition)
            setGpsAccuracy(Math.round(bestAccuracy))
            setShowGpsConfirm(true)
          }
          setGettingLocation(false)
        }
      },
      (err) => {
        navigator.geolocation.clearWatch(watchId)
        setGettingLocation(false)
        setLocationMode('none')
        if (err.code === 1) {
          setError('Location access denied. Please enable location in your browser settings.')
        } else {
          setError('Could not get your location. Please try again or pin on map.')
        }
      },
      { 
        enableHighAccuracy: true, 
        timeout: 20000, 
        maximumAge: 0 // Force fresh location, no cache
      }
    )
    
    // Timeout fallback - use best position we got after 15 seconds
    setTimeout(() => {
      if (bestPosition && gettingLocation) {
        navigator.geolocation.clearWatch(watchId)
        setPendingGpsCoords(bestPosition)
        setGpsAccuracy(Math.round(bestAccuracy))
        setShowGpsConfirm(true)
        setGettingLocation(false)
      }
    }, 15000)
  }
  
  // Confirm GPS location
  function confirmGpsLocation() {
    if (pendingGpsCoords) {
      const url = `https://www.google.com/maps?q=${pendingGpsCoords.lat},${pendingGpsCoords.lng}`
      setLocationUrl(url)
      setRawCoords(pendingGpsCoords)
      checkRegionDistance(pendingGpsCoords.lat, pendingGpsCoords.lng)
    }
    setShowGpsConfirm(false)
    setPendingGpsCoords(null)
    setGpsAccuracy(null)
  }
  
  // Switch from GPS to Map Pin
  function switchToMapPin() {
    setShowGpsConfirm(false)
    setPendingGpsCoords(null)
    setGpsAccuracy(null)
    setLocationMode('pin')
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

  // GPS Confirmation Modal with accuracy circle
  const GpsConfirmModal = () => {
    if (!showGpsConfirm || !pendingGpsCoords) return null
    
    const isAccurate = (gpsAccuracy || 0) <= 20
    const accuracyColor = isAccurate ? 'emerald' : (gpsAccuracy || 0) <= 50 ? 'amber' : 'red'
    
    return createPortal(
      <div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-2xl w-full max-w-sm overflow-hidden">
          {/* Map with accuracy circle */}
          <div className="relative h-48 bg-muted">
            <div 
              ref={(node) => {
                if (!node || !mapboxToken) return
                // Check if map already exists
                if (node.querySelector('canvas')) return
                
                import('mapbox-gl').then(mapboxgl => {
                  mapboxgl.default.accessToken = mapboxToken
                  const map = new mapboxgl.default.Map({
                    container: node,
                    style: 'mapbox://styles/mapbox/dark-v11',
                    center: [pendingGpsCoords.lng, pendingGpsCoords.lat],
                    zoom: 17,
                    interactive: false
                  })
                  
                  map.on('load', () => {
                    // Add accuracy circle
                    map.addSource('accuracy', {
                      type: 'geojson',
                      data: {
                        type: 'Feature',
                        properties: {},
                        geometry: {
                          type: 'Point',
                          coordinates: [pendingGpsCoords.lng, pendingGpsCoords.lat]
                        }
                      }
                    })
                    
                    // Circle layer showing accuracy radius
                    map.addLayer({
                      id: 'accuracy-circle',
                      type: 'circle',
                      source: 'accuracy',
                      paint: {
                        'circle-radius': {
                          stops: [[0, 0], [20, (gpsAccuracy || 20) * 2]]
                        },
                        'circle-color': accuracyColor === 'emerald' ? '#10b981' : accuracyColor === 'amber' ? '#f59e0b' : '#ef4444',
                        'circle-opacity': 0.2,
                        'circle-stroke-width': 2,
                        'circle-stroke-color': accuracyColor === 'emerald' ? '#10b981' : accuracyColor === 'amber' ? '#f59e0b' : '#ef4444'
                      }
                    })
                    
                    // Center point
                    map.addLayer({
                      id: 'center-point',
                      type: 'circle',
                      source: 'accuracy',
                      paint: {
                        'circle-radius': 8,
                        'circle-color': '#3b82f6',
                        'circle-stroke-width': 3,
                        'circle-stroke-color': '#ffffff'
                      }
                    })
                  })
                })
              }}
              className="w-full h-full"
            />
            {/* Accuracy badge */}
            <div className={`absolute top-2 left-2 px-2 py-1 rounded-lg text-xs font-bold ${
              accuracyColor === 'emerald' ? 'bg-emerald-500/90 text-white' : 
              accuracyColor === 'amber' ? 'bg-amber-500/90 text-white' : 
              'bg-red-500/90 text-white'
            }`}>
              ~{gpsAccuracy}m accuracy
            </div>
          </div>
          
          {/* Content */}
          <div className="p-4 space-y-3">
            <div className="text-center">
              <h3 className="font-bold text-foreground">
                {isAccurate ? 'Location looks good!' : 'Location may be inaccurate'}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                {isAccurate 
                  ? 'Your GPS location is accurate. Confirm to use this location.'
                  : `GPS accuracy is ~${gpsAccuracy}m. For indoor locations, try "Map Pin" instead.`}
              </p>
            </div>
            
            {/* Buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={switchToMapPin}
                className="flex flex-col items-center gap-1 p-3 rounded-xl bg-muted border border-border hover:border-primary/50 transition-all"
              >
                <Crosshair className="w-5 h-5 text-primary" />
                <span className="text-xs font-medium">Use Map Pin</span>
                <span className="text-[10px] text-muted-foreground">More precise</span>
              </button>
              <button
                onClick={confirmGpsLocation}
                className={`flex flex-col items-center gap-1 p-3 rounded-xl border transition-all ${
                  isAccurate 
                    ? 'bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-500/50' 
                    : 'bg-amber-500/10 border-amber-500/30 hover:border-amber-500/50'
                }`}
              >
                <CheckCircle className={`w-5 h-5 ${isAccurate ? 'text-emerald-500' : 'text-amber-500'}`} />
                <span className="text-xs font-medium">Use This</span>
                <span className="text-[10px] text-muted-foreground">{isAccurate ? 'Recommended' : 'Accept anyway'}</span>
              </button>
            </div>
            
            {/* Cancel */}
            <button
              onClick={() => { setShowGpsConfirm(false); setPendingGpsCoords(null); setLocationMode('none') }}
              className="w-full text-xs text-muted-foreground hover:text-foreground py-2"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>,
      document.body
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-card/30">
      <GpsConfirmModal />
      <div className="max-w-md mx-auto px-3 py-4 space-y-3">
        
        {/* Compact Header */}
        <header className="flex items-center gap-3 p-3 rounded-2xl bg-card/50 border border-border/50">
          {/* Small 3D Package Icon */}
          <div className="relative shrink-0">
            <div className="absolute inset-0 rounded-xl bg-primary/20 blur-lg" />
            <div 
              className="relative w-12 h-12 rounded-xl bg-gradient-to-br from-primary/90 to-primary flex items-center justify-center shadow-[0_6px_20px_rgba(255,150,50,0.3)]"
              style={{ transform: 'perspective(500px) rotateX(3deg) rotateY(-3deg)' }}
            >
              <Package className="w-6 h-6 text-primary-foreground" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            {company && (
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider truncate">
                {company.company_name}
              </p>
            )}
            <h1 className="text-base font-bold text-foreground leading-tight">
              {isDelivered ? 'Delivered' : 
               isNWD ? 'Rescheduled (NWD)' : 
               isCMS ? 'Customer Service' : 
               'Delivery'}
            </h1>
            <p className="text-xs text-muted-foreground truncate">
              Hi <span className="text-foreground font-medium">{delivery.customer_name}</span>
              {isDelivered ? ' - Thank you!' : isNWD ? ' - Next working day' : isCMS ? ' - We\'ll contact you' : ''}
            </p>
          </div>
        </header>

        {/* Compact Status Banners */}
        {isNWD && (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4 text-white" />
            </div>
            <p className="text-xs text-amber-500"><span className="font-semibold">NWD:</span> Delivery rescheduled. Update location below.</p>
          </div>
        )}

        {isCMS && (
          <div className="flex items-center gap-3 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center shrink-0">
              <Phone className="w-4 h-4 text-white" />
            </div>
            <p className="text-xs text-blue-500"><span className="font-semibold">CMS:</span> Customer service will contact you.</p>
          </div>
        )}

        {/* Compact Location Section */}
        {(!isDelivered || isFailed) && (
          <section className="bg-card/80 border border-border/50 rounded-xl p-3 space-y-2">
            {/* Already has location */}
            {hasExistingReply && delivery.latitude && !showLocationUpdate ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center">
                    <CheckCircle className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-emerald-400">Location Shared</p>
                  </div>
                  <button
                    onClick={() => setShowLocationUpdate(true)}
                    className="px-3 py-1.5 rounded-lg bg-muted/50 border border-border text-xs text-muted-foreground hover:text-foreground transition-all"
                  >
                    Update
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Compact Header */}
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent/80 to-accent flex items-center justify-center">
                    <Navigation className="w-4 h-4 text-accent-foreground" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    {showLocationUpdate ? 'Update Location' : 'Share Location'}
                  </p>
                </div>

                {/* Location captured */}
                {locationUrl ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 p-2 rounded-lg bg-accent/10 border border-accent/20">
                      <Navigation className="w-4 h-4 text-accent shrink-0" />
                      <p className="flex-1 text-xs text-accent truncate">
                        {locationMode === 'gps' ? 'GPS' : locationMode === 'pin' ? 'Pinned' : 'Link'}
                      </p>
                      <button onClick={clearLocation} className="px-2 py-1 rounded bg-background/80 text-[10px] text-muted-foreground">
                        Change
                      </button>
                    </div>
                    {outsideRegion && (
                      <div className="flex items-center gap-2 p-2 rounded-lg bg-warning/10 border border-warning/30">
                        <AlertTriangle className="w-3 h-3 text-warning shrink-0" />
                        <p className="text-[10px] text-warning">Outside delivery area - rider may call</p>
                      </div>
                    )}
                  </div>

                ) : locationMode === 'pin' ? (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
                    <Crosshair className="w-4 h-4 text-cyan-400 animate-pulse" />
                    <p className="flex-1 text-xs text-cyan-400">Pinning on map...</p>
                    <button onClick={clearLocation} className="px-2 py-1 rounded bg-background/80 text-[10px] text-muted-foreground">
                      Cancel
                    </button>
                  </div>

                ) : (
                  /* Location Options: GPS first (recommended), Map Pin second, Paste third */
                  <div className="grid grid-cols-3 gap-2">
                    {/* GPS - PRIMARY (client is usually at delivery location) */}
                    <button
                      onClick={shareGPS}
                      disabled={gettingLocation}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-primary/10 border-2 border-primary/40 hover:border-primary/60 transition-all disabled:opacity-50 relative"
                    >
                      <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-primary text-[7px] font-bold text-primary-foreground whitespace-nowrap">Recommended</div>
                      <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary to-orange-600 flex items-center justify-center">
                        {gettingLocation ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Navigation className="w-4 h-4 text-white" />}
                      </div>
                      <span className="text-[10px] font-medium text-primary">Current</span>
                    </button>

                    {/* Map Pin - for when client is NOT at current location */}
                    {mapboxToken && (
                      <button
                        onClick={() => setLocationMode('pin')}
                        className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-accent/10 border border-accent/25 hover:border-accent/50 transition-all"
                      >
                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-accent to-cyan-600 flex items-center justify-center">
                          <Crosshair className="w-4 h-4 text-white" />
                        </div>
                        <span className="text-[10px] font-medium text-accent">Pin Map</span>
                      </button>
                    )}

                    {/* Paste - shared Google Maps link */}
                    <button
                      onClick={() => {
                        const url = prompt('Paste shared Google Maps link:')
                        if (url?.trim()) {
                          setLocationUrl(url.trim())
                          setLocationMode('manual')
                          const match = url.match(/[?&@]q?=?(-?\d+\.?\d*),(-?\d+\.?\d*)/) || url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/)
                          if (match) {
                            const coords = { lat: parseFloat(match[1]), lng: parseFloat(match[2]) }
                            setRawCoords(coords)
                            checkRegionDistance(coords.lat, coords.lng)
                          }
                        }
                      }}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-muted/30 border border-border/50 hover:border-border transition-all"
                    >
                      <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center">
                        <MapPin className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <span className="text-[10px] font-medium text-muted-foreground">Paste</span>
                    </button>
                  </div>
                )}

                {showLocationUpdate && (
                  <button onClick={() => { setShowLocationUpdate(false); clearLocation() }} className="text-xs text-muted-foreground">
                    Cancel
                  </button>
                )}
              </>
            )}
          </section>
        )}

        {/* Order Details Card - Clear product display */}
        <section className="bg-card border border-border rounded-xl overflow-hidden">
          {/* Header with status */}
          <div className="flex items-center justify-between px-4 py-2 bg-muted/30 border-b border-border">
            <span className="text-xs font-semibold text-foreground uppercase tracking-wide">Your Order</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
              isDelivered ? 'bg-success/20 text-success' :
              isNWD ? 'bg-amber-500/20 text-amber-500' :
              isCMS ? 'bg-blue-500/20 text-blue-500' :
              'bg-primary/20 text-primary'
            }`}>
              {isDelivered ? 'Delivered' : isNWD ? 'Next Working Day' : isCMS ? 'Customer Service' : delivery.status.replace('_', ' ')}
            </span>
          </div>
          
          {/* Product details */}
          <div className="p-4 space-y-3">
            {/* Product name - prominent */}
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Products</p>
              <p className="text-sm font-semibold text-foreground">{delivery.products || 'Delivery'}</p>
            </div>
            
            {/* Stats row */}
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 rounded-lg bg-muted/30 text-center">
                <p className="text-[10px] text-muted-foreground">Qty</p>
                <p className="text-sm font-bold text-foreground">{delivery.qty}</p>
              </div>
              <div className="p-2 rounded-lg bg-primary/10 text-center">
                <p className="text-[10px] text-muted-foreground">Amount</p>
                <p className="text-sm font-bold text-primary">Rs {delivery.amount.toLocaleString()}</p>
              </div>
              <div className="p-2 rounded-lg bg-muted/30 text-center">
                <p className="text-[10px] text-muted-foreground">Area</p>
                <p className="text-xs font-semibold text-foreground truncate">{delivery.locality || '-'}</p>
              </div>
            </div>
            
            {/* Notes */}
            {delivery.delivery_notes && (
              <div className="flex items-start gap-2 p-2 rounded-lg bg-warning/10 border border-warning/20">
                <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
                <p className="text-xs text-warning">{delivery.delivery_notes}</p>
              </div>
            )}
            
            {/* View Invoice/Proforma button */}
            <button 
              onClick={() => setShowInvoice(!showInvoice)} 
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-muted/50 border border-border text-foreground text-xs font-medium hover:bg-muted transition-colors"
            >
              <FileText className="w-4 h-4" />
              {showInvoice ? 'Hide' : 'View'} {isDelivered ? 'Invoice / Receipt' : 'Proforma Invoice'}
            </button>
          </div>
        </section>

        {/* Invoice / Receipt - Full details */}
        {showInvoice && (
          <section className="rounded-xl bg-card border border-border overflow-hidden">
            {/* Company header */}
            {company && (
              <div className="text-center p-4 bg-muted/20 border-b border-border">
                <p className="font-bold text-foreground">{company.company_name}</p>
                {company.company_address && <p className="text-xs text-muted-foreground mt-0.5">{company.company_address}</p>}
                <div className="flex items-center justify-center gap-3 mt-1 text-[10px] text-muted-foreground">
                  {company.brn && <span>BRN: {company.brn}</span>}
                  {company.vat_number && <span>VAT: {company.vat_number}</span>}
                </div>
                {company.phone && <p className="text-xs text-muted-foreground mt-0.5">Tel: {company.phone}</p>}
              </div>
            )}
            
            <div className="p-4 space-y-3">
              {/* Document type and date */}
              <div className="flex justify-between items-center pb-2 border-b border-border">
                <span className="text-sm font-bold text-foreground uppercase">{isDelivered ? 'Invoice' : 'Proforma Invoice'}</span>
                <span className="text-xs text-muted-foreground">{new Date().toLocaleDateString()}</span>
              </div>

              {/* Customer info */}
              <div className="text-xs space-y-1">
                <p className="text-muted-foreground">Customer: <span className="text-foreground font-medium">{delivery.customer_name}</span></p>
                {delivery.locality && <p className="text-muted-foreground">Locality: <span className="text-foreground">{delivery.locality}</span></p>}
              </div>

              {/* Line items table */}
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="grid grid-cols-12 gap-1 px-3 py-2 bg-muted/50 text-[10px] font-bold text-muted-foreground uppercase">
                  <div className="col-span-6">Item</div>
                  <div className="col-span-2 text-center">Qty</div>
                  <div className="col-span-4 text-right">Amount</div>
                </div>
                <div className="grid grid-cols-12 gap-1 px-3 py-3 text-sm">
                  <div className="col-span-6 text-foreground">{delivery.products || 'Delivery'}</div>
                  <div className="col-span-2 text-center text-muted-foreground">{delivery.qty}</div>
                  <div className="col-span-4 text-right text-foreground font-medium">Rs {totalInclVat.toLocaleString()}</div>
                </div>
              </div>

              {/* Totals */}
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal (excl. VAT)</span>
                  <span className="text-foreground">Rs {totalExclVat.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">VAT ({vatRate}%)</span>
                  <span className="text-foreground">Rs {vatAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total (incl. VAT)</span>
                  <span className="text-foreground font-medium">Rs {totalInclVat.toLocaleString()}</span>
                </div>
              </div>
              
              {/* Payment status */}
              <div className={`flex justify-between items-center p-3 rounded-lg ${isDelivered ? 'bg-success/10 border border-success/20' : 'bg-primary/10 border border-primary/20'}`}>
                <span className={`text-sm font-bold uppercase ${isDelivered ? 'text-success' : 'text-primary'}`}>
                  {isDelivered ? 'Paid' : 'Amount Due'}
                </span>
                <span className={`text-lg font-black ${isDelivered ? 'text-success' : 'text-primary'}`}>
                  Rs {totalInclVat.toLocaleString()}
                </span>
              </div>
              
              {/* Footer note */}
              <p className="text-[10px] text-muted-foreground text-center">
                All prices are VAT inclusive.{!isDelivered && ' This is a proforma invoice.'}
              </p>
            </div>
          </section>
        )}

        {/* Existing reply */}
        {hasExistingReply && (
          <div className="flex items-start gap-2 p-2 rounded-lg bg-success/5 border border-success/20">
            <CheckCircle className="w-3 h-3 text-success shrink-0 mt-0.5" />
            <p className="text-[10px] text-foreground">{delivery.client_response}</p>
          </div>
        )}

        {/* Reply Text */}
        {(!isDelivered || isFailed) && (
          <div className="space-y-2">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              placeholder={hasExistingReply ? "Update message..." : "Message to rider..."}
              rows={2}
              className="w-full px-3 py-2 rounded-xl bg-muted/50 border border-border text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
            />
            {error && <p className="text-[10px] text-destructive">{error}</p>}
            <button
              onClick={handleSubmit}
              disabled={submitting || (!reply.trim() && !locationUrl)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-primary to-primary/80 text-primary-foreground text-sm font-semibold disabled:opacity-50"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span>{hasExistingReply ? 'Update' : 'Send'}</span>
            </button>
          </div>
        )}

        {/* Compact Help section */}
        {['delivered', 'nwd', 'cms', 'cancelled', 'returned'].includes(normalizedStatus || '') && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground">Need help?</span>
            <a href={company?.phone ? `tel:${company.phone}` : '#'} className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-500/10 text-emerald-500 text-[10px]">
              <Phone className="w-3 h-3" /> Call
            </a>
            <a
              href={company?.phone ? `https://wa.me/${company.phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(`Help: ${delivery.customer_name} - ${delivery.id}`)}` : '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-2 py-1 rounded bg-green-500/10 text-green-500 text-[10px]"
            >
              <MessageSquare className="w-3 h-3" /> WhatsApp
            </a>
          </div>
        )}

        {/* Footer */}
        <footer className="text-center py-2">
          <p className="text-[10px] text-muted-foreground/50">{company?.company_name || 'Juice Dash'}</p>
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
