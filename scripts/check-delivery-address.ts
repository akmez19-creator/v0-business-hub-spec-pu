/**
 * A place the customer MENTIONS is not a new delivery address.
 *
 * Malini (19 Sep) confirmed delivery at Ebene, then wrote "Hello i work at
 * ebene. I thought delivery will be next week. I live at rose hill. Can you do
 * delivery next week please" and "I dont work tomorrow. I wont be at ebene".
 * She was answered "We'll deliver to Rose Hill instead" - but she only
 * postponed. She works at Ebene, she is simply not there tomorrow, so Monday
 * at Ebene is exactly right and her home address was never requested.
 *
 * Run: pnpm exec tsx scripts/check-delivery-address.ts
 */

import { asksDeliveryAt, latestCustomerRun } from '../lib/inbox/after-sales'

let failures = 0
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     want ${JSON.stringify(want)}\n     got  ${JSON.stringify(got)}`}`)
}

// --- Malini, verbatim -------------------------------------------------------
const malini = [
  'Customer: My name malini. Number 57818737',
  'Customer: Delivery at ebene',
  'Business: 1 x Washing Machine Cleaner (12 tablets) - Rs 375',
  'Business: Order Confirmation. Delivery is scheduled on Saturday 19 September 2026',
  'Customer: Hello i work at ebene. I thought delivery will be next week. I live at rose hill. Can you do delivery next week please',
  'Customer: I dont work tomorrow. I wont be at ebene',
].join('\n')

check(
  'her latest run is both bubbles, not just the last',
  latestCustomerRun(malini),
  'Hello i work at ebene. I thought delivery will be next week. I live at rose hill. Can you do delivery next week please I dont work tomorrow. I wont be at ebene',
)
check('"I live at rose hill" does not re-route the order', asksDeliveryAt(latestCustomerRun(malini), 'Rose Hill'), false)
check('"I work at ebene" is not a delivery request either', asksDeliveryAt(latestCustomerRun(malini), 'Ebene'), false)

// The run stops at our reply: her opening "Delivery at ebene" is not "now".
check(
  'the run is only what came after our last message',
  latestCustomerRun(malini).includes('My name malini'),
  false,
)

// --- mentions: where they are, not where the parcel goes --------------------
for (const text of [
  'I live at rose hill',
  'i stay in rose hill with my mother',
  'I work at ebene but I live at rose hill',
  'I am at rose hill today',
  'mo reste rose hill',
  "j'habite a rose hill",
  'I wont be at rose hill tomorrow',
]) check(`mention: ${text}`, asksDeliveryAt(text, 'Rose Hill'), false)

// --- requests: the parcel moves --------------------------------------------
for (const text of [
  'can you deliver at rose hill',
  'deliver to rose hill please',
  'send it to rose hill',
  'bring it rose hill instead',
  'please drop it at rose hill',
  'my address is rose hill',
  'change the address to rose hill',
  'livrer a rose hill svp',
  'ou kapav amenn li rose hill',
] ) check(`request: ${text}`, asksDeliveryAt(text, 'Rose Hill'), true)

// --- how Ebene was set in the first place -----------------------------------
check('"Delivery at ebene" IS a request', asksDeliveryAt('Delivery at ebene', 'Ebene'), true)

// --- sentence scoping -------------------------------------------------------
// The delivery verb must be in the SAME sentence as the place, or "can you
// deliver next week? I live at rose hill" would move the address.
check(
  'a delivery question in another sentence does not carry over',
  asksDeliveryAt('Can you do delivery next week please. I live at rose hill.', 'Rose Hill'),
  false,
)
check(
  'same sentence still counts',
  asksDeliveryAt('Can you do the delivery next week at rose hill please.', 'Rose Hill'),
  true,
)

// --- guards -----------------------------------------------------------------
check('no locality, nothing to ask for', asksDeliveryAt('deliver to rose hill', ''), false)
check('empty text', asksDeliveryAt('', 'Rose Hill'), false)
// Multi-word localities must match as a phrase, not on "hill" alone.
check('another hill is not Rose Hill', asksDeliveryAt('deliver at quatre bornes', 'Rose Hill'), false)

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
