'use client'

import { useEffect, useRef, useState } from 'react'
import { DollarSign, TrendingUp, Megaphone, X, RefreshCw, Pause, Play, AlertCircle, Users } from 'lucide-react'

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

interface TvDashboardProps {
  groups: TvGroup[]
  campaignCount: number
  totalSpend: number
  activeCampaigns: number
  campaignsWithSpendCount: number
  totalBalanceOwed: number
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
const ROW_GRID = 'grid grid-cols-[2rem_1fr_5.5rem_3.5rem_3rem_5rem] items-center gap-2'

export function TvDashboard({
  groups,
  campaignCount,
  totalSpend,
  activeCampaigns,
  campaignsWithSpendCount,
  totalBalanceOwed,
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // League standings: rank by cost-per-client, best (lowest) first at the top —
  // like a sports league table. Products with no client data drop to the bottom.
  const ranked = [...groups].sort((a, b) => {
    if (a.cac === null && b.cac === null) return b.totalSpend - a.totalSpend
    if (a.cac === null) return 1
    if (b.cac === null) return -1
    return a.cac - b.cac
  })

  // Split the standings into two side-by-side columns so twice as many products
  // are visible before scrolling (ranks flow down the left column, then right).
  const half = Math.ceil(ranked.length / 2)
  const columns = [ranked.slice(0, half), ranked.slice(half)]

  // Zone tallies for the legend/summary bar
  const counts = groups.reduce(
    (acc, g) => {
      acc[zoneFor(g.cac)]++
      return acc
    },
    { green: 0, yellow: 0, red: 0, none: 0 } as Record<Zone, number>,
  )

  // Exit on Escape for convenience
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onExit])

  // Gentle auto-scroll loop: pause at top, scroll to bottom, pause, jump back.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !autoScroll) return
    let raf = 0
    let phase: 'top' | 'scroll' | 'bottom' = 'top'
    let phaseStart = performance.now()
    let last = performance.now()
    const SPEED = 40 // px per second
    const loop = (now: number) => {
      const dt = now - last
      last = now
      const overflow = el.scrollHeight - el.clientHeight
      if (overflow > 4) {
        if (phase === 'top') {
          if (now - phaseStart > 2500) phase = 'scroll'
        } else if (phase === 'scroll') {
          el.scrollTop += (SPEED * dt) / 1000
          if (el.scrollTop >= overflow - 1) {
            phase = 'bottom'
            phaseStart = now
          }
        } else if (phase === 'bottom') {
          if (now - phaseStart > 4000) {
            el.scrollTop = 0
            phase = 'top'
            phaseStart = now
          }
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [autoScroll, ranked.length])

  const columnHeader = (
    <div className={`${ROW_GRID} border-b border-border bg-card px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground`}>
      <span className="text-center">#</span>
      <span>Product</span>
      <span className="text-right">Spend</span>
      <span className="text-right">Clients</span>
      <span className="text-right">Camp</span>
      <span className="text-right">Cost/Cl</span>
    </div>
  )

  const renderRow = (g: TvGroup, globalIndex: number, striped: boolean) => {
    const zone = zoneFor(g.cac)
    const zs = ZONE_STYLES[zone]
    return (
      <div
        key={g.key}
        className={`${ROW_GRID} border-b border-border/50 px-3 py-1.5 ${striped ? 'bg-card/40' : ''}`}
      >
        {/* Rank + zone-colored accent bar */}
        <div className="flex items-center gap-2">
          <span className={`h-6 w-1 rounded-full ${zs.dot}`} />
          <span className="text-lg font-bold tabular-nums text-muted-foreground">{globalIndex + 1}</span>
        </div>

        {/* Product name (zone dot inline to save vertical space) */}
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${zs.dot}`} title={zone === 'none' ? 'No clients yet' : zs.label} />
          <span className="truncate text-lg font-semibold" title={g.productName}>
            {g.productName}
          </span>
        </div>

        {/* Spend */}
        <span className="text-right text-lg font-bold tabular-nums text-amber-500">
          {formatSpend(g.totalSpend.toString())}
        </span>

        {/* Clients */}
        <span className="text-right text-lg font-bold tabular-nums">{g.clients.toLocaleString()}</span>

        {/* Campaigns */}
        <span className="text-right text-lg font-bold tabular-nums text-muted-foreground">{g.campaigns.length}</span>

        {/* Cost per client - the league metric, colored by zone */}
        <span className={`text-right text-xl font-bold tabular-nums ${zs.text}`}>
          {g.cac !== null ? formatRs(g.cac) : '—'}
        </span>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background px-6 py-4 text-foreground">
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
            onClick={() => setAutoScroll((v) => !v)}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-muted"
            aria-label={autoScroll ? 'Pause auto-scroll' : 'Resume auto-scroll'}
          >
            {autoScroll ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {autoScroll ? 'Pause' : 'Scroll'}
          </button>
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
      <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2">
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

      {/* Two-column dense league standings, ranked by cost-per-client and color-coded */}
      <div ref={scrollRef} className="mt-3 flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
        {ranked.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xl text-muted-foreground">
            No products to display
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-x-4 xl:grid-cols-2">
            {columns.map((col, ci) => (
              <div key={ci} className="overflow-hidden rounded-xl border border-border">
                {columnHeader}
                {col.map((g, i) => renderRow(g, ci * half + i, i % 2 === 1))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
