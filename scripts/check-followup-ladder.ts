/**
 * Pins the follow-up ladder rules with real values (times are Mauritius, UTC+4):
 *   pnpm exec tsx scripts/check-followup-ladder.ts
 */
import assert from 'node:assert/strict'
import { anchorFor, dedupeMessages, dueAt, ladderState, shiftToBusinessHours, type LadderMessage } from '../lib/inbox-autopilot/followup-schedule'
import { deliveriesExistFor, hasExistingOrder, phoneKey, phonesInThread, threadConfirmsOrder } from '../lib/inbox-autopilot/order-guard'

const mu = (s: string) => new Date(s + '+04:00')            // "2026-09-15T14:00" in Mauritius
const iso = (s: string) => mu(s).toISOString()
const out = (id: string, at: string, text = 'Our price is Rs 475, free delivery Thursday.'): LadderMessage => ({ id, direction: 'out', at: iso(at), text })
const inb = (id: string, at: string, text = 'Hello, price?'): LadderMessage => ({ id, direction: 'in', at: iso(at), text })
let checks = 0
const pending: Promise<void>[] = []
const check = (label: string, fn: () => void | Promise<void>) => { pending.push(Promise.resolve().then(fn).then(() => { checks++ }, e => { console.error(`FAILED: ${label}`); throw e })) }

