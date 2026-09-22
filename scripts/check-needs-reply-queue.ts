/**
 * Pins the needs-reply rules with real values:
 *   pnpm exec tsx scripts/check-needs-reply-queue.ts
 */
import assert from 'node:assert/strict'
import { fromMessenger, fromWhatsApp } from '../lib/inbox/unified'
import { clientSilentWithin, isAwaitingCustomer, isClosed, isWaitingOnUs, needsReplyWithin, newestConversations, NEEDS_REPLY_WINDOW_MS } from '../components/inbox/inbox-behavior'
import { isClosingAcknowledgement } from '../lib/inbox/acknowledgement'
import { effectiveMark } from '../lib/inbox/thread-marks'

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

const canonical = {
  waId: '23059273187', phoneNumberId: '968962882975955', profileName: 'Eve', businessName: 'Made By Moris', pageId: '471644012696537',
  displayPhone: '+23052500684', canSend: true, outsideWindow: false, unreadStateKnown: true, unreadCount: 1, lastInboundAt: iso(5),
  lastMessageAt: iso(5), lastSnippet: 'Prix?', lastFromCustomer: true, messageCount: 6, firstAdId: null, firstAdName: null,
  firstAdHeadline: null, firstAdSourceUrl: null, firstAdAt: null, product: null, productId: null,
}
// 5. WhatsApp: an agent answered from their own phone 4h ago. Meta reports that reply as an
// outgoing row on the conversation, so the thread is no longer waiting on us.
const answered = fromWhatsApp({ ...canonical, lastFromCustomer: false, lastMessageAt: iso(4), lastSnippet: 'Merci' } as never)
assert.equal(answered.lastReplyBasis, 'meta')
assert.equal(answered.answeredByPhone, false, 'there is no second source to attribute a reply to any more')
assert.equal(isWaitingOnUs(answered), false)

// 6. A newer customer message -> waiting, dated by that message.
const waitingWa = fromWhatsApp({ ...canonical, lastFromCustomer: true, lastMessageAt: iso(1), lastSnippet: 'Toujours dispo?' } as never)
assert.equal(isWaitingOnUs(waitingWa), true)
assert.equal(waitingWa.updatedAt, iso(1))

// 7. Customer spoke last 5h ago and nobody has answered -> still waiting.
const metaThread = fromWhatsApp(canonical as never)
assert.equal(metaThread.lastReplyBasis, 'meta')
assert.equal(isWaitingOnUs(metaThread), true)

// 8. Queue: 24h view keeps only waiting-within-24h, MOST RECENT first (owner, 15 Sep).
const queue = newestConversations([waiting, done, reopened, stale, answered, waitingWa, metaThread], 'needs-reply-24h', NOW)
// the two 1h rows tie and fall back to key order, then 3h, then 5h.
assert.deepEqual(queue.map((r) => r.key), [reopened.key, waitingWa.key, waiting.key, metaThread.key])

// 9. "No reply from client": WE spoke last (app or phone), not Done, not dormant, inside 24h.
assert.equal(isAwaitingCustomer(answered), true, 'we replied last -> client silent')
assert.equal(isAwaitingCustomer(waiting), false)
assert.equal(isAwaitingCustomer(done), false, 'Done is closed on purpose, not silent')
assert.equal(clientSilentWithin(answered, NEEDS_REPLY_WINDOW_MS, NOW), true)
assert.equal(clientSilentWithin({ ...answered, updatedAt: iso(30) }, NEEDS_REPLY_WINDOW_MS, NOW), false, 'outside 24h')
const silent = newestConversations([waiting, done, reopened, stale, answered, waitingWa, metaThread], 'client-silent-24h', NOW)
assert.deepEqual(silent.map((r) => r.key), [answered.key])
const all = newestConversations([waiting, done, reopened, stale], 'all', NOW)
assert.deepEqual(all.map((r) => r.key), [reopened.key, waiting.key, done.key, stale.key])


