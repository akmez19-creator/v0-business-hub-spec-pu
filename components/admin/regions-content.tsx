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
} from 'lucide-react'
import { getRegionImage } from '@/components/ui/region-avatar'

interface Locality {
  id: string
  name: string
  region: string
  district: string
  route_code: string
  is_active: boolean
}

interface AdminRegionsContentProps {
  localities: Locality[]
}

export function AdminRegionsContent({ localities }: AdminRegionsContentProps) {
  const [search, setSearch] = useState('')
  const [filterRegion, setFilterRegion] = useState<string>('all')
  const [filterDistrict, setFilterDistrict] = useState<string>('all')
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'table' | 'grouped'>('table')

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
      return matchSearch && matchRegion && matchDistrict
    })
  }, [localities, search, filterRegion, filterDistrict])

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
      <div className="grid grid-cols-3 gap-2">
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
          <div className="flex items-center gap-0.5 ml-auto border border-border/60 rounded-lg overflow-hidden">
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
              Grouped
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
                      <span className="text-[10px] text-muted-foreground hidden sm:block">{l.district}</span>
                      <span className="text-[10px] font-mono text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded shrink-0">
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
