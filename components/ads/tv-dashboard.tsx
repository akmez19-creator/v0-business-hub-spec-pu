'use client'

import { useEffect } from 'react'
import { DollarSign, TrendingUp, Megaphone, X, RefreshCw, AlertCircle, Users, Bike, Gauge, History, Facebook } from 'lucide-react'
import { RECOMMENDATION_STYLES, VERDICT_STYLES, type Recommendation } from '@/lib/ads-recommendations'

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
  // Budget action recommendation (HOLD/INCREASE/WATCH/DECREASE), null = n/a
  recommendation?: Recommendation | null
  // Budget edit that happened TODAY (the action-taken signal), null = none
  todayEdit?: { direction: 'increase' | 'decrease'; summary: string } | null
}

// Page-level attribution: clients from each page + est. avg cost/client
export interface TvPageStat {
  page: string
  clients: number
  cac: number | null
}

// One normalized campaign edit from Facebook's Activities API
export interface TvActivity {
  eventTime: string
  actorName: string
  objectName: string
  objectId: string
  eventType: string
  changeSummary: string
  direction: 'increase' | 'decrease' | 'status' | 'other'
}

// A rider (or contractor fallback) with the regions allocated to them.
export interface TvRider {
  id: string
  name: string
  isContractor?: boolean
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
  pageStats?: TvPageStat[]
  activities?: TvActivity[]
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
const ZONE_STYLES: Record<Zone, { bg: string; text: string; dot: string }> = {
  green: { bg: 'bg-emerald-500/10', text: 'text-emerald-500', dot: 'bg-emerald-500' },
  yellow: { bg: 'bg-amber-500/10', text: 'text-amber-500', dot: 'bg-amber-500' },
  red: { bg: 'bg-red-500/10', text: 'text-red-500', dot: 'bg-red-500' },
  none: { bg: 'bg-muted', text: 'text-muted-foreground', dot: 'bg-gray-500' },
}

const formatRs = (rs: number) => `Rs ${rs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`

// Shared dense grid template used by both the header and every row.
// Last column: budget action badge (increase / decrease / hold).
const ROW_GRID = 'grid grid-cols-[1.9rem_1fr_4.5rem_2.6rem_4.5rem_1.6rem] items-center gap-1.5'

// Row density presets. The number of rows per column decides the density so
// the whole league fits on the TV screen with NO scrolling.
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
  pageStats = [],
  activities = [],
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
  // ONE continuous league ranked by cost-per-client (best first), flowing
  // across balanced columns with no per-zone gaps. Zone colors stay on each
  // row so green/yellow/red reads at a glance.
  const byCac = (a: TvGroup, b: TvGroup) => {
    if (a.cac === null && b.cac === null) return b.totalSpend - a.totalSpend
    if (a.cac === null) return 1
    if (b.cac === null) return -1
    return a.cac - b.cac
  }
  const ranked = [...groups].sort(byCac)

  // Zone tallies + per-zone client totals for the legend chips
  const zoneStats = groups.reduce(
    (acc, g) => {
      const z = zoneFor(g.cac)
      acc[z].count++
      acc[z].clients += g.clients
      return acc
    },
    {
      green: { count: 0, clients: 0 },
      yellow: { count: 0, clients: 0 },
      red: { count: 0, clients: 0 },
      none: { count: 0, clients: 0 },
    } as Record<Zone, { count: number; clients: number }>,
  )

  // Total clients across every product - the headline the team watches.
  const totalClients = groups.reduce((sum, g) => sum + g.clients, 0)

