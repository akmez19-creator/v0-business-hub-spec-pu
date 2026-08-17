import { NextResponse } from 'next/server'
import { FbGraphError, getAppUsage } from './graph'

/**
 * Facebook's app-wide hourly throttle (error #4 and friends) is the single
 * most misdiagnosed failure in this dashboard.
 *
 * When it hits, every Graph call returns an empty `data` array, which is
 * indistinguishable from "this token has no permissions" unless you actually
 * read the error envelope. The inbox used to render a "your token is broken,
 * regenerate it" panel - advice that is worse than useless here, because a
 * freshly generated Graph Explorer token is SHORT-LIVED. Following it swaps a
 * working never-expiring token for one that silently dies a couple of hours
 * later, turning a self-healing 1-hour outage into a permanent breakage.
 *
 * So throttling gets its own reason code and its own copy: wait, don't touch
 * the token.
 */
export function isRateLimit(e: unknown): boolean {
  return e instanceof FbGraphError && e.isRateLimit
}

/**
 * 200 rather than 429: like the permission states, this is a temporary
 * condition the UI renders inline, not a fault the caller can fix by retrying
 * differently. `reason: 'rate-limit'` is what the UI switches on.
 */
export function rateLimitResponse(e: unknown) {
  const usage = getAppUsage()
  return NextResponse.json({
    success: false,
    needsPermission: false,
    rateLimited: true,
    reason: 'rate-limit',
    usagePct: usage?.pct ?? null,
    error:
      e instanceof Error && e.message
        ? e.message
        : 'Facebook is temporarily rate limiting this app.',
  })
}
