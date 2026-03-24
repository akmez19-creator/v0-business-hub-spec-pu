'use client'

import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RegionAvatar } from '@/components/ui/region-avatar'
import {
  Package,
  CheckCircle,
  Truck,
  Phone,
  MapPin,
  XCircle,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  UserPlus,
  Users,
  Check,
  Search,
  Calendar,
  Clock,
  AlertTriangle,
  TrendingUp,
  Split,
  Zap,
  Settings2,
  GripVertical,
  Trash2,
  ClipboardList,
  RefreshCw,
  FileSpreadsheet,
} from 'lucide-react'
import { StockOverview } from './stock-overview'
import { assignDelivery, bulkAssignDeliveries, saveRiderRegionDefaults, autoAssignByDefaults, syncDefaultsToAll, clearAllRiderRegionDefaults } from '@/lib/delivery-actions'
  import { assignPartnerDelivery, autoAssignPartnerByDefaults, syncPartnerDefaults, savePartnerRiderDefaults, clearAllPartnerDefaults } from '@/lib/partner-actions'

// ── Types ──
interface Rider {
  id: string
  name: string
}

interface Delivery {
  id: string
  customer_name: string
  contact_1?: string | null
  contact_2?: string | null
  locality?: string | null
  status: string
  delivery_date?: string | null
  rider_id?: string | null
  index_no?: string | null
  qty?: number | null
  products?: string | null
  amount?: number | null
  notes?: string | null
  sales_type?: string | null
  return_product?: string | null
}

interface RegionDefault {
  rider_id: string
  locality: string
  sort_order?: number
  }

interface PartnerDelivery {
  id: string
  product?: string | null
  supplier?: string | null
  address?: string | null
  phone?: string | null
  amount?: number | null
  qty?: number | null
  driver?: string | null
  status: string
  locality?: string | null
  rider_id?: string | null
  sheet_row_number?: number | null
}

interface AssignContentProps {
  deliveries: Delivery[]
  riders: Rider[]
  contractorId: string
  riderIds: string[]
  availableDates: string[]
  selectedDate: string
  regionDefaults: RegionDefault[]
  allRegions: string[]
  partnerDeliveries: PartnerDelivery[]
  partnerRegionDefaults: RegionDefault[]
  partnerAllRegions: string[]
}

// ── Constants ──
const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string; icon: any }> = {
  pending: { label: 'Unassigned', color: 'text-amber-400', bgColor: 'bg-amber-500/15', icon: Clock },
  assigned: { label: 'Assigned', color: 'text-blue-400', bgColor: 'bg-blue-500/15', icon: Package },
  picked_up: { label: 'In Transit', color: 'text-purple-400', bgColor: 'bg-purple-500/15', icon: Truck },
  delivered: { label: 'Delivered', color: 'text-emerald-400', bgColor: 'bg-emerald-500/15', icon: CheckCircle },
  nwd: { label: 'NWD', color: 'text-red-400', bgColor: 'bg-red-500/15', icon: XCircle },
  cms: { label: 'CMS', color: 'text-orange-400', bgColor: 'bg-orange-500/15', icon: AlertTriangle },
}

