/**
 * Pins the returning-client prefill rules with exact values:
 *   npx tsx scripts/check-returning-client-prefill.ts
 */
import assert from 'node:assert/strict'
import { applyAssistResult, newLeadSession, seedOrderFromRecord } from '../components/inbox/inbox-session'
import { prefillFromLastDelivery } from '../components/inbox/use-customer-record'

const last = { id: 'd1', customerName: 'Dada Sa Tah', contact2: '230 5711 2233', locality: 'st hilaire', notes: 'Blue gate, call before', products: 'Air Fryer', status: 'delivered', createdAt: '2026-08-12', pastOrders: 3 }
const regions = ['Curepipe', 'St Hilaire', 'Rose Hill']

// 1. Locality matched case-insensitively to the ACTIVE list; alt phone normalised to 8 digits.
const p = prefillFromLastDelivery(last, regions)
assert.deepEqual(p, { fields: { customerName: 'Dada Sa Tah', contact2: '57112233', region: 'St Hilaire', notes: 'Blue gate, call before' }, localityNotInList: false })

// 2. Locality no longer served -> left blank and flagged, never a value the dropdown cannot show.
const gone = prefillFromLastDelivery({ ...last, locality: 'Ebene' }, regions)
assert.equal(gone.fields.region, ''); assert.equal(gone.localityNotInList, true)

// 3. Fills only empty untouched fields, marks nothing touched.
let s = newLeadSession()
s = { ...s, order: { ...s.order, customerName: 'Typed Name' }, orderTouched: { notes: true } }
const seeded = seedOrderFromRecord(s, p.fields)
assert.equal(seeded.order.customerName, 'Typed Name')
assert.equal(seeded.order.region, 'St Hilaire')
assert.equal(seeded.order.contact2, '57112233')
assert.equal(seeded.order.notes, '')
assert.deepEqual(seeded.orderTouched, { notes: true })
assert.equal(seedOrderFromRecord(seeded, p.fields), seeded, 'no-op returns the same reference')

// 4. The AI reading THIS conversation overrides the record when it found something...
const withAi = applyAssistResult(seeded, 0, 0, false, { success: true, reply: 'hi', order: { ...seeded.order, region: 'Curepipe', customerName: '', contact2: '', notes: '', productId: null, qty: 1, deliveryDate: '' } })
assert.equal(withAi.order.region, 'Curepipe')
// ...but its blanks do not wipe what the record (or the ad) already filled.
assert.equal(withAi.order.customerName, 'Typed Name')
assert.equal(withAi.order.contact2, '57112233')

console.log('returning-client prefill: 4 checks passed')
