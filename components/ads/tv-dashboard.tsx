'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarDays, DollarSign, TrendingUp, Megaphone, X, RefreshCw, AlertCircle, Users, Bike, Gauge, History, Facebook, Cat } from 'lucide-react'
import { RECOMMENDATION_STYLES, VERDICT_STYLES, type Recommendation } from '@/lib/ads-recommendations'
import { groupLocalitiesByZone } from '@/lib/ads-region-zones'
import { costPerResultRs, RESULT_LABEL, type ResultKind } from '@/lib/ads-conversions'
import { TvRulesCat } from '@/components/ads/tv-rules-cat'

// Minimal structural shape of a campaign needed for the TV view.
export interface TvCampaign {
  id: string
  name: string
  status: string
  spend: string
  accountName?: string
  // Conversions for this ad (messages, else leads, else purchases)
  messages?: number
  results?: number
  resultKind?: ResultKind
  // The Facebook AD ids under this campaign. These are what deliveries.ad_id
  // stores, so they are the join key for revenue attribution.
  ads?: { id: string; postId: string | null }[]
  adIds?: string[] // legacy shape, still present on stale cache entries
}

// Money booked against one ad id (order value - nothing here is paid yet)
export interface AdRevenueStat {
  revenue: number
  orders: number
  clients: number
}

// A product group enriched with client count + cost-per-client (in Rs).
export interface TvGroup {
  key: string
  productName: string
  productPrice?: number
  // Product photo from the products table (null = no image uploaded)
  productImage?: string | null
  totalSpend: number // USD
  isUnlinked: boolean
  clients: number
  cac: number | null // Rs per client (null when not computable)
  // Conversions across every campaign of this product
  totalResults?: number
  costPerResult?: number | null // Rs per message/lead (null = no results yet)
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

// A rider (or contractor fallback) with the regions allocated to them and
// how many distinct clients they have for TODAY's delivery date.
export interface TvRider {
  id: string
  name: string
  isContractor?: boolean
  regions: string[]
  todayClients?: number
  // Daily client target (null = none configured)
  target?: number | null
}

interface TvDashboardProps {
  groups: TvGroup[]
  campaignCount: number
  totalSpend: number
  activeCampaigns: number
  campaignsWithSpendCount: number
  totalBalanceOwed: number
  riders: TvRider[]
  // Total distinct clients across ALL of the active batch's deliveries
  // (rider-assigned or not) - shown in the panel header so totals reconcile.
  ridersTodayTotal?: number
  // Delivery date (YYYY-MM-DD) of the active batch the counts belong to
  ridersBatchDate?: string | null
  // Called when the user picks a batch date on the Riders panel
  // (null = back to auto: the active batch)
  onRidersDateChange?: (date: string | null) => void
  // Localities whose clients resolve to no rider (with client counts)
  unassignedLocalities?: { name: string; clients: number }[]
  pageStats?: TvPageStat[]
  activities?: TvActivity[]
  // Revenue per Facebook ad id (deliveries.ad_id -> order value in Rs)
  adRevenue?: Record<string, AdRevenueStat>
  // Revenue that maps to no ad id, so the per-ad figures stay honest
  adRevenueLeftover?: {
    labelledOrders: number
    labelledRevenue: number
    missingOrders: number
    missingRevenue: number
  } | null
  // Clients whose delivery carries no usable ad id, per product. The extension
  // captures ad ids silently, but some chats have no ad label at all - those
  // orders are still taken, so the gap has to be reported rather than hidden.
  attributionGaps?: { product: string; total: number; attributed: number; missing: number }[]
  attributionTotals?: { total: number; attributed: number; missing: number; coverage: number } | null
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

// USD -> Rs conversion used across the wall (spend cells, ticker thresholds)
const USD_TO_RS = 57.5

/**
 * Order a product's ads cheapest-result-first, which is the order that answers
 * "which one do I scale and which do I kill". Ads with no result yet sink to
 * the bottom, the biggest spender among them first (that is the worst waste).
 */
function rankByCostPerResult(list: TvCampaign[]): TvCampaign[] {
  const cost = (c: TvCampaign) => costPerResultRs(parseFloat(c.spend || '0'), c.results ?? 0, USD_TO_RS)
  return [...list].sort((a, b) => {
    const ca = cost(a)
    const cb = cost(b)
    if (ca !== null && cb !== null) return ca - cb
    if (ca !== null) return -1
    if (cb !== null) return 1
    return parseFloat(b.spend || '0') - parseFloat(a.spend || '0')
  })
}

/**
 * Roll the per-AD revenue up to the campaign the wall actually renders.
 *
 * `deliveries.ad_id` is an AD id, but a row here is a CAMPAIGN, so the money a
 * campaign made is the sum over its ads. `perAd` is kept alongside the total so
 * the row can name the exact ad id that earned each rupee - a campaign with one
 * winning ad and two dead ones looks identical to three mediocre ones until you
 * split it out.
 *
 * Returns null when no ad of the campaign has any attributed order at all,
 * which is deliberately different from "earned Rs 0": the first means we have
 * no signal, the second means the ad is genuinely not selling.
 */
/** What a single AD earned, keyed by deliveries.ad_id. */
interface PerAdStat {
  id: string
  revenue: number
  orders: number
  /** Real clients booked from this exact ad - NOT Facebook messages. */
  clients: number
}

/** A campaign's or product's ads rolled up, keeping the per-ad detail. */
interface AdRollup {
  revenue: number
  orders: number
  clients: number
  perAd: PerAdStat[]
}

function campaignRevenue(
  c: TvCampaign,
  byAd: Record<string, AdRevenueStat>,
): AdRollup | null {
  // New shape is ads[{id}]; fall back to the legacy adIds[] on a stale cache.
  const ids = c.ads?.length ? c.ads.map((a) => a.id) : (c.adIds ?? [])
  if (ids.length === 0) return null
  const perAd: PerAdStat[] = []
  let revenue = 0
  let orders = 0
  let clients = 0
  for (const id of ids) {
    const stat = byAd[id]
    if (!stat) continue
    // `clients` rides along per ad id - this is what lets the wall answer
    // "which AD brought how many clients", not just which product did.
    perAd.push({ id, revenue: stat.revenue, orders: stat.orders, clients: stat.clients })
    revenue += stat.revenue
    orders += stat.orders
    clients += stat.clients
  }
  if (perAd.length === 0) return null
  perAd.sort((a, b) => b.revenue - a.revenue)
  return { revenue, orders, clients, perAd }
}

/**
 * Money booked against a whole PRODUCT row: the sum over every ad of every
 * campaign in the group. This is the number the wall leads with, because a row
 * is a product, not an ad.
 *
 * `perAd` carries the individual ad ids so the row's tooltip can show exactly
 * which ad id earned what - the point of attributing by ad_id in the first
 * place. Returns null when not a single ad in the group has an attributed
 * order, which is deliberately different from "earned Rs 0": no signal vs
 * genuinely not selling.
 */
function groupRevenue(
  g: TvGroup,
  byAd: Record<string, AdRevenueStat>,
): AdRollup | null {
  const perAd: PerAdStat[] = []
  let revenue = 0
  let orders = 0
  let clients = 0
  for (const c of g.campaigns) {
    const cr = campaignRevenue(c, byAd)
    if (!cr) continue
    perAd.push(...cr.perAd)
    revenue += cr.revenue
    orders += cr.orders
    clients += cr.clients
  }
  if (perAd.length === 0) return null
  perAd.sort((a, b) => b.revenue - a.revenue)
  return { revenue, orders, clients, perAd }
}

// TWO DIFFERENT NUMBERS - do not conflate them:
//   * RESULTS  = Facebook conversions (messages, else leads, else purchases).
//     A person can message five times and never buy. Labelled msg/lead/sale
//     via RESULT_LABEL, and priced as cost-per-result.
//   * CLIENTS  = actual orders booked from deliveries. 2 orders = 2 clients.
//     This is the CL column and drives cost-per-client (cac).
// So a row can legitimately read "5 msgs" next to "2 clients". Never relabel
// results as clients - that overstates real customers by the message count.

// Shared dense grid template used by both the header and every row.
// Columns: rank, product, spend, clients, cost/client, revenue booked, action.
const ROW_GRID =
  'grid grid-cols-[1.5rem_minmax(0,1fr)_3.4rem_1.8rem_3rem_3.6rem_1.2rem] items-center gap-1'

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
  ridersTodayTotal = 0,
  ridersBatchDate = null,
  onRidersDateChange,
  unassignedLocalities = [],
  pageStats = [],
  activities = [],
  adRevenue = {},
  adRevenueLeftover = null,
  attributionGaps = [],
  attributionTotals = null,
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
  // Riders panel: show/hide each rider's region coverage (default hidden so
  // every rider fits as a one-line row with today's client count)
  const [showRiderRegions, setShowRiderRegions] = useState(false)

