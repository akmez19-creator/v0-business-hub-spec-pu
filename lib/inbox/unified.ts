/**
 * Normalises Messenger conversations and WhatsApp contacts into one shape so
 * a single list can sort and filter across both channels.
 *
 * The two APIs disagree on almost everything - Messenger has page-scoped ids
 * and a `customer` object, WhatsApp has phone numbers and ad attribution - so
 * the merge happens here rather than being smeared through the UI.
 */

import { deriveStage, STAGE_PRIORITY, type LeadStage } from './stage'

export type UnifiedChannel = 'messenger' | 'whatsapp' | 'comment'

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
  /**
   * Owning Page, needed to reply as the right business. Null on WhatsApp,
   * which is addressed by phone number instead.
   */
  pageId: string | null
  /**
   * Who to address a reply to: the PSID on Messenger, the wa_id on WhatsApp,
   * the comment id on a comment. Null when the channel gave us no addressable
   * id, in which case the UI must not offer a reply box.
   */
  recipientId: string | null
  /** Click-to-WhatsApp attribution. Messenger threads never carry this. */
  adId: string | null
  adName: string | null

  /** Display label for what they are asking about. */
  product: string | null
  /** Canonical catalogue id, when the label resolved to a real product. */
  productId: string | null
  productCategory: string | null
  /** How the product was established - drives how confidently it is shown. */
  productSource: 'ad' | 'comment' | null
  campaignId: string | null
  campaignName: string | null
  /** True when the ad behind this lead is still running. */
  campaignActive: boolean
  /** Triage bucket. Derived, never stored - see lib/inbox/stage.ts. */
  stage: LeadStage
  messageCount: number
}

function attribution(
  row: AttributedRow,
  updatedAt: string | null,
  productSource: 'ad' | 'comment' | null,
) {
  const messageCount = row.messageCount ?? 0
  return {
    product: row.product ?? null,
    productId: row.productId ?? null,
    productCategory: row.productCategory ?? null,
    productSource,
    campaignId: row.campaignId ?? null,
    campaignName: row.campaignName ?? null,
    campaignActive: row.campaignActive ?? false,
    messageCount,
    stage: deriveStage({
      messageCount,
      lastFromCustomer: row.lastFromCustomer ?? false,
      lastMessageAt: updatedAt,
    }),
  }
}

export type SortKey = 'triage' | 'recent' | 'oldest' | 'unread' | 'name'
export type ChannelFilter = 'all' | UnifiedChannel
/** 'ads' means any ad-sourced thread; any other string is a specific ad id. */
export type AdFilter = 'all' | 'ads' | string

/** Attribution fields the API attaches to every channel row alike. */
type AttributedRow = {
  product?: string | null
  productId?: string | null
  productCategory?: string | null
  campaignId?: string | null
  campaignName?: string | null
  campaignActive?: boolean
  messageCount?: number
  lastFromCustomer?: boolean
}

export type MessengerRow = AttributedRow & {
  id: string
  snippet?: string
  updatedTime?: string
  unreadCount?: number
  customer?: { id?: string; name?: string } | null
  outsideWindow?: boolean
  pageId?: string
  pageName?: string
  adId?: string | null
  adName?: string | null
  productSource?: 'ad-click' | 'comment' | null
}

export type WhatsAppRow = AttributedRow & {
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
  const updatedAt = c.updatedTime ?? null
  return {
    key: `messenger:${c.id}`,
    channel: 'messenger',
    nativeId: c.id,
    name: c.customer?.name?.trim() || 'Facebook user',
    snippet: c.snippet ?? '',
    updatedAt,
    unreadCount: c.unreadCount ?? 0,
    outsideWindow: c.outsideWindow ?? false,
    source: c.pageName ?? 'Page',
    pageId: c.pageId ?? null,
    recipientId: c.customer?.id ?? null,
    // Populated from the page webhook (messenger_ad_refs). Null on every
    // thread that predates the subscription - Graph cannot backfill it.
    adId: c.adId ?? null,
    adName: c.adName ?? null,
    ...attribution(c, updatedAt, c.product ? 'ad' : null),
  }
}

export function fromWhatsApp(c: WhatsAppRow): UnifiedThread {
  const updatedAt = c.lastMessageAt ?? null
  return {
    key: `whatsapp:${c.waId}`,
    channel: 'whatsapp',
    nativeId: c.waId,
    name: c.profileName?.trim() || c.waId,
    snippet: c.lastSnippet ?? '',
    updatedAt,
    unreadCount: c.unreadCount ?? 0,
    outsideWindow: c.outsideWindow ?? false,
    source: c.displayPhone ?? 'WhatsApp',
    // WhatsApp is addressed by number, not by Page.
    pageId: null,
    recipientId: c.waId,
    adId: c.firstAdId ?? null,
    // The headline Meta sends is the PAGE name on every ad, so it is only a
    // last resort - never preferred over the resolved ad name.
    adName: c.firstAdName ?? c.firstAdHeadline ?? null,
    ...attribution(c, updatedAt, c.product ? 'ad' : null),
  }
}

