'use client'
// DeliveryMap v2.1 — No weather effects, no neon animations. Clean Mapbox-native route display.
// Dusk lighting, styled DOM driver marker, GeoJSON pins.
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import {
  Navigation, Phone, X, Locate, Clock, MapPin, Users,
  ChevronDown, List, Search, ArrowRight, ArrowLeft,
  Mail, Smartphone, Banknote, CreditCard, Check, Ban, Crosshair,
  Moon, Sun, ExternalLink, Send, Package, TrendingUp, Maximize2, Minimize2, GripVertical, Link2, ClipboardCopy, RotateCcw,
  Camera, Loader2, ImageIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { generateReplyTokens, updateDeliveryStatusBulk, updateDeliveryLocation, uploadPaymentProof } from '@/lib/delivery-actions'
import { ModifyOrderSheet } from './modify-order-sheet'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// ── Helpers ──
function formatPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '')
  if (cleaned.startsWith('230')) return `+${cleaned}`
  if (cleaned.length === 7 || cleaned.length === 8) return `+230${cleaned}`
  return phone
}

// Parse comma-separated products string into items array
// "2x Mini Cooker, 1x Aluminium Tape" -> [{ name: "Mini Cooker", qty: 2, amount: X }, ...]
function parseProductsToItems(products: string | null, totalAmount: number): { name: string; qty: number; amount: number }[] {
  if (!products) return []
  const parts = products.split(',').map(s => s.trim()).filter(Boolean)
  const items: { name: string; qty: number; amount: number }[] = []
  const totalQty = parts.reduce((sum, p) => {
    const m = p.match(/^(\d+)\s*x\s*/i)
    return sum + (m ? parseInt(m[1], 10) : 1)
  }, 0) || 1
  for (const part of parts) {
    const match = part.match(/^(\d+)\s*x\s*(.+)$/i)
    if (match) {
      const qty = parseInt(match[1], 10)
      items.push({ name: match[2].trim(), qty, amount: Math.round((totalAmount / totalQty) * qty * 100) / 100 })
    } else {
      items.push({ name: part, qty: 1, amount: Math.round(totalAmount / totalQty * 100) / 100 })
    }
  }
  return items
}

// ── Types ──
export interface DeliveryPin {
  id: string
  itemIds: string[]
  customerName: string
  contact1: string | null
  locality: string | null
  products: string | null
  qty: number
  amount: number
  status: string
  lat: number
  lng: number
  source: 'gps' | 'response' | 'geocoded'
  riderId?: string | null
  riderName?: string | null
  deliveryNotes?: string | null
  clientResponse?: string | null
  locationFlagged?: boolean
  locationSource?: string | null
  isModified?: boolean
  modificationCount?: number
  items?: { name: string; qty: number; amount: number }[]
  salesType?: string | null
  returnProduct?: string | null
}

export interface RegionCluster {
  locality: string
  lat: number
  lng: number
  count: number
  deliveries: DeliveryPin[]
  statuses: Record<string, number>
}

export interface DeliveryRegionGroup {
  region: string
  parentRegion?: string
  routable: DeliveryPin[]
  unreachable: DeliveryPin[]
  totalCount: number
}

interface OptimizedStop { pin: DeliveryPin; sequence: number }

interface DeliveryMapProps {
  deliveries: DeliveryPin[]
  regions?: RegionCluster[]
  regionGroups?: DeliveryRegionGroup[]
  apiKey: string
  userName?: string
  userPhoto?: string | null
  centerLat?: number
  centerLng?: number
  warehouseLat?: number | null
  warehouseLng?: number | null
  warehouseName?: string
  className?: string
  backHref?: string
  customTemplates?: Record<string, string> | null
  riderColorMap?: Record<string, { color: string; name: string }>
  riderJuicePolicies?: Record<string, string>
  }

interface RouteInfo {
  distance: string
  duration: string
  steps: { instruction: string; distance: string; maneuver?: string; modifier?: string; name?: string; location?: number[] | null }[]
  geometry: any
}

const RETURN_SALES_TYPES = ['exchange', 'trade_in', 'refund']
function isReturnOrder(pin: { salesType?: string | null; amount?: number }): boolean {
  return RETURN_SALES_TYPES.includes(pin.salesType || '')
}
function getReturnLabel(salesType: string): string {
  return salesType === 'exchange' ? 'EXCHANGE' : salesType === 'trade_in' ? 'TRADE-IN' : 'REFUND'
}

const STATUS_COLORS: Record<string, { dot: string; glow: string }> = {
  pending:   { dot: '#b45309', glow: 'rgba(180,83,9,0.5)' },
  assigned:  { dot: '#1d4ed8', glow: 'rgba(29,78,216,0.5)' },
  picked_up: { dot: '#6d28d9', glow: 'rgba(109,40,217,0.5)' },
  on_way:    { dot: '#c2410c', glow: 'rgba(194,65,12,0.5)' },
  delivered: { dot: '#047857', glow: 'rgba(4,120,87,0.5)' },
  cancelled: { dot: '#b91c1c', glow: 'rgba(185,28,28,0.5)' },
  returned:  { dot: '#4b5563', glow: 'rgba(75,85,99,0.5)' },
}

const DEFAULT_CENTER: [number, number] = [57.5, -20.2]
const mbgl = () => (window as any).mapboxgl as any

// ── Waypoint icon generator (house with lit windows) ──
function createWaypointIcon(color: string): string {
  const c = document.createElement('canvas')
  c.width = 48; c.height = 80
  const cx = c.getContext('2d')!
  const cx0 = 24

  // Ground shadow
  cx.beginPath(); cx.ellipse(cx0, 74, 14, 4, 0, 0, Math.PI * 2)
  cx.fillStyle = 'rgba(0,0,0,0.4)'; cx.fill()

  // Pole
  cx.fillStyle = color; cx.fillRect(cx0 - 1.5, 52, 3, 20)
  cx.fillStyle = 'rgba(0,0,0,0.2)'; cx.fillRect(cx0, 52, 1.5, 20)

  // House body
  cx.beginPath(); cx.roundRect(8, 28, 32, 26, [0, 0, 3, 3])
  cx.fillStyle = color; cx.fill()
  cx.strokeStyle = 'rgba(0,0,0,0.4)'; cx.lineWidth = 1; cx.stroke()
  cx.fillStyle = 'rgba(0,0,0,0.15)'; cx.fillRect(8, 40, 32, 14)

  // Roof
  cx.beginPath(); cx.moveTo(cx0, 10); cx.lineTo(42, 30); cx.lineTo(6, 30); cx.closePath()
  cx.fillStyle = color; cx.fill()
  cx.strokeStyle = 'rgba(0,0,0,0.5)'; cx.lineWidth = 1.5; cx.stroke()
  cx.beginPath(); cx.moveTo(cx0, 13); cx.lineTo(37, 29); cx.lineTo(cx0, 29); cx.closePath()
  cx.fillStyle = 'rgba(255,255,255,0.15)'; cx.fill()

  // Chimney
  cx.fillStyle = color; cx.fillRect(32, 14, 5, 14)
  cx.fillStyle = 'rgba(0,0,0,0.3)'; cx.fillRect(34, 14, 3, 14)

  // Windows (lit warm glow)
  cx.fillStyle = '#fbbf24'; cx.shadowColor = '#fbbf24'; cx.shadowBlur = 6
  cx.fillRect(13, 34, 8, 7); cx.shadowBlur = 0
  cx.strokeStyle = 'rgba(0,0,0,0.3)'; cx.lineWidth = 0.8
  cx.beginPath(); cx.moveTo(17, 34); cx.lineTo(17, 41); cx.moveTo(13, 37.5); cx.lineTo(21, 37.5); cx.stroke()

  cx.fillStyle = '#fde68a'; cx.shadowColor = '#fbbf24'; cx.shadowBlur = 6
  cx.fillRect(27, 34, 8, 7); cx.shadowBlur = 0
  cx.strokeStyle = 'rgba(0,0,0,0.3)'; cx.lineWidth = 0.8
  cx.beginPath(); cx.moveTo(31, 34); cx.lineTo(31, 41); cx.moveTo(27, 37.5); cx.lineTo(35, 37.5); cx.stroke()

  // Door
  cx.fillStyle = 'rgba(0,0,0,0.35)'; cx.beginPath(); cx.roundRect(19, 43, 10, 11, [2, 2, 0, 0]); cx.fill()
  cx.beginPath(); cx.arc(27, 49, 1, 0, Math.PI * 2); cx.fillStyle = '#fbbf24'; cx.fill()

  return c.toDataURL()
}

