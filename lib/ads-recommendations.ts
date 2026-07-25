// Budget action recommendations for ad campaigns (recommend-only; the team
// acts inside Facebook Ads Manager). Shared by the Ads dashboard and TV mode
// so the rules live in exactly one place.
//
// Rules (agreed thresholds):
//   HOLD     - campaign younger than MIN_DAYS (4): too early to judge
//   INCREASE - 4+ days old AND cost/client below Rs 50: performing, scale it
//   WATCH    - Rs 50-99 cost/client: neutral zone, keep running
//   DECREASE - Rs 100+ cost/client (or 4+ days with spend but zero clients)
//   EDITED   - a budget edit already happened within the watch window (4 days):
//              it's been taken care of, we're now watching whether results
//              actually improve. Carries a live verdict from the current CAC.

export const MIN_CAMPAIGN_DAYS = 4
export const INCREASE_BELOW_RS = 50
export const DECREASE_AT_RS = 100
/** Days after a budget edit during which we watch instead of re-recommending */
export const EDIT_WATCH_DAYS = 4

export type RecommendationAction = 'HOLD' | 'INCREASE' | 'WATCH' | 'DECREASE' | 'EDITED'

/** How results look since the edit, judged from the current cost/client */
export type EditVerdict = 'improving' | 'neutral' | 'not-improving'

export interface Recommendation {
  action: RecommendationAction
  reason: string
  daysActive: number | null
  /** Only set when action = EDITED: is the edit paying off so far? */
  verdict?: EditVerdict
  /** Only set when action = EDITED: days since the budget edit */
  daysSinceEdit?: number
}

export function getRecommendation({
  createdTime,
  cac,
  hasSpend = true,
  lastEditTime,
  lastEditDirection,
}: {
  /** Campaign created_time from Facebook (ISO string), null if unknown */
  createdTime: string | null | undefined
  /** Rs cost per client; null when the product has spend but no clients yet */
  cac: number | null
  /** Whether there is any spend at all (no spend = nothing to recommend) */
  hasSpend?: boolean
  /** Most recent budget edit time from the FB activity feed (ISO), if any */
  lastEditTime?: string | null
  /** Direction of that edit: 'increase' | 'decrease' | other */
  lastEditDirection?: string | null
}): Recommendation | null {
  if (!hasSpend) return null

  let daysActive: number | null = null
  if (createdTime) {
    const created = new Date(createdTime).getTime()
    if (!Number.isNaN(created)) {
      daysActive = Math.floor((Date.now() - created) / 86400000)
    }
  }

  // Already-edited rule: if a budget change happened within the watch window,
  // the action was taken - don't nag with INCREASE/DECREASE again. Instead
  // report that it's being watched, with a verdict on whether the numbers
  // look better: green zone = improving, red zone = still not paying off.
  if (lastEditTime && (lastEditDirection === 'increase' || lastEditDirection === 'decrease')) {
    const edited = new Date(lastEditTime).getTime()
    if (!Number.isNaN(edited)) {
      const daysSinceEdit = Math.floor((Date.now() - edited) / 86400000)
      if (daysSinceEdit >= 0 && daysSinceEdit < EDIT_WATCH_DAYS) {
        const verdict: EditVerdict =
          cac !== null && cac < INCREASE_BELOW_RS
            ? 'improving'
            : cac !== null && cac < DECREASE_AT_RS
              ? 'neutral'
              : 'not-improving'
        const verdictText =
          verdict === 'improving'
            ? `results look good (Rs ${Math.round(cac!)}/client)`
            : verdict === 'neutral'
              ? `results neutral so far (Rs ${Math.round(cac!)}/client)`
              : cac === null
                ? 'no clients since the edit yet'
                : `still expensive (Rs ${Math.round(cac)}/client)`
        const dayLabel = daysSinceEdit === 0 ? 'today' : `${daysSinceEdit}d ago`
        return {
          action: 'EDITED',
          reason: `Budget ${lastEditDirection}d ${dayLabel} - watching: ${verdictText} (${EDIT_WATCH_DAYS - daysSinceEdit}d of watch window left)`,
          daysActive,
          verdict,
          daysSinceEdit,
        }
      }
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
  EDITED: { label: 'Edited', arrow: '✓', text: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
}

// Verdict styling for the EDITED state: is the change paying off so far?
export const VERDICT_STYLES: Record<EditVerdict, { label: string; text: string }> = {
  improving: { label: 'Improving', text: 'text-emerald-500' },
  neutral: { label: 'No change yet', text: 'text-amber-500' },
  'not-improving': { label: 'Not improving', text: 'text-red-500' },
}