  // Average cost per client (Rs) across ALL products with clients: each cac is
  // Rs/client, so cac * clients recovers each product's Rs spend and the sum
  // over total clients is the true weighted average.
  const rsSpendWithClients = groups.reduce(
    (sum, g) => (g.cac !== null ? sum + g.cac * g.clients : sum),
    0,
  )
  const avgCac = totalClients > 0 ? rsSpendWithClients / totalClients : null
  // Health thresholds for the average: green below Rs 75, yellow Rs 76-99,
  // red at Rs 100 and above.
  const avgStyle =
    avgCac === null
      ? { border: 'border-border', bg: 'bg-muted', text: 'text-muted-foreground' }
      : avgCac <= 75
        ? { border: 'border-emerald-500/20', bg: 'bg-emerald-500/10', text: 'text-emerald-500' }
        : avgCac < 100
          ? { border: 'border-amber-500/20', bg: 'bg-amber-500/10', text: 'text-amber-500' }
          : { border: 'border-red-500/20', bg: 'bg-red-500/10', text: 'text-red-500' }

  // Split the single ranked list into 3 balanced columns (top-to-bottom, then
  // next column) so every column is full and nothing scrolls or leaves gaps.
  const COLS = 3
  const perCol = Math.ceil(ranked.length / COLS) || 1
  const columns: TvGroup[][] = Array.from({ length: COLS }, (_, i) =>
    ranked.slice(i * perCol, (i + 1) * perCol),
  )

  // Density adapts to rows per column, not the biggest zone.
  const density = perCol <= 14 ? DENSITY.normal : perCol <= 24 ? DENSITY.compact : DENSITY.tight
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
        {/* Global rank + zone-colored accent bar */}
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

