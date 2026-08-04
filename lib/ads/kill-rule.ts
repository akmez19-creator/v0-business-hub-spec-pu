// The Rs 150 kill rule, isolated as a pure function so it can be reasoned
// about and tested without Facebook or the database in the way.
//
// The rule the user chose: an ad that has burned Rs 150 or more and produced
// ZERO clients, sustained for more than a day, is waste and should be turned
// off - and must then STAY off.
//
// Deliberately NOT cost-per-client. tv-dashboard.tsx already had a
// TURN_OFF_CAC = 150 constant testing `cac > 150`, which is a different rule:
// it kills ads that ARE producing clients, just expensively. That constant was
// display-only (it tinted a row and never turned anything off), and it is not
// what was asked for here.

import { usdToRs } from './currency'

/** Rs burned with nothing to show before an ad is considered waste. */
export const KILL_SPEND_RS = 150

/**
 * An ad must be older than this before the rule can fire. A fresh ad that has
 * spent Rs 150 in its first hours has not been given a fair chance - the
 * delivery data it would be judged on has not even arrived yet.
 */
export const KILL_MIN_AGE_HOURS = 24

export interface AdPerformance {
  adId: string
  adName?: string
  /** Facebook spend for this ad, in USD */
  spendUsd: number
  /** Distinct clients attributed to this ad via deliveries.ad_id */
  clients: number
  /** When the ad started running */
  createdAt: string | Date | null
  /** Set once the ad has been killed - a killed ad is never re-evaluated */
  killedAt?: string | Date | null
  /** Set when a human explicitly revives a killed ad, re-arming the rule */
  reactivatedAt?: string | Date | null
  /** Facebook effective_status; only live ads are worth flagging */
  status?: string
}

export type KillVerdict =
  | { kill: false; reason: string }
  | { kill: true; reason: string; spendRs: number; ageHours: number }

function hoursSince(value: string | Date | null | undefined, now: Date): number | null {
  if (!value) return null
  const then = value instanceof Date ? value : new Date(value)
  const ms = then.getTime()
  if (!Number.isFinite(ms)) return null
  return (now.getTime() - ms) / 3_600_000
}

/**
 * Decide whether one ad should be killed.
 *
 * Returns a reason in BOTH directions on purpose: the UI shows why an ad was
 * spared as well as why it was flagged, so a surprising verdict can be
 * understood instead of guessed at.
 */
export function evaluateAd(ad: AdPerformance, now: Date = new Date()): KillVerdict {
  // An already-killed ad stays killed. This is the "li rest teign" guarantee:
  // without it the nightly evaluator would re-list ads a human already dealt
  // with, and a careless bulk action could revive them.
  if (ad.killedAt && !ad.reactivatedAt) {
    return { kill: false, reason: 'Already killed' }
  }

  // Paused/archived ads are not burning money, so there is nothing to stop.
  const status = (ad.status || '').toUpperCase()
  if (status && status !== 'ACTIVE') {
    return { kill: false, reason: `Not active (${status.toLowerCase()})` }
  }

  // A single attributed client means the ad works. Cost is a separate
  // question, and not the one this rule answers.
  if (ad.clients > 0) {
    return { kill: false, reason: `${ad.clients} client${ad.clients === 1 ? '' : 's'}` }
  }

  const spendRs = usdToRs(ad.spendUsd)
  if (spendRs < KILL_SPEND_RS) {
    return { kill: false, reason: `Only Rs ${Math.round(spendRs)} spent so far` }
  }

  // Age is measured from the LATER of created and reactivated: a revived ad
  // gets a fresh 24h window rather than being killed again instantly on the
  // strength of the spend that got it killed the first time.
  const createdHours = hoursSince(ad.createdAt, now)
  const revivedHours = hoursSince(ad.reactivatedAt, now)
  const ageHours =
    revivedHours !== null && createdHours !== null
      ? Math.min(createdHours, revivedHours)
      : (revivedHours ?? createdHours)

  // Unknown age is not treated as old. Guessing here risks killing a
  // brand-new ad whose creation timestamp simply failed to come through.
  if (ageHours === null) {
    return { kill: false, reason: 'Age unknown' }
  }
  if (ageHours <= KILL_MIN_AGE_HOURS) {
    return { kill: false, reason: `Only ${Math.round(ageHours)}h old` }
  }

  return {
    kill: true,
    reason: `Rs ${Math.round(spendRs)} spent, no clients in ${Math.round(ageHours / 24)}d`,
    spendRs,
    ageHours,
  }
}

/** Apply the rule across a set of ads and return only the ones to kill. */
export function findKillCandidates(
  ads: AdPerformance[],
  now: Date = new Date(),
): Array<AdPerformance & { verdict: Extract<KillVerdict, { kill: true }> }> {
  const out: Array<AdPerformance & { verdict: Extract<KillVerdict, { kill: true }> }> = []
  for (const ad of ads) {
    const verdict = evaluateAd(ad, now)
    if (verdict.kill) out.push({ ...ad, verdict })
  }
  // Worst offenders first - the biggest waste is the most urgent to stop.
  return out.sort((a, b) => b.verdict.spendRs - a.verdict.spendRs)
}
