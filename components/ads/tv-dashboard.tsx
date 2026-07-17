'use client'

import { useEffect, useRef, useState } from 'react'
import { DollarSign, TrendingUp, Megaphone, X, RefreshCw, CalendarIcon, Pause, Play, AlertCircle } from 'lucide-react'
import { format } from 'date-fns'

// Minimal structural shape of a campaign needed for the TV view. Compatible with
// the Campaign interface used on the Ads Manager page.
export interface TvCampaign {
  id: string
  name: string
  status: string
  objective: string
  spend: string
  accountName?: string
  lifetime_budget?: string | null
  budget_remaining?: string | null
  stop_time?: string | null
}

interface TvDashboardProps {
  campaigns: TvCampaign[]
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

export function TvDashboard({
  campaigns,
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

  // Sort campaigns by spend (highest first) so the most important spend is on top
  const sorted = [...campaigns].sort(
    (a, b) => parseFloat(b.spend || '0') - parseFloat(a.spend || '0'),
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
  // Only scrolls when the content actually overflows the viewport.
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
          if (now - phaseStart > 2500) { phase = 'scroll' }
        } else if (phase === 'scroll') {
          el.scrollTop += (SPEED * dt) / 1000
          if (el.scrollTop >= overflow - 1) { phase = 'bottom'; phaseStart = now }
        } else if (phase === 'bottom') {
          if (now - phaseStart > 4000) { el.scrollTop = 0; phase = 'top'; phaseStart = now }
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [autoScroll, sorted.length])

  const statusDot = (status: string) => {
    if (status === 'ACTIVE') return 'bg-emerald-500'
    if (status === 'PAUSED') return 'bg-amber-500'
    return 'bg-gray-500'
  }

  // Per-campaign budget summary (Facebook budget fields are in USD cents)
  const budgetInfo = (c: TvCampaign) => {
    const lifetime = parseFloat(c.lifetime_budget || '0') / 100
    const remaining = parseFloat(c.budget_remaining || '0') / 100
    const end = c.stop_time ? new Date(c.stop_time) : null
    const validEnd = end && !isNaN(end.getTime())
    if (lifetime <= 0 && !validEnd) return null
    const spent = lifetime > 0 ? Math.max(0, lifetime - remaining) : 0
    const pct = lifetime > 0 ? Math.min(100, (spent / lifetime) * 100) : 0
    return { lifetime, remaining, spent, pct, end: validEnd ? (end as Date) : null }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background p-8 text-foreground">
      {/* Header + KPIs */}
      <div className="shrink-0">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-baseline gap-4">
            <h1 className="text-4xl font-bold tracking-tight">Ads Manager</h1>
            <span className="text-lg text-muted-foreground">
              {showTodayOnly ? "Today's spend" : 'All campaigns'} · {campaigns.length} campaigns
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
      </div>

      {/* Campaign grid */}
      <div
        ref={scrollRef}
        className="mt-6 flex-1 overflow-y-auto pr-2"
        style={{ scrollbarWidth: 'thin' }}
      >
        {sorted.length === 0 ? (
          <div className="flex h-full items-center justify-center text-2xl text-muted-foreground">
            No campaigns to display
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-5">
            {sorted.map((c) => {
              const b = budgetInfo(c)
              return (
                <div key={c.id} className="rounded-2xl border border-border bg-card p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`h-3 w-3 shrink-0 rounded-full ${statusDot(c.status)}`} />
                      <h3 className="truncate text-xl font-semibold" title={c.name}>{c.name}</h3>
                    </div>
                  </div>
                  {c.accountName && (
                    <p className="mt-1 truncate text-base text-muted-foreground">{c.accountName}</p>
                  )}
                  <p className="mt-3 text-4xl font-bold tabular-nums text-amber-500">
                    {formatSpend(c.spend || '0')}
                  </p>
                  <p className="text-sm text-muted-foreground/70">{formatUsd(c.spend || '0')} USD</p>

                  {b && (
                    <div className="mt-4 space-y-2">
                      {b.lifetime > 0 && (
                        <>
                          <div className="flex items-center justify-between text-base">
                            <span className="text-muted-foreground">Spent</span>
                            <span className="font-medium tabular-nums">
                              {formatSpend(b.spent.toString())}
                              <span className="text-muted-foreground/60"> / {formatSpend(b.lifetime.toString())}</span>
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                            <div className="h-full rounded-full bg-amber-500" style={{ width: `${b.pct}%` }} />
                          </div>
                          <div className="flex items-center justify-between text-base">
                            <span className="text-muted-foreground">Remaining</span>
                            <span className="font-medium tabular-nums">{formatSpend(b.remaining.toString())}</span>
                          </div>
                        </>
                      )}
                      {b.end && (
                        <div className="flex items-center gap-2 text-base text-muted-foreground">
                          <CalendarIcon className="h-4 w-4" />
                          Ends {format(b.end, 'd MMM yyyy')}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
