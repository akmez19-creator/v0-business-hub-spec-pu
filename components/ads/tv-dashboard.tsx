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

// Tailwind class bundles per zone (border, tint, text, dot, progress).
const ZONE_STYLES: Record<Zone, { border: string; bg: string; text: string; dot: string; label: string }> = {
  green: {
    border: 'border-emerald-500/60',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-500',
    dot: 'bg-emerald-500',
    label: 'Good',
  },
  yellow: {
    border: 'border-amber-500/60',
    bg: 'bg-amber-500/10',
    text: 'text-amber-500',
    dot: 'bg-amber-500',
    label: 'Watch',
  },
  red: {
    border: 'border-red-500/60',
    bg: 'bg-red-500/10',
    text: 'text-red-500',
    dot: 'bg-red-500',
    label: 'High',
  },
  none: {
    border: 'border-border',
    bg: 'bg-card',
    text: 'text-muted-foreground',
    dot: 'bg-gray-500',
    label: 'No data',
  },
}

const formatRs = (rs: number) => `Rs ${rs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`

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

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background p-8 text-foreground">
      {/* Header */}
      <div className="shrink-0">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-baseline gap-4">
            <h1 className="text-4xl font-bold tracking-tight">Ads Manager</h1>
            <span className="text-lg text-muted-foreground">
              {showTodayOnly ? "Today's spend" : 'All campaigns'} · {groups.length} products · {campaignCount} campaigns
            </span>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <div className="text-sm text-muted-foreground">Auto-refresh</div>
              <div className="font-mono text-2xl text-primary tabular-nums">{formatCountdown(countdown)}</div>
              <div className="text-xs text-muted-foreground">Last: {formatLastRefresh(lastRefresh)}</div>
            </div>
            <button
              onClick={() => setAutoScroll((v) => !v)}
              className="flex h-14 items-center gap-2 rounded-xl border border-border bg-card px-5 text-lg font-medium transition-colors hover:bg-muted"
              aria-label={autoScroll ? 'Pause auto-scroll' : 'Resume auto-scroll'}
            >
              {autoScroll ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              {autoScroll ? 'Pause' : 'Scroll'}
            </button>
            <button
              onClick={onRefresh}
              className="flex h-14 items-center gap-2 rounded-xl border border-border bg-card px-5 text-lg font-medium transition-colors hover:bg-muted"
              aria-label="Refresh"
            >
              <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              onClick={onExit}
              className="flex h-14 items-center gap-2 rounded-xl bg-primary px-6 text-lg font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              aria-label="Exit TV mode"
            >
              <X className="h-5 w-5" />
              Exit
            </button>
          </div>
        </div>

        {/* KPI cards */}
        <div className="mt-6 grid grid-cols-4 gap-6">
          <div className="rounded-2xl border border-amber-500/20 bg-gradient-to-br from-amber-500/15 to-amber-600/5 p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-amber-500/20">
                <DollarSign className="h-7 w-7 text-amber-500" />
              </div>
              <p className="text-lg text-muted-foreground">Total Spend</p>
            </div>
            <p className="mt-4 text-5xl font-bold tabular-nums">{formatSpend(totalSpend.toString())}</p>
            <p className="mt-1 text-lg text-muted-foreground/70">{formatUsd(totalSpend.toString())} USD</p>
          </div>

          <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/15 to-emerald-600/5 p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-emerald-500/20">
                <TrendingUp className="h-7 w-7 text-emerald-500" />
              </div>
              <p className="text-lg text-muted-foreground">Active Campaigns</p>
            </div>
            <p className="mt-4 text-5xl font-bold tabular-nums">{activeCampaigns}</p>
          </div>

          <div className="rounded-2xl border border-blue-500/20 bg-gradient-to-br from-blue-500/15 to-blue-600/5 p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-blue-500/20">
                <Megaphone className="h-7 w-7 text-blue-500" />
              </div>
              <p className="text-lg text-muted-foreground">{showTodayOnly ? 'With Spend' : 'Total Campaigns'}</p>
            </div>
            <p className="mt-4 text-5xl font-bold tabular-nums">{campaignsWithSpendCount}</p>
          </div>

          <div className="rounded-2xl border border-red-500/20 bg-gradient-to-br from-red-500/15 to-red-600/5 p-6">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-red-500/20">
                <AlertCircle className="h-7 w-7 text-red-500" />
              </div>
              <p className="text-lg text-muted-foreground">Total Due</p>
            </div>
            <p className="mt-4 text-5xl font-bold tabular-nums text-red-500">{formatSpend(totalBalanceOwed.toString())}</p>
          </div>
        </div>

        {/* Cost-per-client zone legend */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <span className="text-base font-medium text-muted-foreground">Cost / client</span>
          <div className="flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-4 py-1.5 text-emerald-500">
            <span className="h-3 w-3 rounded-full bg-emerald-500" />
            <span className="text-base font-semibold">Rs 0–50</span>
            <span className="text-base font-bold tabular-nums">· {counts.green}</span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-4 py-1.5 text-amber-500">
            <span className="h-3 w-3 rounded-full bg-amber-500" />
            <span className="text-base font-semibold">Rs 51–75</span>
            <span className="text-base font-bold tabular-nums">· {counts.yellow}</span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-red-500/40 bg-red-500/10 px-4 py-1.5 text-red-500">
            <span className="h-3 w-3 rounded-full bg-red-500" />
            <span className="text-base font-semibold">Above Rs 75</span>
            <span className="text-base font-bold tabular-nums">· {counts.red}</span>
          </div>
        </div>
      </div>

      {/* League standings table, ranked by cost-per-client and color-coded by zone */}
      <div ref={scrollRef} className="mt-6 flex-1 overflow-y-auto pr-2" style={{ scrollbarWidth: 'thin' }}>
        {ranked.length === 0 ? (
          <div className="flex h-full items-center justify-center text-2xl text-muted-foreground">
            No products to display
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border">
            {/* Column headers */}
            <div className="grid grid-cols-[4rem_1fr_9rem_9rem_9rem_11rem] items-center gap-4 border-b border-border bg-card px-6 py-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              <span className="text-center">#</span>
              <span>Product</span>
              <span className="text-right">Spend</span>
              <span className="text-right">Clients</span>
              <span className="text-right">Campaigns</span>
              <span className="text-right">Cost / Client</span>
            </div>

            {ranked.map((g, i) => {
              const zone = zoneFor(g.cac)
              const zs = ZONE_STYLES[zone]
              const pos = i + 1
              return (
                <div
                  key={g.key}
                  className={`grid grid-cols-[4rem_1fr_9rem_9rem_9rem_11rem] items-center gap-4 border-b border-border/60 px-6 py-4 ${
                    i % 2 === 1 ? 'bg-card/40' : ''
                  }`}
                >
                  {/* Rank with zone-colored accent bar */}
                  <div className="flex items-center gap-3">
                    <span className={`h-9 w-1.5 rounded-full ${zs.dot}`} />
                    <span className="w-8 text-center text-2xl font-bold tabular-nums text-muted-foreground">{pos}</span>
                  </div>

                  {/* Product name + zone label */}
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-2xl font-semibold" title={g.productName}>
                        {g.productName}
                      </p>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 rounded-full ${zs.bg} px-2.5 py-0.5 text-sm font-semibold ${zs.text}`}>
                          <span className={`h-2 w-2 rounded-full ${zs.dot}`} />
                          {zone === 'none' ? 'No clients yet' : zs.label}
                        </span>
                        {typeof g.productPrice === 'number' && (
                          <span className="text-sm text-muted-foreground">Rs {g.productPrice}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Spend */}
                  <span className="text-right text-2xl font-bold tabular-nums text-amber-500">
                    {formatSpend(g.totalSpend.toString())}
                  </span>

                  {/* Clients */}
                  <span className="flex items-center justify-end gap-1.5 text-right text-2xl font-bold tabular-nums">
                    <Users className="h-5 w-5 text-muted-foreground" />
                    {g.clients.toLocaleString()}
                  </span>

                  {/* Campaigns */}
                  <span className="text-right text-2xl font-bold tabular-nums">{g.campaigns.length}</span>

                  {/* Cost per client - the league metric, colored by zone */}
                  <span className={`text-right text-4xl font-bold tabular-nums ${zs.text}`}>
                    {g.cac !== null ? formatRs(g.cac) : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
