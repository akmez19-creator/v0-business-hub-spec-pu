'use client'

import React from "react"
import { createPortal } from 'react-dom'
import { useState, useMemo, useCallback, useEffect } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { Delivery, DeliveryStatus, SalesType } from '@/lib/types'
import { STATUS_LABELS, SALES_TYPE_LABELS, SALES_TYPE_COLORS } from '@/lib/types'
import { updateDeliveryStatusBulk, updateClientResponse, updateDeliveryNote, resetContractorDeliveries, generateReplyTokens, uploadPaymentProof } from '@/lib/delivery-actions'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Package,
  Phone,
  Search,
  Calendar,
  CheckCircle,
  Clock,
  XCircle,
  AlertTriangle,
  ShoppingBag,
  TrendingUp,
  MapPin,
  Send,
  Users,
  X,
  StickyNote,
  MessageSquareText,
  Smartphone,
  Banknote,
  CreditCard,
  RotateCcw,
  GripVertical,
  Navigation,
  ExternalLink,
  Pencil,
  Camera,
  Loader2,
  ImageIcon,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { RegionAvatar } from '@/components/ui/region-avatar'
import { DraggableRegionList } from '@/components/orders/draggable-region-list'
import { ReorderCard } from '@/components/orders/reorder-card'
import { BatchContactRow } from '@/components/orders/batch-contact-row'
import { ModifyOrderSheet } from '@/components/delivery-map/modify-order-sheet'

// Map view temporarily disabled

// ── Types ──
interface ClientOrder {
  key: string
  customerName: string
  contact1: string | null
  contact2: string | null
  region: string
  locality: string | null
  riderId: string | null
  status: DeliveryStatus
  indexNo: string | null
  items: Delivery[]
  totalAmount: number
  totalQty: number
  clientResponse: string | null
  deliveryNotes: string | null
  paymentMethod: string | null
  paymentJuice: number
  paymentCash: number
  paymentBank: number
  paymentStatus: string
  deliverySequence: number
}

interface OrdersContentProps {
  deliveries: Delivery[]
  availableDates: string[]
  selectedDate: string
  riders?: { id: string; name: string }[]
  statusCounts: Record<string, number>
  totalCount: number
  contractorId?: string
  contractorAsRiderId?: string | null
  customTemplates?: Record<string, string> | null
  riderJuicePolicies?: Record<string, string>
}

// ── Constants ──
const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Clock className="w-3.5 h-3.5" />,
  assigned: <Package className="w-3.5 h-3.5" />,
  picked_up: <Package className="w-3.5 h-3.5" />,
  delivered: <CheckCircle className="w-3.5 h-3.5" />,
  nwd: <XCircle className="w-3.5 h-3.5" />,
  cms: <AlertTriangle className="w-3.5 h-3.5" />,
}

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  assigned: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  picked_up: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  delivered: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  nwd: 'bg-red-500/15 text-red-400 border-red-500/30',
  cms: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
}

const FILTER_STATUS_STYLE: Record<string, string> = {
  all: 'bg-foreground/10 text-foreground border-foreground/20',
  pending: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
  assigned: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
  picked_up: 'bg-purple-500/20 text-purple-400 border-purple-500/40',
  delivered: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
  nwd: 'bg-red-500/20 text-red-400 border-red-500/40',
  cms: 'bg-orange-500/20 text-orange-400 border-orange-500/40',
}

