'use client'

import { useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { RegionAvatar } from '@/components/ui/region-avatar'
import * as XLSX from 'xlsx'
import {
  Package,
  Phone,
  ChevronDown,
  ChevronUp,
  Search,
  Upload,
  Plus,
  Trash2,
  CheckCircle,
  XCircle,
  Clock,
  FileSpreadsheet,
  User,
  AlertTriangle,
  MapPin,
} from 'lucide-react'
import {
  addPartnerSheet,
  removePartnerSheet,
  uploadPartnerDeliveries,
  assignPartnerDelivery,
  updatePartnerDeliveryStatus,
  saveAddressRegionMapping,
} from '@/lib/partner-actions'

// ── Types ──
interface Rider { id: string; name: string }

interface PartnerDelivery {
  id: string
  sheet_id: string
  sheet_row_number?: number
  order_date?: string
  supplier?: string
  product?: string
  address?: string
  phone?: string
  amount?: number
  qty?: number
  driver?: string
  status?: string
  rider_id?: string | null
  region?: string
  notes?: string
  riders?: { name: string } | null
}

interface PartnerSheet {
  id: string
  name: string
  spreadsheet_id: string
  gid: string
  is_active: boolean
  last_synced_at?: string
}

interface PartnerContentProps {
  contractorId: string
  sheets: PartnerSheet[]
  activeSheet: PartnerSheet | null
  deliveries: PartnerDelivery[]
  riders: Rider[]
  canonicalRegions: string[]
  unmappedAddresses: string[]
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: 'bg-amber-500/15', text: 'text-amber-400' },
  assigned: { bg: 'bg-blue-500/15', text: 'text-blue-400' },
  delivered: { bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  cancelled: { bg: 'bg-red-500/15', text: 'text-red-400' },
  returned: { bg: 'bg-orange-500/15', text: 'text-orange-400' },
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

export function PartnerContent({
  contractorId,
  sheets,
  activeSheet,
  deliveries,
  riders,
  canonicalRegions,
  unmappedAddresses,
}: PartnerContentProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<{
    success?: boolean
    error?: string
    rowsAdded?: number
    rowsUpdated?: number
    rowsSkipped?: number
  } | null>(null)
  const [showAddSheet, setShowAddSheet] = useState(false)
  const [sheetName, setSheetName] = useState('')
  const [addingSheet, setAddingSheet] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(new Set())
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)

  // ── Excel upload handler ──
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !activeSheet) return

    setUploading(true)
    setUploadResult(null)

    try {
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' })

      if (rows.length === 0) {
        setUploadResult({ error: 'No data found in file.' })
        setUploading(false)
        return
      }

      const result = await uploadPartnerDeliveries(contractorId, activeSheet.id, rows)

      if (result.success) {
        setUploadResult({
          success: true,
          rowsAdded: result.rowsAdded,
          rowsUpdated: result.rowsUpdated,
          rowsSkipped: result.rowsSkipped,
        })
        router.refresh()
      } else {
        setUploadResult({ error: result.error })
      }
    } catch (err) {
      setUploadResult({ error: `Failed to parse file: ${err instanceof Error ? err.message : String(err)}` })
    }

    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setTimeout(() => setUploadResult(null), 6000)
  }

  // ── Add sheet handler ──
  const handleAddSheet = async () => {
    if (!sheetName.trim()) return
    setAddingSheet(true)
    const result = await addPartnerSheet(contractorId, sheetName.trim())
    if (result.success) {
      setShowAddSheet(false)
      setSheetName('')
      router.refresh()
    }
    setAddingSheet(false)
  }

  // ── Remove sheet ──
  const handleRemoveSheet = async (sheetId: string) => {
    await removePartnerSheet(sheetId)
    setShowDeleteConfirm(null)
    router.refresh()
  }

  // ── Filter and search ──
  const filtered = useMemo(() => {
    let list = deliveries
    if (filterStatus !== 'all') {
      list = list.filter(d => d.status === filterStatus)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(d =>
        (d.product || '').toLowerCase().includes(q) ||
        (d.address || '').toLowerCase().includes(q) ||
        (d.supplier || '').toLowerCase().includes(q) ||
        (d.phone || '').toLowerCase().includes(q) ||
        (d.driver || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [deliveries, filterStatus, searchQuery])

  // ── Group by mapped region, fallback to raw address ──
  const regionGroups = useMemo(() => {
    const groups: Record<string, typeof filtered> = {}
    for (const d of filtered) {
      const region = d.locality || d.address || 'Unmapped'
      if (!groups[region]) groups[region] = []
      groups[region].push(d)
    }
    // Sort: "Unmapped" at the bottom, rest by count
    return Object.entries(groups).sort((a, b) => {
      if (a[0] === 'Unmapped') return 1
      if (b[0] === 'Unmapped') return -1
      return b[1].length - a[1].length
    })
  }, [filtered])

  const toggleRegion = (region: string) => {
    setExpandedRegions(prev => {
      const next = new Set(prev)
      if (next.has(region)) next.delete(region)
      else next.add(region)
      return next
    })
  }

  const allExpanded = regionGroups.length > 0 && regionGroups.every(([r]) => expandedRegions.has(r))
  const toggleAllRegions = () => {
    if (allExpanded) setExpandedRegions(new Set())
    else setExpandedRegions(new Set(regionGroups.map(([r]) => r)))
  }

  // ── Stats ──
  const totalAmount = deliveries.reduce((sum, d) => sum + (d.amount || 0), 0)
  const statusCounts = deliveries.reduce((acc, d) => {
    const s = d.status || 'pending'
    acc[s] = (acc[s] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div className="flex flex-col gap-3 pb-24">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">Partner Orders</h2>
          <p className="text-[10px] text-muted-foreground">
            {activeSheet ? activeSheet.name : 'No partner sheet created'}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {activeSheet && (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all",
                uploading
                  ? "bg-muted text-muted-foreground"
                  : "bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.98]"
              )}
            >
              <Upload className={cn("w-3.5 h-3.5", uploading && "animate-pulse")} />
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
          )}
          <button
            onClick={() => setShowAddSheet(!showAddSheet)}
            className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-xs font-medium border border-border bg-card text-muted-foreground hover:border-primary/30 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── Upload result ── */}
      {uploadResult && (
        <div className={cn(
          "rounded-xl border px-3 py-2 flex items-center gap-2",
          uploadResult.success
            ? "border-emerald-500/30 bg-emerald-500/10"
            : "border-red-500/30 bg-red-500/10"
        )}>
          {uploadResult.success
            ? <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            : <XCircle className="w-4 h-4 text-red-400 shrink-0" />
          }
          <span className={cn("text-xs", uploadResult.success ? "text-emerald-400" : "text-red-400")}>
            {uploadResult.success
              ? `Upload done: ${uploadResult.rowsAdded} added, ${uploadResult.rowsUpdated} updated${uploadResult.rowsSkipped ? `, ${uploadResult.rowsSkipped} skipped` : ''}`
              : uploadResult.error
            }
          </span>
        </div>
      )}

      {/* ── Add Sheet Form ── */}
      {showAddSheet && (
        <div className="rounded-xl border border-border bg-card p-3 space-y-2.5">
          <p className="text-xs font-semibold text-foreground">Create Partner Sheet</p>
          <p className="text-[10px] text-muted-foreground">
            Create a named partner sheet, then upload your Excel/CSV file daily.
          </p>
          <input
            type="text"
            placeholder="Partner name (e.g. Jassam Orders)"
            value={sheetName}
            onChange={e => setSheetName(e.target.value)}
            className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-background text-foreground focus:border-primary/50 focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              onClick={handleAddSheet}
              disabled={addingSheet || !sheetName.trim()}
              className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40 hover:bg-primary/90 transition-colors"
            >
              {addingSheet ? 'Creating...' : 'Create Sheet'}
            </button>
            <button
              onClick={() => setShowAddSheet(false)}
              className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-xs font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Sheet tabs (when multiple) ── */}
      {sheets.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {sheets.map(s => (
            <div key={s.id} className="flex items-center gap-0 shrink-0">
              <button
                onClick={() => {
                  const url = new URL(window.location.href)
                  url.searchParams.set('sheet', s.id)
                  url.searchParams.delete('date')
                  router.push(url.pathname + url.search)
                }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-l-lg text-[10px] font-medium whitespace-nowrap border transition-all",
                  activeSheet?.id === s.id
                    ? "bg-primary/10 text-primary border-primary/30"
                    : "bg-card text-muted-foreground border-border"
                )}
              >
                <FileSpreadsheet className="w-3 h-3" />
                {s.name}
              </button>
              {showDeleteConfirm === s.id ? (
                <div className="flex">
                  <button
                    onClick={() => handleRemoveSheet(s.id)}
                    className="px-2 py-1.5 text-[9px] font-bold bg-red-500 text-white border border-red-500 rounded-none"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(null)}
                    className="px-2 py-1.5 text-[9px] font-bold bg-muted text-muted-foreground border border-border rounded-r-lg"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowDeleteConfirm(s.id)}
                  className={cn(
                    "px-1.5 py-1.5 rounded-r-lg border border-l-0 transition-all",
                    activeSheet?.id === s.id ? "border-primary/30 text-primary/50 hover:text-red-400" : "border-border text-muted-foreground/40 hover:text-red-400"
                  )}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── No sheets state ── */}
      {sheets.length === 0 && !showAddSheet && (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <FileSpreadsheet className="w-10 h-10 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No partner sheets yet</p>
          <p className="text-[10px] text-muted-foreground text-center max-w-[240px]">
            Create a partner sheet, then upload your daily Excel file to import orders.
          </p>
          <button
            onClick={() => setShowAddSheet(true)}
            className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
          >
            Create Partner Sheet
          </button>
        </div>
      )}

      {activeSheet && (
        <>
          {/* ── Last upload info ── */}
          {activeSheet.last_synced_at && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Clock className="w-3 h-3" />
              Last upload: {new Date(activeSheet.last_synced_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </div>
          )}

          {/* ── Empty state ── */}
          {deliveries.length === 0 && (
            <div className="flex flex-col items-center py-8 gap-2">
              <Upload className="w-8 h-8 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">No data yet</p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90"
              >
                Upload Excel File
              </button>
            </div>
          )}

          {deliveries.length > 0 && (
            <>
              {/* ── Stats Row ── */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-border bg-card p-2.5 text-center">
                  <p className="text-lg font-bold text-foreground">{deliveries.length}</p>
                  <p className="text-[10px] text-muted-foreground">Orders</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-2.5 text-center">
                  <p className="text-lg font-bold text-primary">
                    Rs {totalAmount.toLocaleString()}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Amount</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-2.5 text-center">
                  <p className="text-lg font-bold text-emerald-400">{statusCounts['delivered'] || 0}</p>
                  <p className="text-[10px] text-muted-foreground">Delivered</p>
                </div>
              </div>

              {/* ── Status filter chips ── */}
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {['all', ...Object.keys(statusCounts)].map(s => {
                  const count = s === 'all' ? deliveries.length : statusCounts[s]
                  const colors = STATUS_COLORS[s] || { bg: 'bg-muted', text: 'text-muted-foreground' }
                  return (
                    <button
                      key={s}
                      onClick={() => setFilterStatus(s)}
                      className={cn(
                        "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium whitespace-nowrap border transition-all shrink-0",
                        filterStatus === s
                          ? cn(colors.bg, colors.text, "border-transparent")
                          : "bg-card text-muted-foreground border-border"
                      )}
                    >
                      {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
                      <span className="opacity-60">({count})</span>
                    </button>
                  )
                })}
              </div>

              {/* ── Search ── */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search product, address, supplier..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 text-xs rounded-xl border border-border bg-card text-foreground focus:border-primary/50 focus:outline-none"
                />
              </div>

              {/* ── Unmapped Addresses Banner ── */}
              {unmappedAddresses.length > 0 && (
                <UnmappedBanner
                  contractorId={contractorId}
                  unmappedAddresses={unmappedAddresses}
                  canonicalRegions={canonicalRegions}
                  onMapped={() => router.refresh()}
                />
              )}

              {/* ── Expand/Collapse All ── */}
              {regionGroups.length > 1 && (
                <button
                  onClick={toggleAllRegions}
                  className="text-[10px] text-primary font-medium self-end"
                >
                  {allExpanded ? 'Collapse All' : 'Expand All'}
                </button>
              )}

              {/* ── Region Groups ── */}
              <div className="space-y-2">
                {regionGroups.length === 0 ? (
                  <div className="flex flex-col items-center py-8 gap-2">
                    <Package className="w-8 h-8 text-muted-foreground/30" />
                    <p className="text-xs text-muted-foreground">No orders match filters</p>
                  </div>
                ) : (
                  regionGroups.map(([region, regionDeliveries]) => {
                    const regionColor = getRegionColor(region)
                    const isExpanded = expandedRegions.has(region)
                    const regionAmount = regionDeliveries.reduce((sum, d) => sum + (d.amount || 0), 0)
                    const deliveredCount = regionDeliveries.filter(d => d.status === 'delivered').length

                    return (
                      <div key={region} className="rounded-xl border border-border bg-card overflow-hidden">
                        {/* Region Header */}
                        <button
                          onClick={() => toggleRegion(region)}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
                        >
  <RegionAvatar region={region} size="md" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{region}</p>
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                              <span>{regionDeliveries.length} order{regionDeliveries.length !== 1 ? 's' : ''}</span>
                              <span>Rs {regionAmount.toLocaleString()}</span>
                              {deliveredCount > 0 && (
                                <span className="text-emerald-400">{deliveredCount} delivered</span>
                              )}
                            </div>
                          </div>
                          {isExpanded
                            ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                            : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                          }
                        </button>

                        {/* Expanded deliveries */}
                        {isExpanded && (
                          <div className="border-t border-border px-1.5 py-1.5 space-y-1">
                            {regionDeliveries.map(d => (
                              <PartnerDeliveryCard
                                key={d.id}
                                delivery={d}
                                riders={riders}
                                expanded={expandedId === d.id}
                                onToggle={() => setExpandedId(expandedId === d.id ? null : d.id)}
                                onAssign={async (riderId) => {
                                  await assignPartnerDelivery(d.id, riderId)
                                  router.refresh()
                                }}
                                onStatusChange={async (status) => {
                                  await updatePartnerDeliveryStatus(d.id, status)
                                  router.refresh()
                                }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

// ── Delivery Card ──
// ── Unmapped Addresses Mapping UI ──
function UnmappedBanner({
  contractorId,
  unmappedAddresses,
  canonicalRegions,
  onMapped,
}: {
  contractorId: string
  unmappedAddresses: string[]
  canonicalRegions: string[]
  onMapped: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [mappings, setMappings] = useState<Record<string, string>>({})

  const handleMap = async (address: string) => {
    const region = mappings[address]
    if (!region) return
    setSaving(address)
    await saveAddressRegionMapping(contractorId, address, region)
    setSaving(null)
    onMapped()
  }

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
      >
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
        <div className="flex-1">
          <p className="text-xs font-semibold text-amber-300">
            {unmappedAddresses.length} unmapped address{unmappedAddresses.length !== 1 ? 'es' : ''}
          </p>
          <p className="text-[10px] text-amber-400/60">Tap to map them to known regions</p>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-amber-400" /> : <ChevronDown className="w-4 h-4 text-amber-400" />}
      </button>

      {expanded && (
        <div className="border-t border-amber-500/20 px-3 py-2 space-y-2">
          {unmappedAddresses.map(address => (
            <div key={address} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-foreground truncate flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-muted-foreground shrink-0" />
                  {address}
                </p>
              </div>
              <select
                className="w-32 text-[10px] py-1 px-1.5 rounded-lg border border-border bg-card text-foreground"
                value={mappings[address] || ''}
                onChange={(e) => setMappings(prev => ({ ...prev, [address]: e.target.value }))}
              >
                <option value="">Select region</option>
                {canonicalRegions.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <button
                onClick={() => handleMap(address)}
                disabled={!mappings[address] || saving === address}
                className={cn(
                  "px-2 py-1 rounded-lg text-[10px] font-semibold transition-all shrink-0",
                  mappings[address]
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-muted text-muted-foreground cursor-not-allowed"
                )}
              >
                {saving === address ? '...' : 'Map'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PartnerDeliveryCard({
  delivery,
  riders,
  expanded,
  onToggle,
  onAssign,
  onStatusChange,
}: {
  delivery: PartnerDelivery
  riders: Rider[]
  expanded: boolean
  onToggle: () => void
  onAssign: (riderId: string) => Promise<void>
  onStatusChange: (status: string) => Promise<void>
}) {
  const [assigning, setAssigning] = useState(false)
  const statusColor = STATUS_COLORS[delivery.status || 'pending'] || STATUS_COLORS.pending
  const riderName = delivery.riders?.name || delivery.driver || null

  return (
    <div className={cn(
      "rounded-lg border bg-card overflow-hidden transition-all",
      expanded ? "border-primary/30" : "border-border/50"
    )}>
      {/* Main row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-2.5 py-2 text-left"
      >
        <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center shrink-0", statusColor.bg)}>
          <Package className={cn("w-3.5 h-3.5", statusColor.text)} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground truncate">
            {delivery.product || 'No product'}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            {delivery.supplier && (
              <span className="text-[10px] text-muted-foreground truncate">{delivery.supplier}</span>
            )}
            {delivery.driver && (
              <span className="text-[10px] text-primary/70 truncate flex items-center gap-0.5">
                <User className="w-2.5 h-2.5 shrink-0" />
                {delivery.driver}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          {delivery.amount != null && (
            <span className="text-xs font-bold text-foreground">Rs {Number(delivery.amount).toLocaleString()}</span>
          )}
          <Badge className={cn("text-[8px] py-0 px-1.5 border-0", statusColor.bg, statusColor.text)}>
            {delivery.status || 'pending'}
          </Badge>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2.5 border-t border-border pt-2.5">
          <div className="grid grid-cols-2 gap-2">
            {delivery.supplier && (
              <div>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Supplier</p>
                <p className="text-xs font-medium text-foreground">{delivery.supplier}</p>
              </div>
            )}
            {delivery.qty && delivery.qty > 0 && (
              <div>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Qty</p>
                <p className="text-xs font-medium text-foreground">{delivery.qty}</p>
              </div>
            )}
            {delivery.phone && (
              <div>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Phone</p>
                <a href={`tel:${delivery.phone}`} className="text-xs font-medium text-primary flex items-center gap-1">
                  <Phone className="w-3 h-3" />
                  {delivery.phone}
                </a>
              </div>
            )}
            {riderName && (
              <div>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Driver</p>
                <p className="text-xs font-medium text-foreground flex items-center gap-1">
                  <User className="w-3 h-3 text-primary" />
                  {riderName}
                </p>
              </div>
            )}
          </div>

          {/* Assign rider */}
          <div>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">Assign Rider</p>
            <div className="flex flex-wrap gap-1">
              {riders.map(r => (
                <button
                  key={r.id}
                  onClick={async () => {
                    setAssigning(true)
                    await onAssign(r.id)
                    setAssigning(false)
                  }}
                  disabled={assigning}
                  className={cn(
                    "px-2 py-1 rounded-md text-[10px] font-medium border transition-all",
                    delivery.rider_id === r.id
                      ? "bg-primary/15 text-primary border-primary/30"
                      : "bg-card text-muted-foreground border-border hover:border-primary/30"
                  )}
                >
                  {r.name}
                </button>
              ))}
            </div>
          </div>

          {/* Status change */}
          <div>
            <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">Status</p>
            <div className="flex flex-wrap gap-1">
              {['pending', 'assigned', 'delivered', 'cancelled', 'returned'].map(s => {
                const c = STATUS_COLORS[s]
                return (
                  <button
                    key={s}
                    onClick={() => onStatusChange(s)}
                    className={cn(
                      "px-2 py-1 rounded-md text-[10px] font-medium border transition-all",
                      delivery.status === s
                        ? cn(c.bg, c.text, "border-transparent")
                        : "bg-card text-muted-foreground border-border hover:border-primary/30"
                    )}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