const REGION_COLORS = [
  { bg: 'bg-rose-500/20', text: 'text-rose-400', border: 'border-rose-500/30' },
  { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30' },
  { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  { bg: 'bg-teal-500/20', text: 'text-teal-400', border: 'border-teal-500/30' },
  { bg: 'bg-cyan-500/20', text: 'text-cyan-400', border: 'border-cyan-500/30' },
  { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
  { bg: 'bg-indigo-500/20', text: 'text-indigo-400', border: 'border-indigo-500/30' },
  { bg: 'bg-violet-500/20', text: 'text-violet-400', border: 'border-violet-500/30' },
  { bg: 'bg-pink-500/20', text: 'text-pink-400', border: 'border-pink-500/30' },
  { bg: 'bg-sky-500/20', text: 'text-sky-400', border: 'border-sky-500/30' },
  { bg: 'bg-lime-500/20', text: 'text-lime-400', border: 'border-lime-500/30' },
  { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/30' },
]

function getRegionColor(region: string) {
  let hash = 0
  const normalized = region.toLowerCase().trim()
  for (let i = 0; i < normalized.length; i++) {
    hash = normalized.charCodeAt(i) + ((hash << 5) - hash)
  }
  return REGION_COLORS[Math.abs(hash) % REGION_COLORS.length]
}

function getRegionInitials(region: string) {
  const words = region.trim().split(/\s+/)
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

function getRiderInitials(name: string) {
  const words = name.trim().split(/\s+/)
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

// Assign unique colors to riders
const RIDER_COLORS = [
  { bg: 'bg-blue-500/25', text: 'text-blue-400', active: 'bg-blue-500', activeText: 'text-white' },
  { bg: 'bg-emerald-500/25', text: 'text-emerald-400', active: 'bg-emerald-500', activeText: 'text-white' },
  { bg: 'bg-rose-500/25', text: 'text-rose-400', active: 'bg-rose-500', activeText: 'text-white' },
  { bg: 'bg-amber-500/25', text: 'text-amber-400', active: 'bg-amber-500', activeText: 'text-white' },
  { bg: 'bg-violet-500/25', text: 'text-violet-400', active: 'bg-violet-500', activeText: 'text-white' },
  { bg: 'bg-cyan-500/25', text: 'text-cyan-400', active: 'bg-cyan-500', activeText: 'text-white' },
  { bg: 'bg-pink-500/25', text: 'text-pink-400', active: 'bg-pink-500', activeText: 'text-white' },
  { bg: 'bg-orange-500/25', text: 'text-orange-400', active: 'bg-orange-500', activeText: 'text-white' },
]

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

// ── Component ──
export function AssignContent({ deliveries, riders, contractorId, riderIds, availableDates, selectedDate, regionDefaults, allRegions, partnerDeliveries, partnerRegionDefaults, partnerAllRegions }: AssignContentProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<'main' | 'partner' | 'stock'>('main')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assigning, setAssigning] = useState(false)
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(new Set(['__all__']))
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filterRider, setFilterRider] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [assignTarget, setAssignTarget] = useState<string>('')
  const [splitRegions, setSplitRegions] = useState<Set<string>>(new Set())
  const [showDefaults, setShowDefaults] = useState(false)
  const [autoAssigning, setAutoAssigning] = useState(false)
  const [autoAssignResult, setAutoAssignResult] = useState<{ matched: number; unmatched: number; unmatchedLocalities?: string[] } | null>(null)
  // Optimistic rider assignments for split mode (deliveryId -> riderId)
  const [optimisticAssigns, setOptimisticAssigns] = useState<Map<string, string>>(new Map())
  const pendingSavesRef = useRef<Map<string, string>>(new Map())
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Build default region -> rider mapping
  const defaultRegionMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const d of regionDefaults) {
      map.set(d.locality.toLowerCase().trim(), d.rider_id)
    }
    return map
  }, [regionDefaults])

  // Check if defaults are configured
  const hasDefaults = regionDefaults.length > 0
  const hasPartnerDefaults = partnerRegionDefaults.length > 0

  // Auto-assign handler
  const [autoAssignError, setAutoAssignError] = useState<string | null>(null)

  // ── Partner state ──
  const [partnerSearch, setPartnerSearch] = useState('')
  const [partnerFilterRider, setPartnerFilterRider] = useState<string>('all')
  const [partnerExpandedRegions, setPartnerExpandedRegions] = useState<Set<string>>(new Set())
  const [partnerExpandedId, setPartnerExpandedId] = useState<string | null>(null)
  const [partnerSelected, setPartnerSelected] = useState<Set<string>>(new Set())
  const [partnerAssignTarget, setPartnerAssignTarget] = useState('')
  const [partnerBulkAssigning, setPartnerBulkAssigning] = useState(false)
  const [partnerSplitRegions, setPartnerSplitRegions] = useState<Set<string>>(new Set())

  const partnerFiltered = useMemo(() => {
    let result = partnerDeliveries
    if (partnerFilterRider === 'unassigned') {
      result = result.filter(d => !d.rider_id)
    } else if (partnerFilterRider !== 'all') {
      result = result.filter(d => d.rider_id === partnerFilterRider)
    }
    if (partnerSearch.trim()) {
      const q = partnerSearch.toLowerCase()
      result = result.filter(d =>
        d.product?.toLowerCase().includes(q) ||
        d.supplier?.toLowerCase().includes(q) ||
        d.address?.toLowerCase().includes(q) ||
        d.locality?.toLowerCase().includes(q) ||
        d.driver?.toLowerCase().includes(q) ||
        d.phone?.includes(q)
      )
    }
    return result
  }, [partnerDeliveries, partnerFilterRider, partnerSearch])

  const partnerRegionGroups = useMemo(() => {
    const groups: Record<string, PartnerDelivery[]> = {}
    for (const d of partnerFiltered) {
      const region = d.locality || d.address || 'Unmapped'
      if (!groups[region]) groups[region] = []
      groups[region].push(d)
    }
    return Object.entries(groups).sort((a, b) => {
      if (a[0] === 'Unmapped') return 1
      if (b[0] === 'Unmapped') return -1
      return b[1].length - a[1].length
    })
  }, [partnerFiltered])

  // Partner stats
  const partnerNoRiderCount = partnerDeliveries.filter(d => !d.rider_id).length
  const partnerAssignedCount = partnerDeliveries.filter(d => d.rider_id).length
  const partnerDeliveredCount = partnerDeliveries.filter(d => d.status === 'delivered').length
  const partnerRegionCount = new Set(partnerDeliveries.map(d => d.locality || d.address || 'Unmapped')).size

  // Per-rider counts for partner
  const partnerRiderCounts = new Map<string, number>()
  const partnerRiderDelivered = new Map<string, number>()
  for (const d of partnerDeliveries) {
    if (d.rider_id) {
      partnerRiderCounts.set(d.rider_id, (partnerRiderCounts.get(d.rider_id) || 0) + 1)
      if (d.status === 'delivered') {
        partnerRiderDelivered.set(d.rider_id, (partnerRiderDelivered.get(d.rider_id) || 0) + 1)
      }
    }
  }

  const partnerAllExpanded = partnerRegionGroups.length > 0 && partnerRegionGroups.every(([r]) => partnerExpandedRegions.has(r))
  const togglePartnerAllRegions = () => {
    if (partnerAllExpanded) setPartnerExpandedRegions(new Set())
    else setPartnerExpandedRegions(new Set(partnerRegionGroups.map(([r]) => r)))
  }
  const togglePartnerRegion = (region: string) => {
    setPartnerExpandedRegions(prev => {
      const next = new Set(prev)
      if (next.has(region)) next.delete(region)
      else next.add(region)
      return next
    })
  }

  // Partner selection
  const partnerToggleSelect = (id: string) => {
    setPartnerSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const partnerSelectRegion = (regionDeliveries: PartnerDelivery[]) => {
    const ids = regionDeliveries.map(d => d.id)
    const allSelected = ids.every(id => partnerSelected.has(id))
    setPartnerSelected(prev => {
      const next = new Set(prev)
      if (allSelected) { for (const id of ids) next.delete(id) }
      else { for (const id of ids) next.add(id) }
      return next
    })
  }
  const partnerSelectAll = () => {
    if (partnerSelected.size === partnerFiltered.length) {
      setPartnerSelected(new Set())
    } else {
      setPartnerSelected(new Set(partnerFiltered.map(d => d.id)))
    }
  }

  // Partner bulk assign
  const handlePartnerBulkAssign = async () => {
    if (!partnerAssignTarget || partnerSelected.size === 0) return
    setPartnerBulkAssigning(true)
    for (const id of partnerSelected) {
      await assignPartnerDelivery(id, partnerAssignTarget)
    }
    setPartnerSelected(new Set())
    setPartnerAssignTarget('')
    setPartnerBulkAssigning(false)
    router.refresh()
  }

  // Partner save defaults handler
  const handleSavePartnerDefaults = async (riderId: string, regions: string[]) => {
    await savePartnerRiderDefaults(contractorId, riderId, regions)
    router.refresh()
  }

  // Partner auto-assign / sync
  const [partnerAutoAssigning, setPartnerAutoAssigning] = useState(false)
  const [partnerAutoResult, setPartnerAutoResult] = useState<{ matched: number; unmatched: number; unmatchedLocalities?: string[] } | null>(null)
  const [partnerAutoError, setPartnerAutoError] = useState<string | null>(null)
  const [partnerShowSyncConfirm, setPartnerShowSyncConfirm] = useState(false)
  const [partnerShowDefaults, setPartnerShowDefaults] = useState(false)

  const handlePartnerAutoAssign = async () => {
    setPartnerAutoAssigning(true)
    setPartnerAutoResult(null)
    setPartnerAutoError(null)
    try {
      const result = await autoAssignPartnerByDefaults(contractorId)
      if (result.success) {
        setPartnerAutoResult({ matched: result.matched || 0, unmatched: result.unmatched || 0, unmatchedLocalities: result.unmatchedLocalities })
        router.refresh()
        setTimeout(() => setPartnerAutoResult(null), result.unmatched ? 8000 : 4000)
      } else if (result.error) {
        setPartnerAutoError(result.error)
        setTimeout(() => setPartnerAutoError(null), 4000)
      }
    } catch (err) {
      setPartnerAutoError(String(err))
      setTimeout(() => setPartnerAutoError(null), 4000)
    }
    setPartnerAutoAssigning(false)
  }

  const handlePartnerSyncDefaults = async () => {
    setPartnerAutoAssigning(true)
    setPartnerAutoResult(null)
    setPartnerAutoError(null)
    setPartnerShowSyncConfirm(false)
    try {
      const result = await syncPartnerDefaults(contractorId)
      if (result.success) {
        setPartnerAutoResult({ matched: result.matched || 0, unmatched: result.unmatched || 0, unmatchedLocalities: result.unmatchedLocalities })
        router.refresh()
        setTimeout(() => setPartnerAutoResult(null), result.unmatched ? 8000 : 4000)
      } else if (result.error) {
        setPartnerAutoError(result.error)
        setTimeout(() => setPartnerAutoError(null), 4000)
      }
    } catch (err) {
      setPartnerAutoError(String(err))
      setTimeout(() => setPartnerAutoError(null), 4000)
    }
    setPartnerAutoAssigning(false)
  }

  const handleAutoAssign = async () => {
    setAutoAssigning(true)
    setAutoAssignResult(null)
    setAutoAssignError(null)
    try {
      const result = await autoAssignByDefaults(contractorId, riderIds, selectedDate)
      if (result.success) {
        setAutoAssignResult({ matched: result.matched || 0, unmatched: result.unmatched || 0, unmatchedLocalities: result.unmatchedLocalities })
        router.refresh()
        setTimeout(() => setAutoAssignResult(null), result.unmatched ? 8000 : 4000)
      } else if (result.error) {
        setAutoAssignError(result.error)
        setTimeout(() => setAutoAssignError(null), 4000)
      }
    } catch (err) {
      setAutoAssignError(String(err))
      setTimeout(() => setAutoAssignError(null), 4000)
    }
    setAutoAssigning(false)
  }

  // Sync defaults to ALL deliveries (overwrite existing assignments)
  const [showSyncConfirm, setShowSyncConfirm] = useState(false)
  const handleSyncDefaults = async () => {
    setAutoAssigning(true)
    setAutoAssignResult(null)
    setAutoAssignError(null)
    setShowSyncConfirm(false)
    try {
      const result = await syncDefaultsToAll(contractorId, riderIds, selectedDate)
      if (result.success) {
        setAutoAssignResult({ matched: result.matched || 0, unmatched: result.unmatched || 0, unmatchedLocalities: result.unmatchedLocalities })
        router.refresh()
        setTimeout(() => setAutoAssignResult(null), result.unmatched ? 8000 : 4000)
      } else if (result.error) {
        setAutoAssignError(result.error)
        setTimeout(() => setAutoAssignError(null), 4000)
      }
    } catch (err) {
      setAutoAssignError(String(err))
      setTimeout(() => setAutoAssignError(null), 4000)
    }
    setAutoAssigning(false)
  }

  // Save defaults for a rider
  const handleSaveDefaults = async (riderId: string, regions: string[]) => {
    await saveRiderRegionDefaults(contractorId, riderId, regions)
    router.refresh()
  }

  // Clear all defaults
  const [clearingDefaults, setClearingDefaults] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState<'main' | 'partner' | null>(null)

  const handleClearAllDefaults = async (type: 'main' | 'partner') => {
    setClearingDefaults(true)
    setShowClearConfirm(null)
    if (type === 'main') {
      await clearAllRiderRegionDefaults(contractorId)
    } else {
      await clearAllPartnerDefaults(contractorId)
    }
    setClearingDefaults(false)
    router.refresh()
  }

  // Build rider map
  const riderMap = new Map<string, string>()
  for (const r of riders) riderMap.set(r.id, r.name)

  // Date navigation
  const currentDateIndex = availableDates.indexOf(selectedDate)
  const canGoPrev = currentDateIndex < availableDates.length - 1
  const canGoNext = currentDateIndex > 0

  function navigateDate(direction: 'prev' | 'next') {
    const newIndex = direction === 'prev' ? currentDateIndex + 1 : currentDateIndex - 1
    if (newIndex >= 0 && newIndex < availableDates.length) {
      const params = new URLSearchParams(searchParams.toString())
      params.set('date', availableDates[newIndex])
      router.push(`${pathname}?${params.toString()}`)
    }
  }

  function selectDate(date: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('date', date)
    router.push(`${pathname}?${params.toString()}`)
  }

  // Filter deliveries
  const filtered = useMemo(() => {
    let result = deliveries
    if (filterRider === 'unassigned') {
      result = result.filter(d => !d.rider_id)
    } else if (filterRider !== 'all') {
      result = result.filter(d => d.rider_id === filterRider)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(d =>
        d.customer_name?.toLowerCase().includes(q) ||
        d.locality?.toLowerCase().includes(q) ||
        d.products?.toLowerCase().includes(q) ||
        d.contact_1?.includes(q)
      )
    }
    return result
  }, [deliveries, filterRider, searchQuery])

  // Group by locality
  const regionGroups = useMemo(() => {
    const groups: Record<string, Delivery[]> = {}
    for (const d of filtered) {
      const region = d.locality || 'Unassigned'
      if (!groups[region]) groups[region] = []
      groups[region].push(d)
    }
    return Object.entries(groups).sort((a, b) => {
      if (a[0] === 'Unassigned') return 1
      if (b[0] === 'Unassigned') return -1
      return a[0].localeCompare(b[0])
    })
  }, [filtered])



  // Stats
  const noRiderCount = deliveries.filter(d => !d.rider_id).length
  const unassignedCount = deliveries.filter(d => !d.rider_id || d.status === 'pending').length
  const assignedCount = deliveries.filter(d => d.rider_id && d.status !== 'pending').length
  const regionCount = new Set(deliveries.map(d => d.locality || 'Unassigned')).size
  const deliveredCount = deliveries.filter(d => d.status === 'delivered').length
  const inTransitCount = deliveries.filter(d => d.status === 'picked_up').length
  const nwdCount = deliveries.filter(d => d.status === 'nwd').length
  const cmsCount = deliveries.filter(d => d.status === 'cms').length
  const deliveredPercent = deliveries.length > 0 ? Math.round((deliveredCount / deliveries.length) * 100) : 0

  // Per-rider delivery counts
  const riderCounts = new Map<string, number>()
  const riderDelivered = new Map<string, number>()
  for (const d of deliveries) {
    if (d.rider_id) {
      riderCounts.set(d.rider_id, (riderCounts.get(d.rider_id) || 0) + 1)
      if (d.status === 'delivered') {
        riderDelivered.set(d.rider_id, (riderDelivered.get(d.rider_id) || 0) + 1)
      }
    }
  }

  // Region toggle
  function toggleRegion(region: string) {
    setExpandedRegions(prev => {
      const next = new Set(prev)
      if (next.has(region)) next.delete(region)
      else next.add(region)
      return next
    })
  }

  const allExpanded = regionGroups.length > 0 && regionGroups.every(([r]) => expandedRegions.has(r))
  function toggleAllRegions() {
    if (allExpanded) setExpandedRegions(new Set())
    else setExpandedRegions(new Set(regionGroups.map(([r]) => r)))
  }

  // Selection
  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectRegion = (regionDeliveries: Delivery[]) => {
    const ids = regionDeliveries.map(d => d.id)
    const allSelected = ids.every(id => selected.has(id))
    setSelected(prev => {
      const next = new Set(prev)
      if (allSelected) {
        for (const id of ids) next.delete(id)
      } else {
        for (const id of ids) next.add(id)
      }
      return next
    })
  }

  const selectAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map(d => d.id)))
    }
  }

  // Flush pending split assigns to server
  const flushPendingSaves = useCallback(async () => {
    if (pendingSavesRef.current.size === 0) return
    const batch = new Map(pendingSavesRef.current)
    pendingSavesRef.current.clear()

    // Group by rider for efficient bulk calls
    const riderGroups = new Map<string, string[]>()
    for (const [deliveryId, riderId] of batch) {
      if (!riderGroups.has(riderId)) riderGroups.set(riderId, [])
      riderGroups.get(riderId)!.push(deliveryId)
    }

    for (const [riderId, ids] of riderGroups) {
      await bulkAssignDeliveries(ids, riderId, contractorId)
    }
    router.refresh()
  }, [contractorId, router])

  // Split mode instant assign - optimistic UI + debounced server save
  const handleSplitAssign = useCallback((deliveryId: string, riderId: string) => {
    // Instant optimistic update
    setOptimisticAssigns(prev => {
      const next = new Map(prev)
      next.set(deliveryId, riderId)
      return next
    })

    // Queue for server save
    pendingSavesRef.current.set(deliveryId, riderId)

    // Debounce: save after 1.5s of no taps
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      flushPendingSaves()
    }, 1500)
  }, [flushPendingSaves])

  // Get effective rider_id (optimistic overrides server value)
  const getEffectiveRiderId = useCallback((d: Delivery) => {
    return optimisticAssigns.get(d.id) || d.rider_id
  }, [optimisticAssigns])

  // Assign actions
  const handleBulkAssign = async () => {
    if (!assignTarget || selected.size === 0) return
    setAssigning(true)
    await bulkAssignDeliveries(Array.from(selected), assignTarget, contractorId)
    setSelected(new Set())
    setAssignTarget('')
    setAssigning(false)
    router.refresh()
  }

  const handleSingleAssign = async (deliveryId: string, riderId: string) => {
    setAssigning(true)
    await assignDelivery(deliveryId, riderId, contractorId)
    setAssigning(false)
    router.refresh()
  }

  // Bulk assign entire region
  const handleRegionAssign = async (regionDeliveries: Delivery[], riderId: string) => {
    setAssigning(true)
    const ids = regionDeliveries.map(d => d.id)
    await bulkAssignDeliveries(ids, riderId, contractorId)
    setAssigning(false)
    router.refresh()
  }

  return (
    <div className="space-y-3 pb-20">
      {/* ── Tab Toggle: Main / Partner ── */}
      <div className="flex rounded-xl border border-border bg-card p-0.5 gap-0.5">
        <button
          onClick={() => setActiveTab('main')}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all",
            activeTab === 'main'
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Package className="w-3.5 h-3.5" />
          Main ({deliveries.length})
        </button>
        {partnerDeliveries.length > 0 && (
          <button
            onClick={() => setActiveTab('partner')}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all",
              activeTab === 'partner'
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Partner ({partnerDeliveries.length})
            {partnerNoRiderCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[9px] font-bold">
                {partnerNoRiderCount}
              </span>
            )}
          </button>
        )}
        <button
          onClick={() => setActiveTab('stock')}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all",
            activeTab === 'stock'
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <ClipboardList className="w-3.5 h-3.5" />
          Stock
        </button>
      </div>

      {activeTab === 'main' && (<>
      {/* ── Date Navigation ── */}
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => navigateDate('prev')} disabled={!canGoPrev}>
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <button
          onClick={() => { const el = document.getElementById('assign-date-select'); if (el) (el as HTMLSelectElement).showPicker?.() }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-card border border-border hover:border-primary/50 transition-colors"
        >
          <Calendar className="w-4 h-4 text-primary" />
          <span className="font-semibold text-sm">{formatDate(selectedDate)}</span>
        </button>
        <select id="assign-date-select" className="sr-only" value={selectedDate} onChange={(e) => selectDate(e.target.value)}>
          {availableDates.map(d => (<option key={d} value={d}>{formatDate(d)}</option>))}
        </select>
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => navigateDate('next')} disabled={!canGoNext}>
          <ChevronRight className="w-5 h-5" />
        </Button>
      </div>

      {/* ── Auto-Assign + Defaults ── */}
      <div className="flex items-center gap-2">
        {/* Main action: Auto-Assign unassigned OR Sync all */}
        {noRiderCount > 0 ? (
          <button
            onClick={handleAutoAssign}
            disabled={autoAssigning || !hasDefaults}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all",
              hasDefaults
                ? "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98]"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            <Zap className={cn("w-4 h-4", autoAssigning && "animate-pulse")} />
            {autoAssigning ? 'Assigning...' : !hasDefaults ? 'Set Defaults First' : `Auto-Assign ${noRiderCount} Deliveries`}
          </button>
        ) : (
          <button
            onClick={() => setShowSyncConfirm(true)}
            disabled={autoAssigning || !hasDefaults || deliveries.length === 0}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all",
              hasDefaults && deliveries.length > 0
                ? "bg-card text-foreground border border-border hover:border-primary/40 active:scale-[0.98]"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            <RefreshCw className={cn("w-3.5 h-3.5", autoAssigning && "animate-spin")} />
            {autoAssigning ? 'Syncing...' : 'Sync Defaults'}
          </button>
        )}
        <button
          onClick={() => setShowDefaults(!showDefaults)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium border transition-all shrink-0",
            showDefaults
              ? "bg-primary/10 text-primary border-primary/30"
              : "bg-card text-muted-foreground border-border hover:border-primary/30"
          )}
        >
          <Settings2 className="w-3.5 h-3.5" />
          Defaults
        </button>
      </div>

      {/* Sync confirmation */}
      {showSyncConfirm && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 space-y-2">
          <p className="text-xs text-foreground font-medium">Re-apply default rider assignments?</p>
          <p className="text-[10px] text-muted-foreground">
            This will overwrite current rider assignments for all {deliveries.length} deliveries based on your region defaults.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleSyncDefaults}
              className="flex-1 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 transition-colors"
            >
              Yes, Sync All
            </button>
            <button
              onClick={() => setShowSyncConfirm(false)}
              className="flex-1 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-medium hover:bg-muted/80 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Auto-assign / sync result */}
      {autoAssignResult && (
        <div className={cn(
          "rounded-xl border px-3 py-2 space-y-1",
          autoAssignResult.unmatched > 0
            ? "border-amber-500/30 bg-amber-500/5"
            : "border-emerald-500/30 bg-emerald-500/10"
        )}>
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-xs text-emerald-400">
              Assigned {autoAssignResult.matched} deliveries by defaults.
            </span>
          </div>
          {autoAssignResult.unmatched > 0 && autoAssignResult.unmatchedLocalities && (
            <div className="pl-6">
              <p className="text-[10px] text-amber-400 font-medium">
                {autoAssignResult.unmatched} region{autoAssignResult.unmatched !== 1 ? 's' : ''} not in defaults:
              </p>
              <p className="text-[10px] text-amber-400/70 mt-0.5">
                {autoAssignResult.unmatchedLocalities.join(', ')}
                {autoAssignResult.unmatched > 10 && '...'}
              </p>
            </div>
          )}
        </div>
      )}
      {autoAssignError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 flex items-center gap-2">
          <XCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="text-xs text-red-400">{autoAssignError}</span>
        </div>
      )}

      {/* Defaults Management Panel */}
      {showDefaults && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-3 py-2 border-b border-border bg-muted/30 flex items-center justify-between">
            <div>
                    <p className="text-xs font-semibold text-foreground">Rider Locality Defaults</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Set localities and route order for each rider. Drag to reorder.</p>
            </div>
            {hasDefaults && (
              <button
                onClick={() => setShowClearConfirm(showClearConfirm === 'main' ? null : 'main')}
                className="text-[10px] text-red-400 hover:text-red-300 font-medium flex items-center gap-0.5 shrink-0"
              >
                <Trash2 className="w-3 h-3" />
                Clear
              </button>
            )}
          </div>
          {showClearConfirm === 'main' && (
            <div className="px-3 py-2 border-b border-red-500/20 bg-red-500/5 flex items-center justify-between gap-2">
              <p className="text-[10px] text-red-400">Clear all rider defaults?</p>
              <div className="flex gap-1.5">
                <button
                  onClick={() => handleClearAllDefaults('main')}
                  disabled={clearingDefaults}
                  className="px-2.5 py-1 rounded-lg bg-red-500 text-white text-[10px] font-semibold hover:bg-red-600"
                >
                  {clearingDefaults ? 'Clearing...' : 'Yes, Clear'}
                </button>
                <button onClick={() => setShowClearConfirm(null)} className="px-2.5 py-1 rounded-lg bg-muted text-muted-foreground text-[10px] font-medium">
                  Cancel
                </button>
              </div>
            </div>
          )}
          <div className="divide-y divide-border">
            {riders.map((r, i) => {
              const rc = RIDER_COLORS[i % RIDER_COLORS.length]
              const currentRegions = regionDefaults
                .filter(d => d.rider_id === r.id)
                .map(d => d.locality)
              return (
                <RiderDefaultsRow
                  key={r.id}
                  rider={r}
                  color={rc}
                  currentRegions={currentRegions}
                  allRegions={allRegions}
                  onSave={(regions) => handleSaveDefaults(r.id, regions)}
                  otherRiderDefaults={regionDefaults.filter(d => d.rider_id !== r.id)}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* ── Delivery Overview ── */}
      <div className="space-y-2">
        {/* Delivery count + progress */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 pt-3 pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-primary" />
                <span className="text-xs font-medium text-muted-foreground">Deliveries for the day</span>
              </div>
              <span className="text-[10px] text-muted-foreground">{regionCount} localit{regionCount !== 1 ? 'ies' : 'y'}</span>
            </div>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="text-3xl font-bold text-foreground tabular-nums">{deliveries.length}</span>
              {deliveredCount > 0 && (
                <span className="text-sm text-emerald-400 font-semibold tabular-nums">{deliveredCount} done</span>
              )}
            </div>
          </div>

          {/* Pipeline bar */}
          {deliveries.length > 0 && (
            <div className="px-4 pb-3">
              <div className="flex h-3 rounded-full overflow-hidden bg-muted">
                {deliveredCount > 0 && (
                  <div className="bg-emerald-500 transition-all duration-500 flex items-center justify-center" style={{ width: `${(deliveredCount / deliveries.length) * 100}%` }}>
                    {deliveredPercent >= 15 && <span className="text-[8px] font-bold text-white">{deliveredCount}</span>}
                  </div>
                )}
                {inTransitCount > 0 && (
                  <div className="bg-purple-500 transition-all duration-500 flex items-center justify-center" style={{ width: `${(inTransitCount / deliveries.length) * 100}%` }}>
                    {(inTransitCount / deliveries.length) * 100 >= 15 && <span className="text-[8px] font-bold text-white">{inTransitCount}</span>}
                  </div>
                )}
                {assignedCount > 0 && (
                  <div className="bg-blue-500 transition-all duration-500 flex items-center justify-center" style={{ width: `${(assignedCount / deliveries.length) * 100}%` }}>
                    {(assignedCount / deliveries.length) * 100 >= 15 && <span className="text-[8px] font-bold text-white">{assignedCount}</span>}
                  </div>
                )}
                {unassignedCount > 0 && (
                  <div className="bg-amber-500/60 transition-all duration-500 flex items-center justify-center" style={{ width: `${(unassignedCount / deliveries.length) * 100}%` }}>
                    {(unassignedCount / deliveries.length) * 100 >= 15 && <span className="text-[8px] font-bold text-white/80">{unassignedCount}</span>}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                <span className="flex items-center gap-1 text-[10px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span className="text-muted-foreground">Delivered</span>
                </span>
                <span className="flex items-center gap-1 text-[10px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                  <span className="text-muted-foreground">Transit</span>
                </span>
                <span className="flex items-center gap-1 text-[10px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  <span className="text-muted-foreground">Assigned</span>
                </span>
                <span className="flex items-center gap-1 text-[10px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500/60" />
                  <span className="text-muted-foreground">Pending</span>
                </span>
                {(nwdCount + cmsCount) > 0 && (
                  <span className="flex items-center gap-1 text-[10px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                    <span className="text-red-400 font-semibold">{nwdCount + cmsCount}</span>
                    <span className="text-muted-foreground">Failed</span>
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Rider Cards - delivery focused */}
        {riders.length > 0 && (
          <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
            {riders.map((r, i) => {
              const count = riderCounts.get(r.id) || 0
              const done = riderDelivered.get(r.id) || 0
              const rc = RIDER_COLORS[i % RIDER_COLORS.length]
              const pct = count > 0 ? Math.round((done / count) * 100) : 0
              return (
                <button
                  key={r.id}
                  onClick={() => setFilterRider(filterRider === r.id ? 'all' : r.id)}
                  className={cn(
                    "flex-shrink-0 rounded-xl border p-2.5 min-w-[110px] transition-all text-left",
                    filterRider === r.id
                      ? "border-primary/50 bg-primary/5"
                      : "border-border bg-card hover:border-border/80"
                  )}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className={cn("w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold", rc.bg, rc.text)}>
                      {getRiderInitials(r.name)}
                    </span>
                    <span className="text-[11px] font-semibold text-foreground truncate">{r.name}</span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-xl font-bold text-foreground tabular-nums">{count}</span>
                    <span className="text-[10px] text-muted-foreground">deliveries</span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className={cn("text-[10px] font-medium tabular-nums", pct === 100 ? "text-emerald-400" : "text-muted-foreground")}>{done}/{count} done</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted mt-1 overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", pct === 100 ? "bg-emerald-500" : rc.active)} style={{ width: `${pct}%` }} />
                  </div>
                </button>
              )
            })}
            {unassignedCount > 0 && (
              <button
                onClick={() => setFilterRider(filterRider === 'unassigned' ? 'all' : 'unassigned')}
                className={cn(
                  "flex-shrink-0 rounded-xl border p-2.5 min-w-[110px] transition-all text-left border-dashed",
                  filterRider === 'unassigned'
                    ? "border-amber-500/50 bg-amber-500/5"
                    : "border-amber-500/20 bg-card"
                )}
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  <span className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold bg-amber-500/15 text-amber-400">?</span>
                  <span className="text-[11px] font-semibold text-amber-400">Pending</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-xl font-bold text-amber-400 tabular-nums">{unassignedCount}</span>
                  <span className="text-[10px] text-muted-foreground">to assign</span>
                </div>
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Search ── */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search customer, locality, product..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 h-9 text-sm"
        />
      </div>

      {/* Active filter indicator */}
      {filterRider !== 'all' && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">Filtering by:</span>
          <Badge variant="secondary" className="text-[10px] gap-1">
            {filterRider === 'unassigned' ? 'Unassigned' : riders.find(r => r.id === filterRider)?.name}
            <button onClick={() => setFilterRider('all')} className="ml-0.5 hover:text-foreground">
              <XCircle className="w-3 h-3" />
            </button>
          </Badge>
        </div>
      )}

      {/* ── Bulk Assign Bar (sticky) ── */}
      {selected.size > 0 && (
        <div className="sticky top-0 z-20 rounded-xl border border-primary/30 bg-card p-3 space-y-2 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-primary">{selected.size} selected</span>
            <button onClick={() => setSelected(new Set())} className="text-xs text-muted-foreground">
              Clear
            </button>
          </div>
          <div className="flex gap-2">
            <select
              value={assignTarget}
              onChange={(e) => setAssignTarget(e.target.value)}
              className={cn(
                "flex-1 text-xs rounded-lg border px-2 py-2 font-medium transition-colors cursor-pointer",
                assignTarget
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground"
              )}
            >
              <option value="">Select rider...</option>
              {riders.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={!assignTarget || assigning}
              onClick={handleBulkAssign}
              className="shrink-0"
            >
              <UserPlus className="w-4 h-4 mr-1" />
              {assigning ? 'Assigning...' : 'Assign'}
            </Button>
          </div>
        </div>
      )}

      {/* ── Expand/Collapse + Select All ── */}
      <div className="flex items-center justify-between">
        <button onClick={selectAll} className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className={cn(
            "w-4 h-4 rounded border flex items-center justify-center transition-colors",
            selected.size === filtered.length && filtered.length > 0
              ? "bg-primary border-primary" : "border-muted-foreground/40"
          )}>
            {selected.size === filtered.length && filtered.length > 0 && <Check className="w-3 h-3 text-primary-foreground" />}
          </div>
          Select all ({filtered.length})
        </button>
        <button onClick={toggleAllRegions} className="text-xs text-primary font-medium">
          {allExpanded ? 'Collapse all' : 'Expand all'}
        </button>
      </div>

      {/* ── Region Groups ── */}
      <div className="space-y-3">
        {regionGroups.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <Package className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No deliveries found for this date</p>
          </div>
        ) : (
          regionGroups.map(([region, regionDeliveries]) => {
            const regionColor = getRegionColor(region)
            const isExpanded = expandedRegions.has(region)
            const regionUnassigned = regionDeliveries.filter(d => !d.rider_id).length
            const allRegionSelected = regionDeliveries.every(d => selected.has(d.id))

            return (
              <div key={region} className="rounded-xl border border-border bg-card overflow-hidden">
                {/* Region Header */}
                <div className="flex items-center gap-2 p-3 cursor-pointer" onClick={() => toggleRegion(region)}>
                  {/* Checkbox for region */}
                  <button
                    onClick={(e) => { e.stopPropagation(); selectRegion(regionDeliveries) }}
                    className="shrink-0"
                  >
                    <div className={cn(
                      "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                      allRegionSelected ? "bg-primary border-primary" : "border-muted-foreground/40"
                    )}>
                      {allRegionSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                    </div>
                  </button>

  {/* Region avatar */}
  <RegionAvatar region={region} size="md" />

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{region}</p>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{regionDeliveries.length} deliveries</span>
                      {regionUnassigned > 0 && (
                        <Badge className="text-[8px] py-0 px-1.5 bg-amber-500/15 text-amber-400 border-0">{regionUnassigned} unassigned</Badge>
                      )}
                      {(() => {
                        const defaultRiderId = defaultRegionMap.get(region.toLowerCase().trim())
                        const defaultRiderName = defaultRiderId ? riderMap.get(defaultRiderId) : null
                        if (defaultRiderName) return (
                          <span className="text-[9px] text-primary/60">
                            {defaultRiderName}
                          </span>
                        )
                        return null
                      })()}
                    </div>
                  </div>

                  {/* Split toggle */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      const wasActive = splitRegions.has(region)
                      setSplitRegions(prev => {
                        const next = new Set(prev)
                        if (next.has(region)) next.delete(region)
                        else next.add(region)
                        return next
                      })
                      // Flush saves when exiting split mode
                      if (wasActive && pendingSavesRef.current.size > 0) {
                        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
                        flushPendingSaves()
                      }
                      // Auto-expand if not already
                      if (!isExpanded) toggleRegion(region)
                    }}
                    className={cn(
                      "flex items-center gap-0.5 text-[10px] px-2 py-1.5 rounded-lg font-medium transition-all shrink-0",
                      splitRegions.has(region)
                        ? "bg-violet-500/20 text-violet-400 border border-violet-500/40"
                        : "bg-muted text-muted-foreground border border-border hover:border-violet-500/30"
                    )}
                  >
                    <Split className="w-3 h-3" />
                    Split
                  </button>

                  {/* Quick region assign */}
                  <select
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      if (e.target.value) {
                        const sel = e.target
                        handleRegionAssign(regionDeliveries, e.target.value)
                        sel.style.background = 'rgba(34,197,94,0.25)'
                        sel.style.color = '#22c55e'
                        setTimeout(() => { sel.style.background = ''; sel.style.color = ''; sel.value = '' }, 1200)
                      }
                    }}
                    className="text-[10px] bg-primary/10 text-primary border border-primary/30 rounded-lg px-2 py-1.5 max-w-[80px] font-medium transition-all cursor-pointer shrink-0"
                    defaultValue=""
                  >
                    <option value="" disabled>All</option>
                    {riders.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>

                  {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                </div>

                {/* Region Deliveries */}
                {isExpanded && (
                  <div className="border-t border-border">
                    {/* Split mode rider legend */}
                    {splitRegions.has(region) && (
                      <div className="px-3 py-2 bg-violet-500/5 border-b border-border flex items-center gap-1.5 overflow-x-auto">
                        <Split className="w-3 h-3 text-violet-400 shrink-0" />
                        <span className="text-[10px] text-violet-400 font-medium shrink-0">Tap to assign:</span>
                        {pendingSavesRef.current.size > 0 && (
                          <span className="text-[9px] text-amber-400 shrink-0 animate-pulse">saving...</span>
                        )}
                        {riders.map((r, i) => {
                          const rc = RIDER_COLORS[i % RIDER_COLORS.length]
                          return (
                            <span key={r.id} className={cn("text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0", rc.bg, rc.text)}>
                              {getRiderInitials(r.name)} = {r.name}
                            </span>
                          )
                        })}
                      </div>
                    )}

                    <div className="divide-y divide-border">
                    {regionDeliveries.map((d) => {
                      const statusCfg = STATUS_CONFIG[d.status] || STATUS_CONFIG.pending
                      const StatusIcon = statusCfg.icon
                      const isItemExpanded = expandedId === d.id
                      const isSelected = selected.has(d.id)
                      const effectiveRiderId = getEffectiveRiderId(d)
                      const riderName = effectiveRiderId ? riderMap.get(effectiveRiderId) : null
                      const isSplitMode = splitRegions.has(region)

                      return (
                        <div key={d.id} className={cn("transition-colors", isSelected && "bg-primary/5")}>
                          {/* Row */}
                          <div className="flex items-center gap-1.5 px-3 py-2">
                            {/* Checkbox (hidden in split mode) */}
                            {!isSplitMode && (
                              <button onClick={() => toggleSelect(d.id)} className="shrink-0">
                                <div className={cn(
                                  "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                                  isSelected ? "bg-primary border-primary" : "border-muted-foreground/40"
                                )}>
                                  {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                                </div>
                              </button>
                            )}

                            {/* Status icon */}
                            <div className={cn("w-6 h-6 rounded-lg flex items-center justify-center shrink-0", statusCfg.bgColor)}>
                              <StatusIcon className={cn("w-3 h-3", statusCfg.color)} />
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0 cursor-pointer" onClick={() => !isSplitMode && setExpandedId(isItemExpanded ? null : d.id)}>
                              <div className="flex items-center gap-1">
                                <p className="text-xs font-medium truncate">{d.customer_name}</p>
                                {d.sales_type && d.sales_type !== 'sale' && d.sales_type !== 'drop_off' && (
                                  <span style={{
                                    padding: '1px 4px',
                                    borderRadius: '3px',
                                    fontSize: '8px',
                                    fontWeight: 800,
                                    flexShrink: 0,
                                    backgroundColor: d.sales_type === 'exchange' ? 'rgba(139,92,246,0.25)' :
                                                    d.sales_type === 'trade_in' ? 'rgba(59,130,246,0.25)' : 'rgba(239,68,68,0.25)',
                                    color: d.sales_type === 'exchange' ? '#a78bfa' : d.sales_type === 'trade_in' ? '#60a5fa' : '#f87171',
                                  }}>
                                    {d.sales_type === 'exchange' ? 'EXCHG' : d.sales_type === 'trade_in' ? 'TRADE' : 'REFND'}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                {d.index_no && <span>{d.index_no}</span>}
                                {d.products && <><span>-</span><span className="truncate max-w-[80px]">{d.products}</span></>}
                              </div>
                            </div>

                            {/* Split mode: inline rider initial buttons */}
                            {isSplitMode ? (
                              <div className="flex items-center gap-1 shrink-0">
                                {riders.map((r, i) => {
                                  const rc = RIDER_COLORS[i % RIDER_COLORS.length]
                                  const isAssigned = effectiveRiderId === r.id
                                  return (
                                    <button
                                      key={r.id}
                                      onClick={() => handleSplitAssign(d.id, r.id)}
                                      className={cn(
                                        "w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold transition-all duration-100 active:scale-110",
                                        isAssigned
                                          ? cn(rc.active, rc.activeText, "ring-2 ring-white/20 shadow-lg scale-105")
                                          : cn(rc.bg, rc.text, "opacity-40 hover:opacity-100")
                                      )}
                                      title={r.name}
                                    >
                                      {getRiderInitials(r.name)}
                                    </button>
                                  )
                                })}
                              </div>
                            ) : (
                              /* Normal mode: rider badge + amount */
                              <div className="flex items-center gap-1 shrink-0">
                                {riderName ? (
                                  <Badge className="text-[8px] py-0 bg-blue-500/15 text-blue-400 border-0">{riderName}</Badge>
                                ) : (
                                  <Badge className="text-[8px] py-0 bg-amber-500/15 text-amber-400 border-0">None</Badge>
                                )}
                                {d.amount ? (
                                  <span className="text-[10px] font-semibold text-foreground">Rs{d.amount}</span>
                                ) : null}
                                <button onClick={() => setExpandedId(isItemExpanded ? null : d.id)}>
                                  {isItemExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Expanded Detail (only in normal mode) */}
                          {isItemExpanded && !isSplitMode && (
                            <div className="px-3 pb-3 space-y-2 bg-muted/30">
                              {/* Contact */}
                              <div className="flex flex-wrap gap-2 text-xs">
                                {d.contact_1 && (
                                  <a href={`tel:${d.contact_1}`} className="flex items-center gap-1 text-primary">
                                    <Phone className="w-3 h-3" />{d.contact_1}
                                  </a>
                                )}
                                {d.locality && (
                                  <span className="flex items-center gap-1 text-muted-foreground">
                                    <MapPin className="w-3 h-3" />{d.locality}
                                  </span>
                                )}
                              </div>

                              {/* Product & amount */}
                              {d.products && (
                                <div className="bg-muted/50 rounded-lg p-2 text-xs">
                                  <span className="text-muted-foreground">Products: </span>{d.products}
                                  {d.qty && <span className="text-muted-foreground"> x{d.qty}</span>}
                                </div>
                              )}

                              {/* Return product protocol for exchange/trade_in/refund */}
                              {d.sales_type && ['exchange', 'trade_in', 'refund'].includes(d.sales_type) && (
                                <div style={{
                                  padding: '10px',
                                  borderRadius: '8px',
                                  border: d.sales_type === 'exchange' ? '2px solid #8b5cf6' :
                                         d.sales_type === 'trade_in' ? '2px solid #3b82f6' : '2px solid #ef4444',
                                  backgroundColor: d.sales_type === 'exchange' ? 'rgba(139,92,246,0.15)' :
                                                  d.sales_type === 'trade_in' ? 'rgba(59,130,246,0.15)' : 'rgba(239,68,68,0.15)',
                                }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 800,
                                    color: d.sales_type === 'exchange' ? '#a78bfa' : d.sales_type === 'trade_in' ? '#60a5fa' : '#f87171'
                                  }}>
                                    <RefreshCw style={{ width: 14, height: 14 }} />
                                    {d.sales_type === 'exchange' ? 'EXCHANGE ORDER' : d.sales_type === 'trade_in' ? 'TRADE-IN ORDER' : 'REFUND ORDER'}
                                  </div>
                                  {d.return_product && (
                                    <p style={{ fontSize: '12px', fontWeight: 700, color: '#fbbf24', margin: '4px 0' }}>Collect: {d.return_product}</p>
                                  )}
                                  <p style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', lineHeight: '1.4' }}>
                                    {d.sales_type === 'exchange'
                                      ? 'Deliver new, collect old with ALL packaging. Missing parts deducted from payout.'
                                      : d.sales_type === 'trade_in'
                                      ? 'Deliver new, collect trade-in. Verify packaging. Missing parts deducted from payout.'
                                      : 'Give cash refund, collect product with ALL packaging. Missing parts deducted from payout.'}
                                  </p>
                                </div>
                              )}

                              {/* Quick assign */}
                              <div className="space-y-1.5">
                                <p className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                                  <Users className="w-3 h-3" /> Assign to:
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  {riders.map(r => (
                                    <button
                                      key={r.id}
                                      disabled={assigning}
                                      onClick={(e) => {
                                        const btn = e.currentTarget
                                        handleSingleAssign(d.id, r.id)
                                        btn.style.background = 'rgba(34,197,94,0.3)'
                                        btn.style.color = '#22c55e'
                                        btn.style.transform = 'scale(1.1)'
                                        setTimeout(() => { btn.style.background = ''; btn.style.color = ''; btn.style.transform = '' }, 800)
                                      }}
                                      className={cn(
                                        "px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-all duration-200",
                                        effectiveRiderId === r.id
                                          ? "bg-primary/25 text-primary border border-primary/40 ring-1 ring-primary/20"
                                          : "bg-muted text-muted-foreground hover:bg-primary/20 hover:text-primary border border-transparent"
                                      )}
                                    >
                                      {effectiveRiderId === r.id && <Check className="w-3 h-3 inline mr-0.5 -mt-0.5" />}
                                      {r.name}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
      </>)}

      {/* ── Partner Tab ── */}
      {activeTab === 'partner' && (
        <div className="space-y-3">
          {/* ── Delivery Overview ── */}
          <div className="space-y-2">
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-4 pt-3 pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="w-4 h-4 text-primary" />
                    <span className="text-xs font-medium text-muted-foreground">Partner Deliveries</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">{partnerRegionCount} localit{partnerRegionCount !== 1 ? 'ies' : 'y'}</span>
                </div>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <span className="text-3xl font-bold text-foreground tabular-nums">{partnerDeliveries.length}</span>
                  {partnerAssignedCount > 0 && (
                    <span className="text-sm text-blue-400 font-semibold tabular-nums">{partnerAssignedCount} assigned</span>
                  )}
                </div>
              </div>

              {/* Pipeline bar */}
              {partnerDeliveries.length > 0 && (
                <div className="px-4 pb-3">
                  <div className="flex h-3 rounded-full overflow-hidden bg-muted">
                    {partnerDeliveredCount > 0 && (
                      <div className="bg-emerald-500 transition-all duration-500 flex items-center justify-center" style={{ width: `${(partnerDeliveredCount / partnerDeliveries.length) * 100}%` }}>
                        {(partnerDeliveredCount / partnerDeliveries.length) * 100 >= 15 && <span className="text-[8px] font-bold text-white">{partnerDeliveredCount}</span>}
                      </div>
                    )}
                    {partnerAssignedCount > 0 && (
                      <div className="bg-blue-500 transition-all duration-500 flex items-center justify-center" style={{ width: `${(partnerAssignedCount / partnerDeliveries.length) * 100}%` }}>
                        {(partnerAssignedCount / partnerDeliveries.length) * 100 >= 15 && <span className="text-[8px] font-bold text-white">{partnerAssignedCount}</span>}
                      </div>
                    )}
                    {partnerNoRiderCount > 0 && (
                      <div className="bg-amber-500/60 transition-all duration-500 flex items-center justify-center" style={{ width: `${(partnerNoRiderCount / partnerDeliveries.length) * 100}%` }}>
                        {(partnerNoRiderCount / partnerDeliveries.length) * 100 >= 15 && <span className="text-[8px] font-bold text-white/80">{partnerNoRiderCount}</span>}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                    <span className="flex items-center gap-1 text-[10px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span className="text-muted-foreground">Delivered</span>
                    </span>
                    <span className="flex items-center gap-1 text-[10px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                      <span className="text-muted-foreground">Assigned</span>
                    </span>
                    <span className="flex items-center gap-1 text-[10px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500/60" />
                      <span className="text-muted-foreground">Unassigned</span>
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Rider Cards */}
            {riders.length > 0 && (
              <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-0.5">
                {riders.map((r, i) => {
                  const count = partnerRiderCounts.get(r.id) || 0
                  const done = partnerRiderDelivered.get(r.id) || 0
                  const rc = RIDER_COLORS[i % RIDER_COLORS.length]
                  const pct = count > 0 ? Math.round((done / count) * 100) : 0
                  return (
                    <button
                      key={r.id}
                      onClick={() => setPartnerFilterRider(partnerFilterRider === r.id ? 'all' : r.id)}
                      className={cn(
                        "flex-shrink-0 rounded-xl border p-2.5 min-w-[110px] transition-all text-left",
                        partnerFilterRider === r.id
                          ? "border-primary/50 bg-primary/5"
                          : "border-border bg-card hover:border-border/80"
                      )}
                    >
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span className={cn("w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold", rc.bg, rc.text)}>
                          {getRiderInitials(r.name)}
                        </span>
                        <span className="text-[11px] font-semibold text-foreground truncate">{r.name}</span>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-xl font-bold text-foreground tabular-nums">{count}</span>
                        <span className="text-[10px] text-muted-foreground">orders</span>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className={cn("text-[10px] font-medium tabular-nums", pct === 100 ? "text-emerald-400" : "text-muted-foreground")}>{done}/{count} done</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted mt-1 overflow-hidden">
                        <div className={cn("h-full rounded-full transition-all", pct === 100 ? "bg-emerald-500" : rc.active)} style={{ width: `${pct}%` }} />
                      </div>
                    </button>
                  )
                })}
                {partnerNoRiderCount > 0 && (
                  <button
                    onClick={() => setPartnerFilterRider(partnerFilterRider === 'unassigned' ? 'all' : 'unassigned')}
                    className={cn(
                      "flex-shrink-0 rounded-xl border p-2.5 min-w-[110px] transition-all text-left border-dashed",
                      partnerFilterRider === 'unassigned'
                        ? "border-amber-500/50 bg-amber-500/5"
                        : "border-amber-500/20 bg-card"
                    )}
                  >
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold bg-amber-500/15 text-amber-400">?</span>
                      <span className="text-[11px] font-semibold text-amber-400">Pending</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="text-xl font-bold text-amber-400 tabular-nums">{partnerNoRiderCount}</span>
                      <span className="text-[10px] text-muted-foreground">to assign</span>
                    </div>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── Auto-Assign + Defaults ── */}
          <div className="flex items-center gap-2">
            {partnerNoRiderCount > 0 ? (
              <button
                onClick={handlePartnerAutoAssign}
                disabled={partnerAutoAssigning || !hasPartnerDefaults}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all",
                  hasPartnerDefaults
                    ? "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98]"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                )}
              >
                <Zap className={cn("w-4 h-4", partnerAutoAssigning && "animate-pulse")} />
                {partnerAutoAssigning ? 'Assigning...' : !hasPartnerDefaults ? 'Set Defaults First' : `Auto-Assign ${partnerNoRiderCount} Deliveries`}
              </button>
            ) : (
              <button
                onClick={() => setPartnerShowSyncConfirm(true)}
                disabled={partnerAutoAssigning || !hasPartnerDefaults || partnerDeliveries.length === 0}
                className={cn(
                  "flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all",
                  hasPartnerDefaults && partnerDeliveries.length > 0
                    ? "bg-card text-foreground border border-border hover:border-primary/40 active:scale-[0.98]"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                )}
              >
                <RefreshCw className={cn("w-3.5 h-3.5", partnerAutoAssigning && "animate-spin")} />
                {partnerAutoAssigning ? 'Syncing...' : 'Sync Defaults'}
              </button>
            )}
            <button
              onClick={() => setPartnerShowDefaults(!partnerShowDefaults)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium border transition-all shrink-0",
                partnerShowDefaults
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "bg-card text-muted-foreground border-border hover:border-primary/30"
              )}
            >
              <Settings2 className="w-3.5 h-3.5" />
              Defaults
            </button>
          </div>

          {/* Sync confirmation */}
          {partnerShowSyncConfirm && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 space-y-2">
              <p className="text-xs text-foreground font-medium">Re-apply default rider assignments?</p>
              <p className="text-[10px] text-muted-foreground">
                This will overwrite current rider assignments for all {partnerDeliveries.length} partner deliveries based on your region defaults.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handlePartnerSyncDefaults}
                  className="flex-1 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 transition-colors"
                >
                  Yes, Sync All
                </button>
                <button
                  onClick={() => setPartnerShowSyncConfirm(false)}
                  className="flex-1 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-medium hover:bg-muted/80 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Auto-assign result */}
          {partnerAutoResult && (
            <div className={cn(
              "rounded-xl border px-3 py-2 space-y-1",
              partnerAutoResult.unmatched > 0
                ? "border-amber-500/30 bg-amber-500/5"
                : "border-emerald-500/30 bg-emerald-500/10"
            )}>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-xs text-emerald-400">
                  Assigned {partnerAutoResult.matched} partner deliveries by defaults.
                </span>
              </div>
              {partnerAutoResult.unmatched > 0 && partnerAutoResult.unmatchedLocalities && (
                <div className="pl-6">
                  <p className="text-[10px] text-amber-400 font-medium">
                    {partnerAutoResult.unmatched} region{partnerAutoResult.unmatched !== 1 ? 's' : ''} not in defaults:
                  </p>
                  <p className="text-[10px] text-amber-400/70 mt-0.5">
                    {partnerAutoResult.unmatchedLocalities.join(', ')}
                    {partnerAutoResult.unmatched > 10 && '...'}
                  </p>
                </div>
              )}
            </div>
          )}
          {partnerAutoError && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span className="text-xs text-red-400">{partnerAutoError}</span>
            </div>
          )}

          {/* Defaults Management Panel */}
          {partnerShowDefaults && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="px-3 py-2 border-b border-border bg-muted/30 flex items-center justify-between">
                <div>
                    <p className="text-xs font-semibold text-foreground">Partner Rider Locality Defaults</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Separate from main. Set localities and route order.</p>
                </div>
                {hasPartnerDefaults && (
                  <button
                    onClick={() => setShowClearConfirm(showClearConfirm === 'partner' ? null : 'partner')}
                    className="text-[10px] text-red-400 hover:text-red-300 font-medium flex items-center gap-0.5 shrink-0"
                  >
                    <Trash2 className="w-3 h-3" />
                    Clear
                  </button>
                )}
              </div>
              {showClearConfirm === 'partner' && (
                <div className="px-3 py-2 border-b border-red-500/20 bg-red-500/5 flex items-center justify-between gap-2">
                  <p className="text-[10px] text-red-400">Clear all partner defaults?</p>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => handleClearAllDefaults('partner')}
                      disabled={clearingDefaults}
                      className="px-2.5 py-1 rounded-lg bg-red-500 text-white text-[10px] font-semibold hover:bg-red-600"
                    >
                      {clearingDefaults ? 'Clearing...' : 'Yes, Clear'}
                    </button>
                    <button onClick={() => setShowClearConfirm(null)} className="px-2.5 py-1 rounded-lg bg-muted text-muted-foreground text-[10px] font-medium">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              <div className="divide-y divide-border">
                {riders.map((r, i) => {
                  const rc = RIDER_COLORS[i % RIDER_COLORS.length]
                  const currentRegions = partnerRegionDefaults
                    .filter(d => d.rider_id === r.id)
                    .map(d => d.locality)
                  return (
                    <RiderDefaultsRow
                      key={r.id}
                      rider={r}
                      color={rc}
                      currentRegions={currentRegions}
                      allRegions={partnerAllRegions}
                      onSave={(regions) => handleSavePartnerDefaults(r.id, regions)}
                      otherRiderDefaults={partnerRegionDefaults.filter(d => d.rider_id !== r.id)}
                    />
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Search ── */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search product, supplier, address..."
              value={partnerSearch}
              onChange={(e) => setPartnerSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>

          {/* Active filter */}
          {partnerFilterRider !== 'all' && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">Filtering by:</span>
              <Badge variant="secondary" className="text-[10px] gap-1">
                {partnerFilterRider === 'unassigned' ? 'Unassigned' : riders.find(r => r.id === partnerFilterRider)?.name}
                <button onClick={() => setPartnerFilterRider('all')} className="ml-0.5 hover:text-foreground">
                  <XCircle className="w-3 h-3" />
                </button>
              </Badge>
            </div>
          )}

          {/* ── Bulk Assign Bar ── */}
          {partnerSelected.size > 0 && (
            <div className="sticky top-0 z-20 rounded-xl border border-primary/30 bg-card p-3 space-y-2 shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-primary">{partnerSelected.size} selected</span>
                <button onClick={() => setPartnerSelected(new Set())} className="text-xs text-muted-foreground">Clear</button>
              </div>
              <div className="flex gap-2">
                <select
                  value={partnerAssignTarget}
                  onChange={(e) => setPartnerAssignTarget(e.target.value)}
                  className={cn(
                    "flex-1 text-xs rounded-lg border px-2 py-2 font-medium transition-colors cursor-pointer",
                    partnerAssignTarget
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground"
                  )}
                >
                  <option value="">Select rider...</option>
                  {riders.map(r => (<option key={r.id} value={r.id}>{r.name}</option>))}
                </select>
                <Button
                  size="sm"
                  disabled={!partnerAssignTarget || partnerBulkAssigning}
                  onClick={handlePartnerBulkAssign}
                  className="shrink-0"
                >
                  <UserPlus className="w-4 h-4 mr-1" />
                  {partnerBulkAssigning ? 'Assigning...' : 'Assign'}
                </Button>
              </div>
            </div>
          )}

          {/* ── Expand/Collapse + Select All ── */}
          <div className="flex items-center justify-between">
            <button onClick={partnerSelectAll} className="flex items-center gap-2 text-xs text-muted-foreground">
              <div className={cn(
                "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                partnerSelected.size === partnerFiltered.length && partnerFiltered.length > 0
                  ? "bg-primary border-primary" : "border-muted-foreground/40"
              )}>
                {partnerSelected.size === partnerFiltered.length && partnerFiltered.length > 0 && <Check className="w-3 h-3 text-primary-foreground" />}
              </div>
              Select all ({partnerFiltered.length})
            </button>
            <button onClick={togglePartnerAllRegions} className="text-xs text-primary font-medium">
              {partnerAllExpanded ? 'Collapse all' : 'Expand all'}
            </button>
          </div>

          {/* ── Region Groups ── */}
          <div className="space-y-3">
            {partnerRegionGroups.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-8 text-center">
                <FileSpreadsheet className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No partner deliveries found</p>
              </div>
            ) : (
              partnerRegionGroups.map(([region, regionDeliveries]) => {
                const regionColor = getRegionColor(region)
                const isExpanded = partnerExpandedRegions.has(region)
                const regionUnassigned = regionDeliveries.filter(d => !d.rider_id).length
                const allRegionSelected = regionDeliveries.every(d => partnerSelected.has(d.id))
                const isSplitMode = partnerSplitRegions.has(region)

                return (
                  <div key={region} className="rounded-xl border border-border bg-card overflow-hidden">
                    {/* Region Header */}
                    <div className="flex items-center gap-2 p-3 cursor-pointer" onClick={() => togglePartnerRegion(region)}>
                      {/* Checkbox */}
                      <button
                        onClick={(e) => { e.stopPropagation(); partnerSelectRegion(regionDeliveries) }}
                        className="shrink-0"
                      >
                        <div className={cn(
                          "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                          allRegionSelected ? "bg-primary border-primary" : "border-muted-foreground/40"
                        )}>
                          {allRegionSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                        </div>
                      </button>

                      {/* Region avatar */}
                      <RegionAvatar region={region} size="md" />

                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{region}</p>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span>{regionDeliveries.length} order{regionDeliveries.length !== 1 ? 's' : ''}</span>
                          {regionUnassigned > 0 && (
                            <Badge className="text-[8px] py-0 px-1.5 bg-amber-500/15 text-amber-400 border-0">{regionUnassigned} unassigned</Badge>
                          )}
                        </div>
                      </div>

                      {/* Split toggle */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setPartnerSplitRegions(prev => {
                            const next = new Set(prev)
                            if (next.has(region)) next.delete(region)
                            else next.add(region)
                            return next
                          })
                          if (!isExpanded) togglePartnerRegion(region)
                        }}
                        className={cn(
                          "flex items-center gap-0.5 text-[10px] px-2 py-1.5 rounded-lg font-medium transition-all shrink-0",
                          isSplitMode
                            ? "bg-violet-500/20 text-violet-400 border border-violet-500/40"
                            : "bg-muted text-muted-foreground border border-border hover:border-violet-500/30"
                        )}
                      >
                        <Split className="w-3 h-3" />
                        Split
                      </button>

                      {/* Quick region assign */}
                      <select
                        onClick={(e) => e.stopPropagation()}
                        onChange={async (e) => {
                          const riderId = e.target.value
                          if (!riderId) return
                          const sel = e.target
                          for (const d of regionDeliveries) {
                            await assignPartnerDelivery(d.id, riderId)
                          }
                          router.refresh()
                          sel.style.background = 'rgba(34,197,94,0.25)'
                          sel.style.color = '#22c55e'
                          setTimeout(() => { sel.style.background = ''; sel.style.color = ''; sel.value = '' }, 1200)
                        }}
                        className="text-[10px] bg-primary/10 text-primary border border-primary/30 rounded-lg px-2 py-1.5 max-w-[80px] font-medium transition-all cursor-pointer shrink-0"
                        defaultValue=""
                      >
                        <option value="" disabled>All</option>
                        {riders.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>

                      {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                    </div>

                    {/* Region Deliveries */}
                    {isExpanded && (
                      <div className="border-t border-border">
                        {/* Split mode legend */}
                        {isSplitMode && (
                          <div className="px-3 py-2 bg-violet-500/5 border-b border-border flex items-center gap-1.5 overflow-x-auto">
                            <Split className="w-3 h-3 text-violet-400 shrink-0" />
                            <span className="text-[10px] text-violet-400 font-medium shrink-0">Tap to assign:</span>
                            {riders.map((r, i) => {
                              const rc = RIDER_COLORS[i % RIDER_COLORS.length]
                              return (
                                <span key={r.id} className={cn("text-[9px] px-1.5 py-0.5 rounded font-bold shrink-0", rc.bg, rc.text)}>
                                  {getRiderInitials(r.name)} = {r.name}
                                </span>
                              )
                            })}
                          </div>
                        )}

                        <div className="divide-y divide-border">
                          {regionDeliveries.map(d => {
                            const riderName = d.rider_id ? riders.find(r => r.id === d.rider_id)?.name : null
                            const isItemExpanded = partnerExpandedId === d.id
                            const isSelected = partnerSelected.has(d.id)

                            return (
                              <div key={d.id} className={cn("transition-colors", isSelected && "bg-primary/5")}>
                                {/* Row */}
                                <div className="flex items-center gap-1.5 px-3 py-2">
                                  {/* Checkbox (hidden in split mode) */}
                                  {!isSplitMode && (
                                    <button onClick={() => partnerToggleSelect(d.id)} className="shrink-0">
                                      <div className={cn(
                                        "w-4 h-4 rounded border flex items-center justify-center transition-colors",
                                        isSelected ? "bg-primary border-primary" : "border-muted-foreground/40"
                                      )}>
                                        {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
                                      </div>
                                    </button>
                                  )}

                                  {/* Info */}
                                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => !isSplitMode && setPartnerExpandedId(isItemExpanded ? null : d.id)}>
                                    <p className="text-xs font-medium truncate">{d.product || 'No product'}</p>
                                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                      {d.supplier && <span className="truncate max-w-[80px]">{d.supplier}</span>}
                                      {d.driver && <><span>-</span><span className="text-primary/60 truncate max-w-[60px]">{d.driver}</span></>}
                                    </div>
                                  </div>

                                  {/* Split mode: inline rider initial buttons */}
                                  {isSplitMode ? (
                                    <div className="flex items-center gap-1 shrink-0">
                                      {riders.map((r, i) => {
                                        const rc = RIDER_COLORS[i % RIDER_COLORS.length]
                                        const isAssigned = d.rider_id === r.id
                                        return (
                                          <button
                                            key={r.id}
                                            onClick={async () => {
                                              await assignPartnerDelivery(d.id, r.id)
                                              router.refresh()
                                            }}
                                            className={cn(
                                              "w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold transition-all duration-100 active:scale-110",
                                              isAssigned
                                                ? cn(rc.active, rc.activeText, "ring-2 ring-white/20 shadow-lg scale-105")
                                                : cn(rc.bg, rc.text, "opacity-40 hover:opacity-100")
                                            )}
                                            title={r.name}
                                          >
                                            {getRiderInitials(r.name)}
                                          </button>
                                        )
                                      })}
                                    </div>
                                  ) : (
                                    /* Normal mode */
                                    <div className="flex items-center gap-1 shrink-0">
                                      {riderName ? (
                                        <Badge className="text-[8px] py-0 bg-blue-500/15 text-blue-400 border-0">{riderName}</Badge>
                                      ) : (
                                        <Badge className="text-[8px] py-0 bg-amber-500/15 text-amber-400 border-0">None</Badge>
                                      )}
                                      {d.amount ? <span className="text-[10px] font-semibold text-foreground">Rs{d.amount}</span> : null}
                                      <button onClick={() => setPartnerExpandedId(isItemExpanded ? null : d.id)}>
                                        {isItemExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                                      </button>
                                    </div>
                                  )}
                                </div>

                                {/* Expanded Detail */}
                                {isItemExpanded && !isSplitMode && (
                                  <div className="px-3 pb-3 space-y-2 bg-muted/30">
                                    <div className="flex flex-wrap gap-2 text-xs">
                                      {d.phone && (
                                        <a href={`tel:${d.phone}`} className="flex items-center gap-1 text-primary">
                                          <Phone className="w-3 h-3" />{d.phone}
                                        </a>
                                      )}
                                      {d.address && (
                                        <span className="flex items-center gap-1 text-muted-foreground">
                                          <MapPin className="w-3 h-3" />{d.address}
                                        </span>
                                      )}
                                      {d.qty && <span className="text-muted-foreground">Qty: {d.qty}</span>}
                                    </div>
                                    <div className="space-y-1.5">
                                      <p className="text-[10px] font-medium text-muted-foreground flex items-center gap-1">
                                        <Users className="w-3 h-3" /> Assign to:
                                      </p>
                                      <div className="flex flex-wrap gap-1.5">
                                        {riders.map(r => (
                                          <button
                                            key={r.id}
                                            onClick={async () => {
                                              await assignPartnerDelivery(d.id, r.id)
                                              router.refresh()
                                            }}
                                            className={cn(
                                              "px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-all",
                                              d.rider_id === r.id
                                                ? "bg-primary/25 text-primary border border-primary/40"
                                                : "bg-muted text-muted-foreground hover:bg-primary/20 hover:text-primary border border-transparent"
                                            )}
                                          >
                                            {d.rider_id === r.id && <Check className="w-3 h-3 inline mr-0.5 -mt-0.5" />}
                                            {r.name}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* ── STOCK TAB ── */}
      {activeTab === 'stock' && (
        <StockOverview
          deliveries={deliveries}
          partnerDeliveries={partnerDeliveries}
          riders={riders}
        />
      )}
    </div>
  )
}

// ── Rider Defaults Row Component ──
function RiderDefaultsRow({
  rider,
  color,
  currentRegions,
  allRegions,
  onSave,
  otherRiderDefaults,
}: {
  rider: Rider
  color: { bg: string; text: string; active: string; activeText: string }
  currentRegions: string[]
  allRegions: string[]
  onSave: (regions: string[]) => Promise<void>
  otherRiderDefaults: RegionDefault[]
}) {
  const [expanded, setExpanded] = useState(false)
  // Ordered list (array, not set) so sequence matters
  const [orderedRegions, setOrderedRegions] = useState<string[]>(currentRegions)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  // Sync when props change
  useEffect(() => {
    setOrderedRegions(currentRegions)
  }, [currentRegions])

  const selectedSet = new Set(orderedRegions)

  const hasChanges = (() => {
    if (orderedRegions.length !== currentRegions.length) return true
    for (let i = 0; i < currentRegions.length; i++) {
      if (orderedRegions[i] !== currentRegions[i]) return true
    }
    return false
  })()

  const toggleRegion = (region: string) => {
    if (selectedSet.has(region)) {
      setOrderedRegions(prev => prev.filter(r => r !== region))
    } else {
      setOrderedRegions(prev => [...prev, region])
    }
  }

  // Drag reorder helpers
  const handleDragStart = (idx: number) => setDragIdx(idx)
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    if (dragIdx === null || dragIdx === idx) return
    setOrderedRegions(prev => {
      const next = [...prev]
      const [moved] = next.splice(dragIdx, 1)
      next.splice(idx, 0, moved)
      return next
    })
    setDragIdx(idx)
  }
  const handleDragEnd = () => setDragIdx(null)

  // Move up/down helpers for mobile
  const moveUp = (idx: number) => {
    if (idx === 0) return
    setOrderedRegions(prev => {
      const next = [...prev]
      ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
      return next
    })
  }
  const moveDown = (idx: number) => {
    if (idx >= orderedRegions.length - 1) return
    setOrderedRegions(prev => {
      const next = [...prev]
      ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
      return next
    })
  }

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    try {
      await onSave(orderedRegions)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      // silently handle
    }
    setSaving(false)
  }

  // Build set of regions already assigned to other riders
  const otherRiderRegions = new Map<string, string>()
  for (const d of otherRiderDefaults) {
    otherRiderRegions.set(d.locality, d.rider_id)
  }

  const filteredRegions = allRegions.filter(r =>
    r.toLowerCase().includes(searchTerm.toLowerCase())
  )

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-muted/30 transition-colors"
      >
        <span className={cn("w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0", color.bg, color.text)}>
          {getRiderInitials(rider.name)}
        </span>
        <div className="flex-1 text-left min-w-0">
          <p className="text-xs font-semibold text-foreground">{rider.name}</p>
          <p className="text-[10px] text-muted-foreground">
            {orderedRegions.length > 0
              ? `${orderedRegions.length} region${orderedRegions.length !== 1 ? 's' : ''}: ${orderedRegions.slice(0, 4).join(' > ')}${orderedRegions.length > 4 ? ' ...' : ''}`
              : 'No default regions set'
            }
          </p>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {/* Current ordered regions (drag to reorder) */}
          {orderedRegions.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-medium text-muted-foreground">Route order (drag to reorder):</p>
              <div className="space-y-0.5 max-h-[180px] overflow-y-auto">
                {orderedRegions.map((region, idx) => (
                  <div
                    key={region}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={(e) => handleDragOver(e, idx)}
                    onDragEnd={handleDragEnd}
                    className={cn(
                      "flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium border transition-all cursor-grab active:cursor-grabbing",
                      dragIdx === idx
                        ? "border-primary/50 bg-primary/10 scale-[1.02] shadow-md"
                        : cn(color.active, color.activeText, "border-transparent")
                    )}
                  >
                    <GripVertical className="w-3 h-3 text-muted-foreground/50 shrink-0" />
                    <span className="text-[9px] font-bold text-muted-foreground/50 w-4 tabular-nums shrink-0">{idx + 1}</span>
                    <span className="flex-1 truncate">{region}</span>
                    {/* Mobile reorder arrows */}
                    <button onClick={(e) => { e.stopPropagation(); moveUp(idx) }} disabled={idx === 0} className="p-0.5 hover:bg-background/50 rounded disabled:opacity-20">
                      <ChevronUp className="w-3 h-3" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); moveDown(idx) }} disabled={idx === orderedRegions.length - 1} className="p-0.5 hover:bg-background/50 rounded disabled:opacity-20">
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); toggleRegion(region) }} className="p-0.5 hover:bg-red-500/20 rounded text-muted-foreground/50 hover:text-red-400">
                      <XCircle className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Search regions */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search regions to add..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-7 pr-2 py-1.5 text-[11px] rounded-lg border border-border bg-background focus:border-primary/50 focus:outline-none"
            />
          </div>

          {/* Region chips - available to add */}
          <div className="flex flex-wrap gap-1 max-h-[160px] overflow-y-auto">
            {filteredRegions.map(region => {
              const isSelected = selectedSet.has(region)
              const otherRider = otherRiderRegions.get(region)
              return (
                <button
                  key={region}
                  onClick={() => toggleRegion(region)}
                  className={cn(
                    "px-2 py-1 rounded-lg text-[10px] font-medium transition-all border",
                    isSelected
                      ? cn(color.active, color.activeText, "border-transparent")
                      : otherRider
                        ? "bg-muted/50 text-muted-foreground/50 border-border/50 line-through"
                        : "bg-muted text-muted-foreground border-border hover:border-primary/30"
                  )}
                >
                  {isSelected && <Check className="w-2.5 h-2.5 inline mr-0.5 -mt-0.5" />}
                  {region}
                </button>
              )
            })}
          </div>

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className={cn(
              "w-full py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-40",
              saved
                ? "bg-emerald-500/20 text-emerald-400"
                : hasChanges
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-muted text-muted-foreground"
            )}
          >
            {saving ? 'Saving...' : saved ? 'Saved!' : hasChanges ? `Save ${orderedRegions.length} region${orderedRegions.length !== 1 ? 's' : ''} (in order)` : `${orderedRegions.length} region${orderedRegions.length !== 1 ? 's' : ''} set`}
          </button>
        </div>
      )}
    </div>
  )
}
