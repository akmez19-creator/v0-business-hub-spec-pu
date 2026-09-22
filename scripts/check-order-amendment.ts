/**
 * Pinned cases for lib/inbox/order-amendment.
 *
 * Run: pnpm exec tsx scripts/check-order-amendment.ts
 *
 * The first case is the real thread that prompted this (Sungalee Malini,
 * 18 Sep): the reply promises a new DAY but only ASKS about the address, and
 * the panel happened to hold a stale "Ebene". The day must move; the address
 * must not.
 */

import { detectAmendments, type Amendment } from '@/lib/inbox/order-amendment'

let failures = 0
const check = (name: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) return console.log(`  ok   ${name}`)
  failures++
  console.log(`  FAIL ${name}\n       expected ${e}\n       actual   ${a}`)
}

/** Compact view: field -> ticked or the reason it is not. */
const shape = (list: Amendment[]) =>
  Object.fromEntries(list.map((a) => [a.field, a.confirmed ? `apply:${a.to}` : `hold:${a.hold}`]))

console.log('\nSungalee Malini - "next week instead", address still a question')
{
  const open = { deliveryDate: '2026-09-19', qty: 1, locality: 'Munsah', products: 'Washing Machine Cleaner' }
  const text =
    'No problem Malini, we can deliver next week instead. Should we deliver to Rose Hill or do you prefer another location? Please confirm which address is best for you for Monday 21 September.'
  const next = { deliveryDate: '2026-09-21', qty: 1, region: 'Ebene', productName: 'Washing Machine Cleaner' }
  check('day promised, stale Ebene held back', shape(detectAmendments({ open, next, text })), {
    deliveryDate: 'apply:2026-09-21',
    region: 'hold:the message does not state it',
  })

  // Same thread once she answers and the agent writes the address as a fact.
  const agreed = 'Perfect, we deliver to Rose Hill on Monday 21 September.'
  check('address stated, both apply', shape(detectAmendments({ open, next: { ...next, region: 'Rose Hill' }, text: agreed })), {
    deliveryDate: 'apply:2026-09-21',
    region: 'apply:Rose Hill',
  })

  // Asking about the day too must not move it.
  const asking = 'Can we deliver on Monday 21 September instead?'
  check('day only asked', shape(detectAmendments({ open, next: { ...next, region: 'Munsah' }, text: asking })), {
    deliveryDate: 'hold:the message only asks about it',
  })
}

console.log('\nNothing changed - the panel is prefilled from the open order')
{
  const open = { deliveryDate: '2026-09-19', qty: 1, locality: 'Munsah', products: 'Washing Machine Cleaner' }
  check('no amendments', detectAmendments({
    open,
    next: { deliveryDate: '2026-09-19', qty: 1, region: 'Munsah', productName: 'Washing Machine Cleaner' },
    text: 'Your order is confirmed for Saturday 19 September 2026.',
  }), [])
}

console.log('\nQuantity')
{
  const open = { deliveryDate: '2026-09-21', qty: 1, locality: 'Rose Hill', products: 'Washing Machine Cleaner' }
  const next = { deliveryDate: '2026-09-21', qty: 2, region: 'Rose Hill', productName: 'Washing Machine Cleaner' }
  check('"2 x" applies', shape(detectAmendments({ open, next, text: '2 x Washing Machine Cleaner - Rs 575, delivered Monday 21 September.' })), { qty: 'apply:2' })
  // "Rs 575" and "12 tablets" are digits that are NOT the quantity.
  check('a bare price is not a quantity', shape(detectAmendments({ open, next, text: 'The price is Rs 575 for the 12 tablets pack.' })), { qty: 'hold:the message does not state it' })
}