export type CommentRow = AttributedRow & {
  id: string
  message?: string | null
  createdTime?: string | null
  authorName?: string | null
  pageId?: string | null
  pageName?: string | null
  /** True when the page has not replied to this comment. */
  needsReply?: boolean
}

/**
 * Comments are leads too - and they have the best product coverage of any
 * channel (602/603 resolve), because a comment is physically attached to the
 * post an ad promotes. Meta withholds the commenter's name on public comments,
 * so the product is often the only identifying detail the row carries.
 */
export function fromComment(c: CommentRow): UnifiedThread {
  const updatedAt = c.createdTime ?? null
  return {
    key: `comment:${c.id}`,
    channel: 'comment',
    nativeId: c.id,
    name: c.authorName?.trim() || 'Facebook user',
    snippet: c.message ?? '',
    updatedAt,
    unreadCount: c.needsReply ? 1 : 0,
    // Comment replies have no 24h window the way messaging does.
    outsideWindow: false,
    source: c.pageName ?? 'Page',
    pageId: c.pageId ?? null,
    // A comment is replied to by its own id, not by addressing the author.
    recipientId: c.id,
    // A comment belongs to a POST, not to one specific ad, so there is no
    // single ad id to show. Campaign context still comes through attribution.
    adId: null,
    adName: null,
    ...attribution(
      { ...c, messageCount: 1, lastFromCustomer: c.needsReply ?? true },
      updatedAt,
      'comment',
    ),
  }
}

const time = (t: string | null) => (t ? new Date(t).getTime() : 0)

export function sortThreads(rows: UnifiedThread[], key: SortKey): UnifiedThread[] {
  const out = [...rows]
  switch (key) {
    case 'triage':
      // What needs a human first: awaiting > new > active > dormant, and
      // inside a stage the ones that have waited longest.
      return out.sort(
        (a, b) =>
          STAGE_PRIORITY[a.stage] - STAGE_PRIORITY[b.stage] ||
          (time(a.updatedAt) || Infinity) - (time(b.updatedAt) || Infinity),
      )
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
  opts: {
    channel: ChannelFilter
    ad: AdFilter
    unreadOnly: boolean
    query: string
    /** Empty set means "no stage filter", not "hide everything". */
    stages?: Set<LeadStage>
    product?: string | 'all'
    campaign?: string | 'all'
    liveOnly?: boolean
  },
): UnifiedThread[] {
  const q = opts.query.trim().toLowerCase()
  return rows.filter((r) => {
    if (opts.channel !== 'all' && r.channel !== opts.channel) return false
    if (opts.unreadOnly && r.unreadCount === 0) return false
    if (opts.ad === 'ads' && !r.adId) return false
    if (opts.ad !== 'all' && opts.ad !== 'ads' && r.adId !== opts.ad) return false
    if (opts.stages?.size && !opts.stages.has(r.stage)) return false
    if (opts.liveOnly && !r.campaignActive) return false
    if (opts.campaign && opts.campaign !== 'all' && r.campaignId !== opts.campaign) return false
    if (opts.product && opts.product !== 'all') {
      // Match on catalogue id when we have one, else the raw label, so
      // unmatched products stay filterable.
      const key = r.productId ?? r.product
      if (key !== opts.product) return false
    }
    if (!q) return true
    return (
      r.name.toLowerCase().includes(q) ||
      r.snippet.toLowerCase().includes(q) ||
      r.source.toLowerCase().includes(q) ||
      (r.adName ?? '').toLowerCase().includes(q) ||
      (r.product ?? '').toLowerCase().includes(q) ||
      (r.campaignName ?? '').toLowerCase().includes(q) ||
      (r.adId ?? '').includes(q)
    )
  })
}

/** Distinct products present, busiest first. Keyed by catalogue id when known. */
export function productOptions(
  rows: UnifiedThread[],
): { key: string; name: string; category: string | null; count: number }[] {
  const map = new Map<string, { key: string; name: string; category: string | null; count: number }>()
  for (const r of rows) {
    if (!r.product) continue
    const key = r.productId ?? r.product
    const entry = map.get(key) ?? {
      key,
      name: r.product,
      category: r.productCategory,
      count: 0,
    }
    entry.count += 1
    map.set(key, entry)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** Distinct campaigns present, busiest first. */
export function campaignOptions(
  rows: UnifiedThread[],
): { id: string; name: string; active: boolean; count: number }[] {
  const map = new Map<string, { id: string; name: string; active: boolean; count: number }>()
  for (const r of rows) {
    if (!r.campaignId) continue
    const entry = map.get(r.campaignId) ?? {
      id: r.campaignId,
      name: r.campaignName ?? r.campaignId,
      active: false,
      count: 0,
    }
    entry.count += 1
    // A campaign counts as live if any lead under it came from a running ad.
    entry.active = entry.active || r.campaignActive
    map.set(r.campaignId, entry)
  }
  return [...map.values()].sort((a, b) => b.count - a.count)
}

/** How many threads sit in each stage, for the triage counters. */
export function stageCounts(rows: UnifiedThread[]): Record<LeadStage, number> {
  const counts: Record<LeadStage, number> = { awaiting: 0, new: 0, active: 0, dormant: 0 }
  for (const r of rows) counts[r.stage] += 1
  return counts
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
