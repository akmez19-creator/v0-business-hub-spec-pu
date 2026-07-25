'use client'

import { useEffect } from 'react'
import { DollarSign, TrendingUp, Megaphone, X, RefreshCw, AlertCircle, Users, Bike } from 'lucide-react'

// Minimal structural shape of a campaign needed for the TV view.
export interface TvCampaign {
  id: string
  name: string
  status: string
  spend: string
  accountName?: string
}

// A product group enriched with client count + cost-per-client (in Rs).
export interface TvGroup {
  key: string
  productName: string
  productPrice?: number
  totalSpend: number // USD
  isUnlinked: boolean
  clients: number
  cac: number | null // Rs per client (null when not computable)
  campaigns: TvCampaign[]
}

// A rider with the regions already allocated to them.
export interface TvRider {
  id: string
  name: string
  regions: string[]
}

interface TvDashboardProps {
  groups: TvGroup[]
  campaignCount: number
  totalSpend: number
  activeCampaigns: number
  campaignsWithSpendCount: number
  totalBalanceOwed: number
  riders: TvRider[]
  showTodayOnly: boolean
  countdown: number
  lastRefresh: Date
  formatSpend: (amount: string) => string
  formatUsd: (amount: string) => string
  formatCountdown: (seconds: number) => string
  formatLastRefresh: (date: Date) => string
  onRefresh: () => void
  refreshing: boolean
  onExit: () => void
}

// Cost-per-client efficiency zones (Rs). Green 0-50, Yellow 51-75, Red above 75.
type Zone = 'green' | 'yellow' | 'red' | 'none'
const GREEN_MAX = 50
const YELLOW_MAX = 75

function zoneFor(cac: number | null): Zone {
  if (cac === null) return 'none'
  if (cac <= GREEN_MAX) return 'green'
  if (cac <= YELLOW_MAX) return 'yellow'
  return 'red'
}

// Tailwind class bundles per zone (tint, text, dot).
const ZONE_STYLES: Record<Zone, { bg: string; text: string; dot: string; label: string }> = {
  green: { bg: 'bg-emerald-500/10', text: 'text-emerald-500', dot: 'bg-emerald-500', label: 'Good' },
  yellow: { bg: 'bg-amber-500/10', text: 'text-amber-500', dot: 'bg-amber-500', label: 'Watch' },
  red: { bg: 'bg-red-500/10', text: 'text-red-500', dot: 'bg-red-500', label: 'High' },
  none: { bg: 'bg-muted', text: 'text-muted-foreground', dot: 'bg-gray-500', label: 'No data' },
}

const formatRs = (rs: number) => `Rs ${rs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`

// Shared dense grid template used by both the header and every row.
const ROW_GRID = 'grid grid-cols-[1.6rem_1fr_4.5rem_2.6rem_4.5rem] items-center gap-1.5'

// Row density presets. The tallest zone column decides the density so the whole
// league fits on the TV screen with NO scrolling.
const DENSITY = {
  normal: { row: 'px-2 py-1.5', name: 'text-base', num: 'text-base', cac: 'text-lg', bar: 'h-5' },
  compact: { row: 'px-2 py-1', name: 'text-sm', num: 'text-sm', cac: 'text-base', bar: 'h-4' },
  tight: { row: 'px-2 py-0.5', name: 'text-xs', num: 'text-xs', cac: 'text-sm', bar: 'h-3.5' },
} as const

