/**
 * Normalises Messenger conversations and WhatsApp contacts into one shape so
 * a single list can sort and filter across both channels.
 *
 * The two APIs disagree on almost everything - Messenger has page-scoped ids
 * and a `customer` object, WhatsApp has phone numbers and ad attribution - so
 * the merge happens here rather than being smeared through the UI.
 */

export type UnifiedChannel = 'messenger' | 'whatsapp'

export type UnifiedThread = {
  /** Unique across channels: the channel prefix prevents id collisions. */
  key: string
  channel: UnifiedChannel
  /** Native id, used to preselect the thread in its own channel view. */
  nativeId: string
  name: string
  snippet: string
  /** ISO timestamp of the last activity, or null when never contacted. */
  updatedAt: string | null
  unreadCount: number
  /** True once the 24h free-form reply window has closed. */
  outsideWindow: boolean
  /** Which business this came to - Page name, or WhatsApp display number. */
  source: string
  /** Click-to-WhatsApp attribution. Messenger threads never carry this. */
  adId: string | null
  adName: string | null
}

export type SortKey = 'recent' | 'oldest' | 'unread' | 'name'
export type ChannelFilter = 'all' | UnifiedChannel
/** 'ads' means any ad-sourced thread; any other string is a specific ad id. */
export type AdFilter = 'all' | 'ads' | string

export type MessengerRow = {
  id: string
  snippet?: string
  updatedTime?: string
  unreadCount?: number
  customer?: { name?: string } | null
  outsideWindow?: boolean
  pageName?: string
}

export type WhatsAppRow = {
  waId: string
  profileName?: string | null
  lastSnippet?: string | null
  lastMessageAt?: string | null
  unreadCount?: number
  outsideWindow?: boolean
  displayPhone?: string | null
  firstAdId?: string | null
  firstAdName?: string | null
  firstAdHeadline?: string | null
}

export function fromMessenger(c: MessengerRow): UnifiedThread {
  return {
    key: `messenger:${c.id}`,
    channel: 'messenger',
    nativeId: c.id,
    name: c.customer?.name?.trim() || 'Facebook user',
    snippet: c.snippet ?? '',
    updatedAt: c.updatedTime ?? null,
    unreadCount: c.unreadCount ?? 0,
    outsideWindow: c.outsideWindow ?? false,
    source: c.pageName ?? 'Page',
    adId: null,
    adName: null,
  }
}

export function fromWhatsApp(c: WhatsAppRow): UnifiedThread {
  return {
    key: `whatsapp:${c.waId}`,
    channel: 'whatsapp',
    nativeId: c.waId,
    name: c.profileName?.trim() || c.waId,
    snippet: c.lastSnippet ?? '',
    updatedAt: c.lastMessageAt ?? null,
    unreadCount: c.unreadCount ?? 0,
    outsideWindow: c.outsideWindow ?? false,
    source: c.displayPhone ?? 'WhatsApp',
    adId: c.firstAdId ?? null,
    // The headline Meta sends is the PAGE name on every ad, so it is only a
    // last resort - never preferred over the resolved ad name.
    adName: c.firstAdName ?? c.firstAdHeadline ?? null,
  }
}

const time = (t: string | null) => (t ? new Date(t).getTime() : 0)

export function sortThreads(rows: UnifiedThread[], key: SortKey): UnifiedThread[] {
  const out = [...rows]
  switch (key) {
    case 'oldest':
      // Threads never replied to sink to the bottom rather than jumping to the
      // top, which is what a naive ascending sort on 0 would do.
      return out.sort((a, b) => (time(a.updatedAt) || Infinity) - (time(b.updatedAt) || Infinity))
    case 'unread':
      // Unread first, then most recent inside each group.
      return out.sort(
        (a, b) => b.unreadCount - a.unreadCount || time(b.updatedAt) - time(a.updatedAt),
      )
    case 'name':
      return out.sort((a, b) => a.name.localeCompare(b.name))
    default:
      return out.sort((a, b) => time(b.updatedAt) - time(a.updatedAt))
  }
}

export function filterThreads(
  rows: UnifiedThread[],
  opts: { channel: ChannelFilter; ad: AdFilter; unreadOnly: boolean; query: string },
): UnifiedThread[] {
  const q = opts.query.trim().toLowerCase()
  return rows.filter((r) => {
    if (opts.channel !== 'all' && r.channel !== opts.channel) return false
    if (opts.unreadOnly && r.unreadCount === 0) return false
    if (opts.ad === 'ads' && !r.adId) return false
    if (opts.ad !== 'all' && opts.ad !== 'ads' && r.adId !== opts.ad) return false
    if (!q) return true
    return (
      r.name.toLowerCase().includes(q) ||
      r.snippet.toLowerCase().includes(q) ||
      r.source.toLowerCase().includes(q) ||
      (r.adName ?? '').toLowerCase().includes(q) ||
      (r.adId ?? '').includes(q)
    )
  })
}

/** Distinct ads present in the data, busiest first, for the ad picker. */
export function adOptions(rows: UnifiedThread[]): { id: string; name: string; count: number }[] {
  const map = new Map<string, { id: string; name: string; count: number }>()
  for (const r of rows) {
    if (!r.adId) continue
    const entry = map.get(r.adId) ?? { id: r.adId, name: r.adName ?? r.adId, count: 0 }
    entry.count += 1
    map.set(r.adId, entry)
  }
  return [...map.values()].sort((a, b) => b.count - a.count)
}
