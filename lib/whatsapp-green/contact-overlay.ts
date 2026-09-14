import type { WaContact } from '@/lib/whatsapp/store'

export type GreenContactRow = {
  canonicalExists: boolean; profileName: string | null
  phoneNumberId: string; waId: string; providerMessageCount: number; latestText: string | null
  latestDirection: 'in' | 'out' | null; latestObservedAt: string | null; latestProviderAcceptedAt: string | null
  hasLiveObservation: boolean; liveText: string | null; liveDirection: 'in' | 'out' | null
  liveObservedAt: string | null; liveProviderAcceptedAt: string | null
  businessName: string; pageId: string; businessPhone: string
}
export type GreenContactDisplay = {
  source: 'green-api'; only: boolean; messageCount: number; activityAt: string | null
  activityBasis: 'provider-live-acceptance' | 'copy-received' | 'none'
  snippet: string | null; lastObservedAt: string | null; historyUnverified: true
}
export type ContactWithGreen = WaContact & { green?: GreenContactDisplay }
const currentBusinesses: Record<string, { pageId: string; phone: string }> = {
  '968962882975955': { pageId: '471644012696537', phone: '23052500684' },
  '1090043534186338': { pageId: '308584892331429', phone: '23059406784' },
}
const key = (value: { phoneNumberId: string; waId: string }) => JSON.stringify([value.phoneNumberId, value.waId])
export const isGreenBusiness = (phoneNumberId: string) => Object.prototype.hasOwnProperty.call(currentBusinesses, phoneNumberId)
const time = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : -Infinity
function knownDate(value: string | null, now: number) { const at = time(value); return at > 0 && at <= now + 300000 ? value : null }
function valid(row: GreenContactRow) {
  const business = isGreenBusiness(row.phoneNumberId) ? currentBusinesses[row.phoneNumberId] : null
  return !!business && /^\d{5,20}$/.test(row.waId) && business.pageId === row.pageId && business.phone === row.businessPhone &&
    typeof row.canonicalExists === 'boolean' && Number.isSafeInteger(row.providerMessageCount) && row.providerMessageCount >= 0
}
export function hasGreenConversation(rows: GreenContactRow[], scope: { phoneNumberId: string; waId: string }): boolean {
  return rows.some(row => valid(row) && row.phoneNumberId === scope.phoneNumberId && row.waId === scope.waId && row.providerMessageCount > 0)
}
function queryMatches(row: ContactWithGreen, query: string) {
  return !query || [row.profileName, row.waId, row.businessName, row.displayPhone, row.lastSnippet, row.green?.snippet]
    .some(value => value?.toLocaleLowerCase().includes(query))
}

/** Display-only overlay: never writes or replaces canonical permission, read, window, ad or history fields. */
export function overlayGreenContacts(canonical: WaContact[], provider: GreenContactRow[], options: { phoneNumberId?: string; q?: string; limit?: number; now?: number } = {}): ContactWithGreen[] {
  const now = options.now ?? Date.now(), query = options.q?.trim().toLocaleLowerCase() ?? ''
  const rows = new Map<string, ContactWithGreen>()
  for (const contact of canonical) {
    if (options.phoneNumberId && contact.phoneNumberId !== options.phoneNumberId) continue
    if (!rows.has(key(contact))) rows.set(key(contact), { ...contact })
  }
  const providerKeys = new Set<string>()
  for (const row of provider) {
    if (!valid(row) || options.phoneNumberId && row.phoneNumberId !== options.phoneNumberId) continue
    const identity = key(row)
    if (providerKeys.has(identity)) throw new Error('Conflicting provider conversation summaries')
    providerKeys.add(identity)
    const existing = rows.get(identity)
    if (row.canonicalExists && !existing) continue
    const acceptedAt = row.hasLiveObservation ? knownDate(row.liveProviderAcceptedAt, now) : null
    // A known canonical activity time cannot be displaced by the time an old copy was imported.
    const receivedAt = !existing && row.hasLiveObservation ? knownDate(row.liveObservedAt, now) : null
    const liveAt = acceptedAt ?? receivedAt
    const newerLive = liveAt && (!existing || time(liveAt) > time(existing.lastMessageAt)) ? liveAt : null
    const green: GreenContactDisplay = { source: 'green-api', only: !existing, messageCount: row.providerMessageCount,
      activityAt: newerLive, activityBasis: newerLive ? acceptedAt ? 'provider-live-acceptance' : 'copy-received' : 'none',
      snippet: newerLive ? row.liveText?.trim() || null : !existing ? row.latestText?.trim() || null : null,
      lastObservedAt: knownDate(row.latestObservedAt, now), historyUnverified: true }
    rows.set(identity, existing ? { ...existing, green } : {
      waId: row.waId, phoneNumberId: row.phoneNumberId, profileName: row.profileName?.trim() || null, businessName: row.businessName,
      pageId: row.pageId, displayPhone: '+' + row.businessPhone, canSend: false, outsideWindow: true,
      unreadStateKnown: false, unreadCount: 0, lastInboundAt: null, lastMessageAt: null, lastSnippet: null,
      lastFromCustomer: false, messageCount: 0, firstAdId: null, firstAdName: null, firstAdHeadline: null,
      firstAdSourceUrl: null, firstAdAt: null, product: null, productId: null, green,
    })
  }
  const activity = (row: ContactWithGreen) => Math.max(time(row.lastMessageAt), time(row.green?.activityAt))
  return [...rows.values()].filter(row => queryMatches(row, query)).sort((a, b) => {
    const aTime = activity(a), bTime = activity(b)
    return (aTime === bTime ? 0 : aTime > bTime ? -1 : 1) || key(a).localeCompare(key(b))
  }).slice(0, Math.min(200, Math.max(1, options.limit ?? 100)))
}
