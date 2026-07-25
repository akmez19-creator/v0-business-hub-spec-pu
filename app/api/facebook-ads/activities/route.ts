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

// Budget changes AND on/off flips. Turning an ad OFF is a real action (it
// cuts spend to zero, stronger than any budget decrease) so it must show in
// the feed and count as a taken action; turning ON counts like an increase.
// Review churn, schedule/bidding changes remain noise and are dropped.
const RELEVANT_EVENTS: Record<string, string> = {
  update_campaign_budget: 'Budget',
  update_ad_set_budget: 'Budget',
  update_campaign_run_status: 'Status',
  update_ad_set_run_status: 'Status',
  update_ad_run_status: 'Status',
}

// Normalize FB run-status values (strings like "ACTIVE"/"PAUSED" or numeric
// codes: 1 = active, 2 = paused/off) into 'on' | 'off' | null
function runStatus(value: unknown): 'on' | 'off' | null {
  if (value == null) return null
  const v = String(typeof value === 'object' ? (value as Record<string, unknown>).new_value ?? (value as Record<string, unknown>).old_value ?? '' : value).toUpperCase()
  if (v === 'ACTIVE' || v === '1') return 'on'
  if (v === 'PAUSED' || v === 'INACTIVE' || v === '2' || v === 'OFF') return 'off'
  return null
}

// Budget values in extra_data are USD cents; the team thinks in Rs
const USD_TO_RS = 57.5

function formatRs(usdCents: number): string {
  const rs = (usdCents / 100) * USD_TO_RS
  return `Rs ${rs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

// extra_data for budget events is composite:
//   { old_value: { type:"payment_amount", old_value: 12000, ... },
//     new_value: { type:"payment_amount", new_value: 10000, ... } }
// The amount lives INSIDE the nested object, keyed old_value/new_value again.
function extractAmount(node: unknown, key: 'old_value' | 'new_value'): number | null {
  if (node == null) return null
  if (typeof node === 'number') return node
  if (typeof node === 'string') {
    const n = Number(node)
    return isFinite(n) ? n : null
  }
  if (typeof node === 'object') {
    const inner = (node as Record<string, unknown>)[key]
    if (typeof inner === 'number') return inner
    if (typeof inner === 'string') {
      const n = Number(inner)
      return isFinite(n) ? n : null
    }
  }
  return null
}

function parseActivity(raw: RawActivity): AdActivity | null {
  const eventType = raw.event_type || ''
  const label = RELEVANT_EVENTS[eventType]
  if (!label) return null

  let changeSummary = ''
  let direction: AdActivity['direction'] = 'other'

  if (!raw.extra_data) return null
  try {
    const extra = JSON.parse(raw.extra_data)

    if (label === 'Status') {
      // Only turning OFF is a deliberate spend action (cuts spend to zero,
      // counts as a decrease). Turn-ONs are routine re-activations - not a
      // performance action - so they stay neutral: visible in the feed but
      // never counted as an actioned edit or shown with a green arrow.
      const oldS = runStatus(extra.old_value)
      const newS = runStatus(extra.new_value)
      if (newS === null || newS === oldS) return null
      direction = newS === 'off' ? 'decrease' : 'other'
      changeSummary = newS === 'off' ? 'Ad turned OFF' : 'Ad turned ON'
    } else {
      // Budget: only real INCREASED / DECREASED values survive
      const oldNum = extractAmount(extra.old_value, 'old_value')
      const newNum = extractAmount(extra.new_value, 'new_value')
      // No values or no actual change = noise, drop it
      if (oldNum === null || newNum === null || oldNum <= 0 || newNum === oldNum) return null
      const pct = Math.round(((newNum - oldNum) / oldNum) * 100)
      direction = newNum > oldNum ? 'increase' : 'decrease'
      changeSummary = `Budget ${direction === 'increase' ? 'increased' : 'decreased'}: ${formatRs(oldNum)} \u2192 ${formatRs(newNum)} (${pct > 0 ? '+' : ''}${pct}%)`
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
  // Last 7 days of activity, most recent first. The raw feed is mostly noise
  // (review churn, schedule changes) so a single 100-row page can cover just
  // a couple of hours on a busy day and silently hide the morning's edits -
  // follow paging.next for up to 5 pages (500 raw events) per account.
  const since = Math.floor(Date.now() / 1000) - 7 * 86400
  let url: string | null =
    `${FACEBOOK_GRAPH_URL}/${accountId}/activities` +
    `?fields=event_type,event_time,actor_name,object_name,object_id,extra_data` +
    `&since=${since}&limit=100&access_token=${accessToken}`

  const parsed: AdActivity[] = []
  for (let page = 0; page < 5 && url; page++) {
    const response = await fetch(url)
    if (!response.ok) break // Non-fatal: keep whatever pages we already have
    const data: { data?: RawActivity[]; paging?: { next?: string } } = await response.json()
    const rows: RawActivity[] = data.data || []
    for (const row of rows) {
      const a = parseActivity(row)
      if (a) parsed.push(a)
    }
    url = data.paging?.next || null
  }
  return parsed
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
    // Drop only TRUE duplicates (same object, same change, same moment - the
    // API can return an event on multiple pages/accounts). The same edit
    // repeated at a different time is a real separate action and must stay,
    // e.g. an ad turned OFF in the morning and again in the evening.
    const seen = new Set<string>()
    const activities = perAccount
      .flat()
      .sort((a, b) => new Date(b.eventTime).getTime() - new Date(a.eventTime).getTime())
      .filter((a) => {
        const key = `${a.objectId}|${a.changeSummary}|${a.eventTime}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 200)

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