  // Rider daily targets adjusted from TV mode: optimistic local override,
  // synced to the riders table via PATCH so Regions admin sees the same value
  const [targetOverrides, setTargetOverrides] = useState<Record<string, number>>({})
  const adjustTarget = (r: TvRider, delta: number) => {
    const current = targetOverrides[r.id] ?? r.target ?? 0
    const next = Math.max(0, current + delta)
    setTargetOverrides((prev) => ({ ...prev, [r.id]: next }))
    fetch('/api/ads/rider-targets', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ riderName: r.name, target: next }),
    }).catch(() => {})
  }

  // Cost/client baselines for products edited today: the FIRST cost seen at
  // edit time is stored server-side, so the row can show whether the edit is
  // actually IMPROVING the cost as the day progresses (baseline vs live CAC).
  // createdAt = when the edit was first detected, used to escalate ads that
  // show no improvement after 2-3 hours.
  const [editBaselines, setEditBaselines] = useState<
    Record<string, { cac: number | null; spendRs: number; clients: number; createdAt?: string }>
  >({})

  // Which product row is expanded to show its campaigns + today's edits
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null)

  // Per-campaign ON/OFF straight from the wall: optimistic status overrides
  // (campaign id -> new status) + which id is mid-flight
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({})
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const toggleCampaign = async (campaignId: string, currentStatus: string) => {
    const next = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
    setTogglingId(campaignId)
    try {
      const res = await fetch('/api/facebook-ads/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, status: next }),
      })
      const json = await res.json()
      if (res.ok && json.success) {
        setStatusOverrides((m) => ({ ...m, [campaignId]: next }))
      } else {
        alert(json.error || 'Facebook rejected the change')
      }
    } catch {
      alert('Network error - could not reach Facebook')
    } finally {
      setTogglingId(null)
    }
  }

  // Budget adjust: +20% / +50% of the REMAINING budget added to the campaign
  // budget (daily campaigns grow the daily amount); -10 = STABILIZE (shave
  // 10% off the remaining budget - the undo lever after over-boosting);
  // or the optimum decreases:
  // 'optimum' = spent + remaining_days x 1.25/day (tightest floor),
  // 'optimum2' = spent + remaining_days x 2.00/day (least-aggressive floor),
  // both tallied to the campaign end date.
  // Tracks which id+action is mid-flight and marks done ids with a summary.
  const [boostingKey, setBoostingKey] = useState<string | null>(null)
  const [boostedNotes, setBoostedNotes] = useState<Record<string, string>>({})

  const boostBudget = async (campaignId: string, percent: 20 | 50 | -10 | 'optimum' | 'optimum2') => {
    setBoostingKey(`${campaignId}:${percent}`)
    try {
      const res = await fetch('/api/facebook-ads/budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, percent }),
      })
      const json = await res.json()
      if (res.ok && json.success) {
        const label =
          percent === 'optimum'
            ? `OPT${json.remainingDays ? ` ${json.remainingDays}d` : ''}`
            : percent === 'optimum2'
              ? `OPT2${json.remainingDays ? ` ${json.remainingDays}d` : ''}`
              : percent === -10
                ? 'STAB \u221210%'
                : `+${percent}%`
        setBoostedNotes((m) => ({
          ...m,
          [campaignId]: `${label} \u2192 Rs ${json.next.toLocaleString()}`,
        }))
      } else {
        alert(json.error || 'Facebook rejected the budget change')
      }
    } catch {
      alert('Network error - could not reach Facebook')
    } finally {
      setBoostingKey(null)
    }
  }

  // The animated cat mascot, present by default on the wall (toggleable
  // from the header). Its AI briefing reads the wall via a stable snapshot
  // getter so the cat's internal timers survive re-renders.
  const [showRulesCat, setShowRulesCat] = useState(true)
  const snapshotRef = useRef<() => unknown>(() => ({}))
  const getWallSnapshot = useCallback(() => snapshotRef.current(), [])
  // Stable signature of today's edited products so the sync effect only
  // refires when the edited set (or their live numbers) actually changes
  const editedSignature = groups
    .filter((g) => g.todayEdit && !g.isUnlinked)
    .map((g) => `${g.key}:${g.cac ?? 'x'}:${g.clients}`)
    .join('|')
  useEffect(() => {
    const edited = groups.filter((g) => g.todayEdit && !g.isUnlinked)
    if (edited.length === 0) return
    const entries = edited.map((g) => ({
      productKey: g.key,
      cac: g.cac,
      spendRs: g.totalSpend,
      clients: g.clients,
    }))
    // POST first (server keeps only the first-of-day baseline), then GET
    fetch('/api/facebook-ads/edit-baselines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    })
      .then(() => fetch('/api/facebook-ads/edit-baselines'))
      .then((res) => res.json())
      .then((data) => {
        if (data?.success) setEditBaselines(data.baselines || {})
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editedSignature])
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

  // Average cost per client (Rs) = TOTAL spend / TOTAL clients, so it tallies
  // exactly with the Total Spend and Total Clients tiles next to it. Spend on
  // zero-client products is real money spent acquiring these clients, so it
  // is included (previously excluded, which understated the average).
  const avgCac = totalClients > 0 ? (totalSpend * USD_TO_RS) / totalClients : null
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

  // All of the product's campaigns are switched off (paused/archived): the
  // ad is no longer spending, which itself is the strongest decrease action
  const isGroupOff = (g: TvGroup) =>
    g.campaigns.length > 0 && g.campaigns.every((c) => c.status !== 'ACTIVE')

  // Today's edits (from the FB activity feed) belonging to a product's
  // campaigns: matched by campaign id first, then by object name containing a
  // campaign name (ad set edits carry different ids but related names).
  const todayMu = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const isTodayMu = (t: string) =>
    new Date(new Date(t).getTime() + 4 * 60 * 60 * 1000).toISOString().slice(0, 10) === todayMu
  const editsForGroup = (g: TvGroup): TvActivity[] => {
    const ids = new Set(g.campaigns.map((c) => c.id))
    const names = g.campaigns.map((c) => c.name.toLowerCase()).filter(Boolean)
    return activities.filter((a) => {
      if (!isTodayMu(a.eventTime)) return false
      if (ids.has(a.objectId)) return true
      const obj = (a.objectName || '').toLowerCase()
      return obj.length > 0 && names.some((n) => obj === n || obj.includes(n) || n.includes(obj))
    })
  }

  // STALLED EDITS: edited 2+ hours ago but the cost is NOT improving (live
  // cost/client is the same or worse than at edit time) and still in the red
  // zone. These escalate to breaking news: decrease again, or turn OFF when
  // the cost has blown past Rs 150/client.
  const STALL_HOURS = 2
  // NOTE: this is the STALLED-EDIT escalation threshold - a product whose
  // cost-per-client has blown past Rs 150 despite a budget edit. It is NOT the
  // Rs 150 kill rule (lib/ads/kill-rule.ts), which is per-ad and fires on
  // Rs 150 spent with ZERO clients. Same number, deliberately different tests:
  // this one escalates ads that ARE converting but too expensively.
  const STALL_TURN_OFF_CAC = 150
  const stalledInfo = (g: TvGroup): { hoursAgo: number; turnOff: boolean } | null => {
    if (!g.todayEdit || isGroupOff(g)) return null
    const base = editBaselines[g.key]
    if (!base?.createdAt || base.cac === null || g.cac === null) return null
    const hoursAgo = (Date.now() - new Date(base.createdAt).getTime()) / 3_600_000
    if (hoursAgo < STALL_HOURS) return null
    const improving = g.cac < base.cac
    if (improving || g.cac <= YELLOW_MAX) return null
    return { hoursAgo, turnOff: g.cac > STALL_TURN_OFF_CAC }
  }

  const renderRow = (g: TvGroup, rank: number, striped: boolean) => {
    const zone = zoneFor(g.cac)
    const zs = ZONE_STYLES[zone]
    const off = isGroupOff(g)
    const expanded = expandedProduct === g.key
    const groupEdits = expanded ? editsForGroup(g) : []
    return (
      <div key={g.key}>
      <div
        onClick={() => setExpandedProduct(expanded ? null : g.key)}
        className={`${ROW_GRID} cursor-pointer border-b border-border/50 ${density.row} ${striped ? 'bg-card/40' : ''} ${off ? 'opacity-60' : ''} ${expanded ? 'bg-blue-500/10' : 'hover:bg-muted/40'}`}
      >
        {/* Global rank + zone-colored accent bar */}
        <div className="flex items-center gap-1.5">
          <span className={`${density.bar} w-1 rounded-full ${zs.dot}`} />
          <span className={`${density.num} font-bold tabular-nums text-muted-foreground`}>{rank}</span>
        </div>

        {/* Product photo + name + OFF badge when all its campaigns are
            switched off. Click the row to expand campaigns + edit history. */}
        <span className={`flex min-w-0 items-center gap-1.5 ${density.name} font-semibold`} title={`${g.productName} \u00b7 ${g.campaigns.length} campaign${g.campaigns.length !== 1 ? 's' : ''} \u00b7 click for details`}>
          {g.productImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={g.productImage || '/placeholder.svg'}
              alt=""
              loading="lazy"
              className="h-5 w-5 shrink-0 rounded-md border border-border/60 bg-muted object-cover"
            />
          ) : (
            !g.isUnlinked && (
              <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-muted text-[9px] font-bold text-muted-foreground">
                {g.productName.charAt(0)}
              </span>
            )
          )}
          <span className="truncate">{g.productName}</span>
          {g.campaigns.length > 1 && (
            <span className="shrink-0 rounded bg-muted px-1 py-0 text-[9px] font-bold tabular-nums text-muted-foreground">
              {'\u00d7'}{g.campaigns.length}
            </span>
          )}
          {off && (
            <span className="shrink-0 rounded bg-red-500/20 px-1 py-0 text-[9px] font-bold uppercase tracking-wide text-red-400">
              Off
            </span>
          )}
        </span>

        {/* Spend - digits only (Rs is in the column header) */}
        <span
          className={`text-right ${density.num} font-bold tabular-nums text-amber-500`}
          title={formatSpend(g.totalSpend.toString())}
        >
          {(g.totalSpend * USD_TO_RS).toLocaleString('en-US', { maximumFractionDigits: 0 })}
        </span>

        {/* Clients */}
        <span className={`text-right ${density.num} font-bold tabular-nums`}>{g.clients.toLocaleString()}</span>

        {/* Cost per client - the league metric, colored by zone. Rows edited
            today also show whether the edit is IMPROVING the cost: live CAC
            vs the cost captured at edit time (green down = cheaper since the
            edit, red up = more expensive, gray = no change yet). */}
        <span className={`flex items-center justify-end gap-1 text-right ${density.cac} font-bold tabular-nums ${zs.text}`}>
          {(() => {
            if (!g.todayEdit) return null
            const base = editBaselines[g.key]
            if (!base || base.cac === null || g.cac === null) return null
            const pct = base.cac > 0 ? Math.round(((g.cac - base.cac) / base.cac) * 100) : 0
            const title = `Since today\u2019s edit: ${formatRs(base.cac)} \u2192 ${formatRs(g.cac)} per client`
            if (pct === 0)
              return (
                <span title={title} className="rounded bg-muted px-1 py-0 text-[9px] font-bold leading-tight text-muted-foreground">
                  =
                </span>
              )
            const improving = pct < 0
            return (
              <span
                title={title}
                className={`rounded px-1 py-0 text-[9px] font-bold leading-tight ${
                  improving ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                }`}
              >
                {improving ? '\u25bc' : '\u25b2'}{Math.abs(pct)}%
              </span>
            )
          })()}
          {/* Digits only - Rs is in the column header */}
          <span title={g.cac !== null ? formatRs(g.cac) : undefined}>
            {g.cac !== null ? g.cac.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}
          </span>
        </span>

        {/* Money BOOKED against this product's ad ids, with ROAS underneath.
            ROAS is the whole point of pairing it with spend: Rs 900 booked on
            Rs 300 spent is 3.0x and worth scaling, the same Rs 900 on Rs 1,200
            is 0.75x and is losing money. Colored by that ratio, not by size.
            An em dash means no order carries any of this product's ad ids -
            no signal, which is NOT the same as having sold nothing. */}
        {(() => {
          const rev = groupRevenue(g, adRevenue)
          const spendRs = g.totalSpend * USD_TO_RS
          if (!rev) {
            return (
              <span
                className={`text-right ${density.num} tabular-nums text-muted-foreground/40`}
                title="No delivery carries an ad id from this product's campaigns yet"
              >
                —
              </span>
            )
          }
          const roas = spendRs > 0 ? rev.revenue / spendRs : null
          // Below 1x the ad is spending more than it books; 2x+ is scalable.
          const roasStyle =
            roas === null
              ? 'text-muted-foreground'
              : roas >= 2
                ? 'text-emerald-500'
                : roas >= 1
                  ? 'text-amber-500'
                  : 'text-red-500'
          // Ranked by clients so the tooltip answers "which ad id is actually
          // bringing customers", with each ad's own cost per client.
          const top = [...rev.perAd]
            .sort((a, b) => b.clients - a.clients)
            .slice(0, 3)
            .map(
              (a) =>
                `  ${a.id}: ${a.clients} client${a.clients !== 1 ? 's' : ''} \u00b7 ${formatRs(a.revenue)}`,
            )
            .join('\n')
          const groupCac = rev.clients > 0 ? spendRs / rev.clients : null
          const title =
            `${formatRs(rev.revenue)} booked from ${rev.orders} order${rev.orders !== 1 ? 's' : ''}\n` +
            `${rev.clients} client${rev.clients !== 1 ? 's' : ''}${groupCac !== null ? ` \u00b7 ${formatRs(groupCac)} per client` : ''}\n` +
            `Spent ${formatRs(spendRs)}${roas !== null ? ` \u00b7 ${roas.toFixed(2)}x return` : ''}\n` +
            `Top ad ids by clients:\n${top}${rev.perAd.length > 3 ? `\n  +${rev.perAd.length - 3} more` : ''}`
          return (
            <span className="flex flex-col items-end leading-none" title={title}>
              <span className={`${density.num} font-bold tabular-nums ${roasStyle}`}>
                {/* Abbreviated (2.4k) so a five-figure sum cannot widen the
                    column and squeeze the product name - the exact rupee
                    figure is in the tooltip. */}
                {rev.revenue >= 1000
                  ? `${(rev.revenue / 1000).toFixed(rev.revenue >= 10000 ? 0 : 1)}k`
                  : rev.revenue.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </span>
              {roas !== null && (
                <span className={`text-[9px] font-semibold tabular-nums ${roasStyle} opacity-80`}>
                  {roas.toFixed(1)}x
                </span>
              )}
            </span>
          )
        })()}

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

      {/* Expanded details: the ad campaigns this product concerns + every
          edit they received today, so the wall answers "which campaign is
          this and what was done to it" without leaving TV mode */}
      {expanded && (
        <div className="border-b border-blue-500/30 bg-blue-500/5 px-2 py-1.5">
          {/* Product-level cost per message, so the ads below can be judged
              against their own product average rather than in a vacuum. */}
          {(g.totalResults ?? 0) > 0 && (
            <div className="mb-1 flex items-center justify-between gap-2 border-b border-blue-500/20 pb-1">
              <span className="text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
                Cheapest first {'\u00b7'} {g.totalResults} {RESULT_LABEL[g.campaigns.find((c) => c.resultKind && c.resultKind !== 'none')?.resultKind ?? 'msg']}
                {(g.totalResults ?? 0) !== 1 ? 's' : ''} total
              </span>
              {g.costPerResult != null && (
                <span
                  className={`rounded px-1.5 py-0 text-[10px] font-black tabular-nums ${ZONE_STYLES[zoneFor(g.costPerResult)].bg} ${ZONE_STYLES[zoneFor(g.costPerResult)].text}`}
                  title={`Product average: ${formatSpend(g.totalSpend.toString())} across ${g.totalResults} results`}
                >
                  avg {formatRs(g.costPerResult)}
                </span>
              )}
            </div>
          )}
          <div className="space-y-0.5">
            {rankByCostPerResult(g.campaigns).map((c) => {
              // Live status = optimistic override if we flipped it just now
              const status = statusOverrides[c.id] ?? c.status
              const isOn = status === 'ACTIVE'
              const busy = togglingId === c.id
              return (
                <div key={c.id} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isOn ? 'bg-emerald-500' : 'bg-red-500'}`} />
                    <span className={`truncate ${isTight ? 'text-[10px]' : 'text-[11px]'} font-medium`} title={c.name}>
                      {c.name}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {/* Cost per result is the headline number here: spend alone
                        cannot tell you which ad is cheap, only which is big.
                        Zone-colored on the same Rs scale as cost-per-client. */}
                    {(() => {
                      const spendUsd = parseFloat(c.spend || '0')
                      const results = c.results ?? 0
                      const cpr = costPerResultRs(spendUsd, results, USD_TO_RS)
                      const label = RESULT_LABEL[c.resultKind ?? 'none']
                      const size = isTight ? 'text-[10px]' : 'text-[11px]'
                      // Whole rupees only: these rows share their width with six
                      // action buttons, and paise never change a decision.
                      const spendRs = `Rs ${Math.round(spendUsd * USD_TO_RS).toLocaleString('en-IN')}`
                      if (cpr === null) {
                        // Spending with nothing to show for it - the loudest
                        // signal on the panel; zero spend just stays quiet.
                        return (
                          <span
                            className={`rounded px-1 py-0 ${size} font-black tabular-nums ${
                              spendUsd > 0 ? 'bg-red-500/20 text-red-400' : 'text-muted-foreground'
                            }`}
                            title={spendUsd > 0 ? `${spendRs} spent, no ${label} yet` : 'No spend yet'}
                          >
                            {spendUsd > 0 ? `${spendRs} \u00b7 0 ${label}` : spendRs}
                          </span>
                        )
                      }
                      const cz = ZONE_STYLES[zoneFor(cpr)]
                      return (
                        <span
                          className="flex items-center gap-1"
                          title={`${spendRs} spent \u00b7 ${results} ${label}${results !== 1 ? 's' : ''} \u00b7 ${formatRs(cpr)} per ${label}`}
                        >
                          {/* Spend and volume stay quiet context; the per-message
                              cost is what ranks these ads against each other. */}
                          <span className={`${size} tabular-nums text-muted-foreground`}>
                            {spendRs} {'\u00b7'} {results}
                          </span>
                          <span
                            className={`rounded px-1 py-0 ${size} font-black tabular-nums ${cz.bg} ${cz.text}`}
                          >
                            {formatRs(cpr)}/{label}
                          </span>
                        </span>
                      )
                    })()}
                    {/* What this ad actually BROUGHT IN. Cost per message says
                        how cheaply an ad starts conversations; only this says
                        whether those conversations turned into orders. Keyed by
                        deliveries.ad_id, so the tooltip can name the ad id. */}
                    {(() => {
                      const rev = campaignRevenue(c, adRevenue)
                      if (!rev) return null
                      const spendRsNum = parseFloat(c.spend || '0') * USD_TO_RS
                      // Return on ad spend: rupees booked per rupee spent.
                      const roas = spendRsNum > 0 ? rev.revenue / spendRsNum : null
                      const tone =
                        roas === null
                          ? 'bg-muted text-muted-foreground'
                          : roas >= 3
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : roas >= 1.5
                              ? 'bg-amber-500/20 text-amber-400'
                              : 'bg-red-500/20 text-red-400'
                      // Per-AD detail: which ad id produced how many clients.
                      // This is the whole point of forcing an ad id on every
                      // extension entry, so it leads the tooltip.
                      const breakdown = rev.perAd
                        .map(
                          (a) =>
                            `ad ${a.id}: ${a.clients} client${a.clients !== 1 ? 's' : ''} \u00b7 ${formatRs(a.revenue)} (${a.orders} order${a.orders !== 1 ? 's' : ''})`,
                        )
                        .join('\n')
                      // Cost per CLIENT for this campaign - spend divided by
                      // real orders booked, not by messages. Sits next to the
                      // Rs/msg chip so you can see an ad that starts cheap
                      // conversations but converts none of them.
                      const cac = rev.clients > 0 ? spendRsNum / rev.clients : null
                      const cacZone = cac !== null ? ZONE_STYLES[zoneFor(cac)] : null
                      const chip = `rounded px-1 py-0 ${isTight ? 'text-[10px]' : 'text-[11px]'} font-black tabular-nums`
                      return (
                        <>
                          <span
                            className={`shrink-0 ${chip} ${
                              cacZone
                                ? `${cacZone.bg} ${cacZone.text}`
                                : spendRsNum > 0
                                  ? 'bg-red-500/20 text-red-400'
                                  : 'bg-muted text-muted-foreground'
                            }`}
                            title={
                              cac !== null
                                ? `${rev.clients} client${rev.clients !== 1 ? 's' : ''} from this campaign \u00b7 ${formatRs(cac)} per client\n\nPer ad:\n${breakdown}`
                                : `No clients booked from this campaign yet\n\nPer ad:\n${breakdown}`
                            }
                          >
                            {rev.clients} cl{cac !== null ? ` \u00b7 ${formatRs(cac)}/cl` : ''}
                          </span>
                          <span
                            className={`shrink-0 ${chip} ${tone}`}
                            title={`Booked from this campaign's ads\n${breakdown}${
                              roas !== null ? `\n\n${roas.toFixed(1)}x of ${formatRs(spendRsNum)} spent` : ''
                            }\n\nOrder value - deliveries are still unpaid.`}
                          >
                            {formatRs(rev.revenue)} in{roas !== null ? ` \u00b7 ${roas.toFixed(1)}x` : ''}
                          </span>
                        </>
                      )
                    })()}
                    {/* Budget boost: add 20% / 50% of the remaining budget.
                        Shows the applied result inline once done. */}
                    {boostedNotes[c.id] ? (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-black tabular-nums text-emerald-400">
                        {boostedNotes[c.id]}
                      </span>
                    ) : (
                      <>
                        {([20, 50] as const).map((pct) => (
                          <button
                            key={pct}
                            type="button"
                            disabled={boostingKey !== null}
                            onClick={(e) => {
                              e.stopPropagation()
                              if (!window.confirm(`Increase remaining budget of "${c.name}" by ${pct}%?`)) return
                              boostBudget(c.id, pct)
                            }}
                            className="rounded bg-cyan-500/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-cyan-400 transition-colors hover:bg-cyan-500/30 disabled:opacity-50"
                            title={`Add ${pct}% of the remaining budget to this campaign`}
                          >
                            {boostingKey === `${c.id}:${pct}` ? '\u2026' : `+${pct}%`}
                          </button>
                        ))}
                        {/* Stabilize: shave 10% off the remaining budget -
                            the counterweight when a boost overshoots */}
                        <button
                          type="button"
                          disabled={boostingKey !== null}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (!window.confirm(`Stabilize "${c.name}": decrease remaining budget by 10%?`)) return
                            boostBudget(c.id, -10)
                          }}
                          className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-sky-400 transition-colors hover:bg-sky-500/30 disabled:opacity-50"
                          title="Stabilize: cut 10% of the remaining budget (use after an over-boost)"
                        >
                          {boostingKey === `${c.id}:-10` ? '\u2026' : '\u221210%'}
                        </button>
                        {/* Optimum decrease: budget = spent + days-to-end x 1.25/day */}
                        <button
                          type="button"
                          disabled={boostingKey !== null}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (
                              !window.confirm(
                                `Decrease "${c.name}" to its optimum? Budget becomes: spent so far + 1.25/day for each remaining day until the campaign ends.`,
                              )
                            )
                              return
                            boostBudget(c.id, 'optimum')
                          }}
                          className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-amber-400 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
                          title="Decrease budget to optimum: spent + 1.25/day for each day left until the end date"
                        >
                          {boostingKey === `${c.id}:optimum` ? '\u2026' : '\u2193OPT'}
                        </button>
                        {/* Least-aggressive optimum: same logic at 2.00/day */}
                        <button
                          type="button"
                          disabled={boostingKey !== null}
                          onClick={(e) => {
                            e.stopPropagation()
                            if (
                              !window.confirm(
                                `Decrease "${c.name}" to its least optimum? Budget becomes: spent so far + 2.00/day for each remaining day until the campaign ends.`,
                              )
                            )
                              return
                            boostBudget(c.id, 'optimum2')
                          }}
                          className="rounded bg-orange-500/15 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-orange-400 transition-colors hover:bg-orange-500/30 disabled:opacity-50"
                          title="Decrease budget to least optimum: spent + 2.00/day for each day left until the end date"
                        >
                          {boostingKey === `${c.id}:optimum2` ? '\u2026' : '\u2193OPT2'}
                        </button>
                      </>
                    )}
                    {/* Kill switch: pause / reactivate this ad on Facebook.
                        stopPropagation so the row doesn't collapse. */}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (isOn && !window.confirm(`Turn OFF "${c.name}" on Facebook?`)) return
                        toggleCampaign(c.id, status)
                      }}
                      className={`rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide transition-colors disabled:opacity-50 ${
                        isOn
                          ? 'bg-red-500/15 text-red-400 hover:bg-red-500/30'
                          : 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/30'
                      }`}
                      title={isOn ? 'Pause this campaign on Facebook' : 'Reactivate this campaign on Facebook'}
                    >
                      {busy ? '\u2026' : isOn ? 'Turn off' : 'Turn on'}
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
          {/* Today's edits on those campaigns, newest first */}
          <div className="mt-1 border-t border-border/40 pt-1">
            {groupEdits.length === 0 ? (
              <p className={`${isTight ? 'text-[10px]' : 'text-[11px]'} text-muted-foreground`}>No edits today</p>
            ) : (
              <>
                <p className={`${isTight ? 'text-[10px]' : 'text-[11px]'} font-semibold text-blue-400`}>
                  Edited {groupEdits.length}{'\u00d7'} today
                </p>
                {groupEdits.slice(0, 5).map((a, i) => (
                  <p
                    key={`${a.objectId}-${a.eventTime}-${i}`}
                    className={`truncate ${isTight ? 'text-[10px]' : 'text-[11px]'} ${
                      a.direction === 'increase' ? 'text-emerald-400' : a.direction === 'decrease' ? 'text-red-400' : 'text-muted-foreground'
                    }`}
                    title={`${a.objectName}: ${a.changeSummary}`}
                  >
                    <span className="tabular-nums text-muted-foreground">
                      {new Date(a.eventTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </span>{' '}
                    {a.changeSummary}
                  </p>
                ))}
              </>
            )}
          </div>
        </div>
      )}
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
        {/* Rs lives HERE once, so cells can be pure digits (no repeated
            currency prefix distorting the column) */}
        <span className="text-right">
          Spend <span className="text-amber-500">Rs</span>
        </span>
        <span className="text-right">Cl</span>
        <span className="text-right">
          Cost <span className="text-foreground/70">Rs</span>
        </span>
        <span
          className="text-right"
          title="Order value booked against this product's Facebook ad ids, and the return on its spend"
        >
          In <span className="text-emerald-500">Rs</span>
        </span>
        <span className="text-center" title="Budget action: increase / decrease / hold">Act</span>
      </div>
      <div className="min-h-0 overflow-hidden">
        {rows.map((g, i) => renderRow(g, colIndex * perCol + i + 1, i % 2 === 1))}
      </div>
    </div>
  )

  // Riders panel: today's DISTINCT client count per rider (the number that
  // must reconcile with the day's total), with an optional Regions toggle
  // that expands each rider's zone/locality coverage. Compact rows + scroll
  // so ALL riders are reachable, not just the first six.
  const assignedClients = riders.reduce((sum, r) => sum + (r.todayClients || 0), 0)
  const unassignedClients = Math.max(0, ridersTodayTotal - assignedClients)
  const ridersPanel = (
    // Compact mode (regions hidden): shrink-0, the full rider list always
    // shows and only the edits panel scrolls. Regions expanded: the list gets
    // much taller, so the panel flexes and scrolls internally instead.
    <div
      className={`relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-blue-400/25 shadow-[inset_0_0_24px_rgba(59,130,246,0.06)] ${
        showRiderRegions ? 'min-h-0 flex-1' : 'shrink-0'
      }`}
    >
      {/* HUD corner brackets */}
      <span aria-hidden className="pointer-events-none absolute left-0 top-0 h-3 w-3 rounded-tl-xl border-l-2 border-t-2 border-blue-400/70" />
      <span aria-hidden className="pointer-events-none absolute right-0 top-0 h-3 w-3 rounded-tr-xl border-r-2 border-t-2 border-blue-400/70" />
      <span aria-hidden className="pointer-events-none absolute bottom-0 left-0 h-3 w-3 rounded-bl-xl border-b-2 border-l-2 border-blue-400/70" />
      <span aria-hidden className="pointer-events-none absolute bottom-0 right-0 h-3 w-3 rounded-br-xl border-b-2 border-r-2 border-blue-400/70" />
      <div className={`flex shrink-0 items-center justify-between gap-2 border-b border-blue-400/20 bg-blue-500/10 px-2.5 ${isTight ? 'py-1' : 'py-1.5'}`}>
        <div className="flex min-w-0 items-center gap-2">
          <Bike className="h-4 w-4 shrink-0 text-blue-400 [filter:drop-shadow(0_0_5px_rgba(96,165,250,0.8))]" />
          <span className={`truncate ${isTight ? 'text-sm' : 'text-base'} font-black uppercase tracking-[0.15em] text-blue-400`}>
            Riders
          </span>
          <span className={`flex items-center gap-1 font-mono ${isTight ? 'text-[10px]' : 'text-xs'} uppercase text-blue-400/60`}>
            {'clients'}
            {ridersBatchDate && <span aria-hidden>{'\u00b7'}</span>}
            {/* Clickable batch date: a native date input drives the panel so
                any past/future delivery batch can be inspected */}
            <span className="relative inline-flex items-center">
              <input
                type="date"
                value={ridersBatchDate ?? ''}
                onChange={(e) => onRidersDateChange?.(e.target.value || null)}
                aria-label="Select delivery batch date"
                title="Select delivery batch date"
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-full [&::-webkit-calendar-picker-indicator]:cursor-pointer"
              />
              <span className="pointer-events-none flex items-center gap-1 rounded border border-blue-400/30 px-1 py-px text-blue-300 transition-colors">
                {ridersBatchDate
                  ? new Date(ridersBatchDate + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
                  : 'pick date'}
                <CalendarDays className="h-3 w-3" />
              </span>
            </span>
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowRiderRegions((v) => !v)}
            className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
              showRiderRegions
                ? 'border-blue-400/60 bg-blue-500/20 text-blue-300'
                : 'border-border text-muted-foreground hover:text-blue-400'
            }`}
          >
            Regions
          </button>
          <span
            className={`font-mono ${isTight ? 'text-xs' : 'text-sm'} font-black tabular-nums text-blue-300 [text-shadow:0_0_10px_rgba(96,165,250,0.7)]`}
          >
            {ridersTodayTotal}
          </span>
        </div>
      </div>
      <div className={showRiderRegions ? 'min-h-0 overflow-y-auto' : ''}>
        {riders.length === 0 ? (
          <div className="px-3 py-3 text-center text-sm text-muted-foreground">No regions allocated yet</div>
        ) : (
          <>
            {riders.map((r, i) => {
              const { zones, unmatched } = groupLocalitiesByZone(r.regions)
              return (
                <div
                  key={r.id}
                  className={`border-b border-border/50 px-2.5 ${isTight ? 'py-1' : 'py-1.5'} ${i % 2 === 1 ? 'bg-card/40' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className={`flex min-w-0 items-center gap-2 ${isTight ? 'text-xs' : 'text-sm'} font-bold`} title={r.name}>
                      {/* HUD rank index - a slim glowing tick, not a badge */}
                      <span className="flex shrink-0 items-center gap-1">
                        <span className="h-3.5 w-0.5 rounded-full bg-blue-400/80 shadow-[0_0_6px_rgba(96,165,250,0.9)]" />
                        <span className="font-mono text-[9px] font-bold tabular-nums text-blue-400/60">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                      </span>
                      <span className="truncate uppercase tracking-wide">{r.name}</span>
                      {/* Has clients on the batch but zero localities allocated:
                          flag it so dispatch allocates regions to this rider */}
                      {r.regions.length === 0 && (
                        <span className="shrink-0 rounded bg-amber-500/20 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-500">
                          No regions
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {/* Today's clients vs the rider's daily target rendered
                          as a segmented power-cell meter (10 glowing cells):
                          green = target hit, amber = close (80%+), blue =
                          charging. Reads instantly across the room. */}
                      {(() => {
                        const target = targetOverrides[r.id] ?? r.target ?? null
                        const clients = r.todayClients || 0
                        if (target === null || target <= 0) {
                          return (
                            <span className="rounded-full bg-blue-500/15 px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums text-blue-400">
                              {clients} cl
                            </span>
                          )
                        }
                        const pct = clients / target
                        const pctLabel = Math.round(pct * 100)
                        const toneText =
                          pct >= 1 ? 'text-emerald-400' : pct >= 0.8 ? 'text-amber-500' : 'text-blue-400'
                        const cellOn =
                          pct >= 1
                            ? 'bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.9)]'
                            : pct >= 0.8
                              ? 'bg-amber-400 shadow-[0_0_5px_rgba(251,191,36,0.9)]'
                              : 'bg-blue-400 shadow-[0_0_5px_rgba(96,165,250,0.9)]'
                        const CELLS = 10
                        const litCells = Math.min(CELLS, Math.round(pct * CELLS))
                        // The frontier cell pulses while charging toward target
                        return (
                          <span
                            className="flex items-center gap-1.5"
                            title={`${clients} of ${target} target clients (${pctLabel}%)`}
                          >
                            {/* % readout - monospace HUD style */}
                            <span className={`font-mono text-[11px] font-black tabular-nums ${toneText}`}>
                              {pctLabel}
                              <span className="opacity-60">%</span>
                            </span>
                            {/* segmented power cells */}
                            <span
                              className="flex items-center gap-[2px]"
                              role="progressbar"
                              aria-valuenow={clients}
                              aria-valuemin={0}
                              aria-valuemax={target}
                              aria-label={`${r.name}: ${clients} of ${target} clients`}
                            >
                              {Array.from({ length: CELLS }, (_, c) => (
                                <span
                                  key={c}
                                  className={`h-2.5 w-1 skew-x-[-12deg] rounded-[1px] ${
                                    c < litCells
                                      ? `${cellOn} ${c === litCells - 1 && pct < 1 ? 'animate-pulse' : ''}`
                                      : 'bg-muted'
                                  }`}
                                />
                              ))}
                            </span>
                            {/* raw count */}
                            <span className={`font-mono text-[11px] font-bold tabular-nums ${toneText}`}>
                              {clients}
                              <span className="opacity-50">/{target}</span>
                            </span>
                          </span>
                        )
                      })()}
                      {/* Target quick-adjust (admin action, synced to DB and
                          the Regions module). Visible with the Regions toggle
                          so the default wall stays clean. */}
                      {showRiderRegions && (r.target != null || targetOverrides[r.id] != null) && (
                        <span className="flex items-center gap-0.5">
                          <button
                            onClick={() => adjustTarget(r, -7)}
                            className="flex h-4 w-4 items-center justify-center rounded bg-red-500/15 text-[11px] font-bold leading-none text-red-400 hover:bg-red-500/30"
                            aria-label={`Decrease ${r.name} target by 7`}
                            title="Decrease target by 7"
                          >
                            {'\u2212'}
                          </button>
                          <button
                            onClick={() => adjustTarget(r, 7)}
                            className="flex h-4 w-4 items-center justify-center rounded bg-emerald-500/15 text-[11px] font-bold leading-none text-emerald-400 hover:bg-emerald-500/30"
                            aria-label={`Increase ${r.name} target by 7`}
                            title="Increase target by 7"
                          >
                            +
                          </button>
                        </span>
                      )}
                      {showRiderRegions && (
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                          {r.regions.length} loc
                        </span>
                      )}
                    </span>
                  </div>
                  {/* Region coverage only when the Regions toggle is on -
                      keeps default rows one line tall so all riders fit */}
                  {showRiderRegions && (
                    <div className="mt-0.5 space-y-0.5">
                      {zones.map((z) => (
                        <p
                          key={z.zone}
                          className={`${isTight ? 'text-[10px]' : 'text-[11px]'} leading-snug text-muted-foreground`}
                          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                          title={`${z.zone}: ${z.localities.join(', ')}`}
                        >
                          <span className="font-bold uppercase text-blue-400">{z.zone}</span>
                          <span className="text-blue-400/60"> {z.localities.length} {'\u00b7'} </span>
                          {z.localities.join(' \u00b7 ')}
                        </p>
                      ))}
                      {unmatched.length > 0 && (
                        <p
                          className={`${isTight ? 'text-[10px]' : 'text-[11px]'} leading-snug text-muted-foreground`}
                          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                          title={unmatched.join(', ')}
                        >
                          <span className="font-bold uppercase text-muted-foreground/70">Other</span>
                          <span className="text-muted-foreground/50"> {unmatched.length} {'\u00b7'} </span>
                          {unmatched.join(' \u00b7 ')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {/* Reconciliation: clients not yet assigned to any rider, with
                the localities they come from so dispatch knows where to act */}
            {unassignedClients > 0 && (
              <div className={`px-2.5 ${isTight ? 'py-1' : 'py-1.5'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`${isTight ? 'text-xs' : 'text-sm'} font-semibold text-amber-500`}>Unassigned</span>
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold tabular-nums text-amber-500">
                    {unassignedClients} cl
                  </span>
                </div>
                {unassignedLocalities.length > 0 && (
                  <p
                    className={`mt-0.5 ${isTight ? 'text-[10px]' : 'text-[11px]'} leading-snug text-amber-500/80`}
                    style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                    title={unassignedLocalities.map((l) => `${l.name} (${l.clients})`).join(', ')}
                  >
                    {unassignedLocalities.map((l) => `${l.name} ${l.clients}`).join(' \u00b7 ')}
                  </p>
                )}
              </div>
            )}
          </>
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
    // flex-1: takes whatever height remains under the full riders list and
    // scrolls its content internally
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border">
      <div className={`flex shrink-0 items-center justify-between gap-2 bg-violet-500/10 px-2.5 ${isTight ? 'py-1' : 'py-1.5'}`}>
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-violet-400" />
          <span className={`${isTight ? 'text-sm' : 'text-base'} font-bold text-violet-400`}>Recent Edits</span>
        </div>
        {/* Today's edit count front and center; total kept as context */}
        {(() => {
          const todayCount = activities.filter((a) => isTodayMu(a.eventTime)).length
          return (
            <span className={`${isTight ? 'text-xs' : 'text-sm'} font-bold tabular-nums text-violet-400`}>
              {todayCount} today
              <span className="ml-1 font-semibold text-muted-foreground">/ {activities.length}</span>
            </span>
          )
        })()}
      </div>
              <div className="min-h-0 overflow-y-auto">
        {activities.length === 0 ? (
          <div className="px-3 py-3 text-center text-sm text-muted-foreground">No edits in the last 7 days</div>
        ) : (
          activities.map((act, i) => {
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

  // Which CAMPAIGN brought how many clients, and where attribution is leaking.
  //
  // Two halves on purpose. The top ranks live campaigns by real clients, which
  // is the number the wall never showed at campaign level. The bottom lists
  // products whose clients arrived with no usable ad id - without it a product
  // can look like it has a terrible cost-per-client when the truth is that its
  // orders simply were not tagged.
  const attributionPanel = (() => {
    const ranked: { name: string; product: string; clients: number }[] = []
    for (const g of groups) {
      for (const c of g.campaigns) {
        const cr = campaignRevenue(c, adRevenue)
        if (!cr || cr.clients <= 0) continue
        ranked.push({ name: c.name, product: g.productName, clients: cr.clients })
      }
    }
    ranked.sort((a, b) => b.clients - a.clients)

    const gaps = attributionGaps.slice(0, 6)
    const missingTotal = attributionTotals?.missing ?? 0
    const coverage = attributionTotals ? Math.round(attributionTotals.coverage * 100) : null
    if (ranked.length === 0 && gaps.length === 0) return null

    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border">
        <div className={`flex shrink-0 items-center justify-between gap-2 bg-sky-500/10 px-2.5 ${isTight ? 'py-1' : 'py-1.5'}`}>
          <div className="flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-sky-400" />
            <span className={`${isTight ? 'text-sm' : 'text-base'} font-bold text-sky-400`}>Clients by Campaign</span>
          </div>
          {coverage !== null && (
            <span
              className={`${isTight ? 'text-xs' : 'text-sm'} font-bold tabular-nums ${
                coverage >= 90 ? 'text-emerald-400' : coverage >= 70 ? 'text-amber-500' : 'text-red-500'
              }`}
              title={`${attributionTotals?.attributed ?? 0} of ${attributionTotals?.total ?? 0} clients carry a real ad id`}
            >
              {coverage}% tagged
            </span>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto">
          {ranked.map((r, i) => (
            <div
              key={`${r.name}-${i}`}
              className={`flex items-center gap-2 border-b border-border/50 px-2.5 ${isTight ? 'py-0.5' : 'py-1'} ${
                i % 2 === 1 ? 'bg-card/40' : ''
              }`}
              title={`${r.name} \u00b7 ${r.product} \u00b7 ${r.clients} client${r.clients !== 1 ? 's' : ''}`}
            >
              <span className={`min-w-0 flex-1 truncate ${isTight ? 'text-[11px]' : 'text-xs'} font-semibold`}>{r.name}</span>
              <span className={`shrink-0 tabular-nums ${isTight ? 'text-xs' : 'text-sm'} font-bold text-sky-400`}>{r.clients}</span>
            </div>
          ))}

          {gaps.length > 0 && (
            <>
              <div className="sticky top-0 flex items-center justify-between bg-amber-500/10 px-2.5 py-1">
                <span className={`${isTight ? 'text-[10px]' : 'text-xs'} font-bold uppercase tracking-wide text-amber-500`}>
                  No ad id
                </span>
                <span className={`${isTight ? 'text-[10px]' : 'text-xs'} font-bold tabular-nums text-amber-500`}>
                  {missingTotal} client{missingTotal !== 1 ? 's' : ''}
                </span>
              </div>
              {gaps.map((g) => (
                <div
                  key={g.product}
                  className={`flex items-center gap-2 border-b border-border/50 px-2.5 ${isTight ? 'py-0.5' : 'py-1'}`}
                  title={`${g.product}: ${g.missing} of ${g.total} clients have no usable ad id`}
                >
                  <span className={`min-w-0 flex-1 truncate ${isTight ? 'text-[11px]' : 'text-xs'} font-semibold`}>{g.product}</span>
                  <span className={`shrink-0 tabular-nums ${isTight ? 'text-[10px]' : 'text-xs'} text-muted-foreground`}>
                    /{g.total}
                  </span>
                  <span className={`shrink-0 tabular-nums ${isTight ? 'text-xs' : 'text-sm'} font-bold text-amber-500`}>
                    {g.missing}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    )
  })()

  // News ticker: products that STILL need action - recommendation says
  // increase or decrease AND no budget edit has been made today. Once someone
  // edits the budget, the product drops off the ticker automatically.
  const NO_CLIENT_MIN_SPEND_RS = 100 // spent this much with zero clients = act now
  const spendRs = (g: TvGroup) => g.totalSpend * USD_TO_RS

  const pendingActions = ranked.filter(
    (g) =>
      !g.todayEdit &&
      // Turned-off ads are already actioned (spend is zero) - drop them
      !isGroupOff(g) &&
      (g.recommendation?.action === 'INCREASE' || g.recommendation?.action === 'DECREASE'),
  )
  // Zero-client products that have burned at least Rs 100: the top priority.
  const noClient = pendingActions
    .filter((g) => g.cac === null && spendRs(g) >= NO_CLIENT_MIN_SPEND_RS)
    .sort((a, b) => spendRs(b) - spendRs(a))
  const noClientKeys = new Set(noClient.map((g) => g.key))
  // Remaining actions: decreases (money burning) first, then increases.
  const decrease = pendingActions
    .filter((g) => g.recommendation?.action === 'DECREASE' && g.cac !== null)
    .sort((a, b) => (b.cac ?? 0) - (a.cac ?? 0))
  const increase = pendingActions
    .filter((g) => g.recommendation?.action === 'INCREASE' && !noClientKeys.has(g.key))
    .sort((a, b) => (a.cac ?? 0) - (b.cac ?? 0))
  const tickerItems = [...noClient, ...decrease, ...increase]

  // Edited 2+ hours ago but the cost still isn't improving: back in the
  // news as top priority - either cut deeper or switch it OFF (over Rs 150).
  const stalledItems = ranked
    .map((g) => ({ g, info: stalledInfo(g) }))
    .filter((x): x is { g: TvGroup; info: { hoursAgo: number; turnOff: boolean } } => x.info !== null)
    .sort((a, b) => (b.g.cac ?? 0) - (a.g.cac ?? 0))

  // ---- Snapshot of the whole wall for the cat's AI briefing. Stored in a
  // ref + stable callback so the cat's 30-min auto-refresh timers never
  // reset on re-render.
  snapshotRef.current = () => ({
    date: new Date().toISOString(),
    totals: {
      totalSpendRs: Math.round(totalSpend * USD_TO_RS),
      totalClients: ranked.reduce((s, g) => s + g.clients, 0),
      products: groups.length,
      campaigns: campaignCount,
      activeCampaigns,
      balanceOwedRs: Math.round(totalBalanceOwed * USD_TO_RS),
    },
    breakingNews: {
      noClients: noClient.map((g) => ({ product: g.productName, spentRs: Math.round(spendRs(g)) })),
      decrease: decrease.map((g) => ({ product: g.productName, costPerClientRs: g.cac })),
      increase: increase.map((g) => ({ product: g.productName, costPerClientRs: g.cac })),
      stalled: stalledItems.map(({ g, info }) => ({
        product: g.productName,
        costPerClientRs: g.cac,
        hoursSinceEdit: info.hoursAgo,
        verdict: info.turnOff ? 'TURN OFF' : 'DECREASE MORE',
      })),
    },
    // Cost/client leaders and losers so the cat names real products
    bestProducts: ranked.filter((g) => g.cac !== null).slice(0, 5)
      .map((g) => ({ product: g.productName, costPerClientRs: g.cac, clients: g.clients })),
    worstProducts: ranked.filter((g) => g.cac !== null).slice(-5)
      .map((g) => ({ product: g.productName, costPerClientRs: g.cac, clients: g.clients })),
    editedToday: ranked.filter((g) => g.todayEdit)
      .map((g) => ({ product: g.productName, edit: g.todayEdit?.summary, costPerClientRs: g.cac })),
    riders: riders.map((r) => ({
      name: r.name,
      clientsToday: r.todayClients || 0,
      dailyTarget: targetOverrides[r.id] ?? r.target ?? null,
    })),
    recentEdits: activities.slice(0, 25).map((a) => ({
      time: a.eventTime,
      campaign: a.objectName,
      change: a.changeSummary,
    })),
    unassignedLocalities,
  })

  const stalledTickerItem = ({ g, info }: { g: TvGroup; info: { hoursAgo: number; turnOff: boolean } }, idx: number) => {
    const base = editBaselines[g.key]
    return (
      <span key={`stalled-${g.key}-${idx}`} className="inline-flex items-center gap-2 whitespace-nowrap">
        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-sm font-bold uppercase ${
          info.turnOff ? 'bg-red-600 text-white animate-pulse' : 'bg-orange-500/25 text-orange-400'
        }`}>
          {info.turnOff ? '\u23fb Turn off' : '\u2193 Decrease more'}
        </span>
        <span className="text-base font-bold">{g.productName}</span>
        <span className="text-base font-bold tabular-nums text-red-500">{formatRs(g.cac as number)}/cl</span>
        <span className="text-sm tabular-nums text-muted-foreground">
          no improvement {Math.floor(info.hoursAgo)}h after edit
          {base?.cac != null ? ` (was ${formatRs(base.cac)})` : ''}
        </span>
        <span className="mx-4 text-muted-foreground/40">{'\u25c6'}</span>
      </span>
    )
  }

  const tickerItem = (g: TvGroup, idx: number) => {
    const isNoClient = g.cac === null
    const isDecrease = g.recommendation?.action === 'DECREASE'
    // Zero-client gets its own alarming label; then decrease/increase
    const tag = isNoClient ? '\u26a0 No clients' : isDecrease ? '\u2193 Decrease' : '\u2191 Increase'
    const tagClass = isNoClient
      ? 'bg-red-600 text-white animate-pulse'
      : isDecrease
        ? 'bg-red-500/20 text-red-500'
        : 'bg-emerald-500/20 text-emerald-500'
    const valueClass = isNoClient || isDecrease ? 'text-red-500' : 'text-emerald-500'
    return (
      <span key={`${g.key}-${idx}`} className="inline-flex items-center gap-2 whitespace-nowrap">
        <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-sm font-bold uppercase ${tagClass}`}>
          {tag}
        </span>
        <span className="text-base font-bold">{g.productName}</span>
        <span className={`text-base font-bold tabular-nums ${valueClass}`}>
          {isNoClient ? `${formatSpend(g.totalSpend.toString())} wasted` : `${formatRs(g.cac as number)}/cl`}
        </span>
        <span className="text-sm tabular-nums text-muted-foreground">
          {isNoClient ? '0 clients' : `${formatSpend(g.totalSpend.toString())} spent \u00b7 ${g.clients} cl`}
        </span>
        <span className="mx-4 text-muted-foreground/40">{'\u25c6'}</span>
      </span>
    )
  }

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
            onClick={() => setShowRulesCat((v) => !v)}
            className={`flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors ${
              showRulesCat
                ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-400'
                : 'border-border bg-card hover:bg-muted'
            }`}
            aria-label="Toggle the Vision cat"
          >
            <Cat className="h-4 w-4" />
            <span className="sr-only">Vision cat</span>
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

      {/* The animated cat mascot - one system with the breaking-news bar:
          it plays when the wall is clean and goes on duty (red, urgent,
          wearing the same count) whenever ACTION NEEDED has items */}
      {showRulesCat && (
        <TvRulesCat getSnapshot={getWallSnapshot} alertCount={tickerItems.length + stalledItems.length} />
      )}

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

        {/* Booked revenue that IS tied to an ad id, plus the money that is not.
            The second half matters as much as the first: deliveries.ad_id is
            shared with the CRM (it also holds labels like "AI transferred"),
            so a chunk of real revenue can never be credited to an ad. Showing
            it stops the per-ad totals from being read as the whole business. */}
        {(() => {
          const bookedRs = Object.values(adRevenue).reduce((s, a) => s + a.revenue, 0)
          if (bookedRs <= 0) return null
          const lo = adRevenueLeftover
          const unmatched = lo ? lo.labelledRevenue + lo.missingRevenue : 0
          const unmatchedOrders = lo ? lo.labelledOrders + lo.missingOrders : 0
          return (
            <>
              <span className="mx-1 h-5 w-px bg-border" />
              <div
                className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1"
                title={`Order value booked against a real Facebook ad id${
                  showTodayOnly ? ' for orders entered today' : ' (all time)'
                }. Deliveries are still unpaid, so this is revenue earned, not cash collected.`}
              >
                <span className="text-sm font-semibold text-muted-foreground">Booked / ad</span>
                <span className="text-sm font-bold tabular-nums text-emerald-400">{formatRs(bookedRs)}</span>
              </div>
              {unmatched > 0 && (
                <div
                  className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1"
                  title={`${formatRs(unmatched)} across ${unmatchedOrders} order${
                    unmatchedOrders !== 1 ? 's' : ''
                  } cannot be credited to any ad: ${
                    lo ? `${lo.labelledOrders} carry a CRM label instead of an ad id, ${lo.missingOrders} have none` : ''
                  }.`}
                >
                  <span className="text-sm font-semibold text-muted-foreground">No ad id</span>
                  <span className="text-sm font-bold tabular-nums text-amber-500">{formatRs(unmatched)}</span>
                </div>
              )}
            </>
          )
        })()}
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
              {attributionPanel}
              {editsPanel}
            </div>
          </div>
        )}
      </div>

      {/* Breaking-news ticker: ads NOT yet edited that need a budget action.
          Content is duplicated for a seamless infinite scroll; speed scales
          with item count so it stays readable. Disappears when nothing is
          pending (everything actioned). */}
      {(tickerItems.length > 0 || stalledItems.length > 0) && (
        <div className="mt-2 flex shrink-0 items-stretch overflow-hidden rounded-lg border border-red-500/30 bg-card">
          <div className="flex shrink-0 items-center gap-1.5 bg-red-600 px-3 text-white">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm font-bold uppercase tracking-wider">
              Action needed {'\u00b7'} {tickerItems.length + stalledItems.length}
            </span>
          </div>
          <div className="relative flex-1 overflow-hidden">
            <div
              className="flex w-max items-center py-1.5"
              style={{ animation: `tv-ticker ${Math.max(20, (tickerItems.length + stalledItems.length) * 5)}s linear infinite` }}
            >
              {/* Stalled edits lead the news: they were already actioned once
                  and are STILL burning, so they outrank fresh recommendations */}
              {stalledItems.map((x, i) => stalledTickerItem(x, i))}
              {tickerItems.map((g, i) => tickerItem(g, i))}
              {/* duplicate for seamless loop */}
              {stalledItems.map((x, i) => stalledTickerItem(x, i + stalledItems.length))}
              {tickerItems.map((g, i) => tickerItem(g, i + tickerItems.length))}
            </div>
          </div>
          <style>{`@keyframes tv-ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }`}</style>
        </div>
      )}
    </div>
  )
}
