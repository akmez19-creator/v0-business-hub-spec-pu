// Offline check that a Meta status receipt is filled ONLY by its identity-verified GREEN-API copy.
// Run: pnpm exec tsx scripts/verify-green-receipt-match.mts
// Values are pinned from the real Asha thread (Made By Moris, 14 Sep 2026); no database is touched.
import assert from 'node:assert/strict'

const { alignReceiptsWithCopies, decodeWamid, isReceiptOnly } = await import('../lib/whatsapp-green/receipt-match.ts')

const WA = '23052517130'
const HELLO = { id: 'wamid.HBgLMjMwNTI1MTcxMzAVAgARGBRDRTkwRDY4MTMxRTUzNzc3NDlGQQA=', pid: 'CE90D68131E5377749FA', body: 'Hello', at: '2026-09-14T19:12:17.000Z' }
const PEN = { id: 'wamid.HBgLMjMwNTI1MTcxMzAVAgARGBRDRTE5OTU0MzhGQzkxMzNDOTUxMgA=', pid: 'CE1995438FC9133C9512', body: 'Make up Pen RS 475 - 3 pens', at: '2026-09-14T19:12:28.000Z' }

const receipt = (m: typeof HELLO, extra: Partial<Parameters<typeof alignReceiptsWithCopies>[0][number]> = {}) =>
  ({ id: m.id, wa_id: WA, direction: 'out', type: 'external', body: null, media_id: null, created_at: m.at, ...extra })
const copy = (m: typeof HELLO, extra: Partial<Parameters<typeof alignReceiptsWithCopies>[1][number]> = {}) =>
  ({ provider_message_id: m.pid, wa_id: WA, direction: 'out', kind: 'text', body: m.body, provider_accepted_at: m.at, deleted_observed: false, conflicted: false, ...extra })

let passed = 0, failed = 0
const check = (name: string, fn: () => void) => { try { fn(); passed++ } catch (error) { failed++; console.log(`FAIL ${name}\n      ${error instanceof Error ? error.message : error}`) } }

check('wamid decodes to the real customer number and provider id', () => {
  assert.deepEqual(decodeWamid(HELLO.id), { waId: WA, providerMessageId: HELLO.pid })
  assert.deepEqual(decodeWamid(PEN.id), { waId: WA, providerMessageId: PEN.pid })
})
check('non-wamid ids decode to nothing', () => {
  assert.equal(decodeWamid('local-send-123'), null)
  assert.equal(decodeWamid('wamid.!!!'), null)
  assert.equal(decodeWamid(42), null)
})
check('receipt-only means external with no text and no media, or the stored flag', () => {
  assert.equal(isReceiptOnly({ type: 'external', body: null, media_id: null }), true)
  assert.equal(isReceiptOnly({ type: 'external', body: 'typed here', media_id: null }), false)
  assert.equal(isReceiptOnly({ type: 'text', body: null, media_id: null, receiptOnly: true }), true)
  assert.equal(isReceiptOnly({ type: 'text', body: null, media_id: null }), false)
})
check('two real receipts read their own copies, pinned text', () => {
  const a = alignReceiptsWithCopies([receipt(HELLO), receipt(PEN)], [copy(PEN), copy(HELLO)])
  assert.equal(a.fills.get(HELLO.id)?.body, 'Hello')
  assert.equal(a.fills.get(PEN.id)?.body, 'Make up Pen RS 475 - 3 pens')
  assert.equal(a.unresolvedOriginalCount, 0)
  assert.equal(a.unalignedCopyCount, 0)
})
check('a copy for a different customer number never fills', () => {
  const a = alignReceiptsWithCopies([receipt(HELLO)], [copy(HELLO, { wa_id: '23050000000' })])
  assert.equal(a.fills.size, 0); assert.equal(a.unresolvedOriginalCount, 1)
})
check('a copy in the other direction never fills', () => {
  const a = alignReceiptsWithCopies([receipt(HELLO)], [copy(HELLO, { direction: 'in' })])
  assert.equal(a.fills.size, 0); assert.equal(a.unresolvedOriginalCount, 1)
})
check('nearest-in-time is not identity: same second, other id, no fill', () => {
  const a = alignReceiptsWithCopies([receipt(HELLO)], [copy(PEN, { provider_accepted_at: HELLO.at })])
  assert.equal(a.fills.size, 0); assert.equal(a.unresolvedOriginalCount, 1); assert.equal(a.unalignedCopyCount, 1)
})
check('clock disagreement over 5 s refuses the fill', () => {
  const a = alignReceiptsWithCopies([receipt(HELLO)], [copy(HELLO, { provider_accepted_at: '2026-09-14T19:12:23.500Z' })])
  assert.equal(a.fills.size, 0)
  const ok = alignReceiptsWithCopies([receipt(HELLO)], [copy(HELLO, { provider_accepted_at: '2026-09-14T19:12:21.900Z' })])
  assert.equal(ok.fills.size, 1)
})
check('deleted, conflicted, unsupported or empty copies never fill', () => {
  for (const extra of [{ deleted_observed: true }, { conflicted: true }, { kind: 'unsupported' }, { body: '   ' }, { body: null }]) {
    const a = alignReceiptsWithCopies([receipt(HELLO)], [copy(HELLO, extra as never)])
    assert.equal(a.fills.size, 0, JSON.stringify(extra)); assert.equal(a.unresolvedOriginalCount, 1)
  }
})
check('two copies claiming one id are a conflict and neither fills', () => {
  const a = alignReceiptsWithCopies([receipt(HELLO)], [copy(HELLO), copy(HELLO, { body: 'Hallo' })])
  assert.equal(a.fills.size, 0); assert.equal(a.unresolvedOriginalCount, 1)
})
check('a receipt that already has text is left alone and is not counted missing', () => {
  const a = alignReceiptsWithCopies([receipt(HELLO, { body: 'typed in app' })], [copy(HELLO, { body: 'different' })])
  assert.equal(a.fills.size, 0); assert.equal(a.unresolvedOriginalCount, 0); assert.equal(a.unalignedCopyCount, 0)
})
check('a readable copy with no original at all is unaligned, not missing', () => {
  const a = alignReceiptsWithCopies([receipt(HELLO)], [copy(HELLO), copy(PEN)])
  assert.equal(a.fills.size, 1); assert.equal(a.unresolvedOriginalCount, 0); assert.equal(a.unalignedCopyCount, 1)
})
check('inbound customer rows are never receipts and never filled', () => {
  const a = alignReceiptsWithCopies([{ ...receipt(HELLO), direction: 'in', type: 'text', body: 'Hello! Can I get more info on this?' }], [copy(HELLO, { direction: 'in' })])
  assert.equal(a.fills.size, 0); assert.equal(a.unresolvedOriginalCount, 0)
})

console.log(`${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