// 1. Steps from a 14:00 anchor: 14:30, 17:00, 20:00, next day 14:00 - none touch the night.
check('daytime steps', () => {
  const a = iso('2026-09-15T14:00')
  assert.equal(new Date(dueAt(a, 1)).toISOString(), iso('2026-09-15T14:30'))
  assert.equal(new Date(dueAt(a, 2)).toISOString(), iso('2026-09-15T17:00'))
  assert.equal(new Date(dueAt(a, 3)).toISOString(), iso('2026-09-15T20:00'))
  assert.equal(new Date(dueAt(a, 4)).toISOString(), iso('2026-09-16T14:00'))
})
// 2. Night shift: 23:20 and 01:50 both become 08:00; 22:59 stays; 07:59 -> 08:00.
check('business hours shift', () => {
  assert.equal(new Date(shiftToBusinessHours(mu('2026-09-15T23:20').getTime())).toISOString(), iso('2026-09-16T08:00'))
  assert.equal(new Date(shiftToBusinessHours(mu('2026-09-16T01:50').getTime())).toISOString(), iso('2026-09-16T08:00'))
  assert.equal(new Date(shiftToBusinessHours(mu('2026-09-15T22:59').getTime())).toISOString(), iso('2026-09-15T22:59'))
  assert.equal(new Date(shiftToBusinessHours(mu('2026-09-16T07:59').getTime())).toISOString(), iso('2026-09-16T08:00'))
})
// 3. Anchor 22:50: steps 1 (23:20), 2 (01:50) AND 3 (04:50) all shift to 08:00 -> one message, step 3, steps 1-2 skipped.
check('morning picks highest due step', () => {
  const d = ladderState({ channel: 'whatsapp', messages: [inb('c1', '2026-09-15T22:40'), out('o1', '2026-09-15T22:50')], ledger: [], hasOrder: false, now: mu('2026-09-16T08:00') })
  assert.equal(d.action, 'send'); if (d.action !== 'send') return
  assert.equal(d.step, 3); assert.deepEqual(d.skipLower, [1, 2]); assert.equal(d.anchor.id, 'o1')
})
// 4. Before 08:00 the same chat waits for 08:00 exactly.
check('night waits for opening', () => {
  const d = ladderState({ channel: 'whatsapp', messages: [inb('c1', '2026-09-15T22:40'), out('o1', '2026-09-15T22:50')], ledger: [], hasOrder: false, now: mu('2026-09-16T03:00') })
  assert.equal(d.action, 'wait'); if (d.action !== 'wait') return
  assert.equal(d.until, iso('2026-09-16T08:00')); assert.equal(d.step, 1)
})
// 5. Cold-start backlog: anchor 9 h old at switch-on -> only step 3 fires; steps 1-2 skipped, step 4 waits.
check('backlog sends one step', () => {
  const d = ladderState({ channel: 'whatsapp', messages: [inb('c1', '2026-09-15T08:50'), out('o1', '2026-09-15T09:00')], ledger: [], hasOrder: false, now: mu('2026-09-15T18:00') })
  assert.equal(d.action, 'send'); if (d.action !== 'send') return
  assert.equal(d.step, 3); assert.deepEqual(d.skipLower, [1, 2])
  const after = ladderState({ channel: 'whatsapp', messages: [inb('c1', '2026-09-15T08:50'), out('o1', '2026-09-15T09:00'), { ...out('n3', '2026-09-15T18:00', 'Still interested?'), followup: true }],
    ledger: [{ anchorMessageId: 'o1', step: 1, state: 'skipped' }, { anchorMessageId: 'o1', step: 2, state: 'skipped' }, { anchorMessageId: 'o1', step: 3, state: 'sent', providerMessageId: 'n3' }], hasOrder: false, now: mu('2026-09-15T18:05') })
  assert.equal(after.action, 'wait'); if (after.action !== 'wait') return
  assert.equal(after.step, 4); assert.equal(after.until, iso('2026-09-16T09:00'))
})
// 6. Our own nudge is never an anchor (flag OR ledger id); a staff reply is, and it restarts the ladder.
check('anchor rules', () => {
  const msgs = [inb('c1', '2026-09-15T09:00'), out('o1', '2026-09-15T09:10'), out('n1', '2026-09-15T09:40', 'Still there?')]
  assert.equal(anchorFor(msgs, [{ anchorMessageId: 'o1', step: 1, state: 'sent', providerMessageId: 'n1' }])?.id, 'o1')
  assert.equal(anchorFor([...msgs, { ...out('n1b', '2026-09-15T09:41'), followup: true }], [])?.id, 'n1', 'unknown nudge without flag/ledger is treated as staff text')
  const staff = [...msgs, out('o2', '2026-09-15T12:00', 'Hi again, do you want it delivered Thursday?')]
  const d = ladderState({ channel: 'whatsapp', messages: staff, ledger: [{ anchorMessageId: 'o1', step: 1, state: 'sent', providerMessageId: 'n1' }], hasOrder: false, now: mu('2026-09-15T12:45') })
  assert.equal(d.action, 'send'); if (d.action !== 'send') return
  assert.equal(d.anchor.id, 'o2'); assert.equal(d.step, 1, 'new staff anchor starts again at step 1')
})
// 7. A customer message after the anchor stops everything, even one second later.
check('customer replied', () => {
  const d = ladderState({ channel: 'whatsapp', messages: [out('o1', '2026-09-15T09:10'), inb('c2', '2026-09-15T09:10:01')], ledger: [], hasOrder: false, now: mu('2026-09-15T20:00') })
  assert.deepEqual([d.action, (d as any).reason], ['stop', 'customer_replied'])
})
// 8. Order guard: wa_id 23057692493 vs deliveries contact_1 "57692493"; also "+230 5769 2493" typed in a Messenger thread.
check('order guard identity', () => {
  assert.equal(phoneKey('23057692493'), '7692493'); assert.equal(phoneKey('57692493'), '7692493'); assert.equal(phoneKey('5769'), null)
  assert.deepEqual(phonesInThread([inb('c1', '2026-09-15T09:00', 'my number +230 5769 2493 thanks'), out('o1', '2026-09-15T09:01', 'call 5123 4567')]), ['7692493'])
  assert.equal(threadConfirmsOrder([out('o1', '2026-09-15T09:01', 'Your order is confirmed for Thursday')]), true)
  assert.equal(threadConfirmsOrder([out('o1', '2026-09-15T09:01', 'Would you like to order?')]), false)
})
check('order guard SQL and stop', async () => {
  const seen: unknown[][] = []
  const db = { query: async (_sql: string, values?: unknown[]) => { seen.push(values ?? []); return { rows: [{ '?column?': 1 }] } } }
  assert.equal(await deliveriesExistFor(db, ['7692493', 'bad', '7692493'], iso('2026-09-15T09:10')), true)
  assert.deepEqual(seen[0][0], ['7692493'], 'keys are deduped and validated before reaching SQL')
  assert.equal(await deliveriesExistFor(db, [], iso('2026-09-15T09:10')), false); assert.equal(seen.length, 1, 'no keys -> no query')
  assert.equal(await hasExistingOrder(db, { channel: 'whatsapp', customerId: '23057692493', messages: [], anchorAt: iso('2026-09-15T09:10') }), true)
  const d = ladderState({ channel: 'whatsapp', messages: [out('o1', '2026-09-15T09:10')], ledger: [], hasOrder: true, now: mu('2026-09-15T20:00') })
  assert.deepEqual([d.action, (d as any).reason], ['stop', 'order_exists'])
})
// 9. Messenger: customer's last message 23h58 ago -> window closed; 20h ago -> step still sends; +24h step never fits.
check('messenger window', () => {
  const closed = ladderState({ channel: 'messenger', messages: [inb('c1', '2026-09-14T10:02'), out('o1', '2026-09-14T10:10')], ledger: [], hasOrder: false, now: mu('2026-09-15T10:00') })
  assert.deepEqual([closed.action, (closed as any).reason], ['stop', 'messenger_window_closed'])
  const open = ladderState({ channel: 'messenger', messages: [inb('c1', '2026-09-14T14:00'), out('o1', '2026-09-14T14:10')], ledger: [], hasOrder: false, now: mu('2026-09-15T10:00') })
  assert.equal(open.action, 'send'); if (open.action === 'send') assert.equal(open.step, 3)
  const wa = ladderState({ channel: 'whatsapp', messages: [inb('c1', '2026-09-14T10:02'), out('o1', '2026-09-14T10:10')], ledger: [], hasOrder: false, now: mu('2026-09-15T10:15') })
  assert.equal(wa.action, 'send'); if (wa.action === 'send') assert.equal(wa.step, 4, 'WhatsApp via the phone has no 24h window')
})
// 10. After step 4 nothing remains; an anchor older than 34 h is left alone even with an empty ledger.
check('ladder ends', () => {
  const done = ladderState({ channel: 'whatsapp', messages: [out('o1', '2026-09-14T10:10')], ledger: [{ anchorMessageId: 'o1', step: 4, state: 'sent', providerMessageId: 'n4' }], hasOrder: false, now: mu('2026-09-15T12:00') })
  assert.deepEqual([done.action, (done as any).reason], ['stop', 'ladder_complete'])
  const old = ladderState({ channel: 'whatsapp', messages: [out('o1', '2026-09-13T10:10')], ledger: [], hasOrder: false, now: mu('2026-09-15T12:00') })
  assert.deepEqual([old.action, (old as any).reason], ['stop', 'anchor_too_old'])
  const unknown = ladderState({ channel: 'whatsapp', messages: [out('o1', '2026-09-15T09:00')], ledger: [{ anchorMessageId: 'o1', step: 1, state: 'unknown' }], hasOrder: false, now: mu('2026-09-15T10:00') })
  assert.equal(unknown.action, 'wait', 'an unknown provider outcome counts as used - never resent'); if (unknown.action === 'wait') assert.equal(unknown.step, 2)
})
// 11. Done marks are ignored unless opted in.
check('done ignored by default', () => {
  const base = { channel: 'whatsapp' as const, messages: [out('o1', '2026-09-15T09:00')], ledger: [], hasOrder: false, now: mu('2026-09-15T10:00'), doneAt: iso('2026-09-15T09:00:00.500') }
  assert.equal(ladderState(base).action, 'send')
  assert.deepEqual([ladderState({ ...base, respectDone: true }).action, (ladderState({ ...base, respectDone: true }) as any).reason], ['stop', 'done_in_business_suite'])
})
// 12. A Meta send and its Green copy share the wamid: one message, follow-up flag kept.
check('dedupe by id', () => {
  const merged = dedupeMessages([out('wamid.1', '2026-09-15T09:00'), { ...out('wamid.1', '2026-09-15T09:00:00.579'), followup: true }, inb('c1', '2026-09-15T08:00')])
  assert.equal(merged.length, 2); assert.equal(merged[1].id, 'wamid.1'); assert.equal(merged[1].followup, true)
})