// 11. Closing acknowledgements (real snippets from the 15 Sep screenshot) leave Needs reply.
{
  for (const t of ['Okay', 'Ok', 'Thank you', 'Thanks', 'Merci bcp', 'Noted', '👍', '❤️❤️❤️', 'Ok merci', 'GREEN-API copy · Okay', 'Alright thanks', 'Got it', 'D’accord', 'Thnks u', '👍🏼']) {
    assert.equal(isClosingAcknowledgement(t), true, `ack: ${t}`)
  }
  for (const t of ['Ok but when?', 'Thanks, and the price?', 'Ki prix svp', 'I didnt get my order', 'Okay send me the account number', 'Hello! Can I get more info on this?', 'Price plz', '1 please', 'On delivery, cash', 'Need one plz at mare tabac', '59201755', '5920 1755', 'No thank you', '']) {
    assert.equal(isClosingAcknowledgement(t), false, `not ack: ${t}`)
  }
  const acked = { ...waiting, closingAck: true }
  assert.equal(isWaitingOnUs(acked), false, '"Okay" after our reply is not waiting')
  assert.equal(isClosed(acked), true)
  assert.equal(newestConversations([acked, waiting], 'needs-reply-24h', NOW).map((r) => r.key).join(), waiting.key)
  assert.equal(newestConversations([acked, waiting], 'closed', NOW).map((r) => r.key).join(), acked.key)
  // 12. A manual mark holds until the customer writes again.
  const mark = { key: waiting.key, kind: 'confirmed' as const, at: iso(1) }
  assert.deepEqual(effectiveMark(mark, iso(2)), mark, 'marked after the last message -> effective')
  assert.equal(effectiveMark(mark, iso(0.5)), null, 'customer wrote after the mark -> reopened')
  assert.equal(isWaitingOnUs({ ...waiting, mark }), false)
  assert.equal(isWaitingOnUs({ ...waiting, mark: null }), true)
}
// 13. Unread follows the same 24h window. History recovery back-fills months of never-read
// messages, so an unwindowed Unread view buries today's customers under last month's.
{
  const freshUnread = { ...waiting, unreadCount: 2 }
  const oldUnread = { ...waiting, key: 'old-unread', unreadCount: 7, updatedAt: iso(24 * 9) }
  const alreadyRead = { ...waiting, key: 'read', unreadCount: 0 }
  assert.deepEqual(
    newestConversations([freshUnread, oldUnread, alreadyRead], 'unread', NOW).map((r) => r.key),
    [freshUnread.key],
    'unread keeps the last 24h only, and never an already-read row',
  )
  // The escape hatch stays open: "any age" still reaches the older ones.
  assert.deepEqual(
    newestConversations([freshUnread, oldUnread], 'needs-action', NOW).map((r) => r.key).sort(),
    [freshUnread.key, oldUnread.key].sort(),
  )
}
// 14. An answered comment is finished, not a chat waiting on the commenter.
// The owner found a replied-to comment sitting in "No reply from client", where
// it read as a customer who had gone quiet - there is nobody to chase: the
// public thread ends at our answer and the rest happens in Messenger.
{
  const answeredComment = { ...waiting, key: 'comment:123', channel: 'comment' as const, stage: 'active' as const }
  assert.equal(isAwaitingCustomer(answeredComment), false, 'an answered comment is not awaiting the customer')
  assert.deepEqual(newestConversations([answeredComment], 'client-silent-24h', NOW).map((r) => r.key), [])
  assert.deepEqual(newestConversations([answeredComment], 'client-silent', NOW).map((r) => r.key), [])
  // A comment still unanswered is a real lead and stays in Needs reply.
  const openComment = { ...waiting, key: 'comment:456', channel: 'comment' as const }
  assert.equal(isWaitingOnUs(openComment), true, 'an unanswered comment still needs a reply')
  assert.deepEqual(newestConversations([openComment], 'needs-reply-24h', NOW).map((r) => r.key), [openComment.key])
  // Messaging channels are untouched by the comment rule.
  assert.equal(isAwaitingCustomer({ ...waiting, channel: 'messenger' as const, stage: 'active' as const }), true)
}
console.log('needs-reply queue: 14 checks passed')
