/**
 * Applies scripts/create-local-purchasing.sql, then PROVES the schema does what
 * the comments claim - in a transaction that is rolled back, so nothing is left
 * behind. The generated `unit_price_net` column and the FK/check constraints
 * are the parts worth testing: if the discount maths is wrong, every cost
 * comparison built on top of it is wrong too.
 */
import { readFileSync } from 'node:fs'
import { connect } from '../lib/products/pg'

const sql = readFileSync('scripts/create-local-purchasing.sql', 'utf8')
const client = await connect()

let pass = 0
let fail = 0
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) {
    pass++
    console.log(`  ok   ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name}${detail ? ' - ' + detail : ''}`)
  }
}

let savepointSeq = 0

/**
 * Asserts a statement is REFUSED by the database.
 *
 * Must be wrapped in its own SAVEPOINT. A failed statement in Postgres aborts
 * the ENTIRE transaction, so without this every assertion after the first
 * expected-failure died with "current transaction is aborted, commands ignored"
 * - which is exactly what happened on the first run and made a working schema
 * look broken. Rolling back to the savepoint leaves the transaction usable.
 */
async function expectReject(name: string, sql: string, params: unknown[] = []) {
  const sp = `sp_${++savepointSeq}`
  await client.query(`savepoint ${sp}`)
  let rejected = false
  let message = ''
  try {
    await client.query(sql, params)
  } catch (error) {
    rejected = true
    message = error instanceof Error ? error.message : String(error)
  }
  // Release on success, roll back on the expected failure - either way the
  // transaction is left clean for the next assertion.
  await client.query(rejected ? `rollback to savepoint ${sp}` : `release savepoint ${sp}`)
  check(name, rejected, rejected ? '' : 'the database ACCEPTED it')
  return message
}