// ── Maneuver icon SVG ──
function getManeuverIcon(type: string, modifier: string) {
  const color = '#00e5ff', size = 32
  const arrow = (d: string) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`
  if (type === 'arrive') return arrow('M12 2v20M5 15l7 7 7-7')
  if (type === 'depart') return arrow('M12 22V2M5 9l7-7 7 7')
  if (modifier?.includes('left') && modifier?.includes('sharp')) return arrow('M18 20V4L6 14h12')
  if (modifier?.includes('right') && modifier?.includes('sharp')) return arrow('M6 20V4l12 10H6')
  if (modifier?.includes('left') && modifier?.includes('slight')) return arrow('M17 20L7 4M7 4v8M7 4h8')
  if (modifier?.includes('right') && modifier?.includes('slight')) return arrow('M7 20L17 4M17 4v8M17 4H9')
  if (modifier?.includes('left')) return arrow('M19 12H5M5 12l6-6M5 12v8')
  if (modifier?.includes('right')) return arrow('M5 12h14M19 12l-6-6M19 12v8')
  if (modifier?.includes('uturn')) return arrow('M7 20V8a5 5 0 0110 0v1M12 3l5 5-5 5')
  if (type === 'roundabout' || type === 'rotary') return arrow('M12 12m-5 0a5 5 0 1010 0a5 5 0 10-10 0M12 17v5M12 22l-3-3M12 22l3-3')
  if (type === 'merge') return arrow('M6 20l6-16 6 16M6 20h12')
  if (type === 'fork' && modifier?.includes('left')) return arrow('M12 22V8M12 8L4 2M12 8l8 6')
  if (type === 'fork' && modifier?.includes('right')) return arrow('M12 22V8M12 8l8-6M12 8L4 14')
  return arrow('M12 20V4M5 11l7-7 7 7')
}



// ═════════������════════════════════════════════════════════════
// ██  DELIVERY MAP v2.0
// ══════════════════════════════════════════════════════════
export function DeliveryMap({
  deliveries, regions = [], regionGroups = [], apiKey,
  userName, userPhoto, centerLat, centerLng,
  warehouseLat, warehouseLng, warehouseName = 'Warehouse',
  className, backHref, customTemplates, riderColorMap, riderJuicePolicies = {},
}: DeliveryMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const miniMapRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const mapRef = useRef<any>(null)
  const miniMapInstance = useRef<any>(null)
  const driverMarkerRef = useRef<any>(null)
  const watchIdRef = useRef<number | null>(null)
  const warehouseMarkerRef = useRef<any>(null)
  const stopMarkersRef = useRef<any[]>([])
  const [routeOverview, setRouteOverview] = useState(false)
  const routeOverviewRef = useRef(false)

  const [mapLoaded, setMapLoaded] = useState(false)
  const [selectedPin, setSelectedPin] = useState<DeliveryPin | null>(null)
  const [selectedRegion, setSelectedRegion] = useState<RegionCluster | null>(null)
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [driverHeading, setDriverHeading] = useState(0)
  const [navigating, setNavigating] = useState(false)
  const [navTarget, setNavTarget] = useState<DeliveryPin | null>(null)
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [mapLoading, setMapLoading] = useState(true) // Preloading Mauritius tiles
  const [navReady, setNavReady] = useState(false)
  const [navStopsExpanded, setNavStopsExpanded] = useState(false)
  const [arrivalAlert, setArrivalAlert] = useState<string | null>(null)
  const arrivalAlertedRef = useRef<string>('')
  const startNavigationRef = useRef<(pin: DeliveryPin) => void>(() => {})
  const [viewMode, setViewMode] = useState<'overview' | '3d'>('3d')
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [speed, setSpeed] = useState(0)

  const [showClientList, setShowClientList] = useState(false)
  const [showPoles, setShowPoles] = useState(true)
  const [locating, setLocating] = useState(false)
  const [placingPin, setPlacingPin] = useState<DeliveryPin | null>(null)
  const [locationLinkInput, setLocationLinkInput] = useState<string | null>(null) // pin id being edited
  const [locationLinkValue, setLocationLinkValue] = useState('')
  const [savingPin, setSavingPin] = useState(false)
  const [clientSearch, setClientSearch] = useState('')
  const [activeRegion, setActiveRegion] = useState<string | null>(null)
  const [optimizedStops, setOptimizedStops] = useState<OptimizedStop[]>([])
  const [currentStopIdx, setCurrentStopIdx] = useState(0)
  const [optimizing, setOptimizing] = useState(false)
  const [multiStopNav, setMultiStopNav] = useState(false)
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(new Set())
  const [sendingMsg, setSendingMsg] = useState<string | null>(null)
  const [paymentPopup, setPaymentPopup] = useState<{ pin: DeliveryPin; protocol?: boolean } | null>(null)
  const [updatingPinId, setUpdatingPinId] = useState<string | null>(null)
  const [newPinIds, setNewPinIds] = useState<Set<string>>(new Set())
  const [nightMode, setNightMode] = useState(false)
  const [bulkSending, setBulkSending] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [cmsPopup, setCmsPopup] = useState<{ pin: DeliveryPin } | null>(null)
  const [mapProofStep, setMapProofStep] = useState<{ pin: DeliveryPin; method: string } | null>(null)
  const [mapProofFile, setMapProofFile] = useState<File | null>(null)
  const [mapProofPreview, setMapProofPreview] = useState<string | null>(null)
  const [mapProofUploading, setMapProofUploading] = useState(false)
  const [calledTwice, setCalledTwice] = useState<Set<string>>(new Set())
  const [modifyTarget, setModifyTarget] = useState<DeliveryPin | null>(null)
  const mapContainerParentRef = useRef<HTMLDivElement>(null)
  const prevPinIdsRef = useRef<Set<string>>(new Set())
  const arriveAtStopRef = useRef<() => void>(() => {})

  const safeRegionGroups = regionGroups ?? []
  const filtered = deliveries
  const allPins = safeRegionGroups.flatMap(g => [...g.routable, ...g.unreachable])
  const totalDeliveryCount = allPins.length
  const mapboxToken = apiKey

  // ── Delivery stats ──
  const deliveryStats = useMemo(() => {
    const pending = allPins.filter(d => ['pending', 'assigned', 'picked_up', 'on_way'].includes(d.status))
    const done = allPins.filter(d => d.status === 'delivered')
    const failed = allPins.filter(d => ['nwd', 'cancelled', 'returned'].includes(d.status))
    const totalAmount = allPins.filter(d => !isReturnOrder(d)).reduce((s, d) => s + (d.amount || 0), 0)
    const collectedAmount = done.filter(d => !isReturnOrder(d)).reduce((s, d) => s + (d.amount || 0), 0)
    return { pending: pending.length, done: done.length, failed: failed.length, total: allPins.length, totalAmount, collectedAmount }
  }, [allPins])

  // ── Toggle night/dusk map mode ──
  const toggleNightMode = useCallback(() => {
    const next = !nightMode
    setNightMode(next)
    if (mapRef.current) {
      try { mapRef.current.setConfigProperty('basemap', 'lightPreset', next ? 'night' : 'dusk') } catch {}
    }
  }, [nightMode])

  // ── Fullscreen toggle (CSS + native API for true fullscreen on mobile) ──
  const toggleFullscreen = useCallback(() => {
    const el = mapContainerParentRef.current
    if (!el) return
    const next = !isFullscreen
    
    if (next) {
      // CSS-based fullscreen
      el.style.position = 'fixed'
      el.style.inset = '0'
      el.style.zIndex = '9999'
      el.style.width = '100vw'
      el.style.height = '100dvh'
      document.body.style.overflow = 'hidden'
      
      // Try native fullscreen API to hide browser chrome (Android)
      try {
        if (el.requestFullscreen) {
          el.requestFullscreen().catch(() => {})
        } else if ((el as any).webkitRequestFullscreen) {
          (el as any).webkitRequestFullscreen()
        }
      } catch {}
    } else {
      // Exit CSS fullscreen
      el.style.position = ''
      el.style.inset = ''
      el.style.zIndex = ''
      el.style.width = ''
      el.style.height = ''
      document.body.style.overflow = ''
      
      // Exit native fullscreen if active
      try {
        const doc = document as any
        if (doc.fullscreenElement || doc.webkitFullscreenElement) {
          if (doc.exitFullscreen) doc.exitFullscreen().catch(() => {})
          else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen()
        }
      } catch {}
    }
    setIsFullscreen(next)
    // Trigger map resize after layout change
    setTimeout(() => { mapRef.current?.resize() }, 100)
  }, [isFullscreen])

  // ── Open in external nav app (Google Maps / Waze) ──
  const openExternalNav = useCallback((pin: DeliveryPin, app: 'google' | 'waze') => {
    if (app === 'waze') {
      window.open(`https://waze.com/ul?ll=${pin.lat},${pin.lng}&navigate=yes`, '_blank')
    } else {
      const origin = driverLocation ? `&origin=${driverLocation.lat},${driverLocation.lng}` : ''
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${pin.lat},${pin.lng}${origin}&travelmode=driving`, '_blank')
    }
  }, [driverLocation])

  // ── Detect newly appeared pins ──
  useEffect(() => {
    const currentIds = new Set(deliveries.map(d => d.id))
    const prev = prevPinIdsRef.current
    if (prev.size > 0) {
      const appeared = new Set<string>()
      currentIds.forEach(id => { if (!prev.has(id)) appeared.add(id) })
      if (appeared.size > 0) {
        setNewPinIds(appeared)
        setTimeout(() => setNewPinIds(new Set()), 5000)
      }
    }
    prevPinIdsRef.current = currentIds
  }, [deliveries])

  // ── Snap to road ──
  const snapToRoad = useCallback(async (lat: number, lng: number): Promise<{ lat: number; lng: number; bearing: number }> => {
    if (!mapboxToken) return { lat, lng, bearing: 0 }
    try {
      const url = `https://api.mapbox.com/matching/v5/mapbox/driving/${lng},${lat};${lng + 0.0002},${lat}?access_token=${mapboxToken}&geometries=geojson&radiuses=100;100&overview=full`
      const res = await fetch(url)
      const data = await res.json()
      if (data.matchings?.[0]?.geometry?.coordinates?.[0]) {
        const [sLng, sLat] = data.matchings[0].geometry.coordinates[0]
        const coords = data.matchings[0].geometry.coordinates
        let bearing = 0
        if (coords.length >= 2) {
          const [lng1, lat1] = coords[0]
          const [lng2, lat2] = coords[Math.min(2, coords.length - 1)]
          const dLng = ((lng2 - lng1) * Math.PI) / 180
          bearing = (Math.atan2(Math.sin(dLng) * Math.cos((lat2 * Math.PI) / 180),
            Math.cos((lat1 * Math.PI) / 180) * Math.sin((lat2 * Math.PI) / 180) -
            Math.sin((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.cos(dLng)) * 180) / Math.PI
        }
        return { lat: sLat, lng: sLng, bearing }
      }
    } catch {}
    return { lat, lng, bearing: 0 }
  }, [mapboxToken])

  // ── Create / update driver DOM marker ──
  const updateDriverMarker = useCallback((pos: { lat: number; lng: number }, heading?: number) => {
    if (!mapRef.current) return
    if (heading !== undefined) setDriverHeading(heading)

    if (!driverMarkerRef.current) {
      const el = document.createElement('div')
      el.style.cssText = 'display:flex;flex-direction:column;align-items:center;pointer-events:none;'
      const photoHtml = userPhoto
        ? `<img src="${userPhoto}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;border:2px solid rgba(0,229,255,0.5);box-shadow:0 0 8px rgba(0,229,255,0.4);" crossorigin="anonymous" />`
        : `<div style="width:28px;height:28px;border-radius:50%;background:rgba(0,229,255,0.2);border:2px solid rgba(0,229,255,0.5);display:flex;align-items:center;justify-content:center;"><span style="font-size:11px;font-weight:900;color:#00e5ff;">${(userName || 'Y')[0]}</span></div>`
      el.innerHTML = `
        <div style="display:flex;align-items:center;gap:6px;padding:3px 10px 3px 4px;border-radius:20px;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);border:1px solid rgba(0,229,255,0.3);box-shadow:0 2px 10px rgba(0,0,0,0.6);">
          ${photoHtml}
          <span style="font-size:10px;font-weight:800;color:white;white-space:nowrap;letter-spacing:0.5px;max-width:120px;overflow:hidden;text-overflow:ellipsis;">${userName || 'You'}</span>
        </div>
        <div style="margin-top:4px;position:relative;">
          <div style="width:20px;height:20px;border-radius:50%;background:radial-gradient(circle,#00e5ff 30%,transparent 70%);animation:driver-ring 1.5s infinite;"></div>
          <div style="position:absolute;inset:-6px;border-radius:50%;border:2px solid rgba(0,229,255,0.3);animation:driver-ring 2s infinite;"></div>
        </div>
      `
      driverMarkerRef.current = new (mbgl()).Marker({ element: el, anchor: 'bottom' })
        .setLngLat([pos.lng, pos.lat])
        .addTo(mapRef.current)
    } else {
      driverMarkerRef.current.setLngLat([pos.lng, pos.lat])
    }
  }, [userName, userPhoto])

  // ── Load Mapbox & init map ──
  useEffect(() => {
    if (!mapboxToken || !mapContainerRef.current || mapRef.current) return
    let cancelled = false

    async function init() {
      // Load CSS
      if (!document.querySelector('link[href*="mapbox-gl"]')) {
        const link = document.createElement('link')
        link.rel = 'stylesheet'; link.href = 'https://api.mapbox.com/mapbox-gl-js/v3.11.0/mapbox-gl.css'
        document.head.appendChild(link)
      }
      // Load JS
      const existingScript = document.querySelector('script[src*="mapbox-gl"]')
      if (existingScript && !(existingScript as HTMLScriptElement).src.includes('v3.11.0')) {
        existingScript.remove(); delete (window as any).mapboxgl
      }
      if (!(window as any).mapboxgl) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement('script')
          s.src = 'https://api.mapbox.com/mapbox-gl-js/v3.11.0/mapbox-gl.js'; s.async = true
          s.onload = () => resolve(); s.onerror = reject; document.head.appendChild(s)
        })
        await new Promise<void>(r => { const c = () => { if ((window as any).mapboxgl) r(); else setTimeout(c, 50) }; c() })
      }

      if (cancelled || !mapContainerRef.current) return
      mbgl().accessToken = mapboxToken

      const center: [number, number] = centerLng && centerLat
        ? [centerLng, centerLat]
        : filtered.length > 0 ? [filtered[0].lng, filtered[0].lat]
        : regions.length > 0 ? [regions[0].lng, regions[0].lat]
        : DEFAULT_CENTER

      // ══════════════════════════════════════════════════════════════════════════
      // ULTIMATE MAPBOX PERFORMANCE CONFIG - Based on official Mapbox docs + research
      // ══════════════════════════════════════════════════════════════════════════
      const map = new (mbgl()).Map({
        container: mapContainerRef.current,
        style: 'mapbox://styles/mapbox/standard?optimize=true', // style-optimized vector tiles
        center, zoom: 15, maxZoom: 20, pitch: 60, bearing: -20,
        
        // ── GPU / Rendering ──
        antialias: false, // Huge GPU savings, minimal visual impact
        pixelRatio: Math.min(window.devicePixelRatio, 1.5), // Balance quality vs performance
        
        // ── Tile Loading ──
        fadeDuration: 150, // Fast but smooth tile transitions
        maxTileCacheSize: 300, // Max cache for Mauritius tiles (~50MB)
        refreshExpiredTiles: false, // Don't re-fetch during session
        renderWorldCopies: false, // Only render one world
        
        // ── Interaction ──
        projection: 'globe',
        touchZoomRotate: true, touchPitch: true, dragRotate: true,
        cooperativeGestures: false,
        boxZoom: false, doubleClickZoom: false,
        
        // ── Performance Flags ──
        trackResize: true,
        localIdeographFontFamily: 'sans-serif', // Faster CJK text
        crossSourceCollisions: false, // Faster label placement
        collectResourceTiming: false, // No overhead
        testMode: false,
        
        // ── UI ──
        logoPosition: 'bottom-left',
        attributionControl: false,
        
        // ── Style Config ──
        config: { 
          basemap: { 
            lightPreset: 'dusk', 
            show3dObjects: true, 
            showPlaceLabels: true, 
            showRoadLabels: true, 
            showPointOfInterestLabels: false, // Reduce labels during zoom
            showTransitLabels: false 
          } 
        },
      })
      
      // ══════════════════════════════════════════════════════════════════════════
      // SMOOTH INTERACTION SETTINGS
      // ══════════════════════════════════════════════════════════════════════════
      map.touchZoomRotate.enableRotation()
      map.touchPitch.enable()
      
      // Buttery smooth scroll zoom (lower = smoother but slower)
      map.scrollZoom.setWheelZoomRate(1/350)
      map.scrollZoom.setZoomRate(1/150)
      
      // Optimized drag with smooth deceleration
      map.dragPan.enable({ 
        linearity: 0.25, // Smoother curve
        deceleration: 3000, // Longer coast
        maxSpeed: 1200 // Cap speed to prevent jank
      })
      
      // ══════════════════════════════════════════════════════════════════════════
      // PRELOAD ALL MAURITIUS TILES - Instant zoom after initial load
      // ══════════════════════════════════════════════════════════════════════════
      const mauritiusBounds: [[number, number], [number, number]] = [[57.30, -20.53], [57.81, -19.97]]
      const zoomLevels = [10, 12, 13, 14, 15, 16, 17, 18] // All zoom levels rider will use
      
      const preloadTiles = async () => {
        setMapLoading(true)
        
        // Preload at each zoom level
        for (const z of zoomLevels) {
          map.fitBounds(mauritiusBounds, { duration: 0, padding: 0 })
          map.setZoom(z)
          
          // Wait for all tiles at this zoom
          await new Promise<void>(resolve => {
            const check = () => map.areTilesLoaded() ? resolve() : requestAnimationFrame(check)
            check()
          })
        }
        
        // Return to original view
        map.setCenter(center)
        map.setZoom(15)
        map.setPitch(60)
        map.setBearing(-20)
        
        // Wait for final render
        await new Promise<void>(resolve => {
          const check = () => map.areTilesLoaded() ? resolve() : requestAnimationFrame(check)
          check()
        })
        
        setMapLoading(false)
      }
      
      // ══════════════════════════════════════════════════════════════════════════
      // THROTTLE EXPENSIVE OPERATIONS DURING INTERACTION
      // ══════════════════════════════════════════════════════════════════════════
      let interactionThrottle: number | null = null
      
      map.on('movestart', () => {
        // Pause non-critical rendering during pan/zoom
        if (interactionThrottle) cancelAnimationFrame(interactionThrottle)
      })
      
      map.on('moveend', () => {
        // Resume after interaction with RAF batching
        interactionThrottle = requestAnimationFrame(() => {
          map.triggerRepaint()
        })
      })
      
      map.once('idle', preloadTiles)

      // ── Static dusk lighting (no weather effects) ──
      map.on('style.load', () => {
        try { map.setConfigProperty('basemap', 'showPlaceLabels', true) } catch {}
        try { map.setConfigProperty('basemap', 'showRoadLabels', true) } catch {}
        try { map.setConfigProperty('basemap', 'showPointOfInterestLabels', true) } catch {}
        try { map.setConfigProperty('basemap', 'showTransitLabels', true) } catch {}
      })

      // ── Map loaded ──
      map.on('load', () => {
        if (cancelled) return

        // GeoJSON delivery pins source
        if (map.getSource('delivery-pins')) {
          try { ['pins-glow','pins-circle','pins-pulse','pins-waypoint','pins-label'].forEach(l => { if (map.getLayer(l)) map.removeLayer(l) }); map.removeSource('delivery-pins') } catch {}
        }
        map.addSource('delivery-pins', { 
          type: 'geojson', 
          data: { type: 'FeatureCollection', features: [] },
          buffer: 0, // Features are points, no buffer needed - 40% GPU reduction
          tolerance: 0.5, // Simplify geometries
          maxzoom: 14 // Stop processing at z14 for performance
        })

        // Pin layers
        map.addLayer({ id: 'pins-glow', type: 'circle', source: 'delivery-pins', slot: 'top', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 6, 14, 10, 18, 16], 'circle-color': '#000000', 'circle-opacity': 0.35, 'circle-blur': 1.5 } })
        map.addLayer({ id: 'pins-circle', type: 'circle', source: 'delivery-pins', slot: 'top', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 7, 18, 10], 'circle-color': '#000000', 'circle-stroke-width': 3, 'circle-stroke-color': ['get', 'color'] } })
        map.addLayer({ id: 'pins-pulse', type: 'circle', source: 'delivery-pins', slot: 'top', filter: ['==', ['get', 'isNew'], 1], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 12, 14, 20, 18, 28], 'circle-color': 'transparent', 'circle-stroke-width': 3, 'circle-stroke-color': '#22d3ee', 'circle-stroke-opacity': 0.7 } })
        // Red pulsing ring for flagged locations (client sent location outside region)
        map.addLayer({ id: 'pins-flagged-glow', type: 'circle', source: 'delivery-pins', slot: 'top', filter: ['==', ['get', 'flagged'], 1], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 14, 14, 22, 18, 32], 'circle-color': 'transparent', 'circle-stroke-width': 2.5, 'circle-stroke-color': '#ef4444', 'circle-stroke-opacity': 0.8 } })
        map.addLayer({ id: 'pins-flagged-outer', type: 'circle', source: 'delivery-pins', slot: 'top', filter: ['==', ['get', 'flagged'], 1], paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 20, 14, 30, 18, 40], 'circle-color': 'rgba(239,68,68,0.08)', 'circle-stroke-width': 1, 'circle-stroke-color': '#ef4444', 'circle-stroke-opacity': 0.3 } })
      // Special order type ring (exchange=violet, trade_in=blue, refund=red)
      map.addLayer({ id: 'pins-special-ring', type: 'circle', source: 'delivery-pins', slot: 'top',
        filter: ['in', ['get', 'salesType'], ['literal', ['exchange', 'trade_in', 'refund']]],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 10, 14, 16, 18, 22],
          'circle-color': 'transparent',
          'circle-stroke-width': 2.5,
          'circle-stroke-color': ['match', ['get', 'salesType'], 'exchange', '#8b5cf6', 'trade_in', '#3b82f6', 'refund', '#ef4444', '#6b7280'],
          'circle-stroke-opacity': 0.8,
        }
      })
      map.addLayer({ id: 'pins-special-glow', type: 'circle', source: 'delivery-pins', slot: 'top',
        filter: ['in', ['get', 'salesType'], ['literal', ['exchange', 'trade_in', 'refund']]],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 16, 14, 24, 18, 32],
          'circle-color': ['match', ['get', 'salesType'], 'exchange', 'rgba(139,92,246,0.08)', 'trade_in', 'rgba(59,130,246,0.08)', 'refund', 'rgba(239,68,68,0.08)', 'transparent'],
          'circle-stroke-width': 1,
          'circle-stroke-color': ['match', ['get', 'salesType'], 'exchange', '#8b5cf6', 'trade_in', '#3b82f6', 'refund', '#ef4444', '#6b7280'],
          'circle-stroke-opacity': 0.3,
        }
      })

        // Defer waypoint icon generation to idle time (non-blocking)
        const generateWaypointIcons = () => {
          const statusColors = ['#b45309','#1d4ed8','#6d28d9','#c2410c','#047857','#b91c1c','#4b5563']
          statusColors.forEach((col, i) => {
            const key = `waypoint-${i}`
            if (!map.hasImage(key)) {
              const img = new Image(); img.crossOrigin = 'anonymous'
              img.onload = () => { if (!map.hasImage(key)) map.addImage(key, img, { pixelRatio: 2 }) }
              img.src = createWaypointIcon(col)
            }
          })
        }
        
        // Use requestIdleCallback if available, otherwise setTimeout
        if ('requestIdleCallback' in window) {
          (window as any).requestIdleCallback(generateWaypointIcons, { timeout: 2000 })
        } else {
          setTimeout(generateWaypointIcons, 100)
        }

        map.addLayer({ id: 'pins-waypoint', type: 'symbol', source: 'delivery-pins', minzoom: 13, slot: 'top', layout: { 'icon-image': ['concat', 'waypoint-', ['coalesce', ['match', ['get', 'status'], 'pending', '0', 'assigned', '1', 'picked_up', '2', 'on_way', '3', 'delivered', '4', 'cancelled', '5', 'returned', '6', '0'], '0']], 'icon-size': ['interpolate', ['linear'], ['zoom'], 13, 0.7, 18, 1.3], 'icon-anchor': 'bottom', 'icon-allow-overlap': true } })
        map.addLayer({ id: 'pins-label', type: 'symbol', source: 'delivery-pins', minzoom: 13, slot: 'top', layout: { 'text-field': ['get', 'name'], 'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 18, 14], 'text-offset': [0, -5], 'text-anchor': 'bottom', 'text-max-width': 8, 'text-letter-spacing': 0.08, 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'], 'text-transform': 'uppercase' }, paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.95)', 'text-halo-width': 2.5, 'text-halo-blur': 0 } })

        // Click handler
        map.on('click', 'pins-circle', (e: any) => {
          const f = e.features?.[0]
          if (f) {
            const pin = deliveries.find(d => d.id === f.properties.id) || filtered.find(d => d.id === f.properties.id)
            if (pin) { setSelectedPin(pin); setSelectedRegion(null); map.flyTo({ center: [pin.lng, pin.lat], zoom: 16, pitch: 60, duration: 1400, essential: true }) }
          }
        })
        map.on('mouseenter', 'pins-circle', () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', 'pins-circle', () => { map.getCanvas().style.cursor = '' })

        // Region pole markers holder
        ;(map as any)._regionPoleMarkers = []

        // Globe atmosphere
        try { map.setFog({ 'space-color': 'rgb(11, 11, 25)', 'star-intensity': 0.8 }) } catch {}

        setMapLoaded(true)


      })

      mapRef.current = map

      // Mini-map
      if (miniMapRef.current) {
        const mini = new (mbgl()).Map({
          container: miniMapRef.current, style: 'mapbox://styles/mapbox/standard',
          center, zoom: 14, interactive: false, attributionControl: false,
          config: { basemap: { lightPreset: 'dusk', show3dObjects: false, showPlaceLabels: true, showRoadLabels: true, showPointOfInterestLabels: false, showTransitLabels: false } },
        })
        miniMapInstance.current = mini
        // RAF-batched mini-map sync - zero jank
        let miniMapRafId: number | null = null
        let pendingCenter: mapboxgl.LngLat | null = null
        let pendingBearing: number | null = null
        
        const syncMiniMap = () => {
          if (pendingCenter) mini.setCenter(pendingCenter)
          if (pendingBearing !== null) mini.setBearing(pendingBearing)
          pendingCenter = null
          pendingBearing = null
          miniMapRafId = null
        }
        
        map.on('move', () => {
          pendingCenter = map.getCenter()
          pendingBearing = map.getBearing()
          if (!miniMapRafId) {
            miniMapRafId = requestAnimationFrame(syncMiniMap)
          }
        })
        map.on('moveend', syncMiniMap)
      }
    }

    init().catch(console.error)
    return () => {
      cancelled = true
      if (miniMapInstance.current) { miniMapInstance.current.remove(); miniMapInstance.current = null }
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
      setMapLoaded(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapboxToken])

  // ── Update GeoJSON + region poles ──
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return
    const map = mapRef.current

    // Update pins
    if (riderColorMap) {
  
    }
    const pinFeatures = filtered.map(pin => {
      // Use rider color when riderColorMap is provided, otherwise use status color
      const pinColor = (riderColorMap && pin.riderId && riderColorMap[pin.riderId])
        ? riderColorMap[pin.riderId].color
        : STATUS_COLORS[pin.status]?.dot || '#6b7280'
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [pin.lng, pin.lat] },
        properties: { id: pin.id, name: pin.customerName.split(' ')[0], color: pinColor, status: pin.status, isNew: newPinIds.has(pin.id) ? 1 : 0, flagged: pin.locationFlagged ? 1 : 0, salesType: pin.salesType || 'sale' },
      }
    })
    const pinSrc = map.getSource('delivery-pins')
    if (pinSrc) pinSrc.setData({ type: 'FeatureCollection', features: pinFeatures })

    // Clean old region poles
    if ((map as any)._regionPoleMarkers) {
      (map as any)._regionPoleMarkers.forEach((m: any) => m.remove())
    }
    ;(map as any)._regionPoleMarkers = []

    const mb = mbgl()
    const filteredRegions = regions
    if (showPoles && mb) filteredRegions.forEach(r => {
      const count = r.count
      const isHigh = count > 5
      const poleH = isHigh ? 60 : 42

      // Build bar segments — rider-based if riderColorMap provided, otherwise status-based
      let topColor = '#6b7280'
      let barHtml = ''

      if (riderColorMap && Object.keys(riderColorMap).length > 0) {
        // Rider breakdown from cluster deliveries
        const riderCounts: Record<string, number> = {}
        r.deliveries.forEach(d => {
          const rid = d.riderId || 'unassigned'
          riderCounts[rid] = (riderCounts[rid] || 0) + 1
        })
  
        const riderEntries = Object.entries(riderCounts)
          .map(([rid, cnt]) => ({
            count: cnt,
            color: riderColorMap[rid]?.color || '#6b7280',
            name: riderColorMap[rid]?.name || 'Unassigned',
          }))
          .sort((a, b) => b.count - a.count)
        topColor = riderEntries[0]?.color || '#6b7280'
        barHtml = riderEntries.map(e => {
          const pct = Math.max(12, Math.round((e.count / count) * 100))
          return `<div style="flex:${pct};height:100%;background:${e.color};position:relative;" title="${e.name}: ${e.count}">
            <span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:900;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.9);line-height:1;">${e.count}</span>
          </div>`
        }).join('')
      } else {
        // Status breakdown (original)
        const statusOrder = ['pending', 'assigned', 'picked_up', 'on_way', 'delivered', 'nwd', 'cancelled', 'returned']
        const statusEntries = statusOrder.filter(s => (r.statuses[s] || 0) > 0).map(s => ({
          count: r.statuses[s], color: STATUS_COLORS[s]?.dot || '#6b7280'
        }))
        topColor = statusEntries.sort((a, b) => b.count - a.count)[0]?.color || '#6b7280'
        barHtml = statusEntries.length > 0
          ? statusEntries.map(e => {
              const pct = Math.max(12, Math.round((e.count / count) * 100))
              return `<div style="flex:${pct};height:100%;background:${e.color};position:relative;" title="${e.count}">
                <span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:900;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.9);line-height:1;">${e.count}</span>
              </div>`
            }).join('')
          : `<div style="flex:1;height:100%;background:#6b7280;"></div>`
      }

      const el = document.createElement('div')
      el.style.cssText = `display:flex;flex-direction:column;align-items:center;cursor:pointer;perspective:200px;`
      el.innerHTML = `
        <div style="transform:rotateX(15deg);transform-origin:bottom center;display:flex;flex-direction:column;align-items:stretch;min-width:52px;max-width:120px;border-radius:6px;overflow:hidden;background:linear-gradient(180deg,rgba(20,20,30,0.95),rgba(10,10,18,0.98));border:1px solid rgba(255,255,255,0.08);box-shadow:0 8px 24px rgba(0,0,0,0.7),0 2px 6px rgba(0,0,0,0.5),inset 0 1px 0 rgba(255,255,255,0.06)${isHigh ? ',0 0 20px ' + topColor + '30' : ''};">
          <div style="padding:4px 7px 2px;text-align:center;">
            <div style="font-size:8px;font-weight:900;color:rgba(255,255,255,0.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:0.5px;text-transform:uppercase;text-shadow:0 1px 3px rgba(0,0,0,0.8);">${r.locality}</div>
          </div>
          <div style="display:flex;height:14px;margin:2px 4px 4px;border-radius:3px;overflow:hidden;gap:1px;">${barHtml}</div>
          <div style="padding:0 7px 3px;text-align:center;">
            <span style="font-size:7px;font-weight:700;color:rgba(255,255,255,0.3);letter-spacing:0.3px;">${count} deliveries</span>
          </div>
        </div>
        <div style="width:3px;height:${poleH}px;background:linear-gradient(180deg,${topColor}cc,${topColor}33,transparent);border-radius:1.5px;box-shadow:1px 0 4px rgba(0,0,0,0.4),-1px 0 4px rgba(0,0,0,0.4);"></div>
        <div style="width:10px;height:4px;border-radius:50%;background:radial-gradient(ellipse,${topColor}66,transparent);filter:blur(1px);"></div>
      `
      el.addEventListener('click', () => {
        // Open All Deliveries panel filtered to & expanded for this region
        setSelectedPin(null); setSelectedRegion(null)
        setClientSearch(r.locality)
        setShowClientList(true)
        setExpandedRegions(prev => { const next = new Set(prev); next.add(r.locality); return next })
        map.flyTo({ center: [r.lng, r.lat], zoom: 15.5, pitch: 60, bearing: map.getBearing(), duration: 1400, essential: true })
      })
      const marker = new mb.Marker({ element: el, anchor: 'bottom' }).setLngLat([r.lng, r.lat]).addTo(map)
      ;(map as any)._regionPoleMarkers.push(marker)
    })

    // Fit bounds
    const bounds = new (mbgl()).LngLatBounds()
    filtered.forEach(p => bounds.extend([p.lng, p.lat]))
    filteredRegions.forEach(r => bounds.extend([r.lng, r.lat]))
    if (driverLocation) bounds.extend([driverLocation.lng, driverLocation.lat])
    if (!bounds.isEmpty() && !navigating) {
      map.fitBounds(bounds, { padding: 60, duration: 1800, maxZoom: 15, pitch: 60 })
    }
  }, [filtered, regions, mapLoaded, navigating, showPoles, newPinIds, driverLocation, riderColorMap])

  // ── GPS Tracking ──
  const startTracking = useCallback(() => {
    if (!navigator.geolocation || locating) return
    setLocating(true)
    let done = false
    const wid = navigator.geolocation.watchPosition(
      (p) => {
        if (done) return; done = true; navigator.geolocation.clearWatch(wid); setLocating(false)
        const rawPos = { lat: p.coords.latitude, lng: p.coords.longitude }
        setDriverLocation(rawPos); updateDriverMarker(rawPos, p.coords.heading ?? 0)
        mapRef.current?.flyTo({ center: [rawPos.lng, rawPos.lat], zoom: 17, pitch: 60, bearing: p.coords.heading ?? 0, duration: 1800, essential: true })
        snapToRoad(rawPos.lat, rawPos.lng).then(s => { setDriverLocation({ lat: s.lat, lng: s.lng }); updateDriverMarker({ lat: s.lat, lng: s.lng }, s.bearing) }).catch(() => {})
      },
      () => { setLocating(false); done = true; navigator.geolocation.clearWatch(wid) },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    )
    setTimeout(() => { if (!done) { setLocating(false); done = true; navigator.geolocation.clearWatch(wid) } }, 8000)
  }, [updateDriverMarker, snapToRoad, locating])

  // ══════════════════════════════════════════════════════════════════════════
  // KALMAN FILTER - For precise GPS like Google Maps / Navigation apps
  // ══════════════════════════════════════════════════════════════════════════
  const kalmanRef = useRef<{
    lat: number; lng: number; 
    variance: number; // Current uncertainty
    timestamp: number;
  } | null>(null)
  
  // Kalman filter implementation for GPS smoothing
  const kalmanFilter = useCallback((lat: number, lng: number, accuracy: number, timestamp: number) => {
    const Q = 3 // Process noise - how much we expect position to change naturally
    const minAccuracy = 1 // Minimum accuracy to prevent division issues
    
    if (!kalmanRef.current) {
      // Initialize with first reading
      kalmanRef.current = { lat, lng, variance: accuracy * accuracy, timestamp }
      return { lat, lng }
    }
    
    const prev = kalmanRef.current
    const timeDelta = (timestamp - prev.timestamp) / 1000 // seconds
    
    // Prediction step: increase uncertainty over time
    const predictedVariance = prev.variance + Q * Q * Math.max(timeDelta, 0.1)
    
    // Update step: combine prediction with new measurement
    const measurementVariance = Math.max(accuracy * accuracy, minAccuracy)
    const kalmanGain = predictedVariance / (predictedVariance + measurementVariance)
    
    // Calculate filtered position
    const filteredLat = prev.lat + kalmanGain * (lat - prev.lat)
    const filteredLng = prev.lng + kalmanGain * (lng - prev.lng)
    const newVariance = (1 - kalmanGain) * predictedVariance
    
    // Update state
    kalmanRef.current = { lat: filteredLat, lng: filteredLng, variance: newVariance, timestamp }
    
    return { lat: filteredLat, lng: filteredLng }
  }, [])
  
  // LERP helper for smooth interpolation
  const lerp = (start: number, end: number, amt: number) => (1 - amt) * start + amt * end
  const lastPosRef = useRef<{ lat: number; lng: number } | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  
  // Smooth marker animation using requestAnimationFrame
  const animateMarkerTo = useCallback((targetPos: { lat: number; lng: number }, heading: number, duration = 800) => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
    
    const startPos = lastPosRef.current || targetPos
    const startTime = performance.now()
    
    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      
      const currentLat = lerp(startPos.lat, targetPos.lat, eased)
      const currentLng = lerp(startPos.lng, targetPos.lng, eased)
      
      if (driverMarkerRef.current) {
        driverMarkerRef.current.setLngLat([currentLng, currentLat])
      }
      
      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate)
      } else {
        lastPosRef.current = targetPos
        setDriverLocation(targetPos)
      }
    }
    
    animationFrameRef.current = requestAnimationFrame(animate)
  }, [])
  
  const startContinuousTracking = useCallback(() => {
    if (!navigator.geolocation) return
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
    
    // Reset Kalman filter when starting fresh tracking
    kalmanRef.current = null
    
    watchIdRef.current = navigator.geolocation.watchPosition(
      async (p) => {
        const rawLat = p.coords.latitude, rawLng = p.coords.longitude
        const accuracy = p.coords.accuracy || 50
        const speed = p.coords.speed ? p.coords.speed * 3.6 : 0 // km/h
        let heading = p.coords.heading ?? 0
        const timestamp = p.timestamp || Date.now()
        
        // Apply Kalman filter for precise position (like Google Maps)
        const filtered = kalmanFilter(rawLat, rawLng, accuracy, timestamp)
        
        let pos: { lat: number; lng: number }
        
        // When moving with good accuracy, snap to road for navigation
        if (speed > 5 && accuracy < 25) {
          const snapped = await snapToRoad(filtered.lat, filtered.lng)
          pos = { lat: snapped.lat, lng: snapped.lng }
          heading = snapped.bearing || heading
        } else {
          // Use Kalman-filtered position (much more accurate than raw GPS)
          pos = filtered
        }
        
        // Adaptive animation: faster when moving, slower when stationary
        const animDuration = speed > 20 ? 400 : speed > 5 ? 700 : 1000
        animateMarkerTo(pos, heading, animDuration)
        setDriverHeading(heading)
        setSpeed(Math.round(speed))
        
        // Smooth camera follow during navigation
        if (mapRef.current && navigating && !routeOverviewRef.current) {
          mapRef.current.easeTo({ 
            center: [pos.lng, pos.lat], 
            bearing: heading, 
            pitch: 65, 
            zoom: speed > 30 ? 16 : 17, // Zoom out a bit when driving fast
            duration: speed > 15 ? 600 : 1000,
            easing: (t: number) => 1 - Math.pow(1 - t, 3) 
          })
        }
      },
      (err) => { console.log('[v0] GPS error:', err.message) }, 
      { enableHighAccuracy: true, maximumAge: 0, timeout: 3000 } // Fastest possible updates
    )
  }, [updateDriverMarker, navigating, snapToRoad, animateMarkerTo, kalmanFilter])

  useEffect(() => () => { 
    if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current)
  }, [])

  // ── Auto-advance nav steps ──
  useEffect(() => {
    if (!navigating || !routeInfo?.steps?.length || !driverLocation) return
    const step = routeInfo.steps[currentStepIndex]
    if (!step?.location) return
    const R = 6371000
    const dLat = ((step.location[1] - driverLocation.lat) * Math.PI) / 180
    const dLng = ((step.location[0] - driverLocation.lng) * Math.PI) / 180
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((driverLocation.lat * Math.PI) / 180) * Math.cos((step.location[1] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
    const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    if (dist < 30 && currentStepIndex < routeInfo.steps.length - 1) setCurrentStepIndex(prev => prev + 1)
  }, [navigating, driverLocation, routeInfo, currentStepIndex])

  // ── Auto-show driver on map load ──
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || driverMarkerRef.current) return
    const placeDriver = async (lat: number, lng: number, heading = 0, flyTo = false) => {
      setDriverLocation({ lat, lng }); updateDriverMarker({ lat, lng }, heading)
      if (flyTo && mapRef.current) mapRef.current.flyTo({ center: [lng, lat], zoom: 16.5, pitch: 60, bearing: heading, duration: 1500 })
      try { const s = await snapToRoad(lat, lng); setDriverLocation({ lat: s.lat, lng: s.lng }); updateDriverMarker({ lat: s.lat, lng: s.lng }, s.bearing || heading) } catch {}
    }
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        p => placeDriver(p.coords.latitude, p.coords.longitude, p.coords.heading ?? 0, true),
        () => { const c = mapRef.current!.getCenter(); placeDriver(c.lat, c.lng, 0, false) },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 }
      )
    } else { const c = mapRef.current!.getCenter(); placeDriver(c.lat, c.lng, 0, false) }
  }, [mapLoaded, updateDriverMarker, snapToRoad])

  // ── Warehouse marker ──
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !warehouseLat || !warehouseLng) return
    if (warehouseMarkerRef.current) warehouseMarkerRef.current.remove()
    const el = document.createElement('div')
    el.style.cssText = 'display:flex;flex-direction:column;align-items:center;cursor:pointer;'
    el.innerHTML = `<div style="position:relative;"><div style="width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#ff6b00,#ff8c00);display:flex;align-items:center;justify-content:center;box-shadow:0 0 20px rgba(255,107,0,0.5),0 4px 12px rgba(0,0,0,0.4);border:2px solid rgba(255,255,255,0.3);"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><path d="M9 9v.01"/><path d="M9 12v.01"/><path d="M9 15v.01"/><path d="M9 18v.01"/></svg></div><div style="position:absolute;top:-4px;right:-4px;width:14px;height:14px;border-radius:50%;background:#22c55e;border:2px solid #0a1628;"></div></div><div style="margin-top:4px;padding:2px 8px;border-radius:8px;background:rgba(0,0,0,0.85);backdrop-filter:blur(6px);border:1px solid rgba(255,107,0,0.3);"><span style="font-size:9px;font-weight:800;color:#ff8c00;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;">${warehouseName}</span></div>`
    el.addEventListener('click', () => { mapRef.current?.flyTo({ center: [warehouseLng!, warehouseLat!], zoom: 17, pitch: 60, duration: 1500 }) })
    warehouseMarkerRef.current = new (mbgl()).Marker({ element: el, anchor: 'bottom' }).setLngLat([warehouseLng, warehouseLat]).addTo(mapRef.current)
    return () => { warehouseMarkerRef.current?.remove() }
  }, [mapLoaded, warehouseLat, warehouseLng, warehouseName])

  // ── Messaging ──
  const MAP_TEMPLATES: Record<string, string> = {
    onway: 'Hi, I am on my way to deliver your order. Please be available. Thank you!',
    arrived: 'Hi, I have arrived with your delivery. Please come to collect it. Thank you!',
    unavailable: 'Hi, I tried to deliver your order but no one was available. Please contact us to reschedule. Thank you.',
    location: 'Hi, could you please share your location so we can deliver your order? Thank you!',
  }

  // ── Track contacted clients (sms/call) per day ──
  const contactedKey = `contacted-${new Date().toISOString().slice(0, 10)}`
  const [contactedMap, setContactedMap] = useState<Record<string, { sms?: boolean; call?: boolean }>>(() => {
    try { const s = sessionStorage.getItem(contactedKey); return s ? JSON.parse(s) : {} } catch { return {} }
  })
  const markContacted = useCallback((id: string, medium: 'sms' | 'call') => {
    setContactedMap(prev => {
      const next = { ...prev, [id]: { ...prev[id], [medium]: true } }
      try { sessionStorage.setItem(contactedKey, JSON.stringify(next)) } catch {}
      return next
    })
  }, [contactedKey])

  const sendMapMessage = useCallback(async (pin: DeliveryPin, method: 'sms', templateId: string = 'onway') => {
    if (!pin.contact1) return
    markContacted(pin.id, 'sms')
    setSendingMsg(pin.id)
    const phone = formatPhone(pin.contact1)
    const openMsg = (msg: string) => {
      window.location.href = `sms:${phone}?body=${encodeURIComponent(msg)}`
    }
    const rawTemplate = customTemplates?.[templateId] || MAP_TEMPLATES[templateId] || MAP_TEMPLATES.onway
    const body = rawTemplate.replace(/^Hi,?\s*/i, '')
    try {
      const ids = pin.itemIds?.length ? pin.itemIds : [pin.id]
      const { tokens } = await generateReplyTokens(ids)
      const replyToken = tokens[ids[0]]
      const baseUrl = window.location.origin
      const replyLink = replyToken ? `${baseUrl}/reply/${replyToken}` : ''
      const linkLabel = templateId === 'location' ? 'Share your location here' : 'Reply here'
      openMsg(`Hi ${pin.customerName}, ${body}${replyLink ? `\n${linkLabel}: ${replyLink}` : ''}`)
    } catch {
      openMsg(`Hi ${pin.customerName}, ${body}`)
    } finally { setSendingMsg(null) }
  }, [customTemplates, markContacted])

  // ── Drag reorder optimized stops ──
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const dragNodeRef = useRef<HTMLDivElement | null>(null)

  const handleDragStart = useCallback((idx: number, e: React.DragEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    setDragIdx(idx)
    if ('dataTransfer' in e) {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(idx))
      // make drag image semi-transparent
      if (e.currentTarget) {
        const el = e.currentTarget as HTMLDivElement
        el.style.opacity = '0.4'
      }
    }
  }, [])

  const handleDragEnd = useCallback((e: React.DragEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    if ('currentTarget' in e && e.currentTarget) {
      (e.currentTarget as HTMLDivElement).style.opacity = '1'
    }
    if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx) {
      setOptimizedStops(prev => {
        const next = [...prev]
        const [moved] = next.splice(dragIdx, 1)
        next.splice(dragOverIdx, 0, moved)
        const reordered = next.map((s, i) => ({ ...s, sequence: i + 1 }))
        if (multiStopNav && navigating) {
          const newCurrentPin = reordered[currentStopIdx]?.pin
          if (newCurrentPin) {
            setTimeout(() => startNavigationRef.current(newCurrentPin), 100)
          }
        }
        return reordered
      })
    }
    setDragIdx(null)
    setDragOverIdx(null)
  }, [dragIdx, dragOverIdx, currentStopIdx, multiStopNav, navigating])

  const handleDragOver = useCallback((idx: number, e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIdx(idx)
  }, [])

  // Touch drag support
  const touchStartYRef = useRef(0)
  const touchRowHeightRef = useRef(48)
  const handleTouchStart = useCallback((idx: number, e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0]
    touchStartYRef.current = touch.clientY
    dragNodeRef.current = e.currentTarget as HTMLDivElement
    const rowEl = e.currentTarget.closest('[data-stop-row]') as HTMLElement
    if (rowEl) touchRowHeightRef.current = rowEl.offsetHeight
    setDragIdx(idx)
    setDragOverIdx(idx)
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (dragIdx === null) return
    const touch = e.touches[0]
    const delta = touch.clientY - touchStartYRef.current
    const offset = Math.round(delta / touchRowHeightRef.current)
    const newIdx = Math.max(0, Math.min(optimizedStops.length - 1, dragIdx + offset))
    setDragOverIdx(newIdx)
  }, [dragIdx, optimizedStops.length])

  const handleTouchEnd = useCallback(() => {
    if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx) {
      setOptimizedStops(prev => {
        const next = [...prev]
        const [moved] = next.splice(dragIdx, 1)
        next.splice(dragOverIdx, 0, moved)
        const reordered = next.map((s, i) => ({ ...s, sequence: i + 1 }))
        if (multiStopNav && navigating) {
          const newCurrentPin = reordered[currentStopIdx]?.pin
          if (newCurrentPin) {
            setTimeout(() => startNavigationRef.current(newCurrentPin), 100)
          }
        }
        return reordered
      })
    }
    setDragIdx(null)
    setDragOverIdx(null)
  }, [dragIdx, dragOverIdx, currentStopIdx, multiStopNav, navigating])

  // ── Bulk send "On Way" to all pending in a region ──
  const sendBulkOnWay = useCallback(async (regionName: string) => {
    const group = safeRegionGroups.find(g => g.region === regionName)
    if (!group) return
    setBulkSending(true)
    const pendingPins = [...group.routable, ...group.unreachable].filter(d => ['pending', 'assigned', 'picked_up', 'on_way'].includes(d.status) && d.contact1)
    for (const pin of pendingPins) {
      try { await sendMapMessage(pin, 'sms', 'onway') } catch {}
    }
    setBulkSending(false)
  }, [safeRegionGroups, sendMapMessage])

  // ── Export batch SMS for region ──
  const [exporting, setExporting] = useState<string | null>(null)
  const [exportedRegion, setExportedRegion] = useState<string | null>(null)
  const [deviceSelectRegion, setDeviceSelectRegion] = useState<string | null>(null)
  // Track which regions have been batch-exported today (persists per day in sessionStorage)
  const batchExportedKey = `batch-exported-${new Date().toISOString().slice(0, 10)}`
  const [batchExportedRegions, setBatchExportedRegions] = useState<Set<string>>(() => {
    try {
      const stored = sessionStorage.getItem(batchExportedKey)
      return stored ? new Set(JSON.parse(stored)) : new Set()
    } catch { return new Set() }
  })
  const markRegionExported = useCallback((region: string) => {
    setBatchExportedRegions(prev => {
      const next = new Set(prev).add(region)
      try { sessionStorage.setItem(batchExportedKey, JSON.stringify([...next])) } catch {}
      return next
    })
  }, [batchExportedKey])
  const isRegionBatchExported = useCallback((region: string) => batchExportedRegions.has(region), [batchExportedRegions])
  // Helper to find which region a delivery pin belongs to
  const getRegionForPin = useCallback((pin: DeliveryPin) => {
    for (const g of safeRegionGroups) {
      if ([...g.routable, ...g.unreachable].some(p => p.id === pin.id)) return g.region
    }
    return null
  }, [safeRegionGroups])

  const exportBatchSms = useCallback(async (regionName: string, device: 'android' | 'apple') => {
    const group = safeRegionGroups.find(g => g.region === regionName)
    if (!group) return
    setExporting(regionName)
    setDeviceSelectRegion(null)
    const allPins = [...group.routable, ...group.unreachable].filter(d => d.contact1 && !['delivered', 'nwd', 'cms'].includes(d.status))
    // Generate reply tokens
    const deliveryIds = allPins.flatMap(p => p.itemIds)
    let tokenMap: Record<string, string> = {}
    try {
      const result = await generateReplyTokens(deliveryIds)
      tokenMap = result.tokens || result
    } catch {}
    const baseUrl = window.location.origin
    const rows: { phone: string; message: string }[] = []
    for (const pin of allPins) {
      const phone = formatPhone(pin.contact1!)
      const ids = pin.itemIds?.length ? pin.itemIds : [pin.id]
      const replyToken = tokenMap[ids[0]]
      const replyUrl = replyToken ? `${baseUrl}/reply/${replyToken}` : ''
      const rawTemplate = customTemplates?.['location'] || MAP_TEMPLATES['location']
      const body = rawTemplate.replace(/^Hi,?\s*/i, '')
      const msg = `Hi ${pin.customerName}, ${body}${replyUrl ? `\nShare your location here: ${replyUrl}` : ''}`
      rows.push({ phone, message: msg })
    }
    const dayName = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date().getDay()]
    const fileName = `batch-message-${dayName}-${regionName.replace(/\s+/g, '-').toLowerCase()}`
    
    if (device === 'apple') {
      // Download as XLSX for Apple/iPhone - uses "Mobile" header
      const XLSX = await import('xlsx')
      const wsData = [['Mobile', 'Message'], ...rows.map(r => [r.phone, r.message])]
      const ws = XLSX.utils.aoa_to_sheet(wsData)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Messages')
      XLSX.writeFile(wb, `${fileName}.xlsx`)
    } else {
      // Download as CSV for Android
      const lines = rows.map(r => `${r.phone},"${r.message.replace(/"/g, '""')}"`)
      const csv = 'Phone,Message\n' + lines.join('\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${fileName}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
    markRegionExported(regionName)
    setExportedRegion(regionName)
    setTimeout(() => setExportedRegion(null), 3000)
    setExporting(null)
  }, [safeRegionGroups, customTemplates, markRegionExported])

  // ── Status change + Payment ──
  const handleMapDelivered = useCallback((pin: DeliveryPin) => {
    // Exchange / Trade-in / Refund: show protocol popup via paymentPopup with protocol flag
    if (isReturnOrder(pin)) {
      setPaymentPopup({ pin, protocol: true })
      return
    }
    setPaymentPopup({ pin })
  }, [])

  const confirmMapProtocol = useCallback(async () => {
    if (!paymentPopup) return
    const { pin } = paymentPopup
    const salesType = pin.salesType || ''
    setPaymentPopup(null)

    // Exchange: no payment needed
    if (salesType === 'exchange') {
      setUpdatingPinId(pin.id); setSelectedPin(null)
      await updateDeliveryStatusBulk(pin.itemIds, 'delivered', undefined, 'none')
      setUpdatingPinId(null)
      if (multiStopNav && navigating) arriveAtStopRef.current()
      router.refresh()
      return
    }

    // Refund: auto-cash
    if (salesType === 'refund') {
      setUpdatingPinId(pin.id); setSelectedPin(null)
      await updateDeliveryStatusBulk(pin.itemIds, 'delivered', undefined, 'cash')
      setUpdatingPinId(null)
      if (multiStopNav && navigating) arriveAtStopRef.current()
      router.refresh()
      return
    }

    // Trade-in with amount: show payment method picker
    if (salesType === 'trade_in' && (pin.amount || 0) > 0) {
      setPaymentPopup({ pin })
      return
    }

    // Trade-in with no amount
    setUpdatingPinId(pin.id); setSelectedPin(null)
    await updateDeliveryStatusBulk(pin.itemIds, 'delivered', undefined, 'none')
    setUpdatingPinId(null)
    if (multiStopNav && navigating) arriveAtStopRef.current()
    router.refresh()
  }, [paymentPopup, router, multiStopNav, navigating])

  const confirmMapPayment = useCallback(async (method: string, proofUrl?: string) => {
    if (!paymentPopup && !proofUrl) return
    const pin = paymentPopup?.pin
    if (!pin) return

    // Check if payment needs proof: 'paid' always, 'juice' when policy = 'contractor'
    if (!proofUrl) {
      const needsProof = method === 'paid' ||
        (method === 'juice' && pin.riderId && riderJuicePolicies[pin.riderId] === 'contractor')
      if (needsProof) {
        setMapProofStep({ pin, method })
        setPaymentPopup(null)
        return
      }
    }

    setPaymentPopup(null); setUpdatingPinId(pin.id)
    await updateDeliveryStatusBulk(pin.itemIds, 'delivered', undefined, method, proofUrl)
    setUpdatingPinId(null); setSelectedPin(null)
    if (multiStopNav && navigating) arriveAtStopRef.current()
    router.refresh()
  }, [paymentPopup, router, multiStopNav, navigating, riderJuicePolicies])

  const handleMapProofSubmit = useCallback(async () => {
    if (!mapProofStep || !mapProofFile) return
    setMapProofUploading(true)
    const fd = new FormData()
    fd.append('file', mapProofFile)
    const result = await uploadPaymentProof(fd)
    setMapProofUploading(false)
    if (result.error || !result.url) return

    const { pin, method } = mapProofStep
    setMapProofStep(null); setMapProofFile(null); setMapProofPreview(null)
    setUpdatingPinId(pin.id)
    await updateDeliveryStatusBulk(pin.itemIds, 'delivered', undefined, method, result.url)
    setUpdatingPinId(null); setSelectedPin(null)
    if (multiStopNav && navigating) arriveAtStopRef.current()
    router.refresh()
  }, [mapProofStep, mapProofFile, router, multiStopNav, navigating])

  const handleMapStatusChange = useCallback(async (pin: DeliveryPin, status: string, notes?: string, autoAdvance = false) => {
    setUpdatingPinId(pin.id)
    await updateDeliveryStatusBulk(pin.itemIds, status, notes)
    setUpdatingPinId(null); setSelectedPin(null)
    if (autoAdvance && multiStopNav) arriveAtStopRef.current()
    else if (autoAdvance && navigating) stopNavRef.current()
    router.refresh()
  }, [router, multiStopNav, navigating])

  const stopNavRef = useRef<() => void>(() => {})

  const handleCalledTwice = useCallback((pin: DeliveryPin) => {
    if (calledTwice.has(pin.id)) {
      handleMapStatusChange(pin, 'nwd', 'Called twice - no answer', true)
    } else {
      setCalledTwice(prev => new Set(prev).add(pin.id))
    }
  }, [calledTwice, handleMapStatusChange])

  const confirmCmsReason = useCallback(async (reason: string) => {
    if (!cmsPopup) return
    const { pin } = cmsPopup; setCmsPopup(null)
    await handleMapStatusChange(pin, 'cms', reason, true)
  }, [cmsPopup, handleMapStatusChange])

  // ── Pin placement ──
  const startPlacingPin = useCallback((pin: DeliveryPin) => {
    setPlacingPin(pin); setShowClientList(false); setClientSearch(''); setExpandedRegions(new Set()); setSelectedPin(null); setSelectedRegion(null)
    const regionMatch = regions.find(r => r.locality === pin.locality)
    if (regionMatch && mapRef.current) mapRef.current.flyTo({ center: [regionMatch.lng, regionMatch.lat], zoom: 16, pitch: 60, duration: 1400, essential: true })
  }, [regions])

  const confirmPinPlacement = useCallback(async () => {
    if (!mapRef.current || !placingPin) return; setSavingPin(true)
    const center = mapRef.current.getCenter()
    const ids = placingPin.itemIds?.length ? placingPin.itemIds : [placingPin.id]
    const pinLocality = placingPin.locality // Save the region before clearing
    await Promise.all(ids.map(id => updateDeliveryLocation(id, center.lat, center.lng, 'manual_pin')))
    setSavingPin(false); setPlacingPin(null)
    // Re-open client list with the same region expanded so user can continue with next client
    if (pinLocality) {
      setClientSearch(pinLocality)
      setExpandedRegions(new Set([pinLocality]))
    }
    setShowClientList(true)
    router.refresh()
  }, [placingPin, router])

  // ── Paste location link handler ──
  const extractCoordsFromLink = useCallback((url: string): { lat: number; lng: number } | null => {
    const qMatch = url.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/)
    if (qMatch) return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) }
    const atMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/)
    if (atMatch) return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) }
    const dirMatch = url.match(/\/(-?\d+\.?\d*),(-?\d+\.?\d*)/)
    if (dirMatch) return { lat: parseFloat(dirMatch[1]), lng: parseFloat(dirMatch[2]) }
    return null
  }, [])

  const handlePasteLocationLink = useCallback(async (pin: DeliveryPin, link: string) => {
    const coords = extractCoordsFromLink(link.trim())
    if (!coords) { alert('Could not extract location from that link. Try a Google Maps link.'); return }
    setUpdatingPinId(pin.id)
    const pinLocality = pin.locality // Save the region before updating
    const ids = pin.itemIds?.length ? pin.itemIds : [pin.id]
    await Promise.all(ids.map(id => updateDeliveryLocation(id, coords.lat, coords.lng, 'shared')))
    setUpdatingPinId(null); setLocationLinkInput(null); setLocationLinkValue('')
    // Re-open client list with the same region expanded so user can continue with next client
    if (pinLocality) {
      setClientSearch(pinLocality)
      setExpandedRegions(new Set([pinLocality]))
    }
    setShowClientList(true)
    router.refresh()
  }, [extractCoordsFromLink, router])

  // ── Optimize route ──
  const optimizeRegionRoute = useCallback(async (regionName: string) => {
    const group = safeRegionGroups.find(g => g.region === regionName)
    if (!group) return
    // Only include undelivered stops in the route
    const pendingRoutable = group.routable.filter(p => !['delivered', 'nwd', 'cms'].includes(p.status))
    if (pendingRoutable.length === 0) return
    setOptimizing(true); setActiveRegion(regionName)
    try {
      const coords = pendingRoutable.map(p => ({ lng: p.lng, lat: p.lat }))
      let startCoord = coords[0]
      if (driverLocation) startCoord = driverLocation
      else if (warehouseLng && warehouseLat) startCoord = { lng: warehouseLng, lat: warehouseLat }

      const res = await fetch('/api/optimize-route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ coordinates: [startCoord, ...coords], profile: 'mapbox/driving-traffic', roundtrip: false, source: 'first' }) })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      const ordered: OptimizedStop[] = []

      if (data.optimizedOrder) {
        // Server already sorted by optimized position (works for both chunked & non-chunked)
        for (const entry of data.optimizedOrder) {
          const origIdx = (entry.originalIndex ?? 0) - 1 // -1 because index 0 is driver
          const pin = pendingRoutable[origIdx]
          if (pin) ordered.push({ pin, sequence: ordered.length + 1 })
        }
      } else if (data.waypoints) {
        // Fallback: raw Mapbox waypoints — build a mapping from optimized position to original pin
        // waypoints[i] corresponds to coordinates[i]. waypoints[i].waypoint_index = optimized position.
        // Skip index 0 (driver position).
        const wpPairs: { optimizedPos: number; pin: DeliveryPin }[] = []
        for (let i = 1; i < data.waypoints.length; i++) {
          const wp = data.waypoints[i]
          const pin = pendingRoutable[i - 1] // coordinates[i] = pendingRoutable[i-1]
          if (pin) wpPairs.push({ optimizedPos: wp.waypoint_index, pin })
        }
        // Sort by optimized position to get the correct delivery order
        wpPairs.sort((a, b) => a.optimizedPos - b.optimizedPos)
        wpPairs.forEach((pair, idx) => ordered.push({ pin: pair.pin, sequence: idx + 1 }))
      }

      if (ordered.length === 0) pendingRoutable.forEach((pin, i) => ordered.push({ pin, sequence: i + 1 }))
      setOptimizedStops(ordered); setCurrentStopIdx(0); setShowClientList(false); setClientSearch(''); setExpandedRegions(new Set())

      // Render route line
      if (data.geometry && mapRef.current) {
        const map = mapRef.current
        ;['opt-route-casing', 'opt-route-line', 'opt-route-core'].forEach(l => { try { if (map.getLayer(l)) map.removeLayer(l) } catch {} })
        try { if (map.getSource('opt-route')) map.removeSource('opt-route') } catch {}
        map.addSource('opt-route', { type: 'geojson', data: { type: 'Feature', geometry: data.geometry, properties: {} } } as any)
        const lo: any = { 'line-join': 'round', 'line-cap': 'round' }
        try { map.addLayer({ id: 'opt-route-casing', type: 'line', source: 'opt-route', layout: lo, paint: { 'line-color': '#422006', 'line-width': 10, 'line-opacity': 0.8 } } as any) } catch {}
        try { map.addLayer({ id: 'opt-route-line', type: 'line', source: 'opt-route', layout: lo, paint: { 'line-color': '#fbbf24', 'line-width': 6, 'line-opacity': 0.9 } } as any) } catch {}
        try { map.addLayer({ id: 'opt-route-core', type: 'line', source: 'opt-route', layout: lo, paint: { 'line-color': '#fef3c7', 'line-width': 2, 'line-opacity': 0.7 } } as any) } catch {}
      }

      // Show route overview with all stops visible (don't auto-zoom to first stop)
      if (ordered.length > 0) {
        setMultiStopNav(true)
        setRouteOverview(true)
        setCurrentStopIdx(0)
        setNavTarget(ordered[0].pin) // Set first stop as target but don't zoom yet
        
        // Hide pole markers during optimization mode for cleaner view
        setShowPoles(false)
        if (map && (map as any)._regionPoleMarkers) {
          (map as any)._regionPoleMarkers.forEach((m: any) => { m.getElement().style.display = 'none' })
        }
        
        // Auto-fit to show all stops overview
        const bounds = new (mbgl()).LngLatBounds()
        ordered.forEach(s => bounds.extend([s.pin.lng, s.pin.lat]))
        if (driverLocation) bounds.extend([driverLocation.lng, driverLocation.lat])
        map.fitBounds(bounds, { padding: { top: 80, bottom: 300, left: 50, right: 50 }, pitch: 20, bearing: 0, duration: 1500 })
        
        // Keep overview visible - user can tap a stop or "Start" to begin navigation
      }
    } catch (e) { console.error('Optimize failed:', e) }
    finally { setOptimizing(false) }
  }, [safeRegionGroups, driverLocation, warehouseLat, warehouseLng])

  // ── Navigation ──
  const startNavigation = useCallback(async (pin: DeliveryPin) => {
    if (!mapRef.current) return
    setRouteLoading(true); setNavTarget(pin); setNavigating(true); setNavReady(false)
    setSelectedPin(null); setSelectedRegion(null); setCurrentStepIndex(0)

    try {
      // Use cached driver location first, fall back to fast low-accuracy then refine
      let rawPos = driverLocation
      if (!rawPos) {
        try {
          // Fast: low accuracy first (~0-1s)
          rawPos = await new Promise<{ lat: number; lng: number }>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
              p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
              reject, { enableHighAccuracy: false, timeout: 3000, maximumAge: 30000 }
            )
          })
        } catch {
          // Fallback to high accuracy if low fails
          rawPos = await new Promise<{ lat: number; lng: number }>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
              p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
              reject, { enableHighAccuracy: true, timeout: 8000 }
            )
          })
        }
      }

      // Fire API request immediately
      const trafficUrl = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${rawPos.lng},${rawPos.lat};${pin.lng},${pin.lat}?steps=true&geometries=geojson&overview=full&banner_instructions=true&roundabout_exits=true&language=en&annotations=congestion,speed,duration&access_token=${mapboxToken}`
      let data: any = await fetch(trafficUrl).then(r => r.json())
      if (!data.routes?.[0]) {
        data = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${rawPos.lng},${rawPos.lat};${pin.lng},${pin.lat}?steps=true&geometries=geojson&overview=full&banner_instructions=true&roundabout_exits=true&language=en&annotations=speed,duration&access_token=${mapboxToken}`).then(r => r.json())
      }
      if (!data.routes?.[0]) throw new Error(`No route found: ${data.code} ${data.message || ''}`)

      const route = data.routes[0]
      const geometry = route.geometry
      const routeStart = geometry.coordinates[0]
      const routeEnd = geometry.coordinates[geometry.coordinates.length - 1]

      // Place driver at route start
      const startPos = { lat: routeStart[1], lng: routeStart[0] }
      setDriverLocation(startPos)
      const coords = geometry.coordinates
      let startBearing = 0
      if (coords.length >= 2) {
        const [sLng1, sLat1] = coords[0]; const [sLng2, sLat2] = coords[Math.min(3, coords.length - 1)]
        const dL = ((sLng2 - sLng1) * Math.PI) / 180
        startBearing = (Math.atan2(Math.sin(dL) * Math.cos((sLat2 * Math.PI) / 180), Math.cos((sLat1 * Math.PI) / 180) * Math.sin((sLat2 * Math.PI) / 180) - Math.sin((sLat1 * Math.PI) / 180) * Math.cos((sLat2 * Math.PI) / 180) * Math.cos(dL)) * 180) / Math.PI
      }
      updateDriverMarker(startPos, startBearing)
      startContinuousTracking()

      // Start marker - only show in single navigation mode, not multi-stop optimization
      if ((mapRef.current as any)._startMarker) (mapRef.current as any)._startMarker.remove()
      if (!multiStopNav) {
        const startEl = document.createElement('div')
        startEl.style.cssText = 'display:flex;flex-direction:column;align-items:center;pointer-events:none;filter:drop-shadow(0 4px 12px rgba(251,191,36,0.5));'
        startEl.innerHTML = `<div style="padding:4px 12px;border-radius:4px;background:#422006;border:2px solid #fbbf24;"><span style="font-size:10px;font-weight:900;color:#fbbf24;letter-spacing:2px;">START</span></div><div style="width:3px;height:30px;background:linear-gradient(to bottom,#fbbf24,transparent);"></div><div style="position:relative;"><div style="width:16px;height:16px;border-radius:50%;background:#fbbf24;border:3px solid #422006;box-shadow:0 0 16px #fbbf24;"></div></div>`
        ;(mapRef.current as any)._startMarker = new (mbgl()).Marker({ element: startEl, anchor: 'bottom' }).setLngLat(routeStart).addTo(mapRef.current)
      }

      // Destination marker - only show in single navigation mode, not multi-stop optimization
      if ((mapRef.current as any)._destMarker) (mapRef.current as any)._destMarker.remove()
      if (!multiStopNav) {
        const destEl = document.createElement('div')
        destEl.style.cssText = 'display:flex;flex-direction:column;align-items:center;pointer-events:none;filter:drop-shadow(0 4px 12px rgba(34,197,94,0.5));'
        destEl.innerHTML = `<div style="padding:4px 12px;border-radius:4px;background:#052e16;border:2px solid #22c55e;"><div style="display:flex;align-items:center;gap:4px;"><svg viewBox="0 0 24 24" width="14" height="14" fill="#22c55e"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15" stroke="#22c55e" stroke-width="2"/></svg><span style="font-size:10px;font-weight:900;color:#22c55e;letter-spacing:2px;">${pin.customerName?.split(' ')[0]?.toUpperCase() || 'DEST'}</span></div></div><div style="width:3px;height:30px;background:linear-gradient(to bottom,#22c55e,transparent);"></div><div style="position:relative;"><div style="width:16px;height:16px;border-radius:50%;background:#22c55e;border:3px solid #052e16;box-shadow:0 0 16px #22c55e;"></div></div>`
        ;(mapRef.current as any)._destMarker = new (mbgl()).Marker({ element: destEl, anchor: 'bottom' }).setLngLat(routeEnd).addTo(mapRef.current)
      }

      // Add numbered 3D stop markers for all stops
      stopMarkersRef.current.forEach(m => m.remove())
      stopMarkersRef.current = []
      const stopsToMark = multiStopNav ? optimizedStops : optimizedStops.length === 1 ? optimizedStops : []
      if (stopsToMark.length > 0) {
        const mb2 = mbgl()
        stopsToMark.forEach((stop, idx) => {
          const isDone = ['delivered', 'nwd', 'cms'].includes(stop.pin.status)
          const isCurrent = idx === currentStopIdx
          const size = isCurrent ? 40 : 32
          const glow = isCurrent ? '0 0 20px rgba(0,255,255,0.6), 0 0 40px rgba(0,255,255,0.2)' : isDone ? 'none' : '0 0 12px rgba(59,130,246,0.5)'
          const bg = isDone ? 'linear-gradient(135deg, #374151, #1f2937)' : isCurrent ? 'linear-gradient(135deg, #06b6d4, #0891b2)' : 'linear-gradient(135deg, #2563eb, #1d4ed8)'
          const border = isDone ? '#6b7280' : isCurrent ? '#22d3ee' : '#3b82f6'
          const opacity = isDone ? '0.35' : '1'
          const name = stop.pin.customerName?.split(' ')[0] || ''
          const el = document.createElement('div')
          el.style.cssText = `display:flex;flex-direction:column;align-items:center;pointer-events:none;opacity:${opacity};z-index:${isCurrent ? 100 : 50 - idx};`
          el.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;filter:drop-shadow(0 4px 12px rgba(0,0,0,0.7));">
              <div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};border:3px solid ${border};display:flex;align-items:center;justify-content:center;box-shadow:${glow};${isCurrent ? 'animation:pulse 2s infinite;' : ''}">
                <span style="font-size:${isCurrent ? 16 : 13}px;font-weight:900;color:white;font-family:monospace;text-shadow:0 1px 3px rgba(0,0,0,0.5);">${idx + 1}</span>
              </div>
              <div style="padding:2px 6px;margin-top:3px;border-radius:4px;background:rgba(0,0,0,0.75);border:1px solid ${border}40;backdrop-filter:blur(4px);">
                <span style="font-size:8px;font-weight:700;color:${isDone ? '#9ca3af' : isCurrent ? '#22d3ee' : '#93c5fd'};font-family:monospace;letter-spacing:0.5px;white-space:nowrap;text-transform:uppercase;">${name}</span>
              </div>
              <div style="width:2px;height:16px;background:linear-gradient(to bottom, ${border}, transparent);"></div>
              <div style="width:8px;height:8px;border-radius:50%;background:${border};box-shadow:${glow};"></div>
            </div>`
          const marker = new mb2.Marker({ element: el, anchor: 'bottom' }).setLngLat([stop.pin.lng, stop.pin.lat]).addTo(mapRef.current!)
          stopMarkersRef.current.push(marker)
        })
      }

      // Route layers with congestion
      const congestion = route.legs?.[0]?.annotation?.congestion || []
      const segments: any[] = []
      for (let i = 0; i < coords.length - 1; i++) {
        const level = congestion[i] || 'low'
        const color = level === 'severe' ? '#ef4444' : level === 'heavy' ? '#f97316' : level === 'moderate' ? '#eab308' : '#00e5ff'
        segments.push({ type: 'Feature', properties: { color }, geometry: { type: 'LineString', coordinates: [coords[i], coords[i + 1]] } })
      }
      const congestionData = { type: 'FeatureCollection', features: segments.length > 0 ? segments : [{ type: 'Feature', properties: { color: '#00e5ff' }, geometry }] }

      // Clean old route layers
      const RL = ['route-casing','route-line','route-core']
      RL.forEach(l => { try { if (mapRef.current!.getLayer(l)) mapRef.current!.removeLayer(l) } catch {} })
      ;['route','route-congestion'].forEach(s => { try { if (mapRef.current!.getSource(s)) mapRef.current!.removeSource(s) } catch {} })

      mapRef.current.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry, properties: {} } } as any)
      mapRef.current.addSource('route-congestion', { type: 'geojson', data: congestionData } as any)

      const m = mapRef.current
      const lo: any = { 'line-join': 'round', 'line-cap': 'round' }

      // Mapbox-style clean route: casing + congestion fill + white center
      try { m.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: lo, paint: { 'line-color': '#1a1a2e', 'line-width': 14, 'line-opacity': 0.9 } } as any) } catch {}
      try { m.addLayer({ id: 'route-line', type: 'line', source: 'route-congestion', layout: lo, paint: { 'line-color': ['get', 'color'], 'line-width': 8, 'line-opacity': 1.0 } } as any) } catch {}
      try { m.addLayer({ id: 'route-core', type: 'line', source: 'route', layout: lo, paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-opacity': 0.6 } } as any) } catch {}

      // Route info
      const leg = route.legs[0]
      setRouteInfo({
        distance: (leg.distance / 1000).toFixed(1) + ' km',
        duration: Math.round(leg.duration / 60) + ' min',
        steps: leg.steps?.map((s: any) => ({ instruction: s.maneuver?.instruction || '', distance: s.distance < 1000 ? Math.round(s.distance) + ' m' : (s.distance / 1000).toFixed(1) + ' km', maneuver: s.maneuver?.type || '', modifier: s.maneuver?.modifier || '', name: s.name || '', location: s.maneuver?.location || null })) || [],
        geometry,
      })

      // Instant camera: jump straight to driver position, ready immediately
      const driverCenter: [number, number] = routeStart
      m.jumpTo({ center: driverCenter, zoom: 17, pitch: 65, bearing: startBearing })
      setNavReady(true)
    } catch (err: any) {
      alert('Navigation error: ' + (err?.message || 'Unknown') + '. Allow location permission.')
      setNavigating(false); setNavTarget(null); setNavReady(false)
    } finally { setRouteLoading(false) }
  }, [driverLocation, mapboxToken, updateDriverMarker, startContinuousTracking, snapToRoad, multiStopNav, optimizedStops])

  // Keep ref in sync so drag handlers can call startNavigation without circular deps
  startNavigationRef.current = startNavigation

  const stopNavigation = useCallback(() => {
    setNavigating(false); setNavTarget(null); setRouteInfo(null); setNavReady(false); setCurrentStopIdx(0); setCurrentStepIndex(0); setViewMode('3d'); setNavStopsExpanded(false); setArrivalAlert(null); setRouteOverview(false); routeOverviewRef.current = false; arrivalAlertedRef.current = ''
        stopMarkersRef.current.forEach(m => m.remove()); stopMarkersRef.current = []
    if (watchIdRef.current !== null) { navigator.geolocation.clearWatch(watchIdRef.current); watchIdRef.current = null }
    if (mapRef.current) {
      const m = mapRef.current
      ;['route-casing','route-line','route-core'].forEach(l => { try { if (m.getLayer(l)) m.removeLayer(l) } catch {} })
      ;['route','route-congestion'].forEach(s => { try { if (m.getSource(s)) m.removeSource(s) } catch {} })
      if ((m as any)._startMarker) { (m as any)._startMarker.remove(); (m as any)._startMarker = null }
      if ((m as any)._destMarker) { (m as any)._destMarker.remove(); (m as any)._destMarker = null }
      m.flyTo({ pitch: 60, bearing: -20, zoom: 15, duration: 800, essential: true })
    }
  }, [])
  stopNavRef.current = stopNavigation

  // ── Multi-stop navigation ──
  const startMultiStopNav = useCallback(() => {
    if (optimizedStops.length === 0) return
    setMultiStopNav(true); setCurrentStopIdx(0); startNavigationRef.current(optimizedStops[0].pin)
  }, [optimizedStops])

  const arriveAtStop = useCallback(() => {
    const nextIdx = currentStopIdx + 1
    if (nextIdx < optimizedStops.length) { setCurrentStopIdx(nextIdx); setNavStopsExpanded(false); startNavigationRef.current(optimizedStops[nextIdx].pin) }
    else {
      stopNavigation(); setMultiStopNav(false); setOptimizedStops([]); setCurrentStopIdx(0); setActiveRegion(null)
      const map = mapRef.current
      if (map) { ['opt-route-casing','opt-route-line','opt-route-core'].forEach(l => { try { if (map.getLayer(l)) map.removeLayer(l) } catch {} }); try { if (map.getSource('opt-route')) map.removeSource('opt-route') } catch {} }
    }
  }, [currentStopIdx, optimizedStops, stopNavigation])

  arriveAtStopRef.current = arriveAtStop

  const currentStep = routeInfo?.steps?.[currentStepIndex]

  // Distance to nav target (meters) for smart template + proximity alert
  const distToTarget = useMemo(() => {
    if (!driverLocation || !navTarget?.lat || !navTarget?.lng) return Infinity
    const R = 6371000
    const dLat = ((navTarget.lat - driverLocation.lat) * Math.PI) / 180
    const dLng = ((navTarget.lng - driverLocation.lng) * Math.PI) / 180
    const a = Math.sin(dLat / 2) ** 2 + Math.cos((driverLocation.lat * Math.PI) / 180) * Math.cos((navTarget.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }, [driverLocation, navTarget])

  // ── Arrival proximity alert (vibrate + toast when <80m) ──
  useEffect(() => {
    if (!navigating || !navTarget || distToTarget === Infinity) return
    if (distToTarget < 80 && arrivalAlertedRef.current !== navTarget.id) {
      arrivalAlertedRef.current = navTarget.id
      setArrivalAlert(navTarget.customerName)
      try { navigator?.vibrate?.([200, 100, 200]) } catch {}
      const t = setTimeout(() => setArrivalAlert(null), 4000)
      return () => clearTimeout(t)
    }
  }, [navigating, navTarget, distToTarget])

  // ═══════���══════════════════════════════════
  // ██  RENDER
  // ══════════════════════════════════════════
  return (
    <div ref={mapContainerParentRef} className={cn('flex flex-col h-full bg-black relative overflow-hidden', className)}>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes nav-pulse { 0%,100% { box-shadow: 0 0 12px rgba(0,229,255,0.5); } 50% { box-shadow: 0 0 30px rgba(0,229,255,0.9); } }
        @keyframes driver-ring { 0% { transform:scale(1);opacity:0.6; } 100% { transform:scale(2.5);opacity:0; } }
        @keyframes hud-glow { 0%,100% { text-shadow:0 0 8px rgba(0,229,255,0.5); } 50% { text-shadow:0 0 20px rgba(0,229,255,1); } }
        @keyframes slide-up { from { transform:translateY(20px);opacity:0; } to { transform:translateY(0);opacity:1; } }
        .hud-text { animation:hud-glow 2.5s ease-in-out infinite; }
        .slide-up { animation:slide-up 0.4s cubic-bezier(0.16,1,0.3,1); }
        .radar-ring { border: 1px solid rgba(0,229,255,0.15); border-radius: 50%; position: absolute; }
        .mapboxgl-ctrl-logo, .mapboxgl-ctrl-attrib, .mapboxgl-ctrl-bottom-left, .mapboxgl-ctrl-bottom-right { display: none !important; opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; }
      `}} />

      {/* Branding */}
      <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/5">
          <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(0,229,255,0.8)]" />
          <span className="text-[9px] font-bold text-white/50 tracking-[0.2em] uppercase">Business Hub</span>
        </div>
      </div>

      {/* Delivery Stats Bar - visible when not navigating */}
      {!navigating && mapLoaded && (
        <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
          <div className="flex items-center gap-3 px-4 py-2 rounded-2xl bg-black/80 backdrop-blur-xl border border-white/10 shadow-lg">
            <div className="flex items-center gap-1.5">
              <Package className="w-3 h-3 text-amber-400" />
              <span className="text-[10px] font-bold text-amber-400">{deliveryStats.pending}</span>
              <span className="text-[8px] text-white/30">left</span>
            </div>
            <div className="w-px h-3 bg-white/10" />
            <div className="flex items-center gap-1.5">
              <Check className="w-3 h-3 text-emerald-400" />
              <span className="text-[10px] font-bold text-emerald-400">{deliveryStats.done}</span>
              <span className="text-[8px] text-white/30">done</span>
            </div>
            {deliveryStats.failed > 0 && (
              <>
                <div className="w-px h-3 bg-white/10" />
                <div className="flex items-center gap-1.5">
                  <Ban className="w-3 h-3 text-red-400" />
                  <span className="text-[10px] font-bold text-red-400">{deliveryStats.failed}</span>
                </div>
              </>
            )}
            <div className="w-px h-3 bg-white/10" />
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-3 h-3 text-cyan-400" />
              <span className="text-[10px] font-bold text-cyan-400">{deliveryStats.total > 0 ? Math.round((deliveryStats.done / deliveryStats.total) * 100) : 0}%</span>
            </div>
          </div>
        </div>
      )}

  {/* Minimal loading during API fetch */}
  {navigating && !navReady && (
  <div className="absolute inset-0 z-30 pointer-events-none flex items-end justify-center pb-20">
  <div className="pointer-events-auto bg-black/80 backdrop-blur-md border border-cyan-400/15 rounded-xl px-5 py-3 flex items-center gap-3 shadow-[0_0_30px_rgba(0,0,0,0.5)]">
  <div className="w-5 h-5 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
  <div>
  <p className="text-xs font-bold text-white/80">{navTarget?.customerName || 'Loading...'}</p>
  <p className="text-[10px] text-cyan-400/50 font-mono">Fetching route</p>
  </div>
  <button onClick={stopNavigation} className="ml-2 px-3 py-1.5 rounded-lg bg-red-500/15 border border-red-400/20 text-red-400 text-[10px] font-bold active:scale-95 transition-all">Cancel</button>
          </div>
        </div>
      )}

      {/* Map Preloading Overlay */}
      {mapLoading && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center">
          <div className="w-16 h-16 border-4 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin mb-4" />
          <p className="text-white font-semibold text-sm">Loading map tiles...</p>
          <p className="text-cyan-400/70 text-xs mt-1">Preparing smooth experience</p>
        </div>
      )}

      {/* Arrival proximity alert banner */}
      {arrivalAlert && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-40 pointer-events-none animate-bounce">
          <div className="px-5 py-2.5 rounded-2xl bg-emerald-500/90 backdrop-blur-xl shadow-[0_0_30px_rgba(16,185,129,0.4)] border border-emerald-400/30">
            <p className="text-sm font-black text-white text-center">{"You've arrived"}</p>
            <p className="text-[10px] text-emerald-100/80 text-center">{arrivalAlert}</p>
          </div>
        </div>
      )}

      {/* Navigation HUD */}
      {navigating && navReady && navTarget && (
        <div className="absolute top-0 left-0 right-0 z-30 pointer-events-none">
          <div className="pointer-events-auto bg-gradient-to-b from-black/90 to-transparent px-3 pt-3 pb-10">
            <div className="flex items-center gap-2">
              {currentStep && (
                <div className="w-11 h-11 rounded-xl bg-cyan-500/10 border border-cyan-400/20 flex items-center justify-center shrink-0"
                  dangerouslySetInnerHTML={{ __html: getManeuverIcon(currentStep.maneuver || '', currentStep.modifier || '') }} />
              )}
              {currentStep && <p className="text-white text-sm font-black truncate flex-1">{currentStep.distance}</p>}
              <div className="relative w-11 h-11 shrink-0">
                <svg viewBox="0 0 60 60" className="w-full h-full">
                  <circle cx="30" cy="30" r="27" fill="rgba(0,0,0,0.5)" stroke="rgba(0,229,255,0.15)" strokeWidth="2" />
                  <circle cx="30" cy="30" r="27" fill="none" stroke="#00e5ff" strokeWidth="2.5" strokeDasharray={`${(speed / 80) * 170} 170`} strokeLinecap="round" className="transition-all duration-500" style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }} />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-xs font-black text-cyan-400 hud-text leading-none">{speed}</span>
                </div>
              </div>
              {routeInfo && (
                <div className="text-right shrink-0">
                  <p className="text-sm font-black text-white hud-text leading-none">{routeInfo.duration}</p>
                  <p className="text-[8px] text-white/40">{routeInfo.distance}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Map container - GPU accelerated for smooth zoom */}
      <div ref={mapContainerRef} className="flex-1 w-full transform-gpu" style={{ willChange: 'transform', backfaceVisibility: 'hidden' }} />

      {/* Mini-map radar */}
      <div className="absolute bottom-24 left-3 z-20 w-24 h-24 md:w-28 md:h-28 rounded-full overflow-hidden border-2 border-cyan-400/30 shadow-lg shadow-cyan-500/10">
        <div ref={miniMapRef} className="w-full h-full" />
        <div className="absolute inset-0 pointer-events-none">
          <div className="radar-ring inset-[15%]" />
          <div className="radar-ring inset-[30%]" />
          <div className="absolute top-1/2 left-0 right-0 h-px bg-cyan-400/10" />
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-cyan-400/10" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(0,229,255,0.8)]" />
        </div>
      </div>

      {/* Nav: View Route + Re-center buttons */}
      {navigating && navReady && (
        <div className="absolute top-3 right-3 z-30 flex flex-col gap-1.5">
          <button onClick={toggleFullscreen}
            className="w-10 h-10 rounded-xl bg-black/60 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white/50 active:scale-95 transition-all shadow-lg">
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <button onClick={() => {
            if (!mapRef.current) return
            if (routeOverview) {
              // Back to driver view
              setRouteOverview(false); routeOverviewRef.current = false
              if (driverLocation) {
                mapRef.current.flyTo({ center: [driverLocation.lng, driverLocation.lat], zoom: 17, pitch: 65, bearing: driverHeading || 0, duration: 1800, essential: true })
              }
            } else {
              // Show full route overview with all stops
              setRouteOverview(true); routeOverviewRef.current = true
              const mb2 = mbgl()
              const bounds = new mb2.LngLatBounds()
              if (routeInfo?.geometry?.coordinates) {
                (routeInfo.geometry.coordinates as number[][]).forEach((c: number[]) => bounds.extend(c))
              }
              if (multiStopNav) {
                optimizedStops.forEach(s => bounds.extend([s.pin.lng, s.pin.lat]))
              }
              if (driverLocation) bounds.extend([driverLocation.lng, driverLocation.lat])
              mapRef.current.fitBounds(bounds, { padding: { top: 60, bottom: 140, left: 40, right: 40 }, pitch: 20, bearing: 0, duration: 2000 })
            }
          }}
            className={cn('w-10 h-10 rounded-xl backdrop-blur-xl border flex items-center justify-center active:scale-95 transition-all shadow-lg',
              routeOverview ? 'bg-cyan-500/20 border-cyan-400/30 text-cyan-400' : 'bg-black/60 border-white/10 text-cyan-400/60')}>
            <MapPin className="w-4 h-4" />
          </button>
          <button onClick={() => {
            if (!mapRef.current || !driverLocation) return
            setRouteOverview(false); routeOverviewRef.current = false
            mapRef.current.flyTo({ center: [driverLocation.lng, driverLocation.lat], zoom: 17, pitch: 65, bearing: driverHeading || 0, duration: 1800, essential: true })
          }}
            className="w-10 h-10 rounded-xl bg-black/60 backdrop-blur-xl border border-white/10 flex items-center justify-center text-white/50 hover:text-cyan-400 active:scale-95 transition-all shadow-lg">
            <Locate className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Nav: Bottom panel */}
      {navigating && navReady && (
        <div className="absolute bottom-3 left-3 right-3 z-30">
          {multiStopNav && optimizedStops.length > 1 && (() => {
            const doneStops = optimizedStops.filter(s => ['delivered', 'nwd', 'cms'].includes(s.pin.status))
            const collected = optimizedStops.filter(s => s.pin.status === 'delivered').reduce((sum, s) => sum + (s.pin.amount || 0), 0)
            return (
              <div className="mb-2 max-w-sm mx-auto">
                <div className="flex items-center justify-between px-2 mb-1.5">
                  <span className="text-[9px] text-cyan-400/40 font-mono tracking-wide">{doneStops.length}/{optimizedStops.length} STOPS</span>
                  {collected > 0 && <span className="text-[9px] text-emerald-400/60 font-mono" style={{ textShadow: '0 0 8px rgba(52,211,153,0.3)' }}>Rs {collected.toLocaleString()}</span>}
                </div>
                <div className="flex items-center gap-1 px-2" ref={el => {
                  if (!el) return
                  let dragIdx: number | null = null
                  let overIdx: number | null = null
                  const getIdx = (x: number) => {
                    const btns = Array.from(el.children) as HTMLElement[]
                    for (let i = 0; i < btns.length; i++) {
                      const r = btns[i].getBoundingClientRect()
                      if (x >= r.left && x <= r.right) return i
                    }
                    return null
                  }
                  el.ontouchstart = (e) => {
                    const idx = getIdx(e.touches[0].clientX)
                    if (idx === null) return
                    const isDone = ['delivered', 'nwd', 'cms'].includes(optimizedStops[idx]?.pin.status)
                    if (isDone) return
                    dragIdx = idx
                  }
                  el.ontouchmove = (e) => {
                    if (dragIdx === null) return
                    e.preventDefault()
                    const idx = getIdx(e.touches[0].clientX)
                    if (idx !== null && idx !== dragIdx) {
                      const isDone = ['delivered', 'nwd', 'cms'].includes(optimizedStops[idx]?.pin.status)
                      if (!isDone) overIdx = idx
                    }
                    // Visual feedback
                    const btns = Array.from(el.children) as HTMLElement[]
                    btns.forEach((b, i) => { b.style.transform = i === overIdx && overIdx !== dragIdx ? 'scale(1.15)' : '' })
                  }
                  el.ontouchend = () => {
                    if (dragIdx !== null && overIdx !== null && dragIdx !== overIdx) {
                      const newStops = [...optimizedStops]
                      const [moved] = newStops.splice(dragIdx, 1)
                      newStops.splice(overIdx, 0, moved)
                      setOptimizedStops(newStops)
                      // If current stop moved, update index
                      if (dragIdx === currentStopIdx) setCurrentStopIdx(overIdx)
                      else if (overIdx <= currentStopIdx && dragIdx > currentStopIdx) setCurrentStopIdx(currentStopIdx + 1)
                      else if (overIdx >= currentStopIdx && dragIdx < currentStopIdx) setCurrentStopIdx(currentStopIdx - 1)
                      // Reroute to new current stop
                      setTimeout(() => startNavigationRef.current(newStops[currentStopIdx].pin), 150)
                    }
                    // Reset visual
                    const btns = Array.from(el.children) as HTMLElement[]
                    btns.forEach(b => { b.style.transform = '' })
                    dragIdx = null; overIdx = null
                  }
                }}>
                  {optimizedStops.map((s, i) => {
                    const isDone = ['delivered', 'nwd', 'cms'].includes(s.pin.status)
                    const isCurr = i === currentStopIdx
                    return (
                      <button key={s.pin.id} onClick={() => {
                        if (isDone || isCurr) return
                        // Navigate to selected stop and fly to its location
                        const selectedStop = s.pin
                        setCurrentStopIdx(i)
                        setNavStopsExpanded(false)
                        // Fly to the selected stop location first
                        const map = mapRef.current
                        if (map && selectedStop.latitude && selectedStop.longitude) {
                          map.flyTo({ center: [selectedStop.longitude, selectedStop.latitude], zoom: 16, pitch: 60, duration: 1000 })
                        }
                        // Then start navigation to that stop
                        setTimeout(() => startNavigationRef.current(selectedStop), 150)
                      }}
                        className={cn('relative h-7 flex-1 flex items-center justify-center rounded-lg transition-all touch-none',
                          isDone ? 'bg-emerald-500/15' : isCurr ? 'bg-cyan-500/20 ring-1 ring-cyan-400/30' : 'bg-white/[0.03] hover:bg-white/[0.06] active:scale-95')}
                        title={s.pin.customerName}>
                        <span className={cn('text-[8px] font-mono font-bold',
                          isDone ? 'text-emerald-400/70' : isCurr ? 'text-cyan-400' : 'text-white/25')}>{i + 1}</span>
                        <div className={cn('absolute bottom-0 left-0 right-0 h-1 rounded-full',
                          isDone ? 'bg-emerald-400/80 shadow-[0_0_8px_rgba(52,211,153,0.4)]' : isCurr ? 'bg-cyan-400 shadow-[0_0_12px_rgba(0,200,255,0.6)] animate-pulse' : 'bg-white/8')} />
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })()}
          <div className="holo-panel rounded-2xl overflow-hidden nav-card-3d glow-border-pulse">
            {/* ═══ COMPACT CURRENT STOP ═══ */}
            {navTarget && (
              <div className="px-3 pt-3 pb-2 relative">
                {/* Row 1: Status dot + Name + Price + List toggle */}
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full shrink-0 shadow-[0_0_6px_currentColor]" style={{ backgroundColor: STATUS_COLORS[navTarget.status]?.dot || '#6b7280' }} />
                  <p className="text-[12px] font-bold text-white truncate flex-1">{navTarget.customerName}</p>
                  {isReturnOrder(navTarget) && (navTarget.amount || 0) <= 0 ? (
                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded shrink-0 ${navTarget.salesType === 'exchange' ? 'bg-violet-500/20 text-violet-400' : navTarget.salesType === 'trade_in' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'}`}>
                      {getReturnLabel(navTarget.salesType!)}
                    </span>
                  ) : (
                    <span className="text-[11px] font-black text-cyan-400 font-mono shrink-0" style={{ textShadow: '0 0 8px rgba(0,200,255,0.4)' }}>Rs {navTarget.amount.toLocaleString()}</span>
                  )}
                  {navTarget.locationFlagged && <span className="text-[7px] text-red-400 font-bold animate-pulse shrink-0">FLAG</span>}
                  <button onClick={() => setNavStopsExpanded(!navStopsExpanded)}
                    className={cn('btn-holo w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 transition-all',
                      navStopsExpanded ? 'bg-cyan-500/15 border-cyan-400/25 text-cyan-400' : 'bg-white/5 border-white/10 text-white/30')}>
                    <List className="w-3.5 h-3.5" />
                  </button>
                </div>
                {/* Row 2: Product (compact single line) */}
                <p className="text-[10px] text-white/50 font-mono truncate mt-1 ml-4">
                  {navTarget.items?.length ? navTarget.items.map((item, i) => `${item.qty}x ${item.name}`).join(' • ') : navTarget.products}
                </p>
                {/* Row 3: Badges + Notes (only if exists) */}
                {(navTarget.deliveryNotes || navTarget.source === 'geocoded') && (
                  <div className="flex items-center gap-1.5 mt-1.5 ml-4">
                    {navTarget.source === 'response' && <span className="text-[7px] text-cyan-400/50 font-mono px-1 py-px rounded bg-cyan-500/10">GPS</span>}
                    {navTarget.source === 'geocoded' && <span className="text-[7px] text-orange-400/60 font-mono px-1 py-px rounded bg-orange-500/10">APPROX</span>}
                    {navTarget.deliveryNotes && <p className="text-[8px] text-amber-400/40 truncate flex-1 font-mono">{navTarget.deliveryNotes}</p>}
                  </div>
                )}
              </div>
            )}

            {/* ═══ EXPANDED: Route Stops List ═══ */}
            {navStopsExpanded && (() => {
              const regionName = activeRegion || navTarget?.locality
              const regionGroup = regionName ? safeRegionGroups.find(g => g.region === regionName) : null
              const unreachable = (regionGroup?.unreachable || []).filter(u => !['delivered', 'nwd', 'cms'].includes(u.status))
              const nearby = !multiStopNav && regionGroup ? [...regionGroup.routable, ...regionGroup.unreachable].filter(p => p.id !== navTarget?.id && !['delivered', 'nwd', 'cms'].includes(p.status)) : []
              return (
                <div className="max-h-[280px] touch-scroll relative">
                  <div className="glow-line" />
                  {multiStopNav && optimizedStops.map((stop, i) => {
                    const p = stop.pin
                    const isCurrent = i === currentStopIdx
                    const isDone = ['delivered', 'nwd', 'cms'].includes(p.status)
                    const isStopExpanded = expandedRegions.has(`nav-stop-${p.id}`)
                    return (
                      <div key={p.id} data-stop-row
                        draggable={!isDone}
                        onDragStart={(e) => !isDone && handleDragStart(i, e)}
                        onDragEnd={handleDragEnd}
                        onDragOver={(e) => handleDragOver(i, e)}
                        className={cn(
                          'transition-all duration-200 select-none border-b border-white/[0.03]',
                          isCurrent && 'bg-cyan-500/[0.06] border-l-2 border-l-cyan-400',
                          !isDone && 'cursor-grab active:cursor-grabbing',
                          dragIdx === i && 'opacity-30 scale-95',
                          dragOverIdx === i && dragIdx !== null && dragIdx !== i && 'bg-amber-500/10 border-amber-400/20 shadow-[inset_0_0_20px_rgba(251,191,36,0.08)]',
                        )}>
                        <div className="flex items-center gap-2 px-3 py-2.5">
                          {/* Grip handle */}
                          {!isDone ? (
                            <div className="shrink-0 text-white/15 hover:text-amber-400 transition touch-none"
                              onTouchStart={(e) => handleTouchStart(i, e)}
                              onTouchMove={handleTouchMove}
                              onTouchEnd={handleTouchEnd}>
                              <GripVertical className="w-3.5 h-3.5" />
                            </div>
                          ) : (
                            <div className="w-3.5 shrink-0" />
                          )}
                          {/* Sequence badge */}
                          <div className={cn('w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 text-[9px] font-black font-mono transition-all',
                            isDone ? 'bg-emerald-500/15 border-emerald-500/20 text-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.2)]' : isCurrent ? 'bg-cyan-500/15 border-cyan-400/25 text-cyan-400 shadow-[0_0_8px_rgba(0,200,255,0.3)]' : 'bg-white/5 border-white/10 text-white/35',
                            dragOverIdx === i && dragIdx !== null && dragIdx !== i && !isDone && 'shadow-[0_0_12px_rgba(251,191,36,0.4)] border-amber-400/50')}>
                            {isDone ? <Check className="w-3 h-3" /> : i + 1}
                          </div>
                          {/* Client info - tap to expand location options */}
                          <button onClick={(e) => { e.stopPropagation(); if (!isDone) setExpandedRegions(prev => { const next = new Set(prev); const key = `nav-stop-${p.id}`; next.has(key) ? next.delete(key) : next.add(key); return next }) }}
                            className="flex-1 min-w-0 text-left">
                            <p className={cn('text-[11px] font-semibold truncate', isDone ? 'text-white/25 line-through' : isCurrent ? 'text-white' : 'text-white/70')}>{p.customerName}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className={cn('text-[9px] font-mono', isDone ? 'text-white/15' : 'text-white/35')}>{p.items?.length ? p.items.map((it, i) => <span key={i} className="block">{it.qty} x {it.name}</span>) : p.products}</span>
                              {isReturnOrder(p) && (p.amount || 0) <= 0 ? (
                                <span className={cn('text-[8px] font-bold px-1 py-px rounded shrink-0', isDone ? 'bg-white/5 text-white/15' : p.salesType === 'exchange' ? 'bg-violet-500/20 text-violet-400' : p.salesType === 'trade_in' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400')}>
                                  {getReturnLabel(p.salesType!)}
                                </span>
                              ) : (
                                <span className={cn('text-[9px] font-mono font-bold shrink-0', isDone ? 'text-white/15' : 'text-cyan-400/50')}>Rs {p.amount.toLocaleString()}</span>
                              )}
                            </div>
                          </button>
                          {/* Action buttons */}
                          {!isDone && (
                            <div className="flex items-center gap-1 shrink-0">
                              {!isRegionBatchExported(getRegionForPin(p) || '') && (
                              <button onClick={(e) => { e.stopPropagation(); sendMapMessage(p, 'sms', p.source === 'geocoded' ? 'location' : isCurrent ? 'arrived' : 'onway') }} disabled={sendingMsg === p.id || !p.contact1}
                                className={cn('btn-holo w-7 h-7 rounded-lg flex items-center justify-center',
                                  !p.contact1 ? 'bg-white/3 text-white/10' : contactedMap[p.id]?.sms ? 'bg-amber-500/10 text-amber-400 border border-amber-400/10' : 'bg-blue-500/10 text-blue-400 border border-blue-400/10')}>
                                {sendingMsg === p.id ? <div className="w-2.5 h-2.5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" /> :
                                <Mail className="w-3 h-3" />}
                              </button>
                              )}
                              <a href={p.contact1 ? `tel:${formatPhone(p.contact1)}` : '#'} onClick={(e) => { e.stopPropagation(); if (!p.contact1) e.preventDefault(); else markContacted(p.id, 'call') }}
                                className={cn('btn-holo w-7 h-7 rounded-lg flex items-center justify-center',
                                  !p.contact1 ? 'bg-white/3 text-white/10' : contactedMap[p.id]?.call ? 'bg-amber-500/10 text-amber-400 border border-amber-400/10' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-400/10')}>
                                <Phone className="w-3 h-3" />
                              </a>
                            </div>
                          )}
                        </div>
                        {/* ── Expanded: Update location (re-pin/paste link only for GPS clients) ── */}
                        {isStopExpanded && !isDone && (
                          <div className="px-3 pb-2.5 border-t border-white/[0.04] bg-white/[0.02]">
                            <div className="flex items-center gap-2 py-2">
                              <span className="text-[9px] text-white/25 font-mono uppercase tracking-wider">Update Location</span>
                              <div className="flex-1 h-px bg-white/[0.05]" />
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {/* Pin on map - always available */}
                              <button onClick={(e) => { e.stopPropagation(); startPlacingPin(p); setNavStopsExpanded(false) }}
                                className="btn-holo h-8 px-3 rounded-lg flex items-center gap-1.5 bg-cyan-500/8 text-cyan-400 border border-cyan-400/10 text-[10px] font-mono">
                                <Crosshair className="w-3.5 h-3.5" />Pin on Map
                              </button>
                            </div>
                            {/* Paste Google Maps link */}
                            <div className="mt-2">
                              {locationLinkInput === p.id ? (
                                <div className="flex items-center gap-1.5">
                                  <input type="text" value={locationLinkValue} onChange={e => setLocationLinkValue(e.target.value)}
                                    placeholder="Paste Google Maps link..."
                                    className="flex-1 h-8 px-3 rounded-lg bg-cyan-500/5 border border-cyan-400/15 text-[11px] text-white placeholder:text-white/20 outline-none focus:border-cyan-400/30 font-mono"
                                    autoFocus onKeyDown={e => { if (e.key === 'Enter' && locationLinkValue) handlePasteLocationLink(p, locationLinkValue) }}
                                  />
                                  <button onClick={(e) => { e.stopPropagation(); handlePasteLocationLink(p, locationLinkValue) }} disabled={!locationLinkValue || updatingPinId === p.id}
                                    className="btn-holo w-8 h-8 rounded-lg flex items-center justify-center bg-cyan-500/15 border border-cyan-400/15 disabled:opacity-20">
                                    {updatingPinId === p.id ? <div className="w-3 h-3 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" /> : <Check className="w-3.5 h-3.5 text-cyan-400" />}
                                  </button>
                                  <button onClick={(e) => { e.stopPropagation(); setLocationLinkInput(null); setLocationLinkValue('') }}
                                    className="btn-holo w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/5">
                                    <X className="w-3.5 h-3.5 text-white/30" />
                                  </button>
                                </div>
                              ) : (
                                <button onClick={(e) => { e.stopPropagation(); setLocationLinkInput(p.id); setLocationLinkValue('') }}
                                  className="btn-holo h-8 px-3 rounded-lg flex items-center gap-1.5 bg-amber-500/8 text-amber-400/70 border border-amber-400/10 text-[10px] font-mono w-full justify-center">
                                  <Link2 className="w-3.5 h-3.5" />Paste Shared Location Link
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {/* Single-stop: other clients in same area */}
                  {nearby.length > 0 && (
                    <>
                      <div className="px-3 py-2 bg-white/[0.02]">
                        <div className="flex items-center gap-2">
                          <div className="w-1 h-3 rounded-full bg-white/20" />
                          <p className="text-[9px] font-bold text-white/30 uppercase tracking-[0.15em] font-mono">Same Area ({nearby.length})</p>
                        </div>
                      </div>
                      {nearby.map(n => {
                        const isNExpanded = expandedRegions.has(`nav-nearby-${n.id}`)
                        const needsLocation = n.source === 'geocoded' || !n.lat
                        return (
                        <div key={n.id} className="border-b border-white/[0.03]">
                          <div className="flex items-center gap-2 px-3 py-2.5">
                            <div className="w-6 h-6 rounded-lg border border-white/10 flex items-center justify-center shrink-0">
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[n.status]?.dot || '#6b7280' }} />
                            </div>
                            <button onClick={() => setExpandedRegions(prev => { const next = new Set(prev); const key = `nav-nearby-${n.id}`; next.has(key) ? next.delete(key) : next.add(key); return next })}
                              className="flex-1 min-w-0 text-left">
                              <p className="text-[11px] font-medium text-white/60 truncate">{n.customerName}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[9px] text-white/25 truncate max-w-[120px] font-mono">{n.products}</span>
                                {n.deliveryNotes && <span className="text-[8px] text-amber-400/40 truncate font-mono">{n.deliveryNotes}</span>}
                              </div>
                            </button>
                            <div className="flex items-center gap-1 shrink-0">
                              {!isRegionBatchExported(getRegionForPin(n) || '') && (
                              <button onClick={() => sendMapMessage(n, 'sms', needsLocation ? 'location' : 'onway')} disabled={sendingMsg === n.id || !n.contact1}
                                className={cn('btn-holo w-7 h-7 rounded-lg flex items-center justify-center',
                                  !n.contact1 ? 'bg-white/3 text-white/10' : contactedMap[n.id]?.sms ? 'bg-amber-500/10 text-amber-400 border border-amber-400/10' : 'bg-blue-500/10 text-blue-400 border border-blue-400/10')}>
                                {sendingMsg === n.id ? <div className="w-2.5 h-2.5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" /> :
                                <Mail className="w-3 h-3" />}
                              </button>
                              )}
                              <a href={n.contact1 ? `tel:${formatPhone(n.contact1)}` : '#'} onClick={e => { if (!n.contact1) e.preventDefault(); else markContacted(n.id, 'call') }}
                                className={cn('btn-holo w-7 h-7 rounded-lg flex items-center justify-center',
                                  !n.contact1 ? 'bg-white/3 text-white/10' : contactedMap[n.id]?.call ? 'bg-amber-500/10 text-amber-400 border border-amber-400/10' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-400/10')}>
                                <Phone className="w-3 h-3" />
                              </a>
                            </div>
                          </div>
                          {/* Expanded: Location update for nearby */}
                          {isNExpanded && (
                            <div className="px-3 pb-2.5 border-t border-white/[0.04] bg-white/[0.02]">
                              <div className="flex items-center gap-2 py-2">
                                <span className="text-[9px] text-white/25 font-mono uppercase tracking-wider">Update Location</span>
                                <div className="flex-1 h-px bg-white/[0.05]" />
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5">

                                <button onClick={() => { startPlacingPin(n); setNavStopsExpanded(false) }}
                                  className="btn-holo h-8 px-3 rounded-lg flex items-center gap-1.5 bg-cyan-500/8 text-cyan-400 border border-cyan-400/10 text-[10px] font-mono">
                                  <Crosshair className="w-3.5 h-3.5" />Pin on Map
                                </button>
                              </div>
                              <div className="mt-2">
                                {locationLinkInput === n.id ? (
                                  <div className="flex items-center gap-1.5">
                                    <input type="text" value={locationLinkValue} onChange={e => setLocationLinkValue(e.target.value)}
                                      placeholder="Paste Google Maps link..."
                                      className="flex-1 h-8 px-3 rounded-lg bg-cyan-500/5 border border-cyan-400/15 text-[11px] text-white placeholder:text-white/20 outline-none focus:border-cyan-400/30 font-mono"
                                      autoFocus onKeyDown={e => { if (e.key === 'Enter' && locationLinkValue) handlePasteLocationLink(n, locationLinkValue) }}
                                    />
                                    <button onClick={() => handlePasteLocationLink(n, locationLinkValue)} disabled={!locationLinkValue || updatingPinId === n.id}
                                      className="btn-holo w-8 h-8 rounded-lg flex items-center justify-center bg-cyan-500/15 border border-cyan-400/15 disabled:opacity-20">
                                      {updatingPinId === n.id ? <div className="w-3 h-3 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" /> : <Check className="w-3.5 h-3.5 text-cyan-400" />}
                                    </button>
                                    <button onClick={() => { setLocationLinkInput(null); setLocationLinkValue('') }}
                                      className="btn-holo w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/5">
                                      <X className="w-3.5 h-3.5 text-white/30" />
                                    </button>
                                  </div>
                                ) : (
                                  <button onClick={() => { setLocationLinkInput(n.id); setLocationLinkValue('') }}
                                    className="btn-holo h-8 px-3 rounded-lg flex items-center gap-1.5 bg-amber-500/8 text-amber-400/70 border border-amber-400/10 text-[10px] font-mono w-full justify-center">
                                    <Link2 className="w-3.5 h-3.5" />Paste Shared Location Link
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        )
                      })}
                    </>
                  )}
                  {/* Unreachable clients */}
                  {unreachable.length > 0 && (
                    <>
                      <div className="px-3 py-2 bg-orange-500/[0.03]">
                        <div className="flex items-center gap-2">
                          <div className="w-1 h-3 rounded-full bg-orange-400/40 shadow-[0_0_4px_rgba(251,146,60,0.3)]" />
                          <p className="text-[9px] font-bold text-orange-400/60 uppercase tracking-[0.15em] font-mono">Need Location ({unreachable.length})</p>
                        </div>
                      </div>
                      {unreachable.map(u => {
                        const isUExpanded = expandedRegions.has(`nav-unreach-${u.id}`)
                        return (
                        <div key={u.id} className="border-b border-orange-400/[0.05]">
                          <div className="flex items-center gap-2 px-3 py-2.5">
                            <div className="w-6 h-6 rounded-lg bg-orange-500/10 border border-orange-400/15 flex items-center justify-center shrink-0">
                              <MapPin className="w-3 h-3 text-orange-400/60" />
                            </div>
                            <button onClick={() => setExpandedRegions(prev => { const next = new Set(prev); const key = `nav-unreach-${u.id}`; next.has(key) ? next.delete(key) : next.add(key); return next })}
                              className="flex-1 min-w-0 text-left">
                              <p className="text-[11px] font-medium text-white/60 truncate">{u.customerName}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[9px] text-white/25 truncate max-w-[120px] font-mono">{u.products}</span>
                                {isReturnOrder(u) && (u.amount || 0) <= 0 ? (
                                  <span className={`text-[8px] font-bold px-1 py-px rounded shrink-0 ${u.salesType === 'exchange' ? 'bg-violet-500/20 text-violet-400' : u.salesType === 'trade_in' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'}`}>{getReturnLabel(u.salesType!)}</span>
                                ) : (
                                  <span className="text-[9px] text-cyan-400/40 font-mono font-bold shrink-0">Rs {u.amount.toLocaleString()}</span>
                                )}
                              </div>
                            </button>
                            <div className="flex items-center gap-1 shrink-0">
                              {!isRegionBatchExported(getRegionForPin(u) || '') && (
                              <button onClick={() => sendMapMessage(u, 'sms', 'location')} disabled={sendingMsg === u.id || !u.contact1}
                                className={cn('btn-holo w-7 h-7 rounded-lg flex items-center justify-center',
                                  !u.contact1 ? 'bg-white/3 text-white/10' : contactedMap[u.id]?.sms ? 'bg-amber-500/10 text-amber-400 border border-amber-400/10' : 'bg-blue-500/10 text-blue-400 border border-blue-400/10')}>
                                {sendingMsg === u.id ? <div className="w-2.5 h-2.5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" /> :
                                <Mail className="w-3 h-3" />}
                              </button>
                              )}
                              <a href={u.contact1 ? `tel:${formatPhone(u.contact1)}` : '#'} onClick={e => { if (!u.contact1) e.preventDefault(); else markContacted(u.id, 'call') }}
                                className={cn('btn-holo w-7 h-7 rounded-lg flex items-center justify-center',
                                  !u.contact1 ? 'bg-white/3 text-white/10' : contactedMap[u.id]?.call ? 'bg-amber-500/10 text-amber-400 border border-amber-400/10' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-400/10')}>
                                <Phone className="w-3 h-3" />
                              </a>
                            </div>
                          </div>
                          {/* Expanded: Location update for unreachable */}
                          {isUExpanded && (
                            <div className="px-3 pb-2.5 border-t border-orange-400/[0.04] bg-orange-500/[0.02]">
                              <div className="flex items-center gap-2 py-2">
                                <span className="text-[9px] text-orange-400/30 font-mono uppercase tracking-wider">Set Location</span>
                                <div className="flex-1 h-px bg-orange-400/[0.08]" />
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5">

                                {u.contact1 && (
                                  <button onClick={() => sendMapMessage(u, 'sms', 'location')} disabled={sendingMsg === u.id}
                                    className="btn-holo h-8 px-3 rounded-lg flex items-center gap-1.5 bg-blue-500/8 text-blue-400 border border-blue-400/10 text-[10px] font-mono">
                                    <Mail className="w-3.5 h-3.5" />SMS Location
                                  </button>
                                )}
                                <button onClick={() => { startPlacingPin(u); setNavStopsExpanded(false) }}
                                  className="btn-holo h-8 px-3 rounded-lg flex items-center gap-1.5 bg-cyan-500/8 text-cyan-400 border border-cyan-400/10 text-[10px] font-mono">
                                  <Crosshair className="w-3.5 h-3.5" />Pin on Map
                                </button>
                              </div>
                              {/* Paste link */}
                              <div className="mt-2">
                                {locationLinkInput === u.id ? (
                                  <div className="flex items-center gap-1.5">
                                    <input type="text" value={locationLinkValue} onChange={e => setLocationLinkValue(e.target.value)}
                                      placeholder="Paste Google Maps link..."
                                      className="flex-1 h-8 px-3 rounded-lg bg-cyan-500/5 border border-cyan-400/15 text-[11px] text-white placeholder:text-white/20 outline-none focus:border-cyan-400/30 font-mono"
                                      autoFocus onKeyDown={e => { if (e.key === 'Enter' && locationLinkValue) handlePasteLocationLink(u, locationLinkValue) }}
                                    />
                                    <button onClick={() => handlePasteLocationLink(u, locationLinkValue)} disabled={!locationLinkValue || updatingPinId === u.id}
                                      className="btn-holo w-8 h-8 rounded-lg flex items-center justify-center bg-cyan-500/15 border border-cyan-400/15 disabled:opacity-20">
                                      {updatingPinId === u.id ? <div className="w-3 h-3 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" /> : <Check className="w-3.5 h-3.5 text-cyan-400" />}
                                    </button>
                                    <button onClick={() => { setLocationLinkInput(null); setLocationLinkValue('') }}
                                      className="btn-holo w-8 h-8 rounded-lg flex items-center justify-center bg-white/5 border border-white/5">
                                      <X className="w-3.5 h-3.5 text-white/30" />
                                    </button>
                                  </div>
                                ) : (
                                  <button onClick={() => { setLocationLinkInput(u.id); setLocationLinkValue('') }}
                                    className="btn-holo h-8 px-3 rounded-lg flex items-center gap-1.5 bg-amber-500/8 text-amber-400/70 border border-amber-400/10 text-[10px] font-mono w-full justify-center">
                                    <Link2 className="w-3.5 h-3.5" />Paste Shared Location Link
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        )
                      })}
                    </>
                  )}
                </div>
              )
            })()}

            {/* ═══ COMPACT ACTION BAR ═══ */}
            {navTarget && !navStopsExpanded && (
              <div className="px-3 pb-3">
                {!['delivered', 'nwd', 'cms'].includes(navTarget.status) ? (
                  <div className="space-y-1.5">
                    {/* Row 1: SMS + Call + Delivered */}
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => sendMapMessage(navTarget, 'sms', distToTarget < 200 ? 'arrived' : 'onway')} disabled={sendingMsg === navTarget.id || !navTarget.contact1 || isRegionBatchExported(getRegionForPin(navTarget) || '')}
                        className={cn("btn-holo flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[9px] font-bold border transition",
                          !navTarget.contact1 || isRegionBatchExported(getRegionForPin(navTarget) || '') ? "bg-white/3 text-white/15 border-white/5"
                          : contactedMap[navTarget.id]?.sms ? "bg-amber-500/10 text-amber-400 border-amber-400/15" : "bg-blue-500/10 text-blue-400 border-blue-400/15")}>
                        {sendingMsg === navTarget.id ? <div className="w-2.5 h-2.5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" /> : <Mail className="w-3 h-3" />}
                        {distToTarget < 200 ? 'Arrived' : 'On way'}
                      </button>
                      <a href={navTarget.contact1 ? `tel:${formatPhone(navTarget.contact1)}` : '#'} onClick={e => { if (!navTarget.contact1) e.preventDefault(); else markContacted(navTarget.id, 'call') }}
                        className={cn("btn-holo w-9 h-9 rounded-lg border flex items-center justify-center shrink-0",
                          !navTarget.contact1 ? "bg-white/3 text-white/15 border-white/5" : contactedMap[navTarget.id]?.call ? "bg-amber-500/10 text-amber-400 border-amber-400/15" : "bg-emerald-500/10 text-emerald-400 border-emerald-400/15")}>
                        <Phone className="w-3.5 h-3.5" />
                      </a>
                      <button onClick={() => handleMapDelivered(navTarget)} disabled={updatingPinId === navTarget.id}
                        className={cn("btn-holo flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] font-bold disabled:opacity-50",
                          isReturnOrder(navTarget) ? "bg-violet-500/15 text-violet-400 border border-violet-400/20" : "bg-emerald-500/15 text-emerald-400 border border-emerald-400/20")}>
                        {updatingPinId === navTarget.id ? <div className="w-3 h-3 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        {isReturnOrder(navTarget) ? 'Collected' : 'Delivered'}
                      </button>
                    </div>
                    {/* Row 2: CMS + NWD + Modify + Exit */}
                    <div className="flex items-center gap-1.5">
                      {!isReturnOrder(navTarget) && (
                      <>
                      <button onClick={() => setCmsPopup({ pin: navTarget })} disabled={updatingPinId === navTarget.id}
                        className="btn-holo flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500/10 text-amber-400 text-[9px] font-bold border border-amber-400/15 disabled:opacity-50 shrink-0">
                        <Ban className="w-3 h-3" /> CMS
                      </button>
                      <button onClick={() => handleMapStatusChange(navTarget, 'nwd', 'Next working day', true)} disabled={updatingPinId === navTarget.id}
                        className="btn-holo flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-400 text-[9px] font-bold border border-red-400/15 disabled:opacity-50 shrink-0">
                        <Clock className="w-3 h-3" /> NWD
                      </button>
                      </>
                      )}
                      <button onClick={() => setModifyTarget(navTarget)}
                        className="btn-holo flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg bg-purple-500/10 text-purple-400 text-[9px] font-bold border border-purple-400/15 shrink-0">
                        <Package className="w-3 h-3" /> Modify
                      </button>
                      <button onClick={() => { stopNavigation(); if (multiStopNav) { setMultiStopNav(false); setOptimizedStops([]); setCurrentStopIdx(0); setActiveRegion(null); const map = mapRef.current; if (map) { ['opt-route-casing','opt-route-line','opt-route-core'].forEach(l => { try { if (map.getLayer(l)) map.removeLayer(l) } catch {} }); try { if (map.getSource('opt-route')) map.removeSource('opt-route') } catch {} } } }}
                        className="btn-holo flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg bg-white/[0.03] text-white/40 text-[9px] font-bold border border-white/[0.06] hover:text-red-400">
                        <X className="w-3 h-3" /> Exit
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className={cn("flex items-center gap-1.5 text-[10px] font-bold",
                      navTarget.status === 'delivered' ? "text-emerald-400" : navTarget.status === 'cms' ? "text-amber-400" : "text-red-400"
                    )} style={{ textShadow: '0 0 8px currentColor' }}>
                      {navTarget.status === 'delivered' ? <Check className="w-3.5 h-3.5" /> : navTarget.status === 'cms' ? <Ban className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                      {navTarget.status === 'delivered' ? 'Done' : navTarget.status === 'cms' ? 'CMS' : 'NWD'}
                    </div>
                    <button onClick={() => { multiStopNav ? arriveAtStop() : stopNavigation() }}
                      className="btn-holo flex-1 py-2 rounded-lg bg-cyan-500/15 text-cyan-400 text-[10px] font-bold border border-cyan-400/20 text-center">
                      {multiStopNav ? (currentStopIdx < optimizedStops.length - 1 ? 'Next Stop' : 'Finish') : 'Done'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Controls (right side) */}
      {!navigating && (
        <div className="absolute top-12 right-3 z-30 flex flex-col items-end gap-2">
          <div className="flex flex-col rounded-2xl holo-panel overflow-hidden divide-y divide-cyan-400/5">
            <button onClick={() => {
              const next = viewMode === '3d' ? 'overview' : '3d'; setViewMode(next)
              if (mapRef.current) mapRef.current.easeTo({ pitch: next === '3d' ? 60 : 0, bearing: next === '3d' ? mapRef.current.getBearing() : 0, duration: 1200, easing: (t: number) => 1 - Math.pow(1 - t, 3) })
            }} className={cn('btn-holo w-11 h-11 flex items-center justify-center transition', viewMode === '3d' ? 'text-cyan-400' : 'text-white/40 hover:text-cyan-400')}>
              <span className="text-[10px] font-black leading-none font-mono" style={viewMode === '3d' ? { textShadow: '0 0 10px rgba(0,200,255,0.5)' } : {}}>{viewMode === '3d' ? '3D' : '2D'}</span>
            </button>
            <button onClick={() => { mapRef.current?.easeTo({ bearing: 0, pitch: viewMode === '3d' ? 60 : 0, duration: 1200, easing: (t: number) => 1 - Math.pow(1 - t, 3) }) }}
              className="btn-holo w-11 h-11 flex items-center justify-center text-white/40 hover:text-cyan-400 transition">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none"><polygon points="12,2 15,14 12,11 9,14" fill="currentColor" opacity="0.9" /><polygon points="12,22 9,10 12,13 15,10" fill="currentColor" opacity="0.3" /></svg>
            </button>
            <button onClick={startTracking} disabled={locating}
              className={cn('btn-holo w-11 h-11 flex items-center justify-center transition', locating ? 'text-cyan-400' : 'text-white/40 hover:text-cyan-400')}>
              {locating ? <div className="w-4 h-4 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" /> : <Locate className="w-4 h-4" />}
            </button>
            <button onClick={() => {
              const next = !showPoles; setShowPoles(next)
              if (mapRef.current && (mapRef.current as any)._regionPoleMarkers) (mapRef.current as any)._regionPoleMarkers.forEach((m: any) => { m.getElement().style.display = next ? '' : 'none' })
            }} className={cn('btn-holo w-11 h-11 flex items-center justify-center transition', showPoles ? 'text-cyan-400' : 'text-white/40 hover:text-cyan-400')}>
              <MapPin className="w-4 h-4" />
            </button>
            <button onClick={toggleNightMode}
              className={cn('btn-holo w-11 h-11 flex items-center justify-center transition', nightMode ? 'text-cyan-400' : 'text-white/40 hover:text-cyan-400')}>
              {nightMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
          <button onClick={() => { setShowClientList(true); setSelectedPin(null); setSelectedRegion(null) }}
            className="w-11 h-11 rounded-xl flex items-center justify-center text-white/70 hover:text-cyan-400 transition relative active:scale-95"
            style={{ background: '#111111', border: '1px solid rgba(255,255,255,0.12)' }}>
            <List className="w-4.5 h-4.5" />
            <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] rounded-full bg-cyan-500 text-black text-[8px] font-black flex items-center justify-center px-1 shadow-[0_0_10px_rgba(0,200,255,0.5)]">{totalDeliveryCount}</span>
          </button>
        </div>
      )}

      {/* Top Bar: Back + Fullscreen */}
      {!navigating && (
        <div className="absolute top-3 left-3 z-30 flex items-center gap-2">
          {backHref && (
            <Link href={backHref} className="btn-holo shrink-0 w-11 h-11 rounded-xl holo-panel flex items-center justify-center text-white/50 hover:text-cyan-400 transition">
              <ArrowLeft className="w-4 h-4" />
            </Link>
          )}
          <button onClick={toggleFullscreen}
            className="btn-holo shrink-0 w-11 h-11 rounded-xl holo-panel flex items-center justify-center text-white/50 hover:text-cyan-400 transition">
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      )}

      {/* Selected Pin */}
      {selectedPin && !navigating && (
        <div className="absolute bottom-3 left-3 right-3 z-20 max-w-sm mx-auto slide-up">
          <div className="holo-panel rounded-2xl overflow-hidden nav-card-3d">
            <div className="flex items-center gap-3 p-4">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: (STATUS_COLORS[selectedPin.status]?.dot || '#6b7280') + '15', boxShadow: `0 0 20px ${STATUS_COLORS[selectedPin.status]?.glow || 'transparent'}`, border: `1px solid ${(STATUS_COLORS[selectedPin.status]?.dot || '#6b7280')}25` }}>
                <div className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[selectedPin.status]?.dot, boxShadow: `0 0 12px ${STATUS_COLORS[selectedPin.status]?.glow}` }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white truncate tracking-wide">{selectedPin.customerName}</p>
                <p className="text-[11px] text-cyan-400/30 font-mono">{selectedPin.locality} {selectedPin.riderName && `/ ${selectedPin.riderName}`}</p>
                {selectedPin.source === 'response' && <p className="text-[9px] text-cyan-400 flex items-center gap-1 mt-0.5 font-mono"><Navigation className="w-2.5 h-2.5" />Exact GPS</p>}
                {selectedPin.source === 'geocoded' && <p className="text-[9px] text-orange-400 flex items-center gap-1 mt-0.5 font-mono"><MapPin className="w-2.5 h-2.5" />Approximate</p>}
                {selectedPin.locationFlagged && <p className="text-[9px] text-red-400 font-bold flex items-center gap-1 mt-0.5 animate-pulse text-glow"><Ban className="w-2.5 h-2.5" />Location flagged</p>}
              </div>
              <button onClick={() => setSelectedPin(null)} className="text-white/20 hover:text-cyan-400 transition"><X className="w-4 h-4" /></button>
            </div>
            <div className="glow-line" />
            <div className="px-4 py-2.5">
              <p className="text-xs text-white/50 truncate font-mono">{selectedPin.items?.length ? selectedPin.items.map(it => `${it.qty}x ${it.name}`).join(', ') : selectedPin.products}</p>
              {selectedPin.salesType && ['exchange', 'trade_in', 'refund'].includes(selectedPin.salesType) && (
                <div className={`mt-1.5 p-2 rounded-lg border ${selectedPin.salesType === 'exchange' ? 'bg-violet-500/15 border-violet-500/25' : selectedPin.salesType === 'trade_in' ? 'bg-blue-500/15 border-blue-500/25' : 'bg-red-500/15 border-red-500/25'}`}>
                  <div className={`flex items-center gap-1 text-[10px] font-bold ${selectedPin.salesType === 'exchange' ? 'text-violet-400' : selectedPin.salesType === 'trade_in' ? 'text-blue-400' : 'text-red-400'}`}>
                    {selectedPin.salesType === 'exchange' ? 'EXCHANGE' : selectedPin.salesType === 'trade_in' ? 'TRADE-IN' : 'REFUND'}
                  </div>
                  {selectedPin.returnProduct && <p className="text-[10px] font-semibold text-white/80 mt-0.5">Collect: {selectedPin.returnProduct}</p>}
                  <p className="text-[8px] text-white/40 mt-0.5">
                    {selectedPin.salesType === 'exchange' ? 'Collect old product. Verify packaging. Missing parts = payout deduction.' :
                     selectedPin.salesType === 'trade_in' ? 'Collect trade-in. Verify packaging. Missing parts = payout deduction.' :
                     'Give cash refund. Collect product. Verify packaging. Missing parts = payout deduction.'}
                  </p>
                </div>
              )}
              {isReturnOrder(selectedPin) && (selectedPin.amount || 0) <= 0 ? (
                <p className="text-xs font-bold text-white/30 mt-1 font-mono">No payment to collect</p>
              ) : (
                <p className="text-sm font-black text-cyan-400 mt-1 font-mono" style={{ textShadow: '0 0 15px rgba(0,200,255,0.4)' }}>Rs {selectedPin.amount.toLocaleString()}</p>
              )}
              {selectedPin.deliveryNotes && <p className="text-[10px] text-amber-400/60 mt-1 line-clamp-2">{selectedPin.deliveryNotes}</p>}
              {selectedPin.clientResponse && <p className="text-[10px] text-cyan-400/50 mt-0.5 line-clamp-2 font-mono">{selectedPin.clientResponse}</p>}
            </div>
            <div className="glow-line" />
            <div className="flex items-center gap-2 px-3 py-2.5">
              <button onClick={() => startNavigation(selectedPin)} disabled={routeLoading}
                className="btn-holo flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 text-[10px] font-bold border border-cyan-400/15 disabled:opacity-50 shadow-[0_0_12px_rgba(0,200,255,0.15)]">
                {routeLoading ? <div className="w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" /> : <Navigation className="w-3 h-3" />}
                Go
              </button>
              <button onClick={() => sendMapMessage(selectedPin, 'sms', 'onway')} disabled={sendingMsg === selectedPin.id || isRegionBatchExported(getRegionForPin(selectedPin) || '')}
                className={cn("btn-holo w-10 py-2.5 rounded-xl text-xs border transition flex items-center justify-center",
                  !selectedPin.contact1 || isRegionBatchExported(getRegionForPin(selectedPin) || '') ? "bg-white/3 text-white/15 border-white/5"
                  : contactedMap[selectedPin.id]?.sms ? "bg-amber-500/10 text-amber-400 border-amber-400/15 shadow-[0_0_8px_rgba(245,158,11,0.1)]"
                  : "bg-blue-500/10 text-blue-400 border-blue-400/15 shadow-[0_0_8px_rgba(59,130,246,0.1)]")}>
                {sendingMsg === selectedPin.id ? <div className="w-3 h-3 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" /> :
                <Mail className="w-3.5 h-3.5" />}
              </button>
              <a href={selectedPin.contact1 ? `tel:${formatPhone(selectedPin.contact1)}` : '#'} onClick={e => { if (!selectedPin.contact1) e.preventDefault(); else markContacted(selectedPin.id, 'call') }}
                className={cn("btn-holo w-10 py-2.5 rounded-xl text-xs border transition flex items-center justify-center",
                  !selectedPin.contact1 ? "bg-white/3 text-white/15 border-white/5"
                  : contactedMap[selectedPin.id]?.call ? "bg-amber-500/10 text-amber-400 border-amber-400/15 shadow-[0_0_8px_rgba(245,158,11,0.1)]"
                  : "bg-emerald-500/10 text-emerald-400 border-emerald-400/15 shadow-[0_0_8px_rgba(52,211,153,0.1)]")}>
                <Phone className="w-3.5 h-3.5" />
              </a>

            </div>

            {!['delivered', 'nwd', 'cms'].includes(selectedPin.status) && (
              <>
                <div className="glow-line" />
                <div className="flex items-center gap-2 p-3">
                  <button onClick={() => handleMapDelivered(selectedPin)} disabled={updatingPinId === selectedPin.id}
                    className={cn("btn-holo flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[10px] font-bold disabled:opacity-50",
                      isReturnOrder(selectedPin) ? "bg-violet-500/10 text-violet-400 border border-violet-400/15 shadow-[0_0_10px_rgba(139,92,246,0.1)]" : "bg-emerald-500/10 text-emerald-400 border border-emerald-400/15 shadow-[0_0_10px_rgba(52,211,153,0.1)]")}>
                    {updatingPinId === selectedPin.id ? <div className="w-3 h-3 border-2 border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    {isReturnOrder(selectedPin) ? 'Collected' : 'Delivered'}
                  </button>
                  {!isReturnOrder(selectedPin) && (
                  <>
                  <button onClick={() => setCmsPopup({ pin: selectedPin })} disabled={updatingPinId === selectedPin.id}
                    className="btn-holo flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-amber-500/10 text-amber-400 text-[10px] font-bold border border-amber-400/15 disabled:opacity-50 shadow-[0_0_8px_rgba(251,191,36,0.1)]">
                    <Ban className="w-3.5 h-3.5" /> CMS
                  </button>
                  <button onClick={() => handleMapStatusChange(selectedPin, 'nwd', 'Next working day', false)} disabled={updatingPinId === selectedPin.id}
                    className="btn-holo flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-red-500/10 text-red-400 text-[10px] font-bold border border-red-400/15 disabled:opacity-50 shadow-[0_0_8px_rgba(239,68,68,0.1)]">
                    <Clock className="w-3.5 h-3.5" /> NWD
                  </button>
                  </>
                  )}
                </div>
                <div className="px-3 pb-3">
                  <button onClick={() => { setModifyTarget(selectedPin); setSelectedPin(null) }}
                    className="btn-holo w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-purple-500/10 text-purple-400 text-[10px] font-bold border border-purple-400/15 active:bg-purple-500/20 transition-all">
                    <Package className="w-3.5 h-3.5" /> Modify Order
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Selected Region */}
      {selectedRegion && !selectedPin && !navigating && (
        <div className="absolute bottom-3 left-3 right-3 z-20 max-w-sm mx-auto slide-up">
          <div className="bg-black/85 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center gap-3 p-3 border-b border-white/5">
              <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center shrink-0"><Users className="w-5 h-5 text-white/60" /></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-black text-white">{selectedRegion.locality}</p>
                <p className="text-[11px] text-white/40">{selectedRegion.count} deliveries</p>
              </div>
              <button onClick={() => setSelectedRegion(null)} className="text-white/30 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-white/5 overflow-x-auto no-scrollbar">
              {Object.entries(selectedRegion.statuses).map(([status, count]) => (
                <span key={status} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap"
                  style={{ backgroundColor: (STATUS_COLORS[status]?.dot || '#6b7280') + '20', color: STATUS_COLORS[status]?.dot }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: STATUS_COLORS[status]?.dot }} />
                  {status.replace('_', ' ')} ({count})
                </span>
              ))}
            </div>
                <div className="max-h-[220px] touch-scroll divide-y divide-white/5">
              {selectedRegion.deliveries.map(d => (
                <div key={d.id} className="flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition">
                  <button onClick={() => { setSelectedPin(d); setSelectedRegion(null) }} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLORS[d.status]?.dot || '#6b7280' }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-medium text-white truncate">{d.customerName}</p>
                        {d.salesType && d.salesType !== 'sale' && (
                          <span className={`text-[7px] font-bold px-1 py-px rounded shrink-0 ${d.salesType === 'exchange' ? 'bg-violet-500/20 text-violet-400' : d.salesType === 'trade_in' ? 'bg-blue-500/20 text-blue-400' : d.salesType === 'refund' ? 'bg-red-500/20 text-red-400' : 'bg-teal-500/20 text-teal-400'}`}>
                            {d.salesType === 'exchange' ? 'EXCHG' : d.salesType === 'trade_in' ? 'TRADE' : d.salesType === 'refund' ? 'REFND' : 'DROP'}
                          </span>
                        )}
                      </div>
                      {d.items?.length ? d.items.map((it, i) => (
                        <p key={i} className="text-[10px] text-white/30 font-mono">{it.qty} x {it.name}{isReturnOrder(d) && (d.amount || 0) <= 0 ? '' : ` · Rs ${it.amount.toLocaleString()}`}</p>
                      )) : <p className="text-[10px] text-white/30">{d.products}{isReturnOrder(d) && (d.amount || 0) <= 0 ? '' : ` - Rs ${d.amount}`}</p>}
                    </div>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">

                    {!isRegionBatchExported(getRegionForPin(d) || '') && (
                    <button onClick={e => { e.stopPropagation(); sendMapMessage(d, 'sms', 'onway') }} disabled={sendingMsg === d.id}
                      className={cn("w-7 h-7 rounded-lg flex items-center justify-center active:scale-90 transition",
                        !d.contact1 ? "bg-white/5 text-white/15" : contactedMap[d.id]?.sms ? "bg-amber-500/15 text-amber-400" : "bg-blue-500/15 text-blue-400")}>
                      <Mail className="w-3 h-3" />
                    </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Optimized Route Panel */}
      {optimizedStops.length > 0 && !navigating && !showClientList && (
        <div className="absolute bottom-3 left-3 right-3 z-25 max-w-sm mx-auto slide-up">
          <div className="holo-panel-warm rounded-2xl overflow-hidden nav-card-3d">
            {/* Header */}
            <div className="flex items-center gap-3 p-4">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-400/15 flex items-center justify-center shrink-0 shadow-[0_0_12px_rgba(251,191,36,0.15)]">
                <Navigation className="w-5 h-5 text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white tracking-wide">{activeRegion} Route</p>
                <p className="text-[10px] text-amber-400/50 font-mono">{optimizedStops.length} stops optimized</p>
              </div>
              <button onClick={toggleFullscreen} className="text-white/25 hover:text-amber-400 transition" title={isFullscreen ? 'Exit fullscreen' : 'Go fullscreen'}>
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
              <button onClick={() => {
                setOptimizedStops([]); setActiveRegion(null)
                const map = mapRef.current
                if (map) { ['opt-route-casing','opt-route-line','opt-route-core'].forEach(l => { try { if (map.getLayer(l)) map.removeLayer(l) } catch {} }); try { if (map.getSource('opt-route')) map.removeSource('opt-route') } catch {} }
              }} className="text-white/25 hover:text-white transition"><X className="w-4 h-4" /></button>
            </div>
            <div className="glow-line-warm" />
            {/* Stop list with drag reorder */}
                <div className="max-h-[280px] touch-scroll">
              {optimizedStops.map((stop, i) => (
                <div key={stop.pin.id} data-stop-row
                  draggable
                  onDragStart={(e) => handleDragStart(i, e)}
                  onDragEnd={handleDragEnd}
                  onDragOver={(e) => handleDragOver(i, e)}
                  className={cn(
                    'px-3 py-3 border-b border-white/[0.04] transition-all duration-200 cursor-grab active:cursor-grabbing select-none',
                    dragIdx === i && 'opacity-30 scale-95',
                    dragOverIdx === i && dragIdx !== null && dragIdx !== i && 'bg-amber-500/10 border-amber-400/20 shadow-[inset_0_0_20px_rgba(251,191,36,0.06)]',
                  )}>
                  <div className="flex items-center gap-2.5">
                    {/* Grip */}
                    <div className="shrink-0 text-white/15 hover:text-amber-400 transition touch-none"
                      onTouchStart={(e) => handleTouchStart(i, e)}
                      onTouchMove={handleTouchMove}
                      onTouchEnd={handleTouchEnd}>
                      <GripVertical className="w-4 h-4" />
                    </div>
                    {/* Sequence */}
                    <div className={cn('w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 font-mono text-[10px] font-black transition-all',
                      dragOverIdx === i && dragIdx !== null && dragIdx !== i ? 'bg-amber-500/30 border-amber-400/50 text-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.4)]' : 'bg-amber-500/10 border-amber-400/15 text-amber-400')}>
                      {i + 1}
                    </div>
                    {/* Client info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-[11px] font-semibold text-white truncate">{stop.pin.customerName}</p>
                        {stop.pin.salesType && stop.pin.salesType !== 'sale' && (
                          <span className={`text-[7px] font-bold px-1 py-px rounded shrink-0 ${stop.pin.salesType === 'exchange' ? 'bg-violet-500/20 text-violet-400' : stop.pin.salesType === 'trade_in' ? 'bg-blue-500/20 text-blue-400' : stop.pin.salesType === 'refund' ? 'bg-red-500/20 text-red-400' : 'bg-teal-500/20 text-teal-400'}`}>
                    {stop.pin.salesType === 'exchange' ? 'EXCHG' : stop.pin.salesType === 'trade_in' ? 'TRADE' : stop.pin.salesType === 'refund' ? 'REFND' : 'DROP'}
                  </span>
                )}
                {isReturnOrder(stop.pin) && (stop.pin.amount || 0) <= 0 ? null : (
                  <span className="text-[9px] text-amber-400/40 font-mono font-bold shrink-0">Rs {stop.pin.amount.toLocaleString()}</span>
                )}
                      </div>
                      {/* Product - clear display */}
                      <p className="text-[9px] text-white/35 truncate mt-0.5 font-mono">{stop.pin.items?.length ? stop.pin.items.map(it => `${it.qty}x ${it.name}`).join(', ') : stop.pin.products}</p>
                      {stop.pin.returnProduct && <p className="text-[7px] text-amber-400/40 font-mono truncate mt-0.5">Pickup: {stop.pin.returnProduct}</p>}
                      {/* Location source */}
                      <div className="flex items-center gap-2 mt-0.5">
                        {stop.pin.source === 'response' && <span className="text-[7px] text-cyan-400/50 font-mono px-1 py-px rounded bg-cyan-500/10">GPS</span>}
                        {stop.pin.source === 'geocoded' && <span className="text-[7px] text-orange-400/50 font-mono px-1 py-px rounded bg-orange-500/10">APPROX</span>}
                        {stop.pin.locationFlagged && <span className="text-[7px] text-red-400 font-bold animate-pulse">FLAGGED</span>}
                        {stop.pin.deliveryNotes && <span className="text-[7px] text-amber-400/30 truncate max-w-[100px]">{stop.pin.deliveryNotes}</span>}
                      </div>
                    </div>
                    <div className="w-2.5 h-2.5 rounded-full shrink-0 shadow-[0_0_6px_currentColor]" style={{ backgroundColor: STATUS_COLORS[stop.pin.status]?.dot || '#6b7280' }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="glow-line-warm" />
            {/* Start Route */}
            <div className="p-3">
              <button onClick={startMultiStopNav}
                className="btn-holo w-full py-3.5 rounded-xl bg-gradient-to-r from-amber-500/15 to-cyan-500/15 border border-amber-400/20 text-white text-sm font-bold uppercase tracking-[0.15em] shadow-[0_0_20px_rgba(251,191,36,0.1)]">
                Start Route ({optimizedStops.length} stops)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Client List Drawer */}
      {showClientList && !navigating && (
        <div className="absolute inset-0 z-40 flex flex-col">
          <div className="flex-shrink-0 h-[8%]" onClick={() => { setShowClientList(false); setClientSearch(''); setExpandedRegions(new Set()) }} />
          <div className="flex-1 holo-panel rounded-t-3xl flex flex-col overflow-hidden slide-up glow-border-pulse">
            {/* Drag handle + scan line */}
            <div className="flex justify-center pt-2.5 pb-1 relative">
              <div className="w-12 h-1 rounded-full bg-cyan-400/30 shadow-[0_0_8px_rgba(0,200,255,0.4)]" />
            </div>
            {/* Header with glow accents */}
            <div className="px-4 py-3 relative">
              <div className="glow-line mb-3" />
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-black text-white tracking-[0.2em] uppercase text-glow" style={{ textShadow: '0 0 20px rgba(0,200,255,0.3)' }}>My Deliveries</h2>
                  <div className="flex items-center gap-4 mt-1.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]" />
                      <span className="text-[10px] text-amber-400 font-bold tracking-wide">{allPins.filter(p => !['delivered','nwd','cms'].includes(p.status)).length} PENDING</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]" />
                      <span className="text-[10px] text-emerald-400/60 font-medium">{allPins.filter(p => p.status === 'delivered').length} done</span>
                    </div>
                    <span className="text-[10px] text-cyan-400/30 font-mono">{safeRegionGroups.length} areas</span>
                  </div>
                </div>
                <button onClick={() => { setShowClientList(false); setClientSearch(''); setExpandedRegions(new Set()) }} className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:text-cyan-400 hover:border-cyan-400/30 transition-all hover:shadow-[0_0_12px_rgba(0,200,255,0.2)]">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="glow-line mt-3" />
            </div>
            {/* Search with holographic border */}
            <div className="px-4 pb-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-cyan-400/30" />
                <input value={clientSearch} onChange={e => setClientSearch(e.target.value)} placeholder="Search client, area, or region..."
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-cyan-500/5 border border-cyan-400/10 text-white text-xs placeholder:text-white/20 focus:outline-none focus:border-cyan-400/30 focus:shadow-[0_0_15px_rgba(0,200,255,0.1)] transition-all font-mono" />
              </div>
            </div>
              <div className="flex-1 touch-scroll px-2 pb-6">
              {safeRegionGroups.filter(g => {
                if (!clientSearch.trim()) return true
                const q = clientSearch.toLowerCase()
                return g.region.toLowerCase().includes(q) || (g.parentRegion || '').toLowerCase().includes(q) ||
                  [...g.routable, ...g.unreachable].some(d => d.customerName.toLowerCase().includes(q) || (d.locality || '').toLowerCase().includes(q))
              }).map(group => {
                const isExpanded = expandedRegions.has(group.region)
                const searchQ = clientSearch.toLowerCase().trim()
                // If search matches the region name itself, show ALL clients in this region (don't filter individually)
                const regionMatchesSearch = searchQ && (group.region.toLowerCase().includes(searchQ) || (group.parentRegion || '').toLowerCase().includes(searchQ))
                const allGroupPins = [...group.routable, ...group.unreachable]
                const pendingPins = allGroupPins.filter(d => !['delivered','nwd','cms'].includes(d.status))
                const donePins = allGroupPins.filter(d => ['delivered','nwd','cms'].includes(d.status))
                const filteredPending = pendingPins.filter(d => !searchQ || regionMatchesSearch || d.customerName.toLowerCase().includes(searchQ) || (d.locality || '').toLowerCase().includes(searchQ))
                const filteredDone = donePins.filter(d => !searchQ || regionMatchesSearch || d.customerName.toLowerCase().includes(searchQ) || (d.locality || '').toLowerCase().includes(searchQ))
                const pendingRoutable = group.routable.filter(p => !['delivered','nwd','cms'].includes(p.status))
                const pendingUnreachable = group.unreachable.filter(p => !['delivered','nwd','cms'].includes(p.status))


                return (
                  <div key={group.region} className="mb-2">
                    {/* ═══ REGION HEADER ═══ */}
                    <div className="region-pill flex items-center gap-2 px-3 py-2.5">
                      <button onClick={() => setExpandedRegions(prev => { const next = new Set(prev); next.has(group.region) ? next.delete(group.region) : next.add(group.region); return next })}
                        className="flex items-center gap-2.5 flex-1 min-w-0">
                        {/* Count badge */}
                        <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center shrink-0 shadow-lg",
                          pendingPins.length > 0
                            ? "bg-gradient-to-br from-amber-500/20 to-amber-600/10 border border-amber-400/15"
                            : "bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 border border-emerald-400/15"
                        )}>
                          <span className={cn("text-lg font-black font-mono leading-none", pendingPins.length > 0 ? "text-amber-400" : "text-emerald-400")}>
                            {pendingPins.length > 0 ? pendingPins.length : <Check className="w-5 h-5" />}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0 text-left">
                          <p className="text-base font-bold text-white/90 truncate">{group.region}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            
                            <div className="flex items-center gap-1.5">
                              {pendingRoutable.length > 0 && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/10 text-[11px] text-emerald-400/70 font-mono font-bold">
                                  <Navigation className="w-3.5 h-3.5" />{pendingRoutable.length}
                                </span>
                              )}
                              {pendingUnreachable.length > 0 && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-orange-500/10 text-[11px] text-orange-400/70 font-mono font-bold">
                                  <MapPin className="w-3.5 h-3.5" />{pendingUnreachable.length}
                                </span>
                              )}
                              {donePins.length > 0 && (
                                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-white/[0.03] text-[11px] text-white/20 font-mono">{donePins.length} done</span>
                              )}
                            </div>
                          </div>
                        </div>
                        <ChevronDown className={cn('w-4 h-4 text-cyan-400/15 transition-transform duration-300', isExpanded && 'rotate-180')} />
                      </button>
                      {/* Quick actions */}
                      <div className="flex items-center gap-2 shrink-0 ml-1">
                        {pendingRoutable.length >= 2 && (
                          <button onClick={e => { e.stopPropagation(); optimizeRegionRoute(group.region) }} disabled={optimizing}
                            className="action-pill w-10 h-10 bg-gradient-to-br from-amber-500/15 to-amber-600/5 border border-amber-400/12 disabled:opacity-30"
                            title={`Optimize ${pendingRoutable.length} stops`}>
                            <TrendingUp className="w-5 h-5 text-amber-400" />
                          </button>
                        )}
  {allGroupPins.length > 9 && allGroupPins.some(d => d.contact1) && !isRegionBatchExported(group.region) && (
  <button onClick={e => { e.stopPropagation(); setDeviceSelectRegion(group.region) }} disabled={!!exporting}
  className="action-pill w-10 h-10 bg-gradient-to-br from-purple-500/12 to-purple-600/5 border border-purple-400/10 disabled:opacity-30"
  title="Download batch messages">
                            {exporting === group.region
                              ? <div className="w-4 h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                              : exportedRegion === group.region
                                ? <Check className="w-5 h-5 text-emerald-400" />
                                : <ClipboardCopy className="w-5 h-5 text-purple-400" />}
                          </button>
                        )}
                        {isRegionBatchExported(group.region) && (
                          <span className="text-[10px] text-emerald-400/60 font-mono px-2">Batch sent</span>
                        )}
                      </div>
                    </div>

                    {/* ═══ EXPANDED CONTENT ═══ */}
                    {(isExpanded || searchQ) && (
                      <div className="mt-1 ml-2 pl-3 border-l border-cyan-400/[0.06] space-y-1.5 pb-2">

                        {/* ── GPS / HAVE LOCATION ── */}
                        {pendingRoutable.length > 0 && (
                          <>
                            <button onClick={() => setExpandedRegions(prev => { const next = new Set(prev); const key = `gps-${group.region}`; next.has(key) ? next.delete(key) : next.add(key); return next })}
                              className="flex items-center gap-2 py-1.5 px-1 w-full text-left">
                              <div className="w-5 h-[2px] rounded-full bg-gradient-to-r from-emerald-400/60 to-transparent" />
                              <span className="text-xs font-bold text-emerald-400/50 uppercase tracking-[0.15em] font-mono">GPS ({pendingRoutable.length})</span>
                              <ChevronDown className={cn('w-3.5 h-3.5 text-emerald-400/30 ml-auto transition-transform duration-200', expandedRegions.has(`gps-${group.region}`) && 'rotate-180')} />
                            </button>
                            {expandedRegions.has(`gps-${group.region}`) && pendingRoutable.filter(d => !searchQ || regionMatchesSearch || d.customerName.toLowerCase().includes(searchQ) || (d.locality || '').toLowerCase().includes(searchQ)).map(d => {
                              const initials = d.customerName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
                              const hue = d.customerName.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0) % 360
                              const isExpandedCard = expandedRegions.has(`card-${d.id}`)
                              return (
                              <div key={d.id} className="client-card client-card-gps overflow-hidden">
                                {/* ── Main Row: Avatar + Full name/product + chevron ── */}
                                <button onClick={() => setExpandedRegions(prev => { const next = new Set(prev); const key = `card-${d.id}`; next.has(key) ? next.delete(key) : next.add(key); return next })}
                                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
                                  <div className="relative shrink-0">
                                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg"
                                      style={{ background: `linear-gradient(135deg, hsl(${hue}, 50%, 25%) 0%, hsl(${hue}, 40%, 15%) 100%)`, border: `1px solid hsl(${hue}, 50%, 35%, 0.3)` }}>
                                      <span className="text-sm font-bold text-white/80 font-mono">{initials}</span>
                                    </div>
                                    <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-[#0a1929]"
                                      style={{ backgroundColor: STATUS_COLORS[d.status]?.dot || '#6b7280' }} />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[14px] font-semibold text-white/90">{d.customerName}{d.isModified && <span className="ml-1.5 text-[8px] font-bold px-1 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-400/20">MOD</span>}</span>
                                      {d.locationFlagged && <span className="shrink-0 px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 text-[9px] font-black font-mono animate-pulse">FLAG</span>}
                                      {isReturnOrder(d) && (d.amount || 0) <= 0 ? (
                                        <span className={`ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${d.salesType === 'exchange' ? 'bg-violet-500/20 text-violet-400' : d.salesType === 'trade_in' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'}`}>{getReturnLabel(d.salesType!)}</span>
                                      ) : (
                                        <span className="ml-auto text-[13px] text-cyan-400/60 font-mono font-bold shrink-0">Rs {d.amount.toLocaleString()}</span>
                                      )}
                                    </div>
                                    {d.items?.length ? d.items.map((it, i) => (
                                      <p key={i} className="text-[12px] text-white/30 font-mono leading-snug">{it.qty} x {it.name}{isReturnOrder(d) && (d.amount || 0) <= 0 ? '' : ` · Rs ${it.amount.toLocaleString()}`}</p>
                                    )) : <p className="text-[12px] text-white/30 font-mono leading-snug">{d.products}</p>}
                                  </div>
                                  <ChevronDown className={cn('w-4 h-4 text-white/15 shrink-0 transition-transform duration-200', isExpandedCard && 'rotate-180')} />
                                </button>
                                {/* ── Expanded: Contact + Status actions ── */}
                                {isExpandedCard && (
                                  <div className="px-3 pb-3 pt-2 border-t border-white/[0.03] space-y-2">
                                    {/* Contact row */}
                                    <div className="flex items-center gap-2">
                                      <button onClick={() => { setSelectedPin(d); setShowClientList(false); setClientSearch(''); setExpandedRegions(new Set()); mapRef.current?.flyTo({ center: [d.lng, d.lat], zoom: 16, pitch: 60, duration: 1400, essential: true }) }}
                                        className="action-pill h-9 px-3 gap-1.5 bg-cyan-500/8 border border-cyan-400/10 text-[11px] text-cyan-400 font-mono font-bold">
                                        <Navigation className="w-3.5 h-3.5" />Fly to
                                      </button>
                                      <div className="flex-1" />
                                      {d.contact1 && (
                                        <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                                          <a href={`tel:${formatPhone(d.contact1)}`} onClick={() => markContacted(d.id, 'call')}
                                            className={cn("action-pill w-9 h-9 border", contactedMap[d.id]?.call ? "bg-amber-500/8 border-amber-400/10" : "bg-emerald-500/8 border-emerald-400/10")}>
                                            <Phone className={cn("w-4 h-4", contactedMap[d.id]?.call ? "text-amber-400" : "text-emerald-400")} />
                                          </a>
                                          
                                          {!isRegionBatchExported(group.region) && (
                                          <button onClick={() => sendMapMessage(d, 'sms', 'onway')} disabled={sendingMsg === d.id}
                                            className={cn("action-pill w-9 h-9 border", contactedMap[d.id]?.sms ? "bg-amber-500/8 border-amber-400/10" : "bg-blue-500/8 border-blue-400/10")}>
                                            {sendingMsg === d.id ? <div className="w-3.5 h-3.5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" /> :
                                            <Mail className={cn("w-4 h-4", contactedMap[d.id]?.sms ? "text-amber-400" : "text-blue-400")} />}
                                          </button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                    {/* Status row */}
                                    <div className="flex items-center gap-2">
                                      <button onClick={() => handleMapDelivered(d)} disabled={updatingPinId === d.id}
                                        className={cn("status-chip disabled:opacity-30 text-xs px-3.5 py-2 gap-1.5",
                                          isReturnOrder(d) ? "bg-violet-500/12 text-violet-400 border-violet-400/12" : "bg-emerald-500/12 text-emerald-400 border-emerald-400/12")}>
                                        <Check className="w-4 h-4" />{isReturnOrder(d) ? 'Collected' : 'Done'}
                                      </button>
                                      {!isReturnOrder(d) && (
                                      <>
                                      <button onClick={() => setCmsPopup({ pin: d })} disabled={updatingPinId === d.id}
                                        className="status-chip bg-amber-500/12 text-amber-400 border-amber-400/12 disabled:opacity-30 text-xs px-3.5 py-2">
                                        CMS
                                      </button>
                                      <button onClick={() => handleMapStatusChange(d, 'nwd', 'Next working day', false)} disabled={updatingPinId === d.id}
                                        className="status-chip bg-red-500/12 text-red-400 border-red-400/12 disabled:opacity-30 text-xs px-3.5 py-2">
                                        NWD
                                      </button>
                                      </>
                                      )}
                                      <button onClick={() => setModifyTarget(d)}
                                        className="status-chip bg-purple-500/12 text-purple-400 border-purple-400/12 text-xs px-3.5 py-2 gap-1">
                                        <Package className="w-3.5 h-3.5" />Mod
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                              )
                            })}
                          </>
                        )}

                        {/* ── NEED LOCATION ── */}
                        {pendingUnreachable.length > 0 && (
                          <>
                            <div className="flex items-center gap-2 py-1.5 px-1 mt-1">
                              <div className="w-5 h-[2px] rounded-full bg-gradient-to-r from-orange-400/60 to-transparent" />
                              <span className="text-xs font-bold text-orange-400/50 uppercase tracking-[0.15em] font-mono">Need Location ({pendingUnreachable.length})</span>
                            </div>
                            {pendingUnreachable.filter(d => !searchQ || regionMatchesSearch || d.customerName.toLowerCase().includes(searchQ) || (d.locality || '').toLowerCase().includes(searchQ)).map(d => {
                              const initials = d.customerName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
                              const hue = d.customerName.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0) % 360
                              const isExpandedCard = expandedRegions.has(`card-${d.id}`)
                              return (
                              <div key={d.id} className="client-card client-card-need overflow-hidden">
                                {/* ── Main Row: Avatar + Full name/product + chevron ── */}
                                <button onClick={() => setExpandedRegions(prev => { const next = new Set(prev); const key = `card-${d.id}`; next.has(key) ? next.delete(key) : next.add(key); return next })}
                                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
                                  <div className="relative shrink-0">
                                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg"
                                      style={{ background: `linear-gradient(135deg, hsl(${hue}, 35%, 22%) 0%, hsl(${hue}, 25%, 12%) 100%)`, border: `1px solid hsl(${hue}, 35%, 30%, 0.25)` }}>
                                      <span className="text-sm font-bold text-white/60 font-mono">{initials}</span>
                                    </div>
                                    <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-[#0a1929] bg-orange-400/60" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-[14px] font-semibold text-white/75">{d.customerName}{d.isModified && <span className="ml-1.5 text-[8px] font-bold px-1 py-0.5 rounded bg-purple-500/20 text-purple-400 border border-purple-400/20">MOD</span>}</span>
                                      {isReturnOrder(d) && (d.amount || 0) <= 0 ? (
                                        <span className={`ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${d.salesType === 'exchange' ? 'bg-violet-500/20 text-violet-400' : d.salesType === 'trade_in' ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'}`}>{getReturnLabel(d.salesType!)}</span>
                                      ) : (
                                        <span className="ml-auto text-[13px] text-cyan-400/50 font-mono font-bold shrink-0">Rs {d.amount.toLocaleString()}</span>
                                      )}
                                    </div>
                                    {d.items?.length ? d.items.map((it, i) => (
                                      <p key={i} className="text-[12px] text-white/20 font-mono leading-snug">{it.qty} x {it.name}{isReturnOrder(d) && (d.amount || 0) <= 0 ? '' : ` · Rs ${it.amount.toLocaleString()}`}</p>
                                    )) : <p className="text-[12px] text-white/20 font-mono leading-snug">{d.products}</p>}
                                  </div>
                                  <ChevronDown className={cn('w-4 h-4 text-white/15 shrink-0 transition-transform duration-200', isExpandedCard && 'rotate-180')} />
                                </button>
                                {/* ── Expanded: Paste link + Status actions ── */}
                                {isExpandedCard && (
                                  <div className="px-3 pb-3 pt-2 border-t border-white/[0.03] space-y-2">
                                    {/* Contact + Pin row */}
                                    <div className="flex items-center gap-2">
                                      <button onClick={() => startPlacingPin(d)}
                                        className="action-pill h-9 px-3 gap-1.5 bg-cyan-500/8 border border-cyan-400/10 text-[11px] text-cyan-400 font-mono font-bold">
                                        <Crosshair className="w-3.5 h-3.5" />Pin on Map
                                      </button>
                                      <div className="flex-1" />
                                      {d.contact1 && (
                                        <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                                          <a href={`tel:${formatPhone(d.contact1)}`} onClick={() => markContacted(d.id, 'call')}
                                            className={cn("action-pill w-9 h-9 border", contactedMap[d.id]?.call ? "bg-amber-500/8 border-amber-400/10" : "bg-emerald-500/8 border-emerald-400/10")}>
                                            <Phone className={cn("w-4 h-4", contactedMap[d.id]?.call ? "text-amber-400" : "text-emerald-400")} />
                                          </a>
                                          
                                          {!isRegionBatchExported(group.region) && (
                                          <button onClick={() => sendMapMessage(d, 'sms', 'location')} disabled={sendingMsg === d.id}
                                            className={cn("action-pill w-9 h-9 border", contactedMap[d.id]?.sms ? "bg-amber-500/8 border-amber-400/10" : "bg-blue-500/8 border-blue-400/10")}>
                                            {sendingMsg === d.id ? <div className="w-3.5 h-3.5 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" /> :
                                            <Mail className={cn("w-4 h-4", contactedMap[d.id]?.sms ? "text-amber-400" : "text-blue-400")} />}
                                          </button>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                    {/* Paste link row */}
                                    <div className="flex items-center gap-2">
                                      {locationLinkInput === d.id ? (
                                        <>
                                          <input type="text" value={locationLinkValue} onChange={e => setLocationLinkValue(e.target.value)}
                                            placeholder="Paste Google Maps link..."
                                            className="flex-1 h-9 px-3 rounded-lg bg-cyan-500/5 border border-cyan-400/15 text-[12px] text-white placeholder:text-white/20 outline-none focus:border-cyan-400/30 font-mono"
                                            autoFocus onKeyDown={e => { if (e.key === 'Enter' && locationLinkValue) handlePasteLocationLink(d, locationLinkValue) }}
                                          />
                                          <button onClick={() => handlePasteLocationLink(d, locationLinkValue)} disabled={!locationLinkValue || updatingPinId === d.id}
                                            className="action-pill w-9 h-9 bg-cyan-500/15 border border-cyan-400/15 disabled:opacity-20">
                                            {updatingPinId === d.id ? <div className="w-3.5 h-3.5 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" /> : <Check className="w-4 h-4 text-cyan-400" />}
                                          </button>
                                          <button onClick={() => { setLocationLinkInput(null); setLocationLinkValue('') }}
                                            className="action-pill w-9 h-9 bg-white/5 border border-white/5">
                                            <X className="w-4 h-4 text-white/30" />
                                          </button>
                                        </>
                                      ) : (
                                        <button onClick={() => { setLocationLinkInput(d.id); setLocationLinkValue('') }}
                                          className="action-pill h-9 px-3 gap-1.5 bg-cyan-500/8 border border-cyan-400/10 text-[11px] text-cyan-400/70 font-mono">
                                          <Link2 className="w-3.5 h-3.5" />Paste Maps Link
                                        </button>
                                      )}
                                    </div>
                                    {/* Status actions row */}
                                    <div className="flex items-center gap-2">
                                      {d.contact1 && !isRegionBatchExported(group.region) && (
                                        <button onClick={() => sendMapMessage(d, 'sms', 'location')} disabled={sendingMsg === d.id}
                                          className={cn("action-pill h-10 px-4 gap-2 border text-xs font-mono", contactedMap[d.id]?.sms ? "bg-amber-500/8 border-amber-400/10 text-amber-400" : "bg-blue-500/8 border-blue-400/10 text-blue-400")}>
                                          {sendingMsg === d.id ? <div className="w-4 h-4 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" /> :
                                          <><Mail className="w-4 h-4" />SMS</>}
                                        </button>
                                      )}
                                      <div className="flex-1" />
                                      <button onClick={() => handleMapDelivered(d)} disabled={updatingPinId === d.id}
                                        className={cn("status-chip disabled:opacity-30 text-xs px-3.5 py-2 gap-1.5",
                                          isReturnOrder(d) ? "bg-violet-500/12 text-violet-400 border-violet-400/12" : "bg-emerald-500/12 text-emerald-400 border-emerald-400/12")}>
                                        <Check className="w-4 h-4" />{isReturnOrder(d) ? 'Collected' : 'Done'}
                                      </button>
                                      {!isReturnOrder(d) && (
                                      <>
                                      <button onClick={() => setCmsPopup({ pin: d })} disabled={updatingPinId === d.id}
                                        className="status-chip bg-amber-500/12 text-amber-400 border-amber-400/12 disabled:opacity-30 text-xs px-3.5 py-2">
                                        CMS
                                      </button>
                                      <button onClick={() => handleMapStatusChange(d, 'nwd', 'Next working day', false)} disabled={updatingPinId === d.id}
                                        className="status-chip bg-red-500/12 text-red-400 border-red-400/12 disabled:opacity-30 text-xs px-3.5 py-2">
                                        NWD
                                      </button>
                                      </>
                                      )}
                                      <button onClick={() => setModifyTarget(d)}
                                        className="status-chip bg-purple-500/12 text-purple-400 border-purple-400/12 text-xs px-3.5 py-2 gap-1">
                                        <Package className="w-3.5 h-3.5" />Mod
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                              )
                            })}
                          </>
                        )}

                        {/* ── COMPLETED ── */}
                        {filteredDone.length > 0 && (
                          <div className="mt-3 pt-2">
                            <div className="h-[1px] bg-gradient-to-r from-transparent via-emerald-400/15 to-transparent mb-2" />
                            <button onClick={() => setExpandedRegions(prev => { const next = new Set(prev); const key = `${group.region}-done`; next.has(key) ? next.delete(key) : next.add(key); return next })}
                              className="w-full flex items-center gap-2 px-1 py-1.5 rounded-lg hover:bg-emerald-500/[0.03] transition-all">
                              <div className="w-5 h-[2px] rounded-full bg-gradient-to-r from-emerald-400/30 to-transparent" />
                              <span className="text-xs font-bold text-emerald-400/30 uppercase tracking-[0.15em] font-mono">Done ({filteredDone.length})</span>
                              <ChevronDown className={cn('w-4 h-4 text-emerald-400/15 transition-transform duration-300', expandedRegions.has(`${group.region}-done`) && 'rotate-180')} />
                            </button>
                            {expandedRegions.has(`${group.region}-done`) && (
                              <div className="mt-1.5 space-y-0.5">
                                {filteredDone.map(d => {
                                  const initials = d.customerName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
                                  const hue = d.customerName.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0) % 360
                                  return (
                                  <div key={d.id} className="flex items-center gap-3 px-3 py-2 rounded-lg opacity-40 hover:opacity-60 transition-opacity">
                                    <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                                      style={{ background: `linear-gradient(135deg, hsl(${hue}, 30%, 18%) 0%, hsl(${hue}, 20%, 10%) 100%)` }}>
                                      <span className="text-[11px] font-bold text-white/40 font-mono">{initials}</span>
                                    </div>
                                    <span className="text-sm text-white/50 truncate flex-1">{d.customerName}</span>
                                    <span className={cn('text-[11px] font-bold uppercase px-2.5 py-1 rounded-full font-mono',
                                      d.status === 'delivered' ? 'bg-emerald-500/10 text-emerald-400/40' :
                                      d.status === 'cms' ? 'bg-amber-500/10 text-amber-400/40' :
                                      'bg-red-500/10 text-red-400/40'
                                    )}>{d.status}</span>
                                  </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Pin Placement Mode */}
      {placingPin && (
        <>
          <div className="absolute inset-0 z-40 pointer-events-none flex items-center justify-center">
            <div className="relative">
              <div className="w-8 h-8 border-2 border-cyan-400 rounded-full opacity-40" />
              <div className="absolute inset-0 flex items-center justify-center"><div className="w-1.5 h-1.5 rounded-full bg-cyan-400" /></div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-px bg-cyan-400/40" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-px h-12 bg-cyan-400/40" />
            </div>
          </div>
          <div className="absolute top-3 left-3 right-3 z-40 pointer-events-none">
            <div className="bg-cyan-500/20 backdrop-blur-xl border border-cyan-400/30 rounded-xl px-4 py-2.5 text-center">
              <p className="text-xs font-bold text-cyan-400">Placing pin for</p>
              <p className="text-sm font-black text-white">{placingPin.customerName}</p>
              <p className="text-[10px] text-white/40">{placingPin.locality} - {placingPin.products}</p>
            </div>
          </div>
          <div className="absolute bottom-6 left-3 right-3 z-40 flex gap-2">
            <button onClick={() => setPlacingPin(null)}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-white/10 backdrop-blur-xl border border-white/10 text-white/70 font-bold text-sm active:scale-95 transition">
              <X className="w-4 h-4" /> Cancel
            </button>
            <button onClick={confirmPinPlacement} disabled={savingPin}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-cyan-500/20 backdrop-blur-xl border border-cyan-400/30 text-cyan-400 font-bold text-sm active:scale-95 transition disabled:opacity-50">
              {savingPin ? <div className="w-4 h-4 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
              Confirm Pin
            </button>
          </div>
        </>
      )}

      {/* Payment Method / Protocol Popup */}
      {paymentPopup && paymentPopup.protocol && (
        <div className="absolute inset-0 z-[60] bg-black/80 flex items-center justify-center p-4" onClick={() => setPaymentPopup(null)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-[380px] rounded-2xl overflow-hidden" style={{
            border: paymentPopup.pin.salesType === 'exchange' ? '2px solid #8b5cf6' :
                   paymentPopup.pin.salesType === 'trade_in' ? '2px solid #3b82f6' : '2px solid #ef4444',
            backgroundColor: '#1a1a2e',
          }}>
            <div className="flex items-center gap-2.5 p-4" style={{
              background: paymentPopup.pin.salesType === 'exchange' ? 'rgba(139,92,246,0.2)' :
                         paymentPopup.pin.salesType === 'trade_in' ? 'rgba(59,130,246,0.2)' : 'rgba(239,68,68,0.2)',
            }}>
              <RotateCcw className="w-6 h-6" style={{
                color: paymentPopup.pin.salesType === 'exchange' ? '#a78bfa' : paymentPopup.pin.salesType === 'trade_in' ? '#60a5fa' : '#f87171'
              }} />
              <div>
                <h3 className="font-extrabold text-base" style={{
                  color: paymentPopup.pin.salesType === 'exchange' ? '#a78bfa' : paymentPopup.pin.salesType === 'trade_in' ? '#60a5fa' : '#f87171',
                }}>
                  {paymentPopup.pin.salesType === 'exchange' ? 'EXCHANGE ORDER' : paymentPopup.pin.salesType === 'trade_in' ? 'TRADE-IN ORDER' : 'REFUND ORDER'}
                </h3>
                <p className="text-xs text-white/50">{paymentPopup.pin.customerName}</p>
              </div>
            </div>

            <div className="p-4 space-y-3">
              {paymentPopup.pin.returnProduct && (
                <div className="p-3 rounded-xl bg-amber-500/12 border border-amber-400/25">
                  <p className="text-[11px] font-semibold text-amber-400/70">COLLECT FROM CUSTOMER:</p>
                  <p className="text-[15px] font-extrabold text-amber-400 mt-1">{paymentPopup.pin.returnProduct}</p>
                </div>
              )}

              <div className="text-[13px] text-white/70 leading-7">
                {paymentPopup.pin.salesType === 'exchange' && (
                  <>
                    <p>1. Deliver the new product</p>
                    <p>2. Collect the old product with <strong className="text-amber-400">ALL original packaging</strong></p>
                    <p>3. Verify all parts & accessories are present</p>
                    <p>4. If anything missing, exchange only the needed part</p>
                  </>
                )}
                {paymentPopup.pin.salesType === 'trade_in' && (
                  <>
                    <p>1. Deliver the new product</p>
                    <p>2. Collect the trade-in product listed above</p>
                    <p>3. Verify condition & <strong className="text-amber-400">ALL packaging</strong></p>
                    {(paymentPopup.pin.amount || 0) > 0 && (
                      <p>4. Collect difference: <strong className="text-blue-400">Rs {paymentPopup.pin.amount}</strong></p>
                    )}
                  </>
                )}
                {paymentPopup.pin.salesType === 'refund' && (
                  <>
                    <p>1. Give cash refund of <strong className="text-red-400">Rs {paymentPopup.pin.amount || 0}</strong></p>
                    <p>2. Collect the product with <strong className="text-amber-400">ALL original packaging</strong></p>
                    <p>3. Verify all parts & accessories are present</p>
                  </>
                )}
              </div>

              <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-[11px] text-red-400 font-semibold">
                Any missing items or packaging will be deducted from rider payout.
              </div>
            </div>

            <div className="flex gap-2.5 p-4 pt-0">
              <button onClick={() => setPaymentPopup(null)} className="flex-1 py-3 rounded-xl bg-white/5 border border-white/10 text-white/50 text-[13px] font-semibold">Cancel</button>
              <button onClick={confirmMapProtocol} className="flex-[2] py-3 rounded-xl border-none text-white text-[13px] font-bold" style={{
                backgroundColor: paymentPopup.pin.salesType === 'exchange' ? '#8b5cf6' :
                                paymentPopup.pin.salesType === 'trade_in' ? '#3b82f6' : '#ef4444',
              }}>
                {paymentPopup.pin.salesType === 'exchange' ? 'Confirm Exchange' :
                 paymentPopup.pin.salesType === 'trade_in' ? 'Confirm Trade-In' : 'Confirm Refund'}
              </button>
            </div>
          </div>
        </div>
      )}

      {paymentPopup && !paymentPopup.protocol && (
        <div className="absolute inset-0 z-[60] bg-black/70 flex items-end" onClick={() => setPaymentPopup(null)}>
          <div className="w-full bg-zinc-900 border-t border-white/10 rounded-t-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div>
                <h3 className="font-semibold text-white text-sm">Select Payment Method</h3>
                <p className="text-xs text-white/40">{paymentPopup.pin.customerName} - Rs {paymentPopup.pin.amount.toLocaleString()}</p>
              </div>
              <button onClick={() => setPaymentPopup(null)} className="p-2 rounded-lg hover:bg-white/10 transition"><X className="w-4 h-4 text-white/40" /></button>
            </div>
            <div className="p-4 grid grid-cols-3 gap-3">
              <button onClick={() => confirmMapPayment('juice')} className="flex flex-col items-center gap-2 p-4 rounded-xl bg-orange-500/10 border border-orange-500/30 text-orange-400 hover:bg-orange-500/20 transition active:scale-95">
                <Smartphone className="w-6 h-6" /><span className="text-sm font-semibold">Juice</span>
              </button>
              <button onClick={() => confirmMapPayment('cash')} className="flex flex-col items-center gap-2 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition active:scale-95">
                <Banknote className="w-6 h-6" /><span className="text-sm font-semibold">Cash</span>
              </button>
              <button onClick={() => confirmMapPayment('paid')} className="flex flex-col items-center gap-2 p-4 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400 hover:bg-blue-500/20 transition active:scale-95">
                <CreditCard className="w-6 h-6" /><span className="text-sm font-semibold">Paid</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Juice Proof Upload Popup */}
      {mapProofStep && (
        <div className="absolute inset-0 z-[60] bg-black/70 flex items-end" onClick={() => { setMapProofStep(null); setMapProofFile(null); setMapProofPreview(null) }}>
          <div className="w-full bg-zinc-900 border-t border-white/10 rounded-t-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div>
                <h3 className="font-semibold text-white text-sm">Upload Payment Proof</h3>
                <p className="text-xs text-white/40">{mapProofStep.pin.customerName} - {mapProofStep.method === 'paid' ? 'Paid (proof required)' : 'Juice to contractor'}</p>
              </div>
              <button onClick={() => { setMapProofStep(null); setMapProofFile(null); setMapProofPreview(null) }} className="p-2 rounded-lg hover:bg-white/10 transition"><X className="w-4 h-4 text-white/40" /></button>
            </div>
            <div className="p-4 space-y-3">
              {mapProofPreview ? (
                <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-white/10 bg-black/30">
                  <img src={mapProofPreview} alt="Payment proof" className="w-full h-full object-contain" />
                  <button
                    onClick={() => { setMapProofFile(null); setMapProofPreview(null) }}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-dashed border-orange-500/30 bg-orange-500/5 cursor-pointer hover:bg-orange-500/10 transition-colors">
                  <Camera className="w-10 h-10 text-orange-400" />
                  <span className="text-sm font-medium text-orange-400">Take Photo or Upload Screenshot</span>
                  <span className="text-xs text-white/30">Tap to open camera or select image</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      setMapProofFile(file)
                      setMapProofPreview(URL.createObjectURL(file))
                    }}
                    className="hidden"
                  />
                </label>
              )}
              <button
                onClick={handleMapProofSubmit}
                disabled={!mapProofFile || mapProofUploading}
                className="w-full py-3 rounded-xl bg-orange-500 text-black font-semibold text-sm hover:bg-orange-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 active:scale-95"
              >
                {mapProofUploading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /><span>Uploading...</span></>
                ) : (
                  <><Check className="w-4 h-4" /><span>Confirm Payment</span></>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Device Selection for Batch Export */}
      {deviceSelectRegion && (
        <div className="absolute inset-0 z-[60] bg-black/70 flex items-center justify-center p-4" onClick={() => setDeviceSelectRegion(null)}>
          <div className="w-full max-w-[320px] bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div>
                <h3 className="font-semibold text-white text-sm">Download Batch Messages</h3>
                <p className="text-xs text-white/40">Choose your device type</p>
              </div>
              <button onClick={() => setDeviceSelectRegion(null)} className="p-2 rounded-lg hover:bg-white/10 transition"><X className="w-4 h-4 text-white/40" /></button>
            </div>
            <div className="p-4 space-y-3">
              <button 
                onClick={() => exportBatchSms(deviceSelectRegion, 'android')}
                className="w-full flex items-center gap-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 transition active:scale-95"
              >
                <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.523 2.015a.5.5 0 0 0-.662.236l-1.5 3a.5.5 0 0 0 .428.749h.711v2H7.5V6h.711a.5.5 0 0 0 .428-.749l-1.5-3a.5.5 0 0 0-.898.448l1.14 2.28c-.16.014-.321.021-.481.021H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-1.9c-.16 0-.321-.007-.481-.021l1.14-2.28a.5.5 0 0 0-.236-.684zM8 17a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm8 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/></svg>
                </div>
                <div className="text-left">
                  <div className="font-semibold text-sm">Android</div>
                  <div className="text-xs text-emerald-400/60">Downloads as CSV file</div>
                </div>
              </button>
              <button 
                onClick={() => exportBatchSms(deviceSelectRegion, 'apple')}
                className="w-full flex items-center gap-3 p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20 transition active:scale-95"
              >
                <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
                </div>
                <div className="text-left">
                  <div className="font-semibold text-sm">Apple / iPhone</div>
                  <div className="text-xs text-blue-400/60">Downloads as Excel file</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CMS Reason Popup */}
      {cmsPopup && (
        <div className="absolute inset-0 z-[60] bg-black/70 flex items-end" onClick={() => setCmsPopup(null)}>
          <div className="w-full bg-zinc-900 border-t border-white/10 rounded-t-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div>
                <h3 className="font-semibold text-white text-sm">Cannot Make Sale</h3>
                <p className="text-xs text-white/40">{cmsPopup.pin.customerName} - Select a reason</p>
              </div>
              <button onClick={() => setCmsPopup(null)} className="p-2 rounded-lg hover:bg-white/10 transition"><X className="w-4 h-4 text-white/40" /></button>
            </div>
            <div className="p-4 grid grid-cols-2 gap-2">
              <button onClick={() => confirmCmsReason('Wrong Number')}
                className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition active:scale-95">
                <Phone className="w-4 h-4 shrink-0" /><span className="text-xs font-semibold">Wrong Number</span>
              </button>
              <button onClick={() => confirmCmsReason('Wrong Product')}
                className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 transition active:scale-95">
                <Package className="w-4 h-4 shrink-0" /><span className="text-xs font-semibold">Wrong Product</span>
              </button>
              <button onClick={() => confirmCmsReason('Always No Ans')}
                className="flex items-center gap-2 p-3 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400 hover:bg-orange-500/20 transition active:scale-95">
                <Phone className="w-4 h-4 shrink-0" /><span className="text-xs font-semibold">Always No Ans</span>
              </button>
              <button onClick={() => confirmCmsReason('Client Refused')}
                className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition active:scale-95">
                <Ban className="w-4 h-4 shrink-0" /><span className="text-xs font-semibold">Client Refused</span>
              </button>
              <button onClick={() => confirmCmsReason('Change of Address')}
                className="flex items-center gap-2 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20 transition active:scale-95">
                <MapPin className="w-4 h-4 shrink-0" /><span className="text-xs font-semibold">Change of Address</span>
              </button>
              <button onClick={() => confirmCmsReason('Cancelled Order')}
                className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition active:scale-95">
                <X className="w-4 h-4 shrink-0" /><span className="text-xs font-semibold">Cancelled Order</span>
              </button>
            </div>
            {/* Custom note option */}
            <div className="px-4 pb-4">
              <button onClick={() => {
                const note = prompt('Enter CMS reason:')
                if (note && note.trim()) confirmCmsReason(note.trim())
              }} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/40 text-xs font-bold hover:text-white hover:border-white/20 transition active:scale-95">
                <Mail className="w-3.5 h-3.5" /> Other Reason
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modify Order Sheet */}
      <ModifyOrderSheet
        open={!!modifyTarget}
        onClose={() => setModifyTarget(null)}
        deliveryId={modifyTarget?.id || ''}
        customerName={modifyTarget?.customerName || ''}
        currentProducts={modifyTarget?.products || ''}
        currentAmount={modifyTarget?.amount || 0}
        onModified={(result) => {
          // Update target pin with new values
          if (modifyTarget) {
            modifyTarget.amount = result.newAmount
            modifyTarget.qty = result.newQty
            if (result.newProducts) {
              modifyTarget.products = result.newProducts
              // Also update items array for proper display
              modifyTarget.items = parseProductsToItems(result.newProducts, result.newAmount)
            }
            modifyTarget.isModified = true
            modifyTarget.modificationCount = (modifyTarget.modificationCount || 0) + 1
            
            // Also update optimizedStops if navigating
            setOptimizedStops(prev => prev.map(stop => {
              if (stop.pin.id === modifyTarget.id) {
                return {
                  ...stop,
                  pin: {
                    ...stop.pin,
                    amount: result.newAmount,
                    qty: result.newQty,
                    products: result.newProducts || stop.pin.products,
                    items: result.newProducts ? parseProductsToItems(result.newProducts, result.newAmount) : stop.pin.items,
                    isModified: true,
                    modificationCount: (stop.pin.modificationCount || 0) + 1,
                  }
                }
              }
              return stop
            }))
          }
          // Update affected source pin on the map (if active client was impacted)
          if (result.affectedClient) {
            const affected = result.affectedClient
            const allPins = safeRegionGroups.flatMap(g => [...g.routable, ...g.unreachable])
            const sourcePin = allPins.find(p => p.id === affected.deliveryId)
            if (sourcePin) {
              if (affected.markedNwd) {
                sourcePin.status = 'nwd'
                sourcePin.deliveryNotes = `NWD: Products taken for ${modifyTarget?.customerName || 'another client'}`
              }
              sourcePin.qty = affected.remainingQty
              sourcePin.isModified = true
            }
          }
          router.refresh()
        }}
      />
    </div>
  )
}
