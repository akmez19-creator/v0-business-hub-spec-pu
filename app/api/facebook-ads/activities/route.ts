import { NextResponse } from 'next/server'

const FACEBOOK_API_VERSION = 'v21.0'
const FACEBOOK_GRAPH_URL = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`

// Campaign edit history: pulls the ad account Activities feed from Facebook so
// the team can see WHAT changed (budget Rs X -> Rs Y, status flips), WHO did it
// and WHEN - both as a "Recent Edits" feed and a per-campaign last-edit lookup.
//
// GET /api/facebook-ads/activities?accountIds=act_1,act_2

interface RawActivity {
  event_type?: string
  event_time?: string
  actor_name?: string
  object_name?: string
  object_id?: string
  extra_data?: string
}

export interface AdActivity {
  eventTime: string
  actorName: string
  objectName: string
  objectId: string
  eventType: string
  /** Human summary, e.g. "Budget Rs 500 -> Rs 750 (+50%)" */
  changeSummary: string
  /** 'increase' | 'decrease' | 'status' | 'other' for coloring */
  direction: 'increase' | 'decrease' | 'status' | 'other'
}

// Only the edits the team actually acts on: budget changes and on/off flips.
// Everything else (schedule, bidding, creation, review churn) is noise.
const RELEVANT_EVENTS: Record<string, string> = {
  update_campaign_budget: 'Budget',
  update_ad_set_budget: 'Budget',
  update_campaign_run_status: 'Status',
  update_ad_set_run_status: 'Status',
  update_ad_run_status: 'Status',
}

// Facebook's automatic review/delivery states - transitions involving these
// are system churn (ad review cycling), not human edits. Filtered out.
const SYSTEM_STATUSES = /pending|in review|processing|scheduled|with issues/i

function formatRs(cents: number): string {
  // FB budget values in extra_data are in account currency minor units (cents)
  const rs = cents / 100
  return `Rs ${rs.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

function parseActivity(raw: RawActivity): AdActivity | null {
  const eventType = raw.event_type || ''
  const label = RELEVANT_EVENTS[eventType]
  if (!label) return null

  // Strict output: only three kinds of entries survive -
  //   budget INCREASED (with values), budget DECREASED (with values),
  //   or a real ON/OFF flip. Anything unparseable or system-driven is dropped.
  let changeSummary = ''
  let direction: AdActivity['direction'] = 'other'

  if (!raw.extra_data) return null
  try {
    const extra = JSON.parse(raw.extra_data)
    const oldVal = extra.old_value
    const newVal = extra.new_value

    if (eventType.includes('budget')) {
      const oldNum = Number(oldVal)
      const newNum = Number(newVal)
      // No values or no actual change = noise, drop it
      if (!isFinite(oldNum) || !isFinite(newNum) || oldNum <= 0 || newNum === oldNum) return null
      const pct = Math.round(((newNum - oldNum) / oldNum) * 100)
      direction = newNum > oldNum ? 'increase' : 'decrease'
      changeSummary = `Budget ${direction === 'increase' ? 'increased' : 'decreased'}: ${formatRs(oldNum)} \u2192 ${formatRs(newNum)} (${pct > 0 ? '+' : ''}${pct}%)`
    } else {
      // Status flip: keep only genuine on/off changes by a person. Any
      // transition touching a system review state (Pending process etc.)
      // is Facebook churn, not an edit.
      const from = String(oldVal ?? '')
      const to = String(newVal ?? '')
      if (!to || SYSTEM_STATUSES.test(from) || SYSTEM_STATUSES.test(to)) return null
      direction = 'status'
      changeSummary = /^active$/i.test(to) ? `Turned ON (${from} \u2192 ${to})` : `Turned OFF (${from} \u2192 ${to})`
    }
  } catch {
    return null
  }

  return {
    eventTime: raw.event_time || '',
    actorName: raw.actor_name || 'Unknown',
    objectName: raw.object_name || '',
    objectId: raw.object_id || '',
    eventType,
    changeSummary,
    direction,
  }
}

async function fetchAccountActivities(accessToken: string, accountId: string): Promise<AdActivity[]> {
  // Last 7 days of activity, most recent first
  const since = Math.floor(Date.now() / 1000) - 7 * 86400
  const url =
    `${FACEBOOK_GRAPH_URL}/${accountId}/activities` +
    `?fields=event_type,event_time,actor_name,object_name,object_id,extra_data` +
    `&since=${since}&limit=100&access_token=${accessToken}`

  const response = await fetch(url)
  if (!response.ok) {
    // Non-fatal per account: return empty so one bad account doesn't kill the feed
    return []
  }
  const data = await response.json()
  const rows: RawActivity[] = data.data || []
  return rows.map(parseActivity).filter((a): a is AdActivity => a !== null)
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const accountIdsParam = searchParams.get('accountIds') || ''
  const accountIds = accountIdsParam
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^act_\d+$/.test(s))

  const accessToken = process.env.FACEBOOK_ACCESS_TOKEN
  if (!accessToken) {
    return NextResponse.json({ error: 'Facebook access token not configured' }, { status: 500 })
  }
  if (accountIds.length === 0) {
    return NextResponse.json({ activities: [], lastEditByObject: {} })
  }

  try {
    const perAccount = await Promise.all(accountIds.map((id) => fetchAccountActivities(accessToken, id)))
    // Drop duplicate entries (same object + same change) keeping the newest
    const seen = new Set<string>()
    const activities = perAccount
      .flat()
      .sort((a, b) => new Date(b.eventTime).getTime() - new Date(a.eventTime).getTime())
      .filter((a) => {
        const key = `${a.objectId}|${a.changeSummary}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 50)

    // Last edit per object id so each campaign row can show its own indicator
    const lastEditByObject: Record<string, AdActivity> = {}
    for (const act of activities) {
      if (act.objectId && !lastEditByObject[act.objectId]) {
        lastEditByObject[act.objectId] = act
      }
    }

    return NextResponse.json({ activities, lastEditByObject })
  } catch (error) {
    console.error('[v0] facebook activities error:', error)
    return NextResponse.json({ error: 'Failed to fetch activities' }, { status: 500 })
  }
}
