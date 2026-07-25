// Budget action recommendations for ad campaigns (recommend-only; the team
// acts inside Facebook Ads Manager). Shared by the Ads dashboard and TV mode
// so the rules live in exactly one place.
//
// Rules (agreed thresholds):
//   HOLD     - campaign younger than MIN_DAYS (4): too early to judge
//   INCREASE - 4+ days old AND cost/client below Rs 50: performing, scale it
//   WATCH    - Rs 50-99 cost/client: neutral zone, keep running
//   DECREASE - Rs 100+ cost/client (or 4+ days with spend but zero clients)

export const MIN_CAMPAIGN_DAYS = 4
export const INCREASE_BELOW_RS = 50
export const DECREASE_AT_RS = 100

export type RecommendationAction = 'HOLD' | 'INCREASE' | 'WATCH' | 'DECREASE'

export interface Recommendation {
  action: RecommendationAction
  reason: string
  daysActive: number | null
}

export function getRecommendation({
  createdTime,
  cac,
  hasSpend = true,
}: {
  /** Campaign created_time from Facebook (ISO string), null if unknown */
  createdTime: string | null | undefined
  /** Rs cost per client; null when the product has spend but no clients yet */
  cac: number | null
  /** Whether there is any spend at all (no spend = nothing to recommend) */
  hasSpend?: boolean
}): Recommendation | null {
  if (!hasSpend) return null

  let daysActive: number | null = null
  if (createdTime) {
    const created = new Date(createdTime).getTime()
    if (!Number.isNaN(created)) {
      daysActive = Math.floor((Date.now() - created) / 86400000)
    }
  }

  // Minimum runtime rule overrides everything: all ads must run at least 4 days
  if (daysActive !== null && daysActive < MIN_CAMPAIGN_DAYS) {
    return {
      action: 'HOLD',
      reason: `Day ${daysActive + 1} of ${MIN_CAMPAIGN_DAYS} - too early to act`,
      daysActive,
    }
  }

  if (cac === null) {
    // 4+ days of spend with zero clients: treat as burning money
    return { action: 'DECREASE', reason: 'No clients yet despite spend', daysActive }
  }

  if (cac < INCREASE_BELOW_RS) {
    return { action: 'INCREASE', reason: `Rs ${Math.round(cac)}/client - below Rs ${INCREASE_BELOW_RS}, scale it`, daysActive }
  }
  if (cac >= DECREASE_AT_RS) {
    return { action: 'DECREASE', reason: `Rs ${Math.round(cac)}/client - at/above Rs ${DECREASE_AT_RS}, reduce budget`, daysActive }
  }
  return { action: 'WATCH', reason: `Rs ${Math.round(cac)}/client - neutral zone, keep running`, daysActive }
}

// Display styling per action, shared between dashboard and TV mode
export const RECOMMENDATION_STYLES: Record<
  RecommendationAction,
  { label: string; arrow: string; text: string; bg: string; border: string }
> = {
  INCREASE: { label: 'Increase', arrow: '↑', text: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  DECREASE: { label: 'Decrease', arrow: '↓', text: 'text-red-500', bg: 'bg-red-500/10', border: 'border-red-500/30' },
  WATCH: { label: 'Watch', arrow: '→', text: 'text-amber-500', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
  HOLD: { label: 'Hold', arrow: '●', text: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/30' },
}
