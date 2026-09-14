/**
 * Applies scripts/add-auto-match-method.sql and PROVES the new constraint both
 * accepts 'auto' and still refuses nonsense - in a rolled-back transaction, so
 * no rows survive.
 */
import { readFileSync } from 'node:fs'
import { connect } from '../lib/products/pg'

const client = await connect()
await client.query(readFileSync('scripts/add-auto-match-method.sql', 'utf8'))
console.log('migration applied')

let pass = 0
let fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' - ' + detail : ''}`) }
}

await client.query('begin')
try {
  const { rows: sup } = await client.query(
    `insert into local_suppliers (name) values ('ZZ Constraint Probe') returning id`,
  )
  const { rows: pur } = await client.query(
    `insert into local_purchases (supplier_id, purchase_date) values ($1, current_date) returning id`,
    [sup[0].id],
  )
  const pid = pur[0].id

  for (const m of ['auto', 'confirmed', 'created', 'alias', 'manual', 'unmatched']) {
    try {
      await client.query('savepoint s')
      await client.query(
        `insert into local_purchase_lines (purchase_id, supplier_label, qty, unit_price_gross, match_method)
         values ($1, 'probe', 1, 10, $2)`,
        [pid, m],
      )
      await client.query('release savepoint s')
      check(`match_method '${m}' accepted`, true)
    } catch (e) {
      await client.query('rollback to savepoint s')
      check(`match_method '${m}' accepted`, false, e instanceof Error ? e.message : '')
    }
  }

  // The constraint must still bite, or it is not a constraint.
  try {
    await client.query('savepoint s')
    await client.query(
      `insert into local_purchase_lines (purchase_id, supplier_label, qty, unit_price_gross, match_method)
       values ($1, 'probe', 1, 10, 'guessed')`,
      [pid],
    )
    await client.query('rollback to savepoint s')
    check("match_method 'guessed' REFUSED", false, 'it was accepted')
  } catch {
    await client.query('rollback to savepoint s')
    check("match_method 'guessed' REFUSED", true)
  }
} finally {
  await client.query('rollback')
  await client.end()
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
