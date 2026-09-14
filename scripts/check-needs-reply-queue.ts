/**
 * Pins the needs-reply rules with real values:
 *   pnpm exec tsx scripts/check-needs-reply-queue.ts
 */
import assert from 'node:assert/strict'
import { fromMessenger, fromWhatsApp } from '../lib/inbox/unified'
import { overlayGreenContacts, type GreenContactRow } from '../lib/whatsapp-green/contact-overlay'
import { isWaitingOnUs, needsReplyWithin, newestConversations, NEEDS_REPLY_WINDOW_MS } from '../components/inbox/inbox-behavior'

const NOW = Date.parse('2026-09-15T12:00:00Z')
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString()

// 1. Messenger: customer spoke last 3h ago -> waiting, inside 24h.
const waiting = fromMessenger({ id: 't_1', pageId: 'p', pageName: 'MBM', customer: { id: 'u1', name: 'Alice' }, updatedTime: iso(3), messageCount: 4, lastFromCustomer: true })
assert.equal(isWaitingOnUs(waiting), true)
assert.equal(needsReplyWithin(waiting, NEEDS_REPLY_WINDOW_MS, NOW), true)

// 2. Same chat marked Done in Business Suite AFTER the last message -> not waiting.
const done = fromMessenger({ id: 't_2', pageId: 'p', pageName: 'MBM', customer: { id: 'u2', name: 'Bob' }, updatedTime: iso(3), messageCount: 4, lastFromCustomer: true, doneAt: iso(2) })
assert.deepEqual(done.done, { at: iso(2) })
assert.equal(isWaitingOnUs(done), false)
assert.equal(done.stage === 'awaiting' || done.stage === 'new', false, 'done chats never derive a waiting stage')

// 3. Done, then the customer wrote again -> reopened, waiting again.
const reopened = fromMessenger({ id: 't_3', pageId: 'p', pageName: 'MBM', customer: { id: 'u3', name: 'Cy' }, updatedTime: iso(1), messageCount: 5, lastFromCustomer: true, doneAt: iso(2) })
assert.equal(reopened.done, null)
assert.equal(isWaitingOnUs(reopened), true)

// 3b. Graph gives Done times in whole seconds; a message 579ms "later" is the same event, not a reopen.
const subSecond = fromMessenger({ id: 't_3b', pageId: 'p', pageName: 'MBM', customer: { id: 'u3b', name: 'Cy' }, updatedTime: '2026-09-14T18:25:01.579Z', doneAt: '2026-09-14T18:25:01.000Z', messageCount: 5, lastFromCustomer: false })
assert.ok(subSecond.done, 'sub-second precision loss must not reopen a Done chat')
const realReopen = fromMessenger({ id: 't_3c', pageId: 'p', pageName: 'MBM', customer: { id: 'u3c', name: 'Cy' }, updatedTime: '2026-09-14T18:25:02.000Z', doneAt: '2026-09-14T18:25:01.000Z', messageCount: 6, lastFromCustomer: true })
assert.equal(realReopen.done, null, 'a message a full second later does reopen it')

// 4. Customer spoke last, but 30h ago -> waiting, yet outside the 24h view.
const stale = fromMessenger({ id: 't_4', pageId: 'p', pageName: 'MBM', customer: { id: 'u4', name: 'Di' }, updatedTime: iso(30), messageCount: 2, lastFromCustomer: true })
assert.equal(isWaitingOnUs(stale), true)
assert.equal(needsReplyWithin(stale, NEEDS_REPLY_WINDOW_MS, NOW), false)

// 5. WhatsApp: Meta says customer last at 5h ago; phone (Green) saw an OUT at 4h ago -> answered on phone.
const greenRow: GreenContactRow = {
  canonicalExists: true, profileName: 'Eve', phoneNumberId: '968962882975955', waId: '23059273187', providerMessageCount: 12,
  latestText: 'Merci', latestDirection: 'out', latestObservedAt: iso(0.5), latestProviderAcceptedAt: iso(4),
  hasLiveObservation: false, liveText: null, liveDirection: null, liveObservedAt: null, liveProviderAcceptedAt: null,
  businessName: 'Made By Moris', pageId: '471644012696537', businessPhone: '23052500684',
}
const canonical = {
  waId: '23059273187', phoneNumberId: '968962882975955', profileName: 'Eve', businessName: 'Made By Moris', pageId: '471644012696537',
  displayPhone: '+23052500684', canSend: true, outsideWindow: false, unreadStateKnown: true, unreadCount: 1, lastInboundAt: iso(5),
  lastMessageAt: iso(5), lastSnippet: 'Prix?', lastFromCustomer: true, messageCount: 6, firstAdId: null, firstAdName: null,
  firstAdHeadline: null, firstAdSourceUrl: null, firstAdAt: null, product: null, productId: null,
}
const [withGreen] = overlayGreenContacts([canonical as never], [greenRow], { now: NOW })
assert.equal(withGreen.green?.lastDirection, 'out')
assert.equal(withGreen.green?.lastAt, iso(4))
const answered = fromWhatsApp(withGreen as never)
assert.equal(answered.answeredByPhone, true)
assert.equal(answered.lastReplyBasis, 'phone')
assert.equal(isWaitingOnUs(answered), false)

// 6. Phone saw a NEWER inbound (webhook copy) while Meta's row is older and says WE spoke last -> waiting.
const inboundRow: GreenContactRow = { ...greenRow, latestDirection: 'in', latestProviderAcceptedAt: iso(1), latestText: 'Toujours dispo?' }
const [reopenedWa] = overlayGreenContacts([{ ...canonical, lastFromCustomer: false } as never], [inboundRow], { now: NOW })
const waitingWa = fromWhatsApp(reopenedWa as never)
assert.equal(waitingWa.answeredByPhone, false)
assert.equal(isWaitingOnUs(waitingWa), true, 'a customer message the phone saw counts even when Meta has not')
assert.equal(waitingWa.updatedAt, iso(1), 'the row is dated by the phone message, not the stale Meta record')

// 7. Phone's copy OLDER than Meta's record -> Meta decides.
const oldRow: GreenContactRow = { ...greenRow, latestDirection: 'out', latestProviderAcceptedAt: iso(9) }
const [metaWins] = overlayGreenContacts([canonical as never], [oldRow], { now: NOW })
const metaThread = fromWhatsApp(metaWins as never)
assert.equal(metaThread.lastReplyBasis, 'meta')
assert.equal(isWaitingOnUs(metaThread), true)

// 8. Queue: 24h view keeps only waiting-within-24h, LONGEST wait first.
const queue = newestConversations([waiting, done, reopened, stale, answered, waitingWa, metaThread], 'needs-reply-24h', NOW)
// 5h, 3h, then the two 1h rows tie and fall back to key order.
assert.deepEqual(queue.map((r) => r.key), [metaThread.key, waiting.key, reopened.key, waitingWa.key])
const all = newestConversations([waiting, done, reopened, stale], 'all', NOW)
assert.deepEqual(all.map((r) => r.key), [reopened.key, waiting.key, done.key, stale.key])

console.log('needs-reply queue: 9 checks passed')