// ── Dynamic region avatar colors ──
const REGION_COLORS = [
  { bg: 'bg-rose-500/20', text: 'text-rose-400', border: 'border-rose-500/30' },
  { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30' },
  { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/30' },
  { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  { bg: 'bg-teal-500/20', text: 'text-teal-400', border: 'border-teal-500/30' },
  { bg: 'bg-cyan-500/20', text: 'text-cyan-400', border: 'border-cyan-500/30' },
  { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
  { bg: 'bg-indigo-500/20', text: 'text-indigo-400', border: 'border-indigo-500/30' },
  { bg: 'bg-violet-500/20', text: 'text-violet-400', border: 'border-violet-500/30' },
  { bg: 'bg-pink-500/20', text: 'text-pink-400', border: 'border-pink-500/30' },
  { bg: 'bg-sky-500/20', text: 'text-sky-400', border: 'border-sky-500/30' },
  { bg: 'bg-lime-500/20', text: 'text-lime-400', border: 'border-lime-500/30' },
]

function getRegionColor(region: string) {
  // Simple hash to get consistent color per region name
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

// ── Maps link detection ──
const MAPS_URL_REGEX = new RegExp('https?://(maps\\.app\\.goo\\.gl|goo\\.gl/maps|www\\.google\\.com/maps|maps\\.google\\.com|google\\.com/maps)[^\\s)}"\'\\]]*', 'gi')

function extractMapsLinks(text: string): { url: string; start: number; end: number }[] {
  const matches: { url: string; start: number; end: number }[] = []
  let match: RegExpExecArray | null
  const regex = new RegExp(MAPS_URL_REGEX.source, MAPS_URL_REGEX.flags)
  while ((match = regex.exec(text)) !== null) {
    matches.push({ url: match[0], start: match.index, end: match.index + match[0].length })
  }
  return matches
}

function hasLocationLink(text: string | null | undefined): boolean {
  if (!text) return false
  return extractMapsLinks(text).length > 0
}

function RichText({ text, className, label }: { text: string; className?: string; label?: string }) {
  const links = extractMapsLinks(text)
  if (links.length === 0) {
    return <span className={className}>{text}</span>
  }
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  links.forEach((link, i) => {
    if (link.start > lastIndex) {
      const before = text.slice(lastIndex, link.start).trim()
      if (before) parts.push(<span key={`t-${i}`}>{before} </span>)
    }
    const linkLabel = label ? `${label}'s Pin Location` : 'Pin Location'
    parts.push(
      <a
        key={`l-${i}`}
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 hover:text-blue-300 transition-colors text-[11px] font-medium no-underline"
      >
        <Navigation className="w-3 h-3 shrink-0" />
        <span>{linkLabel}</span>
        <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-60" />
      </a>
    )
    lastIndex = link.end
  })
  if (lastIndex < text.length) {
    const after = text.slice(lastIndex).trim()
    if (after) parts.push(<span key="tail"> {after}</span>)
  }
  return <span className={className}>{parts}</span>
}

function getCombinedNotes(order: ClientOrder): string | null {
  const parts: string[] = []
  if (order.deliveryNotes) parts.push(order.deliveryNotes)
  if (order.clientResponse) parts.push(order.clientResponse)
  return parts.length > 0 ? parts.join(' | ') : null
}

const MAX_BATCH_CONTACTS = 20

const DEFAULT_TEMPLATES: Record<string, { label: string; text: string }> = {
  onway: { label: 'On my way', text: 'Hi, I am on my way to deliver your order. Please be available. Thank you!' },
  arrived: { label: 'Arrived', text: 'Hi, I have arrived with your delivery. Please come to collect it. Thank you!' },
  delivered: { label: 'Delivered', text: 'Hi, your order has been successfully delivered. Thank you for your purchase!' },
  unavailable: { label: 'Not available', text: 'Hi, I tried to deliver your order but no one was available. Please contact us to reschedule. Thank you.' },
}

// ── Helpers ──
function groupByClient(deliveries: Delivery[]): ClientOrder[] {
  const map = new Map<string, ClientOrder>()
  for (const d of deliveries) {
    const key = `${(d.customer_name || '').trim().toLowerCase()}|${(d.contact_1 || '').trim()}|${d.delivery_date}|${d.rider_id || ''}`
    if (!map.has(key)) {
      const region = d.locality?.trim() || 'Unassigned'
      map.set(key, {
        key,
        customerName: d.customer_name || 'Unknown',
        contact1: d.contact_1 || null,
        contact2: d.contact_2 || null,
        region,
        locality: d.locality || null,
        riderId: d.rider_id || null,
        status: d.status as DeliveryStatus,
        indexNo: d.index_no || null,
  items: [],
  totalAmount: 0,
  totalQty: 0,
  clientResponse: d.client_response || null,
  deliveryNotes: d.delivery_notes || null,
  paymentMethod: d.payment_method || null,
  paymentJuice: 0,
  paymentCash: 0,
  paymentBank: 0,
  paymentStatus: d.payment_status || 'unpaid',
  deliverySequence: d.delivery_sequence || 0,
  })
  }
  const order = map.get(key)!
  order.items.push(d)
  order.totalAmount += Number(d.amount || 0)
  order.totalQty += Number(d.qty || 1)
  order.paymentJuice += Number(d.payment_juice || 0)
  order.paymentCash += Number(d.payment_cash || 0)
  order.paymentBank += Number(d.payment_bank || 0)
  // Keep the latest non-null response/notes/payment info
  if (d.client_response) order.clientResponse = d.client_response
  if (d.delivery_notes) order.deliveryNotes = d.delivery_notes
  if (d.payment_method) order.paymentMethod = d.payment_method
  if (d.payment_status && d.payment_status !== 'unpaid') order.paymentStatus = d.payment_status
  }
  return Array.from(map.values())
}

function formatPhone(phone: string): string {
  // Ensure Mauritius numbers have +230 prefix
  const cleaned = phone.replace(/\D/g, '')
  if (cleaned.startsWith('230')) return `+${cleaned}`
  if (cleaned.length === 7 || cleaned.length === 8) return `+230${cleaned}`
  return phone
}

// ── Component ──
export function OrdersContent({
  deliveries,
  availableDates,
  selectedDate,
  riders,
  statusCounts,
  totalCount,
  contractorId,
  contractorAsRiderId,
  customTemplates,
  riderJuicePolicies = {},
}: OrdersContentProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [reorderMode, setReorderMode] = useState(false)
  const [batchReorder, setBatchReorder] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(new Set(['__all__']))
  const [riderFilter, setRiderFilter] = useState<string>(searchParams.get('rider') || contractorAsRiderId || 'all')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>(searchParams.get('status') || 'all')
  const [updatingKey, setUpdatingKey] = useState<string | null>(null)
  const [protocolPopup, setProtocolPopup] = useState<{ order: ClientOrder; salesType: string } | null>(null)
  const [messagePanel, setMessagePanel] = useState<{ region: string; orders: ClientOrder[] } | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<string>('onway')
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set())
  const [editingTemplates, setEditingTemplates] = useState(false)
  const [templateEdits, setTemplateEdits] = useState<Record<string, string>>({})
  const [savingTemplates, setSavingTemplates] = useState(false)

  // Merge custom templates with defaults
  const templates = Object.entries(DEFAULT_TEMPLATES).map(([id, def]) => ({
    id,
    label: def.label,
    text: customTemplates?.[id] || def.text,
  }))

  // ── Reset All (contractor only) ──
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)

  async function handleResetAll() {
    if (!contractorId) return
    setResetting(true)
    const result = await resetContractorDeliveries(contractorId, selectedDate)
    setResetting(false)
    if (!result.error) {
      setShowResetConfirm(false)
      router.refresh()
    }
  }

  // ── Notes + Client Reply ──
  async function handleSaveNote(order: ClientOrder, note: string) {
    setSavingNote(true)
    for (const item of order.items) {
      await updateDeliveryNote(item.id, note)
    }
    setSavingNote(false)
    setNotePanel(null)
    router.refresh()
  }

  async function handleSaveReply(order: ClientOrder, reply: string) {
    setSavingReply(true)
    const ids = order.items.map(d => d.id)
    await updateClientResponse(ids, reply)
    setSavingReply(false)
    setReplyPanel(null)
    router.refresh()
  }

  async function handleReplyLogSave(order: ClientOrder, reply: string) {
    setReplyLogSaving(true)
    const ids = order.items.map(d => d.id)
    await updateClientResponse(ids, reply)
    // Update the local panel data so it reflects immediately without refetch
    if (replyLogPanel) {
      setReplyLogPanel({
        ...replyLogPanel,
        orders: replyLogPanel.orders.map(o =>
          o.key === order.key ? { ...o, clientResponse: reply || null } : o
        ),
      })
    }
    setReplyLogSaving(false)
    setReplyLogActive(null)
    setReplyLogText('')
  }

  // Date navigation
  const currentDateIndex = availableDates.indexOf(selectedDate)
  const canGoPrev = currentDateIndex < availableDates.length - 1
  const canGoNext = currentDateIndex > 0

  function navigateDate(direction: 'prev' | 'next') {
    const newIndex = direction === 'prev' ? currentDateIndex + 1 : currentDateIndex - 1
    if (newIndex >= 0 && newIndex < availableDates.length) {
      const params = new URLSearchParams(searchParams.toString())
      params.set('date', availableDates[newIndex])
      params.delete('status')
      router.push(`${pathname}?${params.toString()}`)
    }
  }

  function selectDate(date: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('date', date)
    params.delete('status')
    router.push(`${pathname}?${params.toString()}`)
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr + 'T00:00:00')
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  }

  // Group + filter
  const allOrders = useMemo(() => groupByClient(deliveries), [deliveries])



  const filtered = useMemo(() => {
    let result = allOrders
    // Rider filter
    if (riderFilter && riderFilter !== 'all') {
      result = result.filter(o => o.riderId === riderFilter)
    }
    if (statusFilter && statusFilter !== 'all') {
      result = result.filter(o => o.status === statusFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(o =>
        o.customerName.toLowerCase().includes(q) ||
        o.contact1?.toLowerCase().includes(q) ||
        o.region.toLowerCase().includes(q) ||
        o.locality?.toLowerCase().includes(q) ||
        o.items.some(d => d.products?.toLowerCase().includes(q)) ||
        o.indexNo?.toLowerCase().includes(q)
      )
    }
    return result
  }, [allOrders, statusFilter, searchQuery, riderFilter])

  const regionGroups = useMemo(() => {
    const groups: Record<string, ClientOrder[]> = {}
    for (const o of filtered) {
      const region = o.region
      if (!groups[region]) groups[region] = []
      groups[region].push(o)
    }
    // Sort clients within each region by delivery_sequence (0 = unset, goes last)
    for (const region in groups) {
      groups[region].sort((a, b) => {
        const aSeq = a.deliverySequence || 999
        const bSeq = b.deliverySequence || 999
        return aSeq - bSeq
      })
    }
    return Object.entries(groups).sort((a, b) => {
      // "Unassigned" always goes last
      if (a[0] === 'Unassigned') return 1
      if (b[0] === 'Unassigned') return -1
      return a[0].localeCompare(b[0])
    })
  }, [filtered])

  // Toggle/expand helpers
  function toggleRegion(region: string) {
    setExpandedRegions(prev => {
      const next = new Set(prev)
      if (next.has(region)) next.delete(region)
      else next.add(region)
      return next
    })
  }

  const allExpanded = regionGroups.length > 0 && regionGroups.every(([r]) => expandedRegions.has(r))

  async function handleReorder(regionName: string, fromIndex: number, toIndex: number) {
    const group = regionGroups.find(([r]) => r === regionName)
    if (!group) return
    const orders = [...group[1]]
    const [moved] = orders.splice(fromIndex, 1)
    orders.splice(toIndex, 0, moved)
    // Save sequence for all items in each order
    const updates = orders.map((o, i) => ({
      deliveryIds: o.items.map(item => item.id),
      sequence: i + 1,
    }))
    const { updateDeliverySequence } = await import('@/lib/delivery-actions')
    await updateDeliverySequence(updates)
    startTransition(() => router.refresh())
  }

  function toggleAllRegions() {
    if (allExpanded) setExpandedRegions(new Set())
    else setExpandedRegions(new Set(regionGroups.map(([r]) => r)))
  }

  // Payment method popup for "Delivered"
  const [paymentPopup, setPaymentPopup] = useState<{
    orders: ClientOrder[]
    region?: string
    isBatch: boolean
  } | null>(null)

  function handleDeliveredClick(order: ClientOrder) {
    const salesType = order.items[0]?.sales_type

    // Exchange / Trade-in / Refund: show protocol confirmation first
    if (salesType && ['exchange', 'trade_in', 'refund'].includes(salesType)) {
      setProtocolPopup({ order, salesType })
      return
    }

    // Normal sale or drop_off: show payment popup
    setPaymentPopup({ orders: [order], isBatch: false })
  }

  function confirmProtocol() {
    if (!protocolPopup) return
    const { order, salesType } = protocolPopup
    const amount = order.totalAmount || 0
    setProtocolPopup(null)

    // Exchange: no payment needed
    if (salesType === 'exchange') {
      setUpdatingKey(order.key)
      updateDeliveryStatusBulk(order.items.map(d => d.id), 'delivered' as DeliveryStatus, undefined, 'none')
        .then(() => { setUpdatingKey(null); router.refresh() })
      return
    }

    // Refund: auto-cash (rider gave refund)
    if (salesType === 'refund') {
      setUpdatingKey(order.key)
      updateDeliveryStatusBulk(order.items.map(d => d.id), 'delivered' as DeliveryStatus, undefined, 'cash')
        .then(() => { setUpdatingKey(null); router.refresh() })
      return
    }

    // Trade-in with amount due: show payment popup
    if (salesType === 'trade_in' && amount > 0) {
      setPaymentPopup({ orders: [order], isBatch: false })
      return
    }

    // Trade-in with no amount: mark directly
    setUpdatingKey(order.key)
    updateDeliveryStatusBulk(order.items.map(d => d.id), 'delivered' as DeliveryStatus, undefined, 'none')
      .then(() => { setUpdatingKey(null); router.refresh() })
  }

  function handleRegionDeliveredClick(region: string, orders: ClientOrder[]) {
    const pending = orders.filter(o => !['delivered', 'nwd', 'cms'].includes(o.status))
    if (pending.length === 0) return

    // Separate orders that need payment popup from those that don't
    const noPaymentOrders = pending.filter(o => {
      const st = o.items[0]?.sales_type
      return st === 'exchange' || st === 'refund' || (st === 'trade_in' && (o.totalAmount || 0) <= 0)
    })
    const paymentOrders = pending.filter(o => !noPaymentOrders.includes(o))

    // Mark no-payment orders directly
    if (noPaymentOrders.length > 0) {
      const noPayIds = noPaymentOrders.flatMap(o => o.items.map(d => d.id))
      setUpdatingRegion(region)
      updateDeliveryStatusBulk(noPayIds, 'delivered' as DeliveryStatus, undefined, 'none')
        .then(() => { setUpdatingRegion(null); router.refresh() })
    }

    // Show payment popup for remaining
    if (paymentOrders.length > 0) {
      setPaymentPopup({ orders: paymentOrders, region, isBatch: true })
    }
  }

  // Proof upload step state
  const [proofStep, setProofStep] = useState<{ method: string; orders: ClientOrder[]; region?: string; isBatch: boolean } | null>(null)
  const [proofUploading, setProofUploading] = useState(false)
  const [proofPreview, setProofPreview] = useState<string | null>(null)
  const [proofFile, setProofFile] = useState<File | null>(null)

  function needsProof(method: string, orders: ClientOrder[]): boolean {
    // 'paid' always needs proof
    if (method === 'paid') return true
    // 'juice' needs proof when rider's juice_policy = 'contractor'
    if (method === 'juice') {
      return orders.some(o => {
        const riderId = o.items[0]?.rider_id
        return riderId && riderJuicePolicies[riderId] === 'contractor'
      })
    }
    return false
  }

  async function confirmWithPayment(method: string, proofUrl?: string) {
    if (!paymentPopup && !proofStep) return
    const source = proofStep || paymentPopup!
    const { orders: popupOrders, region, isBatch } = source

    // If juice and needs proof, show proof upload step
    if (!proofStep && needsProof(method, popupOrders)) {
      setProofStep({ method, orders: popupOrders, region, isBatch })
      setPaymentPopup(null)
      return
    }

    setPaymentPopup(null)
    setProofStep(null)
    setProofPreview(null)
    setProofFile(null)
    const allIds = popupOrders.flatMap(o => o.items.map(d => d.id))
    if (isBatch && region) setUpdatingRegion(region)
    else if (popupOrders[0]) setUpdatingKey(popupOrders[0].key)
    await updateDeliveryStatusBulk(allIds, 'delivered' as DeliveryStatus, undefined, method, proofUrl)
    setUpdatingKey(null)
    setUpdatingRegion(null)
    router.refresh()
  }

  async function handleProofSubmit() {
    if (!proofStep || !proofFile) return
    setProofUploading(true)
    const fd = new FormData()
    fd.append('file', proofFile)
    const result = await uploadPaymentProof(fd)
    setProofUploading(false)
    if (result.error) return
    await confirmWithPayment(proofStep.method, result.url)
  }

  function handleProofFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setProofFile(file)
    const url = URL.createObjectURL(file)
    setProofPreview(url)
  }

  // Status update (for non-delivered statuses)
  async function handleStatusChange(order: ClientOrder, newStatus: DeliveryStatus) {
    setUpdatingKey(order.key)
    const ids = order.items.map(d => d.id)
    await updateDeliveryStatusBulk(ids, newStatus)
    setUpdatingKey(null)
    router.refresh()
  }

  // Batch status for entire region
  const [updatingRegion, setUpdatingRegion] = useState<string | null>(null)
  async function handleRegionStatusChange(region: string, orders: ClientOrder[], newStatus: DeliveryStatus) {
    setUpdatingRegion(region)
    const pendingOrders = orders.filter(o => !['delivered', 'nwd', 'cms'].includes(o.status))
    const allIds = pendingOrders.flatMap(o => o.items.map(d => d.id))
    if (allIds.length > 0) {
      await updateDeliveryStatusBulk(allIds, newStatus)
    }
    setUpdatingRegion(null)
    router.refresh()
  }

  // Message panel handlers
  const openMessagePanel = useCallback((region: string, orders: ClientOrder[]) => {
    const contactableOrders = orders.filter(o => o.contact1)
    setMessagePanel({ region, orders: contactableOrders })
    setSelectedContacts(new Set(contactableOrders.slice(0, MAX_BATCH_CONTACTS).map(o => o.contact1!)))
    setSelectedTemplate('onway')
  }, [])

  function toggleContact(phone: string) {
    setSelectedContacts(prev => {
      const next = new Set(prev)
      if (next.has(phone)) {
        next.delete(phone)
      } else {
        if (next.size >= MAX_BATCH_CONTACTS) return prev
        next.add(phone)
      }
      return next
    })
  }

  const [copied, setCopied] = useState(false)
  const [notePanel, setNotePanel] = useState<{ order: ClientOrder; note: string } | null>(null)
  const [savingNote, setSavingNote] = useState(false)
  const [replyPanel, setReplyPanel] = useState<{ order: ClientOrder; reply: string } | null>(null)
  const [savingReply, setSavingReply] = useState(false)
  const [replyLogPanel, setReplyLogPanel] = useState<{ region: string; orders: ClientOrder[] } | null>(null)
  const [replyLogActive, setReplyLogActive] = useState<string | null>(null) // order.key being edited
  const [replyLogText, setReplyLogText] = useState('')
  const [replyLogSaving, setReplyLogSaving] = useState(false)
  const [replyLogSearch, setReplyLogSearch] = useState('')
  const [replyLogFilter, setReplyLogFilter] = useState<'all' | 'with-pin' | 'no-pin' | 'replied' | 'pending'>('all')
  const [modifyTarget, setModifyTarget] = useState<{ deliveryId: string; customerName: string; products: string; amount: number } | null>(null)

  const [batchSending, setBatchSending] = useState(false)
  const [individualQueue, setIndividualQueue] = useState<{ phone: string; name: string; message: string }[]>([])
  const [individualIndex, setIndividualIndex] = useState(0)

  // ── BATCH: one generic message to all selected contacts at once ──
  function sendBatchMessages(method: 'sms' | 'whatsapp') {
    if (!messagePanel) return
    const template = templates.find(t => t.id === selectedTemplate)
    if (!template) return

    const toSend = messagePanel.orders.filter(o => o.contact1 && selectedContacts.has(o.contact1))
    if (toSend.length === 0) return

    const genericMsg = template.text
    const phones = toSend.map(o => formatPhone(o.contact1!))

    if (method === 'sms') {
      // SMS: multiple recipients separated by comma, one generic message
      const recipients = phones.join(',')
      window.location.href = `sms:${recipients}?body=${encodeURIComponent(genericMsg)}`
      setMessagePanel(null)
    } else {
      // WhatsApp: copy message, open WhatsApp for broadcast
      navigator.clipboard.writeText(genericMsg).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 3000)
        window.open('https://wa.me/', '_blank')
      })
    }
  }

  // ── INDIVIDUAL: one-by-one with personalized name + reply link ──
  async function sendIndividualMessages(method: 'sms' | 'whatsapp') {
    if (!messagePanel) return
    const template = templates.find(t => t.id === selectedTemplate)
    if (!template) return

    const toSend = messagePanel.orders.filter(o => o.contact1 && selectedContacts.has(o.contact1))
    if (toSend.length === 0) return

    setBatchSending(true)

    // Generate unique reply tokens
    const allDeliveryIds = toSend.flatMap(o => o.items.map(i => i.id))
    const { tokens } = await generateReplyTokens(allDeliveryIds)
    const baseUrl = window.location.origin

    // Build personalized queue
    const queue = toSend.map(o => {
      const firstItemId = o.items[0]?.id
      const replyToken = firstItemId ? tokens[firstItemId] : null
      const replyLink = replyToken ? `${baseUrl}/reply/${replyToken}` : ''
      const msg = `Hi ${o.customerName}, ${template.text.replace(/^Hi,?\s*/i, '')}${replyLink ? `\nReply or share location: ${replyLink}` : ''}`
      return { phone: formatPhone(o.contact1!), name: o.customerName, message: msg }
    })

    setIndividualQueue(queue)
    setIndividualIndex(0)
    setBatchSending(false)

    // Open first message
    const first = queue[0]
    if (first) {
      if (method === 'sms') {
        window.location.href = `sms:${first.phone}?body=${encodeURIComponent(first.message)}`
      } else {
        window.open(`https://wa.me/${first.phone.replace(/\D/g, '')}?text=${encodeURIComponent(first.message)}`, '_blank')
      }
    }
  }

  function sendNextIndividual(method: 'sms' | 'whatsapp') {
    const nextIdx = individualIndex + 1
    if (nextIdx >= individualQueue.length) {
      setIndividualQueue([])
      setIndividualIndex(0)
      setMessagePanel(null)
      return
    }
    setIndividualIndex(nextIdx)
    const next = individualQueue[nextIdx]
    if (method === 'sms') {
      window.location.href = `sms:${next.phone}?body=${encodeURIComponent(next.message)}`
    } else {
      window.open(`https://wa.me/${next.phone.replace(/\D/g, '')}?text=${encodeURIComponent(next.message)}`, '_blank')
    }
  }

  function cancelIndividualSend() {
    setIndividualQueue([])
    setIndividualIndex(0)
  }

  const [individualMethod, setIndividualMethod] = useState<'sms' | 'whatsapp'>('sms')
  const [singleSending, setSingleSending] = useState<string | null>(null)

  // ── SINGLE: send one personalized message with reply link to a specific client ──
  async function sendSingleMessage(order: ClientOrder, method: 'sms' | 'whatsapp') {
    const itemId = order.items[0]?.id
    if (!itemId || !order.contact1) return
    setSingleSending(order.key)
    const { tokens } = await generateReplyTokens([itemId])
    const replyToken = tokens[itemId]
    const baseUrl = window.location.origin
    const replyLink = replyToken ? `${baseUrl}/reply/${replyToken}` : ''
    const template = templates.find(t => t.id === selectedTemplate) || templates[0]
    const msg = `Hi ${order.customerName}, ${template.text.replace(/^Hi,?\s*/i, '')}${replyLink ? `\nReply or share location: ${replyLink}` : ''}`
    const phone = formatPhone(order.contact1)
    setSingleSending(null)
    if (method === 'sms') {
      window.location.href = `sms:${phone}?body=${encodeURIComponent(msg)}`
    } else {
      window.open(`https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`, '_blank')
    }
  }

  // Rider name lookup
  const riderMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const r of riders || []) map[r.id] = r.name
    return map
  }, [riders])

  // Day stats
  const delivered = statusCounts['delivered'] || 0
  const pending = (statusCounts['pending'] || 0) + (statusCounts['assigned'] || 0) + (statusCounts['picked_up'] || 0)
  const failed = (statusCounts['nwd'] || 0) + (statusCounts['cms'] || 0)
  const donePercent = totalCount > 0 ? Math.round((delivered / totalCount) * 100) : 0
  const dayAmount = allOrders.reduce((s, o) => s + o.totalAmount, 0)
    const allRegionCount = new Set(allOrders.map(o => o.region)).size

  return (
    <div className="space-y-3">
      {/* ── Date Navigation ── */}
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => navigateDate('prev')} disabled={!canGoPrev}>
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <button
          onClick={() => { const el = document.getElementById('date-select'); if (el) (el as HTMLSelectElement).showPicker?.() }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-card border border-border hover:border-primary/50 transition-colors"
        >
          <Calendar className="w-4 h-4 text-primary" />
          <span className="font-semibold text-sm">{formatDate(selectedDate)}</span>
        </button>
        <select id="date-select" className="sr-only" value={selectedDate} onChange={(e) => selectDate(e.target.value)}>
          {availableDates.map(d => (<option key={d} value={d}>{formatDate(d)}</option>))}
        </select>
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => navigateDate('next')} disabled={!canGoNext}>
          <ChevronRight className="w-5 h-5" />
        </Button>
      </div>

      {/* ── Day Overview Card ── */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="h-1.5 w-full bg-muted">
          <div
            className={cn('h-full transition-all rounded-r-full', donePercent === 100 ? 'bg-emerald-500' : donePercent >= 50 ? 'bg-amber-500' : 'bg-red-500')}
            style={{ width: `${donePercent}%` }}
          />
        </div>
        <div className="grid grid-cols-4 divide-x divide-border">
          <div className="py-3 text-center">
            <p className="text-xl font-bold text-foreground">{totalCount}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total</p>
          </div>
          <div className="py-3 text-center">
            <p className="text-xl font-bold text-emerald-400">{delivered}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Done</p>
          </div>
          <div className="py-3 text-center">
            <p className="text-xl font-bold text-amber-400">{pending}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Left</p>
          </div>
          <div className="py-3 text-center">
            <p className="text-xl font-bold text-red-400">{failed}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Failed</p>
          </div>
        </div>
        <div className="flex items-center justify-between px-3 py-2 border-t border-border bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs">
              <TrendingUp className="w-3.5 h-3.5 text-primary" />
              <span className={cn('font-semibold', donePercent === 100 ? 'text-emerald-400' : donePercent >= 50 ? 'text-amber-400' : 'text-red-400')}>
                {donePercent}%
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="w-3.5 h-3.5" />
              <span>{allRegionCount} localit{allRegionCount !== 1 ? 'ies' : 'y'}</span>
            </div>
          </div>
          <span className="text-xs font-semibold text-foreground">Rs {dayAmount.toLocaleString()}</span>
        </div>
      </div>

      {/* ── Reset All for Contractor ── */}
      {contractorId && totalCount > 0 && !showResetConfirm && (
        <div className="flex justify-end">
          <button
            onClick={() => setShowResetConfirm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-amber-400 hover:bg-amber-500/10 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset all to assigned
          </button>
        </div>
      )}
      {showResetConfirm && (
        <div className="rounded-xl border-2 border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-amber-400">Reset all {totalCount} orders for {formatDate(selectedDate)}?</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">All deliveries will revert back to &quot;assigned&quot; status. Stock validation will also be cleared.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-8 text-xs bg-amber-500 hover:bg-amber-600 text-white"
              disabled={resetting}
              onClick={handleResetAll}
            >
              {resetting ? 'Resetting...' : 'Yes, reset all'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs"
              onClick={() => setShowResetConfirm(false)}
              disabled={resetting}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* ── Status Filter Pills ── */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        <button
          onClick={() => setStatusFilter('all')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all shrink-0',
            statusFilter === 'all' ? 'bg-foreground text-background border-foreground' : 'bg-foreground/5 text-muted-foreground border-transparent hover:border-border'
          )}
        >
          All <span className="opacity-70">{totalCount}</span>
        </button>
        {Object.entries(statusCounts).map(([status, count]) => {
          if (count === 0) return null
          const isActive = statusFilter === status
          return (
            <button
              key={status}
              onClick={() => setStatusFilter(isActive ? 'all' : status)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all shrink-0',
                isActive ? FILTER_STATUS_STYLE[status] : 'bg-foreground/5 text-muted-foreground border-transparent hover:border-border'
              )}
            >
              {STATUS_ICON[status]}
              {STATUS_LABELS[status as DeliveryStatus]}
              <span className="opacity-70">{count}</span>
            </button>
          )
        })}
      </div>

      {/* ── Rider Filter ── */}
      {riders && riders.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0 mr-0.5" />
          <button
            onClick={() => setRiderFilter('all')}
            className={cn(
              'px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all shrink-0',
              riderFilter === 'all'
                ? 'bg-foreground text-background border-foreground'
                : 'bg-foreground/5 text-muted-foreground border-transparent hover:border-border'
            )}
          >
            All Team
          </button>
          {contractorAsRiderId && (
            <button
              onClick={() => setRiderFilter(contractorAsRiderId)}
              className={cn(
                'px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all shrink-0',
                riderFilter === contractorAsRiderId
                  ? 'bg-primary/20 text-primary border-primary/40'
                  : 'bg-foreground/5 text-muted-foreground border-transparent hover:border-border'
              )}
            >
              My Orders
            </button>
          )}
          {(riders || [])
            .filter(r => r.id !== contractorAsRiderId)
            .map(r => (
            <button
              key={r.id}
              onClick={() => setRiderFilter(riderFilter === r.id ? 'all' : r.id)}
              className={cn(
                'px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all shrink-0',
                riderFilter === r.id
                  ? 'bg-blue-500/20 text-blue-400 border-blue-500/40'
                  : 'bg-foreground/5 text-muted-foreground border-transparent hover:border-border'
              )}
            >
              {r.name}
            </button>
          ))}
        </div>
      )}

      {/* ── Search ── */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search customer, phone, locality..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 h-10 bg-card border-border"
        />
      </div>

      {/* ── Controls ── */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {regionGroups.length} region{regionGroups.length !== 1 ? 's' : ''} &middot; {filtered.length} order{filtered.length !== 1 ? 's' : ''}
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setReorderMode(!reorderMode)}
            className={cn(
              'flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg border transition-colors',
              reorderMode
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            <GripVertical className="w-3 h-3" />
            {reorderMode ? 'Done' : 'Reorder'}
          </button>
          <button onClick={toggleAllRegions} className="text-xs text-primary hover:underline">
            {allExpanded ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      </div>

      {/* ── Region Route Cards ── */}
      {regionGroups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-3">
            <Package className="w-7 h-7 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">No orders found</p>
          <p className="text-xs text-muted-foreground mt-1">
            {searchQuery || statusFilter !== 'all' ? 'Try adjusting your filters' : 'No deliveries for this date'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {regionGroups.map(([region, orders]) => {
            const isExpanded = expandedRegions.has(region)
            const regionDelivered = orders.filter(o => o.status === 'delivered').length
            const regionPending = orders.filter(o => ['pending', 'assigned', 'picked_up'].includes(o.status)).length
            const regionFailed = orders.filter(o => ['nwd', 'cms'].includes(o.status)).length
            const regionPercent = orders.length > 0 ? Math.round((regionDelivered / orders.length) * 100) : 0
            const regionAmount = orders.reduce((s, o) => s + o.totalAmount, 0)
            const contactable = orders.filter(o => o.contact1).length

            return (
              <div key={region} className="rounded-xl border border-border bg-card overflow-hidden">
                {/* Region Header */}
                <button onClick={() => toggleRegion(region)} className="w-full text-left">
                  {/* Mini progress bar */}
                  <div className="h-1 w-full bg-muted">
                    <div
                      className={cn('h-full transition-all', regionPercent === 100 ? 'bg-emerald-500' : regionPercent >= 50 ? 'bg-amber-500' : 'bg-red-500')}
                      style={{ width: `${regionPercent}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-3 px-4 py-3">
                    {/* Region avatar */}
                    <RegionAvatar region={region} size="lg" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-foreground truncate">{region}</p>
                        <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0">
                          {orders.length}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[11px]">
                        <span className="text-emerald-400 font-medium">{regionDelivered} done</span>
                        {regionPending > 0 && <span className="text-amber-400 font-medium">{regionPending} left</span>}
                        {regionFailed > 0 && <span className="text-red-400 font-medium">{regionFailed} failed</span>}
                        <span className="text-muted-foreground ml-auto">Rs {regionAmount.toLocaleString()}</span>
                      </div>
                    </div>
                    <ChevronDown className={cn('w-4 h-4 text-muted-foreground transition-transform shrink-0', isExpanded && 'rotate-180')} />
                  </div>
                </button>

                {/* Region Actions Bar */}
                {isExpanded && (
                  <div className="border-t border-border bg-muted/30">
                    {/* Top row: Message + Log replies - always full width */}
                    {contactable > 0 && (
                      <div className="flex items-center gap-2 px-4 py-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); openMessagePanel(region, orders) }}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/15 text-blue-400 text-xs font-medium hover:bg-blue-500/25 transition-colors"
                        >
                          <Send className="w-3.5 h-3.5" />
                          Message {contactable}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setReplyLogPanel({ region, orders: orders.filter(o => o.contact1) }); setReplyLogActive(null); setReplyLogText(''); setReplyLogSearch('') }}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500/15 text-emerald-400 text-xs font-medium hover:bg-emerald-500/25 transition-colors"
                        >
                          <MessageSquareText className="w-3.5 h-3.5" />
                          Log replies
                        </button>
                      </div>
                    )}
                    {/* Bottom row: Batch status actions */}
                    <div className="flex items-center gap-2 px-4 py-2 border-t border-border/50 overflow-x-auto">
                    {/* Batch status */}
                    {regionPending > 0 && (
                      <>
                        <button
                          disabled={updatingRegion === region}
                          onClick={(e) => { e.stopPropagation(); handleRegionDeliveredClick(region, orders) }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 text-[11px] font-medium hover:bg-emerald-500/25 transition-colors disabled:opacity-50 shrink-0"
                        >
                          <CheckCircle className="w-3 h-3" />
                          All done
                        </button>
                        <button
                          disabled={updatingRegion === region}
                          onClick={(e) => { e.stopPropagation(); handleRegionStatusChange(region, orders, 'nwd') }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 text-red-400 text-[11px] font-medium hover:bg-red-500/25 transition-colors disabled:opacity-50 shrink-0"
                        >
                          <XCircle className="w-3 h-3" />
                          All NWD
                        </button>
                      </>
                    )}
                    </div>
                  </div>
                )}

                {/* Client Cards */}
                {isExpanded && reorderMode && (
                  <DraggableRegionList
                    region={region}
                    itemCount={orders.length}
                    onReorder={handleReorder}
                  >
                    {orders.map((order) => (
                      <ReorderCard key={order.key} order={order} />
                    ))}
                  </DraggableRegionList>
                )}

                {isExpanded && !reorderMode && (
                  <div className="border-t border-border divide-y divide-border/50">
                    {orders.map((order) => {
                      return (
                      <div key={order.key} className={cn('px-4 py-3 flex flex-col gap-2', updatingKey === order.key && 'opacity-50 pointer-events-none')}>
                        {/* Customer row: seq + name + indicators + status */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {order.deliverySequence > 0 && (
                                <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">{order.deliverySequence}</span>
                              )}
                              {order.indexNo && (
                                <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">#{order.indexNo}</span>
                              )}
                              <p className="text-sm font-medium text-foreground truncate">{order.customerName}</p>
                              {order.items[0]?.sales_type && order.items[0].sales_type !== 'sale' && order.items[0].sales_type !== 'drop_off' && (
                                <span style={{
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  fontSize: '9px',
                                  fontWeight: 800,
                                  backgroundColor: order.items[0].sales_type === 'exchange' ? 'rgba(139,92,246,0.25)' :
                                                  order.items[0].sales_type === 'trade_in' ? 'rgba(59,130,246,0.25)' : 'rgba(239,68,68,0.25)',
                                  color: order.items[0].sales_type === 'exchange' ? '#a78bfa' : order.items[0].sales_type === 'trade_in' ? '#60a5fa' : '#f87171',
                                }}>
                                  {order.items[0].sales_type === 'exchange' ? 'EXCHANGE' : order.items[0].sales_type === 'trade_in' ? 'TRADE-IN' : 'REFUND'}
                                </span>
                              )}
                              {/* Inline indicators: replied / needs call / has note */}
                              {order.clientResponse && (
                                <span
                                  onClick={() => setReplyPanel({ order, reply: order.clientResponse || '' })}
                                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 text-[9px] font-medium cursor-pointer hover:bg-emerald-500/25 transition-colors shrink-0"
                                  title={order.clientResponse}
                                >
                                  <MessageSquareText className="w-2.5 h-2.5" />
                                  Replied
                                </span>
                              )}
                              {!order.clientResponse && order.status === 'assigned' && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 text-[9px] font-medium shrink-0">
                                  <Phone className="w-2.5 h-2.5" />
                                  Call
                                </span>
                              )}
                              {order.deliveryNotes && (
                                <span
                                  onClick={() => setNotePanel({ order, note: order.deliveryNotes || '' })}
                                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground text-[9px] font-medium cursor-pointer hover:bg-muted transition-colors shrink-0"
                                  title={order.deliveryNotes}
                                >
                                  <StickyNote className="w-2.5 h-2.5" />
                                  Note
                                </span>
                              )}
                              {/* Location indicator */}
                              {hasLocationLink(order.clientResponse) || hasLocationLink(order.deliveryNotes) ? (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 text-[9px] font-medium shrink-0">
                                  <Navigation className="w-2.5 h-2.5" />
                                  Pin
                                </span>
                              ) : order.clientResponse && !hasLocationLink(order.clientResponse) ? (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 text-[9px] font-medium shrink-0">
                                  <MapPin className="w-2.5 h-2.5" />
                                  No pin
                                </span>
                              ) : null}
                            </div>
                            {/* Locality */}
                            {order.locality && (
                              <div className="flex items-center gap-1 mt-0.5">
                                <MapPin className="w-3 h-3 text-muted-foreground" />
                                <span className="text-[11px] text-muted-foreground">{order.locality}</span>
                              </div>
                            )}

                            {/* Contact + quick actions */}
                            {order.contact1 && (
                              <div className="flex items-center gap-2 mt-1">
                                <a href={`tel:${order.contact1}`} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors">
                                  <Phone className="w-3 h-3" />
                                  {order.contact1}
                                </a>
                                <button
                                  onClick={(e) => { e.stopPropagation(); sendSingleMessage(order, 'whatsapp') }}
                                  disabled={singleSending === order.key}
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 text-[10px] font-medium hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
                                >
                                  {singleSending === order.key ? (
                                    <div className="w-3 h-3 border border-emerald-400 border-t-transparent rounded-full animate-spin" />
                                  ) : (
                                    <MessageCircle className="w-3 h-3" />
                                  )}
                                  WA
                                </button>
                                <button
                                  onClick={(e) => { e.stopPropagation(); sendSingleMessage(order, 'sms') }}
                                  disabled={singleSending === order.key}
                                  className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 text-[10px] font-medium hover:bg-blue-500/25 transition-colors disabled:opacity-50"
                                >
                                  {singleSending === order.key ? (
                                    <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                                  ) : (
                                    <MessageCircle className="w-3 h-3" />
                                  )}
                                  SMS
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={cn('flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium border shrink-0', STATUS_STYLE[order.status])}>
                              {STATUS_ICON[order.status]}
                              {STATUS_LABELS[order.status]}
                            </span>
                          </div>
                        </div>

                        {/* Products */}
                        <div className="space-y-1">
                          {order.items.map((item) => (
                            <div key={item.id} className="flex items-center justify-between gap-2 text-xs">
                              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                <ShoppingBag className="w-3 h-3 text-muted-foreground shrink-0" />
                                <span className="text-muted-foreground truncate">{item.products || 'Product'}</span>
                                {(item.qty || 1) > 1 && <span className="text-muted-foreground/70 shrink-0">x{item.qty}</span>}
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {item.is_modified && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400" title={`Modified${item.original_amount != null ? ` (was Rs ${item.original_amount})` : ''}`} />
                                )}
                                <span className="text-foreground/70">Rs {Number(item.amount || 0).toLocaleString()}</span>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Payment Info */}
                        {(order.paymentJuice > 0 || order.paymentCash > 0 || order.paymentBank > 0 || order.paymentStatus !== 'unpaid') && (
                          <div className="flex items-center gap-2 flex-wrap text-[11px]">
                            <span className={cn(
                              'px-1.5 py-0.5 rounded text-[10px] font-medium',
                              order.paymentStatus === 'paid' || order.paymentStatus === 'already_paid' ? 'bg-emerald-500/15 text-emerald-400' :
                              order.paymentStatus === 'partial' ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400'
                            )}>
                              {order.paymentStatus === 'already_paid' ? 'Pre-paid' : order.paymentStatus === 'paid' ? 'Paid' : order.paymentStatus === 'partial' ? 'Partial' : 'Unpaid'}
                            </span>
                            {order.paymentJuice > 0 && (
                              <span className="flex items-center gap-0.5 text-orange-400">
                                <Smartphone className="w-3 h-3" />
                                {order.paymentMethod === 'juice_to_rider' ? 'JTR' : 'Juice'} Rs {order.paymentJuice}
                              </span>
                            )}
                            {order.paymentCash > 0 && (
                              <span className="flex items-center gap-0.5 text-emerald-400"><Banknote className="w-3 h-3" />Rs {order.paymentCash}</span>
                            )}
                            {order.paymentBank > 0 && (
                              <span className="flex items-center gap-0.5 text-blue-400"><CreditCard className="w-3 h-3" />Rs {order.paymentBank}</span>
                            )}
                          </div>
                        )}

                        {/* Combined Notes & Replies */}
                        {(order.clientResponse || order.deliveryNotes) && (
                          <div className="px-2 py-1.5 rounded-lg bg-muted/20 border border-border/20 space-y-1">
                            {order.deliveryNotes && (
                              <div
                                onClick={() => setNotePanel({ order, note: order.deliveryNotes || '' })}
                                className="flex items-start gap-1.5 cursor-pointer hover:opacity-80 transition-opacity"
                              >
                                <StickyNote className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
                                <p className="text-[11px] text-amber-300/80 leading-relaxed flex-1 line-clamp-2">
                                  <RichText text={order.deliveryNotes} label={order.customerName} />
                                </p>
                              </div>
                            )}
                            {order.clientResponse && (
                              <div
                                onClick={() => setReplyPanel({ order, reply: order.clientResponse || '' })}
                                className="flex items-start gap-1.5 cursor-pointer hover:opacity-80 transition-opacity"
                              >
                                <MessageSquareText className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                                <p className="text-[11px] text-emerald-300/80 leading-relaxed flex-1 line-clamp-2">
                                  <RichText text={order.clientResponse} label={order.customerName} />
                                </p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Quick action buttons */}
                        <div className="flex items-center gap-2 pt-0.5">
                          <button
                            onClick={() => setReplyPanel({ order, reply: order.clientResponse || '' })}
                            className={cn(
                              'flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border transition-all',
                              order.clientResponse
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                                : 'bg-emerald-500/5 text-emerald-400/60 border-emerald-500/10 hover:bg-emerald-500/15 hover:text-emerald-400'
                            )}
                          >
                            <MessageSquareText className="w-3 h-3" />
                            {order.clientResponse ? 'Edit reply' : 'Client reply'}
                          </button>
                          <button
                            onClick={() => setNotePanel({ order, note: order.deliveryNotes || '' })}
                            className={cn(
                              'flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium border transition-all',
                              order.deliveryNotes
                                ? 'bg-muted/60 text-muted-foreground border-border/40 hover:bg-muted'
                                : 'bg-muted/30 text-muted-foreground/50 border-transparent hover:bg-muted/50 hover:text-muted-foreground'
                            )}
                          >
                            <StickyNote className="w-3 h-3" />
                            {order.deliveryNotes ? 'Edit note' : 'Add note'}
                          </button>
                        </div>

                        {/* Footer: total + rider + actions */}
                        <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-border/30">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {order.items.length > 1 && <span>{order.items.length} items</span>}
                            {order.riderId && riderMap[order.riderId] && (
                              <span className="flex items-center gap-1 text-primary/80">
                                <Users className="w-3 h-3" />
                                {riderMap[order.riderId]}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            {order.items.some(i => i.is_modified) && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-purple-500/15 text-purple-400 border border-purple-400/20">
                                MOD
                              </span>
                            )}
                            <span className="font-semibold text-sm text-foreground">Rs {order.totalAmount.toLocaleString()}</span>
                          </div>
                        </div>

                        {/* Quick status actions */}
                        {!['delivered', 'nwd', 'cms'].includes(order.status) && (
                          <div className="flex items-center gap-2 mt-0.5">
                            <button
                              disabled={updatingKey === order.key}
                              onClick={() => handleDeliveredClick(order)}
                              className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 text-[11px] font-medium hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                              Delivered
                            </button>
                            <button
                              disabled={updatingKey === order.key}
                              onClick={() => {
                                const first = order.items[0]
                                setModifyTarget({
                                  deliveryId: first.id,
                                  customerName: order.customerName,
                                  products: first.products || '',
                                  amount: order.totalAmount,
                                })
                              }}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-purple-500/15 text-purple-400 text-[11px] font-medium hover:bg-purple-500/25 transition-colors disabled:opacity-50"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                              Modify
                            </button>
                            <button
                              disabled={updatingKey === order.key}
                              onClick={() => handleStatusChange(order, 'nwd')}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/15 text-red-400 text-[11px] font-medium hover:bg-red-500/25 transition-colors disabled:opacity-50"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              NWD
                            </button>
                            <button
                              disabled={updatingKey === order.key}
                              onClick={() => handleStatusChange(order, 'cms')}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-orange-500/15 text-orange-400 text-[11px] font-medium hover:bg-orange-500/25 transition-colors disabled:opacity-50"
                            >
                              <AlertTriangle className="w-3.5 h-3.5" />
                              CMS
                            </button>
                          </div>
                        )}
                      </div>
                    )})}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Batch Message Panel (Portal to body) ── */}
      {mounted && messagePanel && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/70 flex items-end" onClick={() => setMessagePanel(null)}>
          <div className="w-full max-h-[80vh] bg-card border-t border-border rounded-t-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
              <div>
                <h3 className="font-semibold text-foreground text-sm">Batch message</h3>
                <p className="text-xs text-muted-foreground">
                  {messagePanel.region} - {selectedContacts.size}/{MAX_BATCH_CONTACTS} selected
                  {selectedContacts.size >= MAX_BATCH_CONTACTS && (
                    <span className="text-amber-400 ml-1">(limit reached)</span>
                  )}
                </p>
              </div>
              <button onClick={() => setMessagePanel(null)} className="p-2 rounded-lg hover:bg-muted transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Template Select + Edit */}
            <div className="px-4 py-3 border-b border-border shrink-0">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-foreground">Message template</p>
                <button
                  onClick={() => {
                    if (editingTemplates) {
                      setEditingTemplates(false)
                      setTemplateEdits({})
                    } else {
                      const edits: Record<string, string> = {}
                      templates.forEach(t => { edits[t.id] = t.text })
                      setTemplateEdits(edits)
                      setEditingTemplates(true)
                    }
                  }}
                  className="text-[10px] font-medium text-primary hover:underline"
                >
                  {editingTemplates ? 'Cancel' : 'Edit Templates'}
                </button>
              </div>

              {!editingTemplates ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    {templates.map(t => (
                      <button
                        key={t.id}
                        onClick={() => setSelectedTemplate(t.id)}
                        className={cn(
                          'px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                          selectedTemplate === t.id
                            ? 'bg-primary/20 text-primary border-primary/40'
                            : 'bg-muted text-muted-foreground border-transparent hover:border-border'
                        )}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 px-2 py-2 rounded-lg bg-muted/30 border border-border/30">
                    <p className="text-[10px] text-muted-foreground/60 mb-1">Batch preview:</p>
                    <p className="text-[11px] text-foreground/80 leading-relaxed">
                      {templates.find(t => t.id === selectedTemplate)?.text}
                    </p>
                  </div>
                  <div className="mt-1.5 px-2 py-1.5 rounded-lg bg-blue-500/5 border border-blue-500/15">
                    <p className="text-[10px] text-blue-400/70">
                      Individual mode adds: &quot;Hi [Name], ...&quot; + a unique reply link per client
                    </p>
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  {templates.map(t => (
                    <div key={t.id}>
                      <label className="text-[10px] font-medium text-foreground mb-1 block">{t.label}</label>
                      <textarea
                        value={templateEdits[t.id] || ''}
                        onChange={(e) => setTemplateEdits(prev => ({ ...prev, [t.id]: e.target.value }))}
                        rows={2}
                        className="w-full rounded-lg bg-background border border-border px-3 py-2 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                        placeholder="Type your message template..."
                      />
                      <p className="text-[9px] text-muted-foreground/60 mt-0.5">
                        Batch sends this exact text. Individual mode auto-adds client name + reply link.
                      </p>
                      {templateEdits[t.id] !== DEFAULT_TEMPLATES[t.id]?.text && (
                        <button
                          onClick={() => setTemplateEdits(prev => ({ ...prev, [t.id]: DEFAULT_TEMPLATES[t.id].text }))}
                          className="text-[9px] text-muted-foreground hover:text-foreground mt-0.5"
                        >
                          Reset to default
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={async () => {
                      setSavingTemplates(true)
                      const { saveMessageTemplates } = await import('@/lib/payment-actions')
                      await saveMessageTemplates(templateEdits)
                      setSavingTemplates(false)
                      setEditingTemplates(false)
                      router.refresh()
                    }}
                    disabled={savingTemplates}
                    className="w-full py-2 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {savingTemplates ? 'Saving...' : 'Save Templates'}
                  </button>
                </div>
              )}
            </div>

            {/* Contact List with Notes & Reorder */}
            <div className="flex-1 overflow-y-auto px-4 py-2">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-muted-foreground">Contacts</p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setBatchReorder(!batchReorder)}
                    className={cn(
                      'flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg border transition-colors',
                      batchReorder
                        ? 'border-primary/50 bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <GripVertical className="w-3 h-3" />
                    {batchReorder ? 'Done' : 'Reorder'}
                  </button>
                  <button
                    onClick={() => {
                      const allContactable = messagePanel.orders.filter(o => o.contact1).map(o => o.contact1!)
                      if (selectedContacts.size > 0) setSelectedContacts(new Set())
                      else setSelectedContacts(new Set(allContactable.slice(0, MAX_BATCH_CONTACTS)))
                    }}
                    className="text-xs text-primary hover:underline"
                  >
                    {selectedContacts.size > 0 ? 'Deselect all' : `Select all (max ${MAX_BATCH_CONTACTS})`}
                  </button>
                </div>
              </div>

              {/* Draggable list when reordering */}
              {batchReorder ? (
                <DraggableRegionList
                  region={messagePanel.region}
                  itemCount={messagePanel.orders.length}
                  onReorder={async (_, from, to) => {
                    const orders = [...messagePanel.orders]
                    const [moved] = orders.splice(from, 1)
                    orders.splice(to, 0, moved)
                    setMessagePanel({ ...messagePanel, orders })
                    const updates = orders.map((o, i) => ({
                      deliveryIds: o.items.map((item: { id: string }) => item.id),
                      sequence: i + 1,
                    }))
                    const { updateDeliverySequence } = await import('@/lib/delivery-actions')
                    await updateDeliverySequence(updates)
                  }}
                >
                  {messagePanel.orders.map(o => (
                    <ReorderCard key={o.key} order={o} />
                  ))}
                </DraggableRegionList>
              ) : (
                <div className="space-y-1">
                  {messagePanel.orders.map(o => (
                    <BatchContactRow key={o.key} order={o} selectedContacts={selectedContacts} toggleContact={toggleContact} limitReached={selectedContacts.size >= MAX_BATCH_CONTACTS} />
                  ))}
                </div>
              )}
            </div>

            {/* Send Buttons */}
            <div className="px-4 py-3 border-t border-border bg-card space-y-2 shrink-0">
              {batchSending && (
                <div className="flex items-center justify-center gap-2 py-2">
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <span className="text-xs text-muted-foreground">Generating reply links...</span>
                </div>
              )}

              {individualQueue.length > 0 ? (
                /* ── Individual send queue (one-by-one with reply links) ── */
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 transition-all" style={{ width: `${((individualIndex + 1) / individualQueue.length) * 100}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">{individualIndex + 1}/{individualQueue.length}</span>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-foreground font-medium">{individualQueue[individualIndex]?.name}</p>
                    <p className="text-[11px] text-muted-foreground font-mono">{individualQueue[individualIndex]?.phone}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => sendNextIndividual(individualMethod)}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors"
                    >
                      <Send className="w-4 h-4" />
                      {individualIndex + 1 < individualQueue.length ? `Next (${individualIndex + 2}/${individualQueue.length})` : 'Done'}
                    </button>
                    <button onClick={cancelIndividualSend} className="px-3 py-2.5 rounded-xl bg-muted text-muted-foreground text-sm hover:bg-muted/80">
                      Close
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {copied && (
                    <p className="text-xs text-center text-emerald-400 font-medium py-1">Message copied! Paste in WhatsApp Broadcast.</p>
                  )}
                  {/* Row 1: Batch send (generic message to all at once) */}
                  <div className="flex items-center gap-2">
                    <button
                      disabled={selectedContacts.size === 0 || batchSending}
                      onClick={() => sendBatchMessages('sms')}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Send className="w-4 h-4" />
                      Batch SMS ({selectedContacts.size})
                    </button>
                    <button
                      disabled={selectedContacts.size === 0 || batchSending}
                      onClick={() => sendBatchMessages('whatsapp')}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <MessageCircle className="w-4 h-4" />
                      Batch WA ({selectedContacts.size})
                    </button>
                  </div>
                  <p className="text-[10px] text-center text-muted-foreground/50">Same message to all contacts at once</p>
                  {/* Divider */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-[10px] text-muted-foreground/60">or</span>
                    <div className="flex-1 h-px bg-border" />
                  </div>
                  {/* Row 2: Individual send (personalized with reply links, one-by-one) */}
                  <div className="flex items-center gap-2">
                    <button
                      disabled={selectedContacts.size === 0 || batchSending}
                      onClick={() => { setIndividualMethod('sms'); sendIndividualMessages('sms') }}
                      className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl border border-blue-500/40 text-blue-400 text-xs font-medium hover:bg-blue-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Individual SMS ({selectedContacts.size})
                    </button>
                    <button
                      disabled={selectedContacts.size === 0 || batchSending}
                      onClick={() => { setIndividualMethod('whatsapp'); sendIndividualMessages('whatsapp') }}
                      className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl border border-emerald-500/40 text-emerald-400 text-xs font-medium hover:bg-emerald-500/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      Individual WA ({selectedContacts.size})
                    </button>
                  </div>
                  <p className="text-[10px] text-center text-blue-400/50">Personalized + reply link per client (one-by-one)</p>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Notes Panel (Portal to body) ── */}
      {mounted && notePanel && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/70 flex items-end" onClick={() => setNotePanel(null)}>
          <div className="w-full bg-card border-t border-border rounded-t-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div>
                <h3 className="font-semibold text-foreground text-sm">Delivery note</h3>
                <p className="text-xs text-muted-foreground">{notePanel.order.customerName}</p>
              </div>
              <button onClick={() => setNotePanel(null)} className="p-2 rounded-lg hover:bg-muted transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-4 py-3">
              <textarea
                autoFocus
                value={notePanel.note}
                onChange={(e) => setNotePanel({ ...notePanel, note: e.target.value })}
                placeholder="e.g. Leave at door, after 2pm, call before..."
                className="w-full h-24 px-3 py-2 text-sm rounded-xl bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
            </div>
            <div className="px-4 py-3 border-t border-border flex items-center gap-3 shrink-0">
              <button
                onClick={() => setNotePanel(null)}
                className="flex-1 py-2.5 rounded-xl bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={savingNote}
                onClick={() => handleSaveNote(notePanel.order, notePanel.note)}
                className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {savingNote ? 'Saving...' : 'Save note'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Log Replies Panel (Portal to body) ── */}
      {mounted && replyLogPanel && createPortal(
        <div className="fixed inset-0 z-[9999] bg-background flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
            <div>
              <h3 className="font-semibold text-foreground text-sm">Notes & Replies</h3>
              <p className="text-xs text-muted-foreground">
                {replyLogPanel.region} - {replyLogPanel.orders.filter(o => o.clientResponse || o.deliveryNotes).length}/{replyLogPanel.orders.length} have notes
              </p>
            </div>
            <button
              onClick={() => { setReplyLogPanel(null); router.refresh() }}
              className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
            >
              Done
            </button>
          </div>

          {/* Search by phone or name */}
          <div className="px-3 py-2 border-b border-border bg-card/50 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                value={replyLogSearch}
                onChange={(e) => setReplyLogSearch(e.target.value)}
                placeholder="Search by phone number or name..."
                className="w-full pl-8 pr-3 py-2 text-sm rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              {replyLogSearch && (
                <button
                  onClick={() => setReplyLogSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2"
                >
                  <X className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground" />
                </button>
              )}
            </div>
          </div>

          {/* Filter tabs */}
          {(() => {
            const all = replyLogPanel.orders
            const withPin = all.filter(o => hasLocationLink(o.clientResponse) || hasLocationLink(o.deliveryNotes))
            const noPin = all.filter(o => !hasLocationLink(o.clientResponse) && !hasLocationLink(o.deliveryNotes))
            const replied = all.filter(o => o.clientResponse)
            const pending = all.filter(o => !o.clientResponse)
            return (
              <div className="px-3 py-2 border-b border-border bg-card/30 shrink-0">
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                  {[
                    { key: 'all' as const, label: 'All', count: all.length, color: 'bg-muted text-muted-foreground' },
                    { key: 'with-pin' as const, label: 'With Pin', count: withPin.length, color: 'bg-cyan-500/15 text-cyan-400' },
                    { key: 'no-pin' as const, label: 'No Pin', count: noPin.length, color: 'bg-orange-500/15 text-orange-400' },
                    { key: 'replied' as const, label: 'Replied', count: replied.length, color: 'bg-emerald-500/15 text-emerald-400' },
                    { key: 'pending' as const, label: 'Pending', count: pending.length, color: 'bg-amber-500/15 text-amber-400' },
                  ].map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setReplyLogFilter(tab.key)}
                      className={cn(
                        'flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all whitespace-nowrap',
                        replyLogFilter === tab.key
                          ? `${tab.color} ring-1 ring-current/30`
                          : 'text-muted-foreground/60 hover:text-muted-foreground'
                      )}
                    >
                      {tab.label}
                      <span className="text-[10px] opacity-70">{tab.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })()}

          {/* Progress bar */}
          <div className="h-1.5 w-full bg-muted shrink-0">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${replyLogPanel.orders.length > 0 ? (replyLogPanel.orders.filter(o => o.clientResponse || o.deliveryNotes).length / replyLogPanel.orders.length) * 100 : 0}%` }}
            />
          </div>

          {/* Client list */}
          <div className="flex-1 overflow-y-auto">
            {replyLogPanel.orders
            .filter(order => {
              // Location/reply filter
              if (replyLogFilter === 'with-pin') return hasLocationLink(order.clientResponse) || hasLocationLink(order.deliveryNotes)
              if (replyLogFilter === 'no-pin') return !hasLocationLink(order.clientResponse) && !hasLocationLink(order.deliveryNotes)
              if (replyLogFilter === 'replied') return !!order.clientResponse
              if (replyLogFilter === 'pending') return !order.clientResponse
              return true
            })
            .filter(order => {
              if (!replyLogSearch.trim()) return true
              const q = replyLogSearch.trim().toLowerCase()
              const nameMatch = order.customerName.toLowerCase().includes(q)
              const phoneMatch = (order.contact1 || '').replace(/\s/g, '').includes(q.replace(/\s/g, ''))
              return nameMatch || phoneMatch
            })
            .map(order => {
              const isActive = replyLogActive === order.key
              const hasReply = !!order.clientResponse
              const hasNotes = !!order.deliveryNotes
              const hasAny = hasReply || hasNotes
              const combined = getCombinedNotes(order)

              return (
                <div key={order.key} className={cn('border-b border-border/50', isActive && 'bg-muted/30')}>
                  {/* Row: tap to expand */}
                  <button
                    onClick={() => {
                      if (isActive) {
                        setReplyLogActive(null)
                        setReplyLogText('')
                      } else {
                        setReplyLogActive(order.key)
                        setReplyLogText(order.clientResponse || '')
                      }
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left"
                  >
                    {/* Status indicator */}
                    <div className={cn(
                      'w-2.5 h-2.5 rounded-full shrink-0',
                      hasReply && hasNotes ? 'bg-emerald-500' : hasAny ? 'bg-amber-500' : 'bg-zinc-600'
                    )} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-foreground truncate">{order.customerName}</p>
                        {(hasLocationLink(order.clientResponse) || hasLocationLink(order.deliveryNotes)) ? (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 text-[9px] font-medium">
                            <Navigation className="w-2.5 h-2.5" />Pin
                          </span>
                        ) : hasReply ? (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 text-[9px] font-medium">
                            <MapPin className="w-2.5 h-2.5" />No pin
                          </span>
                        ) : null}
                      </div>
                      {order.contact1 && (
                        <p className="text-[11px] text-blue-400/80 font-mono mt-0.5 flex items-center gap-1">
                          <Phone className="w-2.5 h-2.5 shrink-0" />
                          {order.contact1}
                        </p>
                      )}
                      {hasAny ? (
                        <div className="mt-1 space-y-0.5">
                          {hasNotes && (
                            <p className="text-[11px] text-amber-400/80 truncate flex items-center gap-1">
                              <StickyNote className="w-2.5 h-2.5 shrink-0" />
                              <RichText text={order.deliveryNotes!} label={order.customerName} />
                            </p>
                          )}
                          {hasReply && (
                            <p className="text-[11px] text-emerald-400 truncate flex items-center gap-1">
                              <MessageSquareText className="w-2.5 h-2.5 shrink-0" />
                              <RichText text={order.clientResponse!} label={order.customerName} />
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-1">No notes or reply yet</p>
                      )}
                    </div>
                    <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium shrink-0', STATUS_STYLE[order.status])}>
                      {STATUS_LABELS[order.status]}
                    </span>
                  </button>

                  {/* Expanded: input area */}
                  {isActive && (
                    <div className="px-4 pb-3 flex flex-col gap-2">
                      <textarea
                        autoFocus
                        value={replyLogText}
                        onChange={(e) => setReplyLogText(e.target.value)}
                        placeholder="Type or paste client reply..."
                        rows={2}
                        className="w-full px-3 py-2 text-sm rounded-xl bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-none"
                      />
                      <div className="flex items-center gap-2">
                        {hasReply && (
                          <button
                            disabled={replyLogSaving}
                            onClick={() => handleReplyLogSave(order, '')}
                            className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors disabled:opacity-50"
                          >
                            Clear
                          </button>
                        )}
                        <div className="flex-1" />
                        <button
                          onClick={() => { setReplyLogActive(null); setReplyLogText('') }}
                          className="px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-medium hover:bg-muted/80 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          disabled={replyLogSaving || !replyLogText.trim()}
                          onClick={() => handleReplyLogSave(order, replyLogText.trim())}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
                        >
                          {replyLogSaving ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            {replyLogSearch.trim() && replyLogPanel.orders.filter(order => {
              const q = replyLogSearch.trim().toLowerCase()
              return order.customerName.toLowerCase().includes(q) || (order.contact1 || '').replace(/\s/g, '').includes(q.replace(/\s/g, ''))
            }).length === 0 && (
              <div className="px-4 py-8 text-center">
                <Phone className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No match for &quot;{replyLogSearch}&quot;</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Try the last 4 digits of the phone number</p>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* ── Protocol Confirmation Popup (Exchange/Trade-In/Refund) ── */}
      {mounted && protocolPopup && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4" onClick={() => setProtocolPopup(null)}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '380px',
              borderRadius: '16px',
              overflow: 'hidden',
              border: protocolPopup.salesType === 'exchange' ? '2px solid #8b5cf6' :
                     protocolPopup.salesType === 'trade_in' ? '2px solid #3b82f6' : '2px solid #ef4444',
              backgroundColor: '#1a1a2e',
            }}
          >
            {/* Header */}
            <div style={{
              padding: '16px 20px',
              background: protocolPopup.salesType === 'exchange' ? 'rgba(139,92,246,0.2)' :
                         protocolPopup.salesType === 'trade_in' ? 'rgba(59,130,246,0.2)' : 'rgba(239,68,68,0.2)',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}>
              <RotateCcw style={{
                width: 24, height: 24,
                color: protocolPopup.salesType === 'exchange' ? '#a78bfa' : protocolPopup.salesType === 'trade_in' ? '#60a5fa' : '#f87171'
              }} />
              <div>
                <h3 style={{
                  fontWeight: 800,
                  fontSize: '16px',
                  color: protocolPopup.salesType === 'exchange' ? '#a78bfa' : protocolPopup.salesType === 'trade_in' ? '#60a5fa' : '#f87171',
                  margin: 0,
                }}>
                  {protocolPopup.salesType === 'exchange' ? 'EXCHANGE ORDER' : protocolPopup.salesType === 'trade_in' ? 'TRADE-IN ORDER' : 'REFUND ORDER'}
                </h3>
                <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', margin: 0 }}>
                  {protocolPopup.order.customerName}
                </p>
              </div>
            </div>

            {/* Body */}
            <div style={{ padding: '16px 20px' }}>
              {/* Product to collect */}
              {protocolPopup.order.items[0]?.return_product && (
                <div style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(251,191,36,0.12)',
                  border: '1px solid rgba(251,191,36,0.25)',
                  marginBottom: '12px',
                }}>
                  <p style={{ fontSize: '11px', color: 'rgba(251,191,36,0.7)', fontWeight: 600, margin: 0 }}>COLLECT FROM CUSTOMER:</p>
                  <p style={{ fontSize: '15px', color: '#fbbf24', fontWeight: 800, margin: '4px 0 0' }}>
                    {protocolPopup.order.items[0].return_product}
                  </p>
                </div>
              )}

              {/* Protocol steps */}
              <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', lineHeight: '1.7' }}>
                {protocolPopup.salesType === 'exchange' && (
                  <>
                    <p style={{ margin: '0 0 6px' }}>1. Deliver the new product</p>
                    <p style={{ margin: '0 0 6px' }}>2. Collect the old product with <strong style={{ color: '#fbbf24' }}>ALL original packaging</strong></p>
                    <p style={{ margin: '0 0 6px' }}>3. Verify all parts & accessories are present</p>
                    <p style={{ margin: '0 0 6px' }}>4. If anything missing, exchange only the needed part and keep the rest</p>
                  </>
                )}
                {protocolPopup.salesType === 'trade_in' && (
                  <>
                    <p style={{ margin: '0 0 6px' }}>1. Deliver the new product</p>
                    <p style={{ margin: '0 0 6px' }}>2. Collect the trade-in product listed above</p>
                    <p style={{ margin: '0 0 6px' }}>3. Verify condition & <strong style={{ color: '#fbbf24' }}>ALL packaging</strong></p>
                    {(protocolPopup.order.totalAmount || 0) > 0 && (
                      <p style={{ margin: '0 0 6px' }}>4. Collect difference: <strong style={{ color: '#60a5fa' }}>Rs {protocolPopup.order.totalAmount}</strong></p>
                    )}
                  </>
                )}
                {protocolPopup.salesType === 'refund' && (
                  <>
                    <p style={{ margin: '0 0 6px' }}>1. Give cash refund of <strong style={{ color: '#f87171' }}>Rs {protocolPopup.order.totalAmount || 0}</strong></p>
                    <p style={{ margin: '0 0 6px' }}>2. Collect the product with <strong style={{ color: '#fbbf24' }}>ALL original packaging</strong></p>
                    <p style={{ margin: '0 0 6px' }}>3. Verify all parts & accessories are present</p>
                  </>
                )}
              </div>

              {/* Warning */}
              <div style={{
                marginTop: '12px',
                padding: '8px 12px',
                borderRadius: '8px',
                backgroundColor: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.2)',
                fontSize: '11px',
                color: '#f87171',
                fontWeight: 600,
              }}>
                Any missing items or packaging will be deducted from rider payout.
              </div>
            </div>

            {/* Actions */}
            <div style={{ padding: '12px 20px 20px', display: 'flex', gap: '10px' }}>
              <button
                onClick={() => setProtocolPopup(null)}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'rgba(255,255,255,0.5)',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmProtocol}
                style={{
                  flex: 2,
                  padding: '12px',
                  borderRadius: '10px',
                  backgroundColor: protocolPopup.salesType === 'exchange' ? '#8b5cf6' :
                                  protocolPopup.salesType === 'trade_in' ? '#3b82f6' : '#ef4444',
                  border: 'none',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {protocolPopup.salesType === 'exchange' ? 'Confirm Exchange' :
                 protocolPopup.salesType === 'trade_in' ? 'Confirm Trade-In' : 'Confirm Refund'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Client Reply Panel (Portal to body) ── */}
      {/* ── Payment Method Popup (Portal to body) ── */}
      {mounted && paymentPopup && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/70 flex items-end" onClick={() => setPaymentPopup(null)}>
          <div className="w-full bg-card border-t border-border rounded-t-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div>
                <h3 className="font-semibold text-foreground text-sm">Select Payment Method</h3>
                <p className="text-xs text-muted-foreground">
                  {paymentPopup.isBatch
                    ? `${paymentPopup.region} - ${paymentPopup.orders.length} orders`
                    : `${paymentPopup.orders[0]?.customerName} - Rs ${paymentPopup.orders[0]?.totalAmount.toLocaleString()}`
                  }
                </p>
              </div>
              <button onClick={() => setPaymentPopup(null)} className="p-2 rounded-lg hover:bg-muted transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 grid grid-cols-3 gap-3">
              <button
                onClick={() => confirmWithPayment('juice')}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-orange-500/10 border border-orange-500/30 text-orange-400 hover:bg-orange-500/20 transition-colors"
              >
                <Smartphone className="w-6 h-6" />
                <span className="text-sm font-semibold">Juice</span>
              </button>
              <button
                onClick={() => confirmWithPayment('cash')}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
              >
                <Banknote className="w-6 h-6" />
                <span className="text-sm font-semibold">Cash</span>
              </button>
              <button
                onClick={() => confirmWithPayment('paid')}
                className="flex flex-col items-center gap-2 p-4 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400 hover:bg-blue-500/20 transition-colors"
              >
                <CreditCard className="w-6 h-6" />
                <span className="text-sm font-semibold">Paid</span>
              </button>
            </div>


          </div>
        </div>,
        document.body
      )}

      {/* ── Proof Upload Step (Portal to body) ── */}
      {mounted && proofStep && createPortal(
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'flex-end' }} onClick={() => { setProofStep(null); setProofPreview(null); setProofFile(null) }}>
          <div className="w-full bg-card border-t border-border rounded-t-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div>
                <h3 className="font-semibold text-foreground text-sm">Upload Payment Proof</h3>
                <p className="text-xs text-muted-foreground">
                  {proofStep?.method === 'paid' ? 'Paid -- proof required' : 'Juice to contractor -- proof required'}
                </p>
              </div>
              <button onClick={() => { setProofStep(null); setProofPreview(null); setProofFile(null) }} className="p-2 rounded-lg hover:bg-muted transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              {proofPreview ? (
                <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-border bg-muted/20">
                  <img src={proofPreview} alt="Payment proof" className="w-full h-full object-contain" />
                  <button
                    onClick={() => { setProofPreview(null); setProofFile(null) }}
                    className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 cursor-pointer hover:bg-primary/10 transition-colors">
                  <Camera className="w-10 h-10 text-primary" />
                  <span className="text-sm font-medium text-primary">Take Photo or Upload Screenshot</span>
                  <span className="text-xs text-muted-foreground">Tap to open camera or select image</span>
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleProofFileChange}
                    className="hidden"
                  />
                </label>
              )}
              <button
                onClick={handleProofSubmit}
                disabled={!proofFile || proofUploading}
                className="w-full py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {proofUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Uploading...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    <span>Confirm Payment</span>
                  </>
                )}
              </button>
              <button
                onClick={() => { setProofStep(null); setProofPreview(null); setProofFile(null) }}
                className="w-full py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Client Reply Panel (Portal to body) ── */}
      {mounted && replyPanel && createPortal(
        <div className="fixed inset-0 z-[9999] bg-black/70 flex items-end" onClick={() => setReplyPanel(null)}>
          <div className="w-full bg-card border-t border-border rounded-t-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <div>
                <h3 className="font-semibold text-foreground text-sm">Client reply</h3>
                <p className="text-xs text-muted-foreground">{replyPanel.order.customerName}</p>
              </div>
              <button onClick={() => setReplyPanel(null)} className="p-2 rounded-lg hover:bg-muted transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="px-4 py-3">
              <textarea
                autoFocus
                value={replyPanel.reply}
                onChange={(e) => setReplyPanel({ ...replyPanel, reply: e.target.value })}
                placeholder="Paste or type what the client replied..."
                className="w-full h-24 px-3 py-2 text-sm rounded-xl bg-muted border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-none"
              />
            </div>
            <div className="px-4 py-3 border-t border-border flex items-center gap-3 shrink-0">
              {replyPanel.order.clientResponse && (
                <button
                  disabled={savingReply}
                  onClick={() => handleSaveReply(replyPanel.order, '')}
                  className="px-4 py-2.5 rounded-xl bg-red-500/10 text-red-400 text-sm font-medium hover:bg-red-500/20 transition-colors disabled:opacity-50"
                >
                  Clear
                </button>
              )}
              <div className="flex-1" />
              <button
                onClick={() => setReplyPanel(null)}
                className="px-4 py-2.5 rounded-xl bg-muted text-foreground text-sm font-medium hover:bg-muted/80 transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={savingReply || !replyPanel.reply.trim()}
                onClick={() => handleSaveReply(replyPanel.order, replyPanel.reply.trim())}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                {savingReply ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Modify Order Sheet (portal so it escapes scroll containers) ── */}
      {mounted && modifyTarget && createPortal(
        <ModifyOrderSheet
          open={!!modifyTarget}
          onClose={() => setModifyTarget(null)}
          deliveryId={modifyTarget.deliveryId}
          customerName={modifyTarget.customerName}
          currentProducts={modifyTarget.products}
          currentAmount={modifyTarget.amount}
          onModified={() => {
            setModifyTarget(null)
            router.refresh()
          }}
        />,
        document.body
      )}
    </div>
  )
}