try {
  await client.query(sql)
  console.log('migration applied\n')

  // ---- verify, then roll back ----
  await client.query('begin')

  const { rows: sup } = await client.query(
    `insert into local_suppliers (name, vat_number) values ('__probe supplier', 'VAT123') returning id`,
  )
  const supplierId = sup[0].id

  const { rows: p } = await client.query(
    `insert into local_purchases
       (supplier_id, doc_ref, discount_percent, vat_percent, vat_reclaimable, document_total_gross)
     values ($1, 'INV 144', 20, 15, true, 1932) returning id`,
    [supplierId],
  )
  const purchaseId = p[0].id

  // The real Sweeping Robot line off the owner's document: list Rs 210, 20%
  // off -> Rs 168 net. If the generated column does not produce 168, the whole
  // comparison is built on sand.
  const { rows: line } = await client.query(
    `insert into local_purchase_lines
       (purchase_id, supplier_label, supplier_code, qty, unit_price_gross, discount_percent)
     values ($1, 'Automatic Sweeping Robot', 'DT1057', 10, 210, 20)
     returning unit_price_net, product_id, match_method`,
    [purchaseId],
  )
  check(
    'generated unit_price_net applies the discount (210 - 20% = 168)',
    Number(line[0].unit_price_net) === 168,
    `got ${line[0].unit_price_net}`,
  )
  check('a purchase line may stay UNLINKED (product_id null)', line[0].product_id === null)

  // A null discount must fall through to the gross price, not to zero.
  const { rows: nodisc } = await client.query(
    `insert into local_purchase_lines (purchase_id, supplier_label, qty, unit_price_gross)
     values ($1, 'no discount line', 1, 99.5) returning unit_price_net`,
    [purchaseId],
  )
  check(
    'null discount leaves the price untouched (not zeroed)',
    Number(nodisc[0].unit_price_net) === 99.5,
    `got ${nodisc[0].unit_price_net}`,
  )

  // A bad status must be refused rather than silently stored.
  await expectReject(
    'status check constraint refuses an unknown value',
    `update local_purchases set status = 'nonsense' where id = $1`,
    [purchaseId],
  )

  // The document's own declared total is kept SEPARATELY from the lines, so a
  // missed line can be detected. Pin the real numbers: Rs 1,932 declared
  // against 10 x Rs 168 = Rs 1,680 goods + Rs 252 VAT = Rs 1,932. They agree
  // here, which is what makes the comparison meaningful when they do not.
  const { rows: tot } = await client.query(
    `select document_total_gross::float8 declared,
            (select round(sum(qty * unit_price_net), 2)
               from local_purchase_lines where purchase_id = $1
                and supplier_label = 'Automatic Sweeping Robot')::float8 goods
       from local_purchases where id = $1`,
    [purchaseId],
  )
  check(
    'declared document total is stored apart from the lines (1932 vs 1680 goods)',
    tot[0].declared === 1932 && tot[0].goods === 1680,
    `declared ${tot[0].declared}, goods ${tot[0].goods}`,
  )

  // vat_reclaimable is a stored fact, not something re-derived from the
  // supplier at read time - a VAT-registered supplier can still issue a
  // non-VAT receipt.
  await client.query(`update local_purchases set vat_reclaimable = false where id = $1`, [
    purchaseId,
  ])
  const { rows: recl } = await client.query(
    `select ls.vat_number, lp.vat_reclaimable
       from local_purchases lp join local_suppliers ls on ls.id = lp.supplier_id
      where lp.id = $1`,
    [purchaseId],
  )
  check(
    'a VAT-registered supplier can still have a non-reclaimable purchase',
    recl[0].vat_number === 'VAT123' && recl[0].vat_reclaimable === false,
  )

  // A line's China comparison is SNAPSHOTTED at purchase time.
  const { rows: realProduct } = await client.query(
    `select id from products where name = 'Sweeping Robot' limit 1`,
  )
  if (realProduct.length) {
    const { rows: snap } = await client.query(
      `insert into local_purchase_lines
         (purchase_id, product_id, supplier_label, qty, unit_price_gross, discount_percent,
          china_cp_at_purchase, variance_percent, override_reason, match_method, matched_at)
       values ($1, $2, 'Automatic Sweeping Robot', 10, 210, 20, 133.56, 25.8, 'needed urgently',
               'confirmed', now())
       returning unit_price_net, china_cp_at_purchase`,
      [purchaseId, realProduct[0].id],
    )
    check(
      'a confirmed line stores the net price and the China snapshot (168 vs 133.56)',
      Number(snap[0].unit_price_net) === 168 && Number(snap[0].china_cp_at_purchase) === 133.56,
      `got ${snap[0].unit_price_net} / ${snap[0].china_cp_at_purchase}`,
    )
  } else {
    console.log('  skip snapshot test - "Sweeping Robot" not found')
  }

  // A document can be attached BEFORE the purchase exists, which is the normal
  // order when importing a receipt.
  const { rows: doc } = await client.query(
    `insert into local_purchase_documents (purchase_id, url, kind, source, extracted)
     values (null, 'https://example.test/receipt.jpg', 'receipt', 'ai', $1::jsonb)
     returning id, purchase_id`,
    [JSON.stringify({ supplier: 'Probe Ltd', total: 1932 })],
  )
  check(
    'a document may be uploaded and read before any purchase row exists',
    doc[0].purchase_id === null,
  )
  await expectReject(
    'document source must be one of ai / sheet / manual',
    `update local_purchase_documents set source = 'guesswork' where id = $1`,
    [doc[0].id],
  )

  /*
   * Pin the EXACT column names the import action writes.
   *
   * This exists because the action wrote storage_path / mime_type /
   * uploaded_by - names that were never in the schema - and every document
   * insert failed at runtime while this suite stayed green, because the tests
   * wrote their own correct SQL and so could not disagree with the app. A test
   * that spells the columns itself proves nothing about what the app spells.
   */
  const appColumns = ['purchase_id', 'url', 'file_name', 'mime', 'kind', 'source', 'extracted', 'created_by']
  const { rows: actual } = await client.query(
    `select column_name from information_schema.columns
      where table_name = 'local_purchase_documents'`,
  )
  const have = new Set(actual.map((r: { column_name: string }) => r.column_name))
  const missing = appColumns.filter((c) => !have.has(c))
  check(
    `every column the import action writes exists (${appColumns.length} checked)`,
    missing.length === 0,
    missing.length ? `missing: ${missing.join(', ')}` : '',
  )

  // Supplier name is unique, so the same company cannot accumulate spellings
  // the way the China supplier_name text field did.
  await expectReject(
    'supplier name is unique',
    `insert into local_suppliers (name) values ('__probe supplier')`,
  )

  await client.query('rollback')
  console.log('\nrolled back - no probe rows kept')

  // Confirm the rollback really happened.
  const { rows: left } = await client.query(
    `select count(*)::int as n from local_suppliers where name = '__probe supplier'`,
  )
  check('rollback left nothing behind', left[0].n === 0, `${left[0].n} rows remain`)

  console.log(`\n${pass} passed, ${fail} failed`)
} catch (error) {
  console.error('FAILED:', error instanceof Error ? error.message : error)
  try {
    await client.query('rollback')
  } catch {}
  process.exitCode = 1
} finally {
  await client.end()
}
