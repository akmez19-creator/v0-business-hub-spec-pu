/**
 * An open order must only GROW when the customer asked for something more.
 *
 * Malini (19 Sep) confirmed a Washing Machine Cleaner, then wrote that she
 * works at Ebene but lives at Rose Hill and wants delivery next week. She was
 * answered "1 x Washing Machine Cleaner - Rs 375 added to your order. New total
 * Rs 750" - a second cleaner she never asked for, because the reply was chosen
 * by the open row existing rather than by her words.
 *
 * Run: pnpm exec tsx scripts/check-order-addition.ts
 */

import { wantsAnotherItem } from '../lib/inbox/after-sales'
import { enforceConfirmationReply } from '../lib/inbox/assist-prompt'

let failures = 0
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     want ${JSON.stringify(want)}\n     got  ${JSON.stringify(got)}`}`)
}

// --- the words that mean "more", and the ones that do not -------------------
const asksMore = [
  'I will need one floor cleaner too',
  'add a mop please',
  'can you also send the window cleaner',
  'one more please',
  'I want 2 more',
  'mo bizin enn ousi',
  'ajoutez une autre svp',
  'je veux encore un',
  'send another one',
]
for (const t of asksMore) check(`asks for more: "${t}"`, wantsAnotherItem(t), true)

const doesNotAskMore = [
  // Malini, verbatim.
  'Hello i work at ebene. I thought delivery will be next week. I live at rose hill. Can you do delivery next week please',
  'I dont work tomorrow. I wont be at ebene',
  'can you deliver on Monday instead',
  'please change the address to Curepipe',
  'what time will the rider come?',
  'is my order confirmed?',
  'ok thank you',
  'pa vini demin, vini lindi',
]
for (const t of doesNotAskMore) check(`not an addition: "${t.slice(0, 42)}"`, wantsAnotherItem(t), false)

// --- the reply that goes out ------------------------------------------------
const openOrders = [{ products: 'Washing Machine Cleaner', amount: 375, deliveryDate: '2026-09-19' }]
const base = { productName: 'Washing Machine Cleaner', qty: 1, amount: 375, deliveryDate: '2026-09-21T00:00:00.000Z' }

// Malini: her message must not be turned into a second cleaner. null = the
// model's own answer about the new day and address is what gets sent.
check(
  'reschedule leaves the reply alone',
  enforceConfirmationReply({
    ...base,
    reply: 'No problem Malini, we can deliver next week instead. Which address should we use?',
    openOrders,
    isAddition: wantsAnotherItem(doesNotAskMore[0]),
  }),
  null,
)

// The add-on path still works exactly as before.
check(
  'a real addition still gives the new total',
  enforceConfirmationReply({
    ...base,
    productName: 'Floor Cleaner',
    amount: 300,
    reply: 'Sure, I will add that for you.',
    openOrders,
    isAddition: wantsAnotherItem('I will need one floor cleaner too'),
  }),
  // The open order is dated BEFORE this drop, so its day is not promised again
  // (a past-dated pending row is being rescheduled) - existing behaviour.
  '1 x Floor Cleaner - Rs 300 added to your order. New total Rs 675, delivered together with your pending order.',
)

// ...and when the open order's day is still ahead, that day is named.
check(
  'addition riding on a future order names the day',
  enforceConfirmationReply({
    ...base,
    productName: 'Floor Cleaner',
    amount: 300,
    deliveryDate: '2026-09-19T00:00:00.000Z',
    reply: 'Sure, I will add that for you.',
    openOrders,
    isAddition: true,
  }),
  '1 x Floor Cleaner - Rs 300 added to your order. New total Rs 675, delivered together on Saturday 19 September 2026.',
)

// An address given alongside is not a request for another item.
check('"add my address" is not an addition', wantsAnotherItem('please add my address: Rose Hill'), false)

// A fresh lead with no open order is untouched by this gate.
const fresh = enforceConfirmationReply({ ...base, reply: 'Great, thank you!', openOrders: [], isAddition: false })
check('fresh confirmation still sent', typeof fresh === 'string' && fresh.includes('Order Confirmation'), true)

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