console.log('\nProduct: an addition is not a swap')
{
  const open = { deliveryDate: '2026-09-21', qty: 1, locality: 'Rose Hill', products: 'Washing Machine Cleaner' }
  const next = { deliveryDate: '2026-09-21', qty: 1, region: 'Rose Hill', productName: 'Floor Cleaner' }
  check('add-on wording changes nothing', shape(detectAmendments({ open, next, text: 'Noted, we add the Floor Cleaner to your order. New total Rs 750, delivered together on Monday 21 September.' })), {})
  check('"instead of" swaps the row', shape(detectAmendments({ open, next, text: 'Sure, we will send the Floor Cleaner instead of the Washing Machine Cleaner on Monday 21 September.' })), { product: 'apply:Floor Cleaner' })
}

console.log('\nDate wording the team actually uses')
{
  const open = { deliveryDate: '2026-09-19', qty: 1, locality: 'Rose Hill', products: 'Washing Machine Cleaner' }
  const base = { qty: 1, region: 'Rose Hill', productName: 'Washing Machine Cleaner' }
  const says = (text: string, ymd = '2026-09-21') =>
    detectAmendments({ open, next: { ...base, deliveryDate: ymd }, text })[0]?.confirmed ?? false
  check('"Monday 21 September"', says('Delivery is scheduled on Monday 21 September 2026.'), true)
  check('"21/09"', says('We deliver 21/09.'), true)
  check('"21 Sept"', says('Your delivery moves to 21 Sept.'), true)
  check('bare weekday', says('We will come Monday instead.'), true)
  check('weekday with a competing number', says('Rs 375, we come Monday.'), true)
  check('wrong day named', says('We deliver Tuesday 22 September.'), false)
}

console.log('\nLocality: the message is the contract, even when the panel was not touched')
{
  // Malini: panel and order both hold Ebene, but the draft promises Rose Hill.
  // Sending that with the order untouched puts the rider back at Ebene.
  const open = { deliveryDate: '2026-09-19', qty: 1, locality: 'Ebene', products: 'Washing Machine Cleaner' }
  const next = { deliveryDate: '2026-09-21', qty: 1, region: 'Ebene', productName: 'Washing Machine Cleaner' }
  const regions = ['Ebene', 'Rose Hill', 'Curepipe', 'Port Louis', 'Quatre Bornes']
  const says = (text: string) => shape(detectAmendments({ open, next, text, regions }))

  check('a promised locality moves the order',
    says("No problem Malini, we'll deliver to Rose Hill instead on Monday 21 September."),
    { deliveryDate: 'apply:2026-09-21', region: 'apply:Rose Hill' })
  check('postponing without naming a place keeps the address',
    says('No problem Malini, we move your delivery to Monday 21 September.'),
    { deliveryDate: 'apply:2026-09-21' })
  check('asking about the address does not move it',
    says('We move it to Monday 21 September. Should we deliver to Rose Hill or keep Ebene?'),
    { deliveryDate: 'apply:2026-09-21' })
  check('repeating the address on the order changes nothing',
    says('We deliver to Ebene on Monday 21 September as planned.'),
    { deliveryDate: 'apply:2026-09-21' })
  // Our own words name places for other reasons; only a sending sentence counts.
  check('a place named without sending it there is ignored',
    says('Our Rose Hill team packs it today. Delivery stays Monday 21 September.'),
    { deliveryDate: 'apply:2026-09-21' })
  check('"your order will come to Curepipe" moves it',
    says('Your order will come to Curepipe on Monday 21 September.'),
    { deliveryDate: 'apply:2026-09-21', region: 'apply:Curepipe' })
  // The panel still wins when the agent picked something themselves.
  check('panel choice still needs the message to back it up',
    shape(detectAmendments({ open, next: { ...next, region: 'Quatre Bornes' }, text: 'Noted, Monday 21 September.', regions })),
    { deliveryDate: 'apply:2026-09-21', region: 'hold:the message does not state it' })
}

console.log(failures ? `\n${failures} FAILED\n` : '\nall pinned cases pass\n')
process.exit(failures ? 1 : 0)