// 3b. Step became due at 22:58 (inside hours) but the engine only sees it at 03:35 -> hold until 08:00, never send at night.
check('a due step is still held when NOW is in quiet hours', () => {
  const d = ladderState({ channel: 'messenger', messages: [inb('c1', '2026-09-14T22:20'), out('o1', '2026-09-14T22:28')], ledger: [], hasOrder: false, now: mu('2026-09-15T03:35') })
  assert.equal(d.action, 'wait'); if (d.action !== 'wait') return
  assert.equal(new Date(d.until).toISOString(), new Date(mu('2026-09-15T08:00')).toISOString())
})

// 3c. A customer who answers with a photo (no text) has replied - never nudge them.
check('photo-only customer reply stops the ladder', () => {
  const d = ladderState({ channel: 'whatsapp', messages: [out('o1', '2026-09-15T10:00'), { id: 'p1', direction: 'in', at: mu('2026-09-15T10:10').toISOString(), text: null, media: true }], ledger: [], hasOrder: false, now: mu('2026-09-15T12:00') })
  assert.deepEqual({ action: d.action, reason: (d as any).reason }, { action: 'stop', reason: 'customer_replied' })
})

// --- text fence: figures/offers only when OUR messages already said them -------------------------------
import { verifyFollowupText } from '../lib/inbox-autopilot/followup-verify'
const thread = [inb('c1', '2026-09-15T10:00', 'price of the air fryer?'), out('o1', '2026-09-15T10:05', 'Rs 1,290 with free delivery. Shall I reserve one?')]
check('figure present in OUR message passes', () => assert.equal(verifyFollowupText('Hi, just checking you saw our message - the air fryer is Rs 1,290. Any question?', thread).ok, true))
check('invented figure is refused', () => assert.deepEqual(verifyFollowupText('Hi, the air fryer is Rs 990 today.', thread), { ok: false, reason: 'text_unverified_figure' }))
check('discount never said by us is refused', () => assert.deepEqual(verifyFollowupText('Hi, we can give you a discount if you order today.', thread), { ok: false, reason: 'text_unverified_offer' }))
check('free delivery allowed only when configured or already said', () => {
  const plain = [inb('c1', '2026-09-15T10:00', 'price?'), out('o1', '2026-09-15T10:05', 'Rs 300.')]
  assert.equal(verifyFollowupText('Hi, delivery is free if you want it.', plain).ok, false)
  assert.equal(verifyFollowupText('Hi, delivery is free if you want it.', plain, { allowFreeDelivery: true }).ok, true)
  assert.equal(verifyFollowupText('Hi, we still offer free delivery, let us know.', thread).ok, true)
})
check('order confirmation, payment ask and links are refused', () => {
  assert.equal((verifyFollowupText('Good news, your order is confirmed.', thread) as any).reason, 'text_confirms_order')
  assert.equal((verifyFollowupText('Please send the payment by Juice to proceed.', thread) as any).reason, 'text_asks_payment')
  assert.equal((verifyFollowupText('See https://akmez.tech/shop for more.', thread) as any).reason, 'text_has_link')
})
Promise.all(pending).then(() => console.log(`follow-up ladder: ${checks} checks passed`))