        {/* Budget action: ↑ increase (scale), ↓ decrease (burning), ● hold (<4 days),
            ✓ edited (already taken care of - glyph tinted by whether results are
            improving: green better, amber no change, red still expensive).
            WATCH stays blank so only actionable rows draw the eye. */}
        <span className="flex items-center justify-center">
          {g.todayEdit ? (
            // Edited TODAY: the priority signal - pulsing arrow in the edit's
            // direction so the wall shows at a glance which ads got actioned.
            <span
              title={g.todayEdit.summary}
              className={`inline-flex h-4 w-4 animate-pulse items-center justify-center rounded text-[12px] font-bold leading-none ${
                g.todayEdit.direction === 'increase'
                  ? 'bg-emerald-500/25 text-emerald-400'
                  : 'bg-red-500/25 text-red-400'
              }`}
            >
              {g.todayEdit.direction === 'increase' ? '\u2191' : '\u2193'}
            </span>
          ) : (
            g.recommendation &&
            g.recommendation.action !== 'WATCH' &&
            (() => {
              const rec = g.recommendation
              const s = RECOMMENDATION_STYLES[rec.action]
              const tint =
                rec.action === 'EDITED' && rec.verdict ? VERDICT_STYLES[rec.verdict].text : s.text
              return (
                <span
                  title={rec.reason}
                  className={`inline-flex h-4 w-4 items-center justify-center rounded ${s.bg} ${tint} text-[11px] font-bold leading-none`}
                >
                  {s.arrow}
                </span>
              )
            })()
          )}
        </span>
      </div>
    )
  }

  // A league column: rank continues across columns (1-15, 16-30, ...).
  const leagueColumn = (rows: TvGroup[], colIndex: number) => (
    <div key={colIndex} className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border">
      {/* Column labels */}
      <div className={`${ROW_GRID} shrink-0 border-b border-border bg-card px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground`}>
        <span className="text-center">#</span>
        <span>Product</span>
        <span className="text-right">Spend</span>
        <span className="text-right">Cl</span>
        <span className="text-right">Cost/Cl</span>
        <span className="text-center" title="Budget action: increase / decrease / hold">Act</span>
      </div>
      <div className="min-h-0 overflow-hidden">
        {rows.map((g, i) => renderRow(g, colIndex * perCol + i + 1, i % 2 === 1))}
      </div>
    </div>
  )

  // Riders panel: regions allocated per rider (from the localities table).
  // Compact rows - count badge + region list clamped to a few lines so many
  // riders fit; unallocated riders are not shown here.
  const ridersPanel = (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border">
      <div className={`flex shrink-0 items-center justify-between gap-2 bg-blue-500/10 px-2.5 ${isTight ? 'py-1' : 'py-1.5'}`}>
        <div className="flex items-center gap-2">
          <Bike className="h-4 w-4 text-blue-400" />
          <span className={`${isTight ? 'text-sm' : 'text-base'} font-bold text-blue-400`}>Riders &amp; Regions</span>
        </div>
        <span className={`${isTight ? 'text-xs' : 'text-sm'} font-bold tabular-nums text-blue-400`}>{riders.length}</span>
      </div>
      <div className="min-h-0 overflow-hidden">
        {riders.length === 0 ? (
          <div className="px-3 py-3 text-center text-sm text-muted-foreground">No regions allocated yet</div>
        ) : (
          riders.map((r, i) => (
            <div
              key={r.id}
              className={`border-b border-border/50 px-2.5 ${isTight ? 'py-1' : 'py-1.5'} ${i % 2 === 1 ? 'bg-card/40' : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`truncate ${isTight ? 'text-xs' : 'text-sm'} font-bold`} title={r.name}>
                  {r.name}
                  {r.isContractor && (
                    <span className="ml-1.5 rounded bg-blue-500/15 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-400">
                      Contractor
                    </span>
                  )}
                </span>
                <span className={`shrink-0 rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] font-bold tabular-nums text-blue-400`}>
                  {r.regions.length}
                </span>
              </div>
              <p
                className={`mt-0.5 ${isTight ? 'text-[10px]' : 'text-[11px]'} leading-snug text-muted-foreground`}
                style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                title={r.regions.join(', ')}
              >
                {r.regions.join(' · ')}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  )

  // Compact "how long ago" for the edits rail (2m / 3h / 1d)
  const shortAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime()
    if (!isFinite(diff) || diff < 0) return ''
    const m = Math.floor(diff / 60000)
    if (m < 60) return `${m}m`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h`
    return `${Math.floor(h / 24)}d`
  }

  // Recent Edits: what got changed on Facebook (budget up/down, status),
  // colored by direction so the wall shows edits at a glance.
  const editsPanel = (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border">
      <div className={`flex shrink-0 items-center justify-between gap-2 bg-violet-500/10 px-2.5 ${isTight ? 'py-1' : 'py-1.5'}`}>
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-violet-400" />
          <span className={`${isTight ? 'text-sm' : 'text-base'} font-bold text-violet-400`}>Recent Edits</span>
        </div>
        <span className={`${isTight ? 'text-xs' : 'text-sm'} font-bold tabular-nums text-violet-400`}>{activities.length}</span>
      </div>
      <div className="min-h-0 overflow-hidden">
        {activities.length === 0 ? (
          <div className="px-3 py-3 text-center text-sm text-muted-foreground">No edits in the last 7 days</div>
        ) : (
          activities.slice(0, 10).map((act, i) => {
            const color =
              act.direction === 'increase'
                ? 'text-emerald-500'
                : act.direction === 'decrease'
                  ? 'text-red-500'
                  : act.direction === 'status'
                    ? 'text-blue-400'
                    : 'text-muted-foreground'
            return (
              <div
                key={`${act.objectId}-${act.eventTime}-${i}`}
                className={`border-b border-border/50 px-2.5 ${isTight ? 'py-0.5' : 'py-1'} ${i % 2 === 1 ? 'bg-card/40' : ''}`}
                title={`${act.objectName} \u00b7 ${act.changeSummary} \u00b7 by ${act.actorName}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{shortAgo(act.eventTime)}</span>
                  <span className={`truncate ${isTight ? 'text-[11px]' : 'text-xs'} font-semibold`}>{act.objectName || act.objectId}</span>
                </div>
                <p className={`truncate ${isTight ? 'text-[10px]' : 'text-[11px]'} ${color}`}>{act.changeSummary}</p>
              </div>
            )
          })
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
          {/* Average cost per client - green below Rs 75, yellow 76-99, red 100+ */}
          <div className={`flex items-center gap-2 rounded-lg border ${avgStyle.border} ${avgStyle.bg} px-3 py-1.5`}>
            <Gauge className={`h-4 w-4 ${avgStyle.text}`} />
            <div className="leading-tight">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Avg Cost/Client</p>
              <p className={`text-lg font-bold tabular-nums ${avgStyle.text}`}>
                {avgCac !== null ? formatRs(avgCac) : '—'}
              </p>
            </div>
          </div>
          {/* How many products got a budget edit TODAY (up / down counts) */}
          {(() => {
            const up = groups.filter((g) => g.todayEdit?.direction === 'increase').length
            const down = groups.filter((g) => g.todayEdit?.direction === 'decrease').length
            if (up + down === 0) return null
            return (
              <div className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-1.5">
                <History className="h-4 w-4 text-blue-400" />
                <div className="leading-tight">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Edited Today</p>
                  <p className="text-lg font-bold tabular-nums">
                    {up > 0 && <span className="text-emerald-500">{'\u2191'}{up}</span>}
                    {up > 0 && down > 0 && <span className="text-muted-foreground/60"> {'\u00b7'} </span>}
                    {down > 0 && <span className="text-red-500">{'\u2193'}{down}</span>}
                  </p>
                </div>
              </div>
            )
          })()}
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

      {/* Cost-per-client zone legend with per-zone product + client tallies */}
      <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Cost / client</span>
        <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-emerald-500">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          <span className="text-sm font-semibold">Rs 0–50 · {zoneStats.green.count}</span>
          <span className="flex items-center gap-1 text-sm font-bold tabular-nums">
            <Users className="h-3 w-3" />
            {zoneStats.green.clients.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-amber-500">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
          <span className="text-sm font-semibold">Rs 51–75 · {zoneStats.yellow.count}</span>
          <span className="flex items-center gap-1 text-sm font-bold tabular-nums">
            <Users className="h-3 w-3" />
            {zoneStats.yellow.clients.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-500/10 px-3 py-1 text-red-500">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
          <span className="text-sm font-semibold">Above Rs 75 · {zoneStats.red.count}</span>
          <span className="flex items-center gap-1 text-sm font-bold tabular-nums">
            <Users className="h-3 w-3" />
            {zoneStats.red.clients.toLocaleString()}
          </span>
        </div>

        {/* Pages strip: clients + est. avg cost/client per page, same thresholds
            as the average KPI (green <75, yellow 76-99, red 100+) */}
        {pageStats.length > 0 && (
          <>
            <span className="mx-1 h-5 w-px bg-border" />
            <Facebook className="h-4 w-4 text-blue-400" />
            {pageStats.slice(0, 6).map((p) => {
              const color =
                p.cac === null
                  ? 'text-muted-foreground'
                  : p.cac < 75
                    ? 'text-emerald-500'
                    : p.cac < 100
                      ? 'text-amber-500'
                      : 'text-red-500'
              return (
                <div
                  key={p.page}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1"
                  title={`${p.clients} client${p.clients !== 1 ? 's' : ''} from ${p.page}${p.cac !== null ? ` \u00b7 est. Rs ${Math.round(p.cac)}/client` : ''}`}
                >
                  <span className="text-sm font-semibold">{p.page}</span>
                  <span className="flex items-center gap-1 text-sm font-bold tabular-nums text-violet-400">
                    <Users className="h-3 w-3" />
                    {p.clients.toLocaleString()}
                  </span>
                  {p.cac !== null && (
                    <span className={`text-sm font-bold tabular-nums ${color}`}>Rs {Math.round(p.cac)}</span>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>

      {/* One continuous ranked league flowing across 3 balanced columns (no
          per-zone gaps, nothing cut off) + the riders/regions allocation table. */}
      <div className="mt-2 min-h-0 flex-1 overflow-hidden">
        {groups.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xl text-muted-foreground">
            No products to display
          </div>
        ) : (
          <div className="grid h-full grid-cols-1 items-start gap-3 lg:grid-cols-[1fr_1fr_1fr_0.9fr]">
            {columns.map((rows, i) => leagueColumn(rows, i))}
            {/* Right rail: riders/regions on top, recent campaign edits below */}
            <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
              {ridersPanel}
              {editsPanel}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