export function TvDashboard({
  groups,
  campaignCount,
  totalSpend,
  activeCampaigns,
  campaignsWithSpendCount,
  totalBalanceOwed,
  riders,
  showTodayOnly,
  countdown,
  lastRefresh,
  formatSpend,
  formatUsd,
  formatCountdown,
  formatLastRefresh,
  onRefresh,
  refreshing,
  onExit,
}: TvDashboardProps) {
  // Within each zone, rank by cost-per-client (best/lowest first) like a league.
  const byCac = (a: TvGroup, b: TvGroup) => {
    if (a.cac === null && b.cac === null) return b.totalSpend - a.totalSpend
    if (a.cac === null) return 1
    if (b.cac === null) return -1
    return a.cac - b.cac
  }
  const green = groups.filter((g) => zoneFor(g.cac) === 'green').sort(byCac)
  const yellow = groups.filter((g) => zoneFor(g.cac) === 'yellow').sort(byCac)
  const red = groups.filter((g) => zoneFor(g.cac) === 'red').sort(byCac)

  // Zone tallies for the legend/summary bar
  const counts = groups.reduce(
    (acc, g) => {
      acc[zoneFor(g.cac)]++
      return acc
    },
    { green: 0, yellow: 0, red: 0, none: 0 } as Record<Zone, number>,
  )

  // Total clients across every product - the headline the team watches.
  const totalClients = groups.reduce((sum, g) => sum + g.clients, 0)

  // Pick a density so the tallest column fits on screen without scrolling.
  const maxRows = Math.max(green.length, yellow.length, red.length, 1)
  const density = maxRows <= 14 ? DENSITY.normal : maxRows <= 24 ? DENSITY.compact : DENSITY.tight
  const isTight = density === DENSITY.tight

  // Exit on Escape for convenience
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExit])

  const renderRow = (g: TvGroup, rank: number, striped: boolean) => {
    const zone = zoneFor(g.cac)
    const zs = ZONE_STYLES[zone]
    return (
      <div
        key={g.key}
        className={`${ROW_GRID} border-b border-border/50 ${density.row} ${striped ? 'bg-card/40' : ''}`}
      >
        {/* Rank + zone-colored accent bar */}
        <div className="flex items-center gap-1.5">
          <span className={`${density.bar} w-1 rounded-full ${zs.dot}`} />
          <span className={`${density.num} font-bold tabular-nums text-muted-foreground`}>{rank}</span>
        </div>

        {/* Product name */}
        <span className={`truncate ${density.name} font-semibold`} title={g.productName}>
          {g.productName}
        </span>

        {/* Spend */}
        <span className={`text-right ${density.num} font-bold tabular-nums text-amber-500`}>
          {formatSpend(g.totalSpend.toString())}
        </span>

        {/* Clients */}
        <span className={`text-right ${density.num} font-bold tabular-nums`}>{g.clients.toLocaleString()}</span>

        {/* Cost per client - the league metric, colored by zone */}
        <span className={`text-right ${density.cac} font-bold tabular-nums ${zs.text}`}>
          {g.cac !== null ? formatRs(g.cac) : '—'}
        </span>
      </div>
    )
  }

  // One self-contained standings table per zone (green / yellow / red).
  const zoneTable = (zone: Exclude<Zone, 'none'>, title: string, rows: TvGroup[]) => {
    const zs = ZONE_STYLES[zone]
    const zoneClients = rows.reduce((s, g) => s + g.clients, 0)
    return (
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border">
        {/* Zone title bar with zone client total */}
        <div className={`flex shrink-0 items-center justify-between gap-2 px-2.5 ${isTight ? 'py-1' : 'py-1.5'} ${zs.bg}`}>
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${zs.dot}`} />
            <span className={`${isTight ? 'text-sm' : 'text-base'} font-bold ${zs.text}`}>{title}</span>
            <span className={`${isTight ? 'text-xs' : 'text-sm'} font-semibold tabular-nums text-muted-foreground`}>{rows.length}</span>
          </div>
          <span className={`flex items-center gap-1 ${isTight ? 'text-xs' : 'text-sm'} font-bold tabular-nums ${zs.text}`}>
            <Users className="h-3.5 w-3.5" />
            {zoneClients.toLocaleString()}
          </span>
        </div>
        {/* Column labels */}
        <div className={`${ROW_GRID} shrink-0 border-y border-border bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground`}>
          <span className="text-center">#</span>
          <span>Product</span>
          <span className="text-right">Spend</span>
          <span className="text-right">Cl</span>
          <span className="text-right">Cost/Cl</span>
        </div>
        {/* Rows - density is chosen so these never need to scroll */}
        <div className="min-h-0 overflow-hidden">
          {rows.length === 0 ? (
            <div className="px-3 py-3 text-center text-sm text-muted-foreground">None</div>
          ) : (
            rows.map((g, i) => renderRow(g, i + 1, i % 2 === 1))
          )}
        </div>
      </div>
    )
  }

  // Riders panel: every rider with the regions already allocated to them.
  const ridersPanel = (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border">
      <div className={`flex shrink-0 items-center justify-between gap-2 bg-blue-500/10 px-2.5 ${isTight ? 'py-1' : 'py-1.5'}`}>
        <div className="flex items-center gap-2">
          <Bike className="h-4 w-4 text-blue-400" />
          <span className={`${isTight ? 'text-sm' : 'text-base'} font-bold text-blue-400`}>Riders &amp; Regions</span>
        </div>
        <span className={`${isTight ? 'text-xs' : 'text-sm'} font-bold tabular-nums text-blue-400`}>{riders.length}</span>
      </div>
      <div className="grid shrink-0 grid-cols-[7rem_1fr] items-center gap-1.5 border-y border-border bg-card px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Rider</span>
        <span>Allocated regions</span>
      </div>
      <div className="min-h-0 overflow-hidden">
        {riders.length === 0 ? (
          <div className="px-3 py-3 text-center text-sm text-muted-foreground">No riders</div>
        ) : (
          riders.map((r, i) => (
            <div
              key={r.id}
              className={`grid grid-cols-[7rem_1fr] items-start gap-1.5 border-b border-border/50 px-2 ${density.row} ${i % 2 === 1 ? 'bg-card/40' : ''}`}
            >
              <span className={`truncate ${density.name} font-semibold`} title={r.name}>
                {r.name}
              </span>
              <span className={`${isTight ? 'text-xs' : 'text-sm'} leading-snug text-muted-foreground`}>
                {r.regions.length > 0 ? r.regions.join(', ') : <span className="italic text-muted-foreground/60">None yet</span>}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background px-6 py-4 text-foreground">
      {/* Header: title + compact inline KPIs + controls, all on one band */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold tracking-tight">Ads Manager</h1>
          <span className="text-sm text-muted-foreground">
            {groups.length} products · {campaignCount} campaigns
          </span>
        </div>

        {/* Inline KPI strip */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-1.5">
            <DollarSign className="h-4 w-4 text-amber-500" />
            <div className="leading-tight">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Total Spend</p>
              <p className="text-lg font-bold tabular-nums">{formatSpend(totalSpend.toString())}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-violet-500/20 bg-violet-500/10 px-3 py-1.5">
            <Users className="h-4 w-4 text-violet-400" />
            <div className="leading-tight">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Total Clients</p>
              <p className="text-lg font-bold tabular-nums text-violet-400">{totalClients.toLocaleString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5">
            <TrendingUp className="h-4 w-4 text-emerald-500" />
            <div className="leading-tight">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Active</p>
              <p className="text-lg font-bold tabular-nums">{activeCampaigns}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-1.5">
            <Megaphone className="h-4 w-4 text-blue-500" />
            <div className="leading-tight">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{showTodayOnly ? 'With Spend' : 'Total'}</p>
              <p className="text-lg font-bold tabular-nums">{campaignsWithSpendCount}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-1.5">
            <AlertCircle className="h-4 w-4 text-red-500" />
            <div className="leading-tight">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Total Due</p>
              <p className="text-lg font-bold tabular-nums text-red-500">{formatSpend(totalBalanceOwed.toString())}</p>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          <div className="text-right leading-tight">
            <div className="font-mono text-lg text-primary tabular-nums">{formatCountdown(countdown)}</div>
            <div className="text-[10px] text-muted-foreground">Last: {formatLastRefresh(lastRefresh)}</div>
          </div>
          <button
            onClick={onRefresh}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-muted"
            aria-label="Refresh"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={onExit}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
            aria-label="Exit TV mode"
          >
            <X className="h-4 w-4" />
            Exit
          </button>
        </div>
      </div>

      {/* Cost-per-client zone legend */}
      <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Cost / client</span>
        <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-emerald-500">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          <span className="text-sm font-semibold">Rs 0–50 · {counts.green}</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-amber-500">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
          <span className="text-sm font-semibold">Rs 51–75 · {counts.yellow}</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-red-500">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
          <span className="text-sm font-semibold">Above Rs 75 · {counts.red}</span>
        </div>
      </div>

      {/* Zone standings (green / yellow / red) + riders panel. Row density is
          adaptive so the full league fits on screen with no scrolling. */}
      <div className="mt-2 min-h-0 flex-1 overflow-hidden">
        {groups.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xl text-muted-foreground">
            No products to display
          </div>
        ) : (
          <div className="grid h-full grid-cols-1 items-start gap-3 lg:grid-cols-[1fr_1fr_1fr_0.9fr]">
            {zoneTable('green', 'Rs 0–50', green)}
            {zoneTable('yellow', 'Rs 51–75', yellow)}
            {zoneTable('red', 'Above Rs 75', red)}
            {ridersPanel}
          </div>
        )}
      </div>
    </div>
  )
}
