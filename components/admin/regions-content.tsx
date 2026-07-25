'use client'

import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import {
  MapPin,
  Search,
  ChevronDown,
  ChevronRight,
  Globe,
  Route,
  Building2,
  Hash,
  Filter,
  UserCheck,
  Bike,
  Pencil,
} from 'lucide-react'
import { getRegionImage } from '@/components/ui/region-avatar'
import { zoneForLocality, ZONE_ORDER } from '@/lib/ads-region-zones'

interface Locality {
  id: string
  name: string
  region: string
  district: string
  route_code: string
  is_active: boolean
  contractor_id: string | null
  contractor_name: string | null
  default_rider_id: string | null
  rider_name: string | null
}

interface PersonOption {
  id: string
  name: string
  contractor_id?: string
}

interface AdminRegionsContentProps {
  localities: Locality[]
  contractors: PersonOption[]
  riders: PersonOption[]
  canEdit: boolean
}

export function AdminRegionsContent({ localities: initialLocalities, contractors, riders, canEdit }: AdminRegionsContentProps) {
  const [localities, setLocalities] = useState<Locality[]>(initialLocalities)
  const [search, setSearch] = useState('')
  const [filterRegion, setFilterRegion] = useState<string>('all')
  const [filterDistrict, setFilterDistrict] = useState<string>('all')
  const [filterGroup, setFilterGroup] = useState<string>('all')
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'table' | 'grouped' | 'groups'>('groups')
  // Assignment editing
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContractor, setEditContractor] = useState<string>('')
  const [editRider, setEditRider] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [bulkRegion, setBulkRegion] = useState<string | null>(null)
  // Group (zone) level bulk assignment
  const [bulkZone, setBulkZone] = useState<string | null>(null)

  // Delivery GROUP (zone) for a locality, e.g. 'PORT LOUIS', 'EAST - 1'
  const zoneOf = (l: Locality) => zoneForLocality(l.name) ?? 'UNGROUPED'

  const contractorName = (id: string | null) => contractors.find(c => c.id === id)?.name || null
  const riderName = (id: string | null) => riders.find(r => r.id === id)?.name || null

  const startEdit = (l: Locality) => {
    setEditingId(l.id)
    setBulkRegion(null)
    setEditContractor(l.contractor_id || '')
    setEditRider(l.default_rider_id || '')
  }

  const applyLocal = (ids: string[], contractorId: string | null, riderId: string | null) => {
    setLocalities(prev => prev.map(l => ids.includes(l.id)
      ? {
          ...l,
          contractor_id: contractorId,
          contractor_name: contractorName(contractorId),
          default_rider_id: riderId,
          rider_name: riderName(riderId),
        }
      : l))
  }

  const saveAssignment = async (target: { localityId?: string; routeCode?: string; localityIds?: string[] }) => {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/localities', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...target,
          contractorId: editContractor || null,
          riderId: editRider || null,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed')
      const contractorId = editContractor || null
      const riderId = contractorId ? (editRider || null) : null
      if (target.localityId) {
        applyLocal([target.localityId], contractorId, riderId)
      } else if (target.routeCode) {
        applyLocal(localities.filter(l => l.route_code === target.routeCode).map(l => l.id), contractorId, riderId)
      } else if (target.localityIds) {
        applyLocal(target.localityIds, contractorId, riderId)
      }
      setEditingId(null)
      setBulkRegion(null)
      setBulkZone(null)
    } catch {
      // keep the editor open so the admin can retry
    } finally {
      setSaving(false)
    }
  }

  // Riders filtered by the selected contractor
  const ridersForContractor = useMemo(
    () => riders.filter(r => r.contractor_id === editContractor),
    [riders, editContractor]
  )

  const renderAssignmentEditor = (onSave: () => void, onCancel: () => void) => (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={editContractor}
        onChange={e => { setEditContractor(e.target.value); setEditRider('') }}
        className="text-[11px] border border-border/60 rounded-md px-1.5 py-1 bg-card text-foreground max-w-[130px]"
      >
        <option value="">No contractor</option>
        {contractors.map(c => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <select
        value={editRider}
        onChange={e => setEditRider(e.target.value)}
        disabled={!editContractor}
        className="text-[11px] border border-border/60 rounded-md px-1.5 py-1 bg-card text-foreground max-w-[120px] disabled:opacity-50"
      >
        <option value="">Any rider</option>
        {ridersForContractor.map(r => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </select>
      <button
        onClick={onSave}
        disabled={saving}
        className="text-[10px] font-semibold px-2 py-1 rounded-md bg-primary text-primary-foreground disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save'}
      </button>
      <button
        onClick={onCancel}
        disabled={saving}
        className="text-[10px] font-medium px-2 py-1 rounded-md border border-border/60 text-muted-foreground"
      >
        Cancel
      </button>
    </div>
  )

  const renderAssignmentBadge = (l: Locality) => (
    l.contractor_name ? (
      <div className="flex flex-col">
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground">
          <UserCheck className="w-3 h-3 text-emerald-500 shrink-0" />
          {l.contractor_name}
        </span>
        {l.rider_name && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground pl-4">
            <Bike className="w-2.5 h-2.5 shrink-0" />
            {l.rider_name}
          </span>
        )}
      </div>
    ) : (
      <span className="text-[10px] text-amber-600 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full font-medium">
        Unassigned
      </span>
    )
  )

  // Unique regions and districts for filters
  const uniqueRegions = useMemo(() =>
    [...new Set(localities.map(l => l.region))].sort(),
    [localities]
  )
  const uniqueDistricts = useMemo(() =>
    [...new Set(localities.map(l => l.district))].sort(),
    [localities]
  )

  // Region colors
  const regionColorMap: Record<string, string> = {
    'EAST - 1': 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    'EAST - 2': 'bg-sky-500/10 text-sky-600 border-sky-500/20',
    'EAST - 3': 'bg-cyan-500/10 text-cyan-600 border-cyan-500/20',
    'PORT LOUIS': 'bg-red-500/10 text-red-600 border-red-500/20',
    'ALBION': 'bg-orange-500/10 text-orange-600 border-orange-500/20',
    'CUREPIPE': 'bg-purple-500/10 text-purple-600 border-purple-500/20',
    'PW': 'bg-pink-500/10 text-pink-600 border-pink-500/20',
    'VACOAS': 'bg-green-500/10 text-green-600 border-green-500/20',
    'WEST': 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    'TRIOLET': 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20',
    'GOODLANDS': 'bg-teal-500/10 text-teal-600 border-teal-500/20',
    'REMPART': 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    'SOUTH': 'bg-rose-500/10 text-rose-600 border-rose-500/20',
  }

  // Filter localities
  const filtered = useMemo(() => {
    return localities.filter(l => {
      const matchSearch = search === '' ||
        l.name.toLowerCase().includes(search.toLowerCase()) ||
        l.region.toLowerCase().includes(search.toLowerCase()) ||
        l.district.toLowerCase().includes(search.toLowerCase()) ||
        l.route_code.toLowerCase().includes(search.toLowerCase())
      const matchRegion = filterRegion === 'all' || l.region === filterRegion
      const matchDistrict = filterDistrict === 'all' || l.district === filterDistrict
      const matchGroup = filterGroup === 'all' || zoneOf(l) === filterGroup
      return matchSearch && matchRegion && matchDistrict && matchGroup
    })
  }, [localities, search, filterRegion, filterDistrict, filterGroup])

  // Group (zone) -> localities, ordered operationally (ZONE_ORDER first)
  const zoneGroups = useMemo(() => {
    const groups: Record<string, Locality[]> = {}
    for (const l of filtered) {
      const z = zoneOf(l)
      if (!groups[z]) groups[z] = []
      groups[z].push(l)
    }
    const order = [...ZONE_ORDER, 'UNGROUPED']
    return Object.entries(groups).sort(
      ([a], [b]) => (order.indexOf(a) === -1 ? 999 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 999 : order.indexOf(b)),
    )
  }, [filtered])

  // Group by region
  const grouped = useMemo(() => {
    const groups: Record<string, Locality[]> = {}
    for (const l of filtered) {
      if (!groups[l.region]) groups[l.region] = []
      groups[l.region].push(l)
    }
    return groups
  }, [filtered])

  function toggleRegion(region: string) {
    setExpandedRegions(prev => {
      const next = new Set(prev)
      if (next.has(region)) next.delete(region)
      else next.add(region)
      return next
    })
  }

  function toggleAllRegions() {
    if (expandedRegions.size === Object.keys(grouped).length) {
      setExpandedRegions(new Set())
    } else {
      setExpandedRegions(new Set(Object.keys(grouped)))
    }
  }

  return (
    <div className="space-y-4 pb-24">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-foreground">Regions & Localities</h2>
        <p className="text-muted-foreground text-xs mt-0.5">
          {localities.length} localities across {uniqueRegions.length} delivery regions
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-lg border border-border/60 bg-card px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
            <Globe className="w-3.5 h-3.5" />
            <span className="text-[10px] font-medium">Regions</span>
          </div>
          <p className="text-lg font-bold text-foreground">{uniqueRegions.length}</p>
        </div>
        <div className="rounded-lg border border-border/60 bg-card px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
            <MapPin className="w-3.5 h-3.5" />
            <span className="text-[10px] font-medium">Localities</span>
          </div>
          <p className="text-lg font-bold text-foreground">{filtered.length}</p>
        </div>
        <div className="rounded-lg border border-border/60 bg-card px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
            <Building2 className="w-3.5 h-3.5" />
            <span className="text-[10px] font-medium">Districts</span>
          </div>
          <p className="text-lg font-bold text-foreground">{uniqueDistricts.length}</p>
        </div>
        <div className="rounded-lg border border-border/60 bg-card px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
            <UserCheck className="w-3.5 h-3.5" />
            <span className="text-[10px] font-medium">Assigned</span>
          </div>
          <p className="text-lg font-bold text-foreground">
            {localities.filter(l => l.contractor_id).length}
            <span className="text-[10px] font-normal text-muted-foreground ml-1">/ {localities.length}</span>
          </p>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search locality, district, route..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 text-sm"
          />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Filter className="w-3 h-3 text-muted-foreground" />
          </div>
          <select
            value={filterRegion}
            onChange={e => setFilterRegion(e.target.value)}
            className="text-xs border border-border/60 rounded-lg px-2.5 py-1.5 bg-card text-foreground"
          >
            <option value="all">All Regions</option>
            {uniqueRegions.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <select
            value={filterDistrict}
            onChange={e => setFilterDistrict(e.target.value)}
            className="text-xs border border-border/60 rounded-lg px-2.5 py-1.5 bg-card text-foreground"
          >
            <option value="all">All Districts</option>
            {uniqueDistricts.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select
            value={filterGroup}
            onChange={e => setFilterGroup(e.target.value)}
            className="text-xs border border-border/60 rounded-lg px-2.5 py-1.5 bg-card text-foreground"
          >
            <option value="all">All Groups</option>
            {ZONE_ORDER.map(z => (
              <option key={z} value={z}>{z}</option>
            ))}
            <option value="UNGROUPED">Ungrouped</option>
          </select>
          <div className="flex items-center gap-0.5 ml-auto border border-border/60 rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('groups')}
              className={cn(
                "px-2.5 py-1.5 text-[10px] font-medium transition-colors",
                viewMode === 'groups' ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/50"
              )}
            >
              Groups
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={cn(
                "px-2.5 py-1.5 text-[10px] font-medium transition-colors",
                viewMode === 'table' ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/50"
              )}
            >
              Table
            </button>
            <button
              onClick={() => setViewMode('grouped')}
              className={cn(
                "px-2.5 py-1.5 text-[10px] font-medium transition-colors",
                viewMode === 'grouped' ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/50"
              )}
            >
              Regions
            </button>
          </div>
        </div>
      </div>

      {/* Table View */}
      {viewMode === 'table' && (
        <div className="rounded-xl border border-border/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border/60">
                  <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    <div className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      Locality
                    </div>
                  </th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    <div className="flex items-center gap-1">
                      <Hash className="w-3 h-3" />
                      Group
                    </div>
                  </th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    <div className="flex items-center gap-1">
                      <Globe className="w-3 h-3" />
                      Region
                    </div>
                  </th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">
                    <div className="flex items-center gap-1">
                      <Building2 className="w-3 h-3" />
                      District
                    </div>
                  </th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    <div className="flex items-center gap-1">
                      <Route className="w-3 h-3" />
                      Route
                    </div>
                  </th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    <div className="flex items-center gap-1">
                      <UserCheck className="w-3 h-3" />
                      Delivery
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l, i) => (
                  <tr
                    key={l.id}
                    className={cn(
                      "border-b border-border/30 hover:bg-muted/20 transition-colors",
                      i % 2 === 0 ? "bg-card" : "bg-card/50"
                    )}
                  >
                    <td className="px-3 py-2">
                      <span className="text-xs font-medium text-foreground">{l.name}</span>
                    </td>
                    <td className="px-3 py-2">
                      {zoneOf(l) !== 'UNGROUPED' ? (
                        <span className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border",
                          regionColorMap[zoneOf(l)] || 'bg-muted text-muted-foreground border-border/40'
                        )}>
                          {zoneOf(l)}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/60">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn(
                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border",
                        regionColorMap[l.region] || 'bg-muted text-muted-foreground border-border/40'
                      )}>
                        {l.region}
                      </span>
                    </td>
                    <td className="px-3 py-2 hidden sm:table-cell">
                      <span className="text-xs text-muted-foreground">{l.district}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-xs font-mono text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                        {l.route_code}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {editingId === l.id ? (
                        renderAssignmentEditor(
                          () => saveAssignment({ localityId: l.id }),
                          () => setEditingId(null)
                        )
                      ) : (
                        <div className="flex items-center gap-2">
                          {renderAssignmentBadge(l)}
                          {canEdit && (
                            <button
                              onClick={() => startEdit(l)}
                              className="text-muted-foreground/50 hover:text-primary transition-colors"
                              title="Edit assignment"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-xs">
              No localities match your search.
            </div>
          )}
        </div>
      )}

      {/* Groups View: delivery zones with one-click whole-zone assignment.
          Riders opt for a zone, so this is the fastest way to assign them. */}
      {viewMode === 'groups' && (
        <div className="space-y-2">
          {zoneGroups.map(([zone, locs]) => {
            const assigned = locs.filter(l => l.contractor_id).length
            // Who currently covers this zone (unique contractor/rider pairs)
            const coverage = [...new Set(locs.filter(l => l.contractor_name).map(l => `${l.contractor_name}${l.rider_name ? ` / ${l.rider_name}` : ''}`))]
            const fullyCovered = assigned === locs.length && coverage.length === 1
            return (
              <div key={zone} className="rounded-xl border border-border/60 overflow-hidden">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 bg-muted/30">
                  <span className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border",
                    regionColorMap[zone] || 'bg-muted text-muted-foreground border-border/40'
                  )}>
                    {zone === 'UNGROUPED' ? 'Ungrouped' : zone}
                  </span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {locs.length} localities
                  </span>
                  <span className={cn(
                    "text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-full border",
                    assigned === locs.length
                      ? 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20'
                      : assigned === 0
                        ? 'text-amber-600 bg-amber-500/10 border-amber-500/20'
                        : 'text-blue-600 bg-blue-500/10 border-blue-500/20'
                  )}>
                    {assigned}/{locs.length} assigned
                  </span>
                  {/* Current coverage summary */}
                  {coverage.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground truncate max-w-[280px]" title={coverage.join(', ')}>
                      <Bike className="w-3 h-3 shrink-0" />
                      {fullyCovered ? coverage[0] : `${coverage.length} different assignments`}
                    </span>
                  )}
                  <div className="ml-auto">
                    {bulkZone === zone ? (
                      renderAssignmentEditor(
                        () => saveAssignment({ localityIds: locs.map(l => l.id) }),
                        () => setBulkZone(null)
                      )
                    ) : (
                      canEdit && (
                        <button
                          onClick={() => {
                            setBulkZone(zone)
                            setEditingId(null)
                            setBulkRegion(null)
                            // Pre-fill with the zone's current single assignment if any
                            const first = locs.find(l => l.contractor_id)
                            setEditContractor(fullyCovered && first ? first.contractor_id || '' : '')
                            setEditRider(fullyCovered && first ? first.default_rider_id || '' : '')
                          }}
                          className="text-[10px] font-semibold px-2.5 py-1 rounded-md bg-primary text-primary-foreground"
                        >
                          Assign whole group
                        </button>
                      )
                    )}
                  </div>
                </div>
                {/* Compact locality chips: name + rider initial state at a glance */}
                <div className="flex flex-wrap gap-1 px-3 py-2 bg-card">
                  {locs.map(l => (
                    <button
                      key={l.id}
                      onClick={() => canEdit && startEdit(l)}
                      title={l.contractor_name ? `${l.name}: ${l.contractor_name}${l.rider_name ? ` / ${l.rider_name}` : ''}` : `${l.name}: unassigned`}
                      className={cn(
                        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] transition-colors",
                        l.contractor_id
                          ? 'border-emerald-500/25 bg-emerald-500/5 text-foreground'
                          : 'border-amber-500/30 bg-amber-500/10 text-amber-600',
                        canEdit && 'hover:border-primary/50'
                      )}
                    >
                      {l.name}
                      {l.rider_name && <span className="text-muted-foreground">· {l.rider_name}</span>}
                    </button>
                  ))}
                </div>
                {/* Inline single-locality editor inside the group */}
                {editingId && locs.some(l => l.id === editingId) && (
                  <div className="px-3 py-2 border-t border-border/40 bg-muted/20">
                    <p className="text-[10px] text-muted-foreground mb-1">
                      Editing: <span className="font-semibold text-foreground">{locs.find(l => l.id === editingId)?.name}</span>
                    </p>
                    {renderAssignmentEditor(
                      () => saveAssignment({ localityId: editingId }),
                      () => setEditingId(null)
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {zoneGroups.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-xs">
              No localities match your search.
            </div>
          )}
        </div>
      )}

      {/* Grouped View */}
      {viewMode === 'grouped' && (
        <div className="space-y-2">
          <button
            onClick={toggleAllRegions}
            className="text-[10px] font-medium text-primary hover:underline"
          >
            {expandedRegions.size === Object.keys(grouped).length ? 'Collapse All' : 'Expand All'}
          </button>
          {Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([region, locs]) => (
            <div key={region} className="rounded-xl border border-border/60 overflow-hidden">
              {/* Region header */}
              <button
                onClick={() => toggleRegion(region)}
                className="w-full flex items-center gap-3 px-3 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                {expandedRegions.has(region) ? (
                  <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                )}
                {/* Region image */}
                <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0 border border-border/40">
                  {getRegionImage(region) ? (
                    <img src={getRegionImage(region)!} alt={region} className="w-full h-full object-cover" />
                  ) : (
                    <div className={cn(
                      "w-full h-full flex items-center justify-center text-[10px] font-bold",
                      regionColorMap[region] || 'bg-muted text-muted-foreground'
                    )}>
                      {region.slice(0, 2)}
                    </div>
                  )}
                </div>
                <div className="flex-1 text-left">
                  <span className={cn(
                    "inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border",
                    regionColorMap[region] || 'bg-muted text-muted-foreground border-border/40'
                  )}>
                    {region}
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground font-medium">
                  {locs.length} {locs.length === 1 ? 'locality' : 'localities'}
                </span>
              </button>

              {/* Localities list */}
              {expandedRegions.has(region) && (
                <div className="divide-y divide-border/30">
                  {canEdit && (
                    <div className="px-3 py-2 bg-muted/20 flex flex-wrap items-center gap-2">
                      {bulkRegion === region ? (
                        renderAssignmentEditor(
                          () => saveAssignment({ routeCode: region }),
                          () => setBulkRegion(null)
                        )
                      ) : (
                        <button
                          onClick={() => { setBulkRegion(region); setEditingId(null); setEditContractor(''); setEditRider('') }}
                          className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline"
                        >
                          <UserCheck className="w-3 h-3" />
                          Assign entire region to a contractor
                        </button>
                      )}
                    </div>
                  )}
                  {locs.map((l, i) => (
                    <div
                      key={l.id}
                      className={cn(
                        "flex items-center gap-3 px-3 py-1.5",
                        i % 2 === 0 ? "bg-card" : "bg-card/50"
                      )}
                    >
                      <Hash className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                      <span className="text-xs font-medium text-foreground flex-1 min-w-0 truncate">{l.name}</span>
                      {editingId === l.id ? (
                        renderAssignmentEditor(
                          () => saveAssignment({ localityId: l.id }),
                          () => setEditingId(null)
                        )
                      ) : (
                        <div className="flex items-center gap-1.5 shrink-0">
                          {renderAssignmentBadge(l)}
                          {canEdit && (
                            <button
                              onClick={() => startEdit(l)}
                              className="text-muted-foreground/50 hover:text-primary transition-colors"
                              title="Edit assignment"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )}
                      <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded shrink-0 hidden sm:block">
                        {l.route_code}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
