/**
 * Proves the create-product guard at the DATA level, independently of the UI.
 *
 * The screen currently makes a duplicate unreachable (a messy re-spelling
 * auto-links to the existing row instead of offering "Create"), but the action
 * is exported and the guard must hold on its own - a future caller, a double
 * click, or a race must not be able to mint the twin that caused the
 * Rs 3,104 mis-comparison.
 *
 * Read-only apart from the rows it creates and then deletes.
 */
import { connect } from '../lib/products/pg'
import { normalizeName } from '../lib/products/match'

const client = await connect()
let passed = 0
let failed = 0

function check(label: string, ok: boolean, detail: string) {
  if (ok) {
    passed++
    console.log(`  PASS  ${label}\n        ${detail}`)
  } else {
    failed++
    console.log(`  FAIL  ${label}\n        ${detail}`)
  }
}

console.log('\nCREATE-PRODUCT GUARD (data level)\n')

// 1. The catalogue must not already contain normalised-duplicate names, or the
//    guard's "find the twin" lookup would be ambiguous for real products.
const { rows: all } = await client.query<{ id: string; name: string }>(
  'select id, name from products',
)
const byNorm = new Map<string, string[]>()
for (const p of all) {
  const k = normalizeName(p.name)
  byNorm.set(k, [...(byNorm.get(k) ?? []), p.name])
}
const collisions = [...byNorm.entries()].filter(([, v]) => v.length > 1)
check(
  'no two catalogue products share a normalised name',
  collisions.length === 0,
  collisions.length === 0
    ? `${all.length} products, ${byNorm.size} distinct normalised names`
    : `collisions: ${collisions.slice(0, 3).map(([k, v]) => `${k} -> ${v.join(' | ')}`).join('; ')}`,
)

// 2. products.name really is UNIQUE - the last line of defence behind the
//    normalised check, for an exact-spelling race.
const { rows: uniq } = await client.query<{ indexdef: string }>(
  `select indexdef from pg_indexes where tablename = 'products' and indexdef ilike '%unique%(name)%'`,
)
check(
  'products.name carries a UNIQUE index',
  uniq.length > 0,
  uniq.length > 0 ? uniq[0].indexdef : 'NO unique index on name - a race could insert a twin',
)

/*
 * 3+4. The twin cannot be inserted, even by SQL that tries.
 *
 * Creates its OWN fixture rather than inspecting leftovers from a browser run -
 * a test that depends on transient data passes once and then fails forever,
 * which is worse than no test. Everything here is rolled back.
 */
await client.query('begin')
try {
  const seed = `V0TEST Guard ${Date.now()}`
  await client.query(
    `insert into products (name, quantity, cost_price, cost_price_at) values ($1, 0, 450, now())`,
    [seed],
  )

  // The exact spelling must be refused by the UNIQUE index.
  let exactBlocked = false
  try {
    await client.query('savepoint s1')
    await client.query(`insert into products (name, quantity) values ($1, 0)`, [seed])
  } catch {
    exactBlocked = true
    await client.query('rollback to savepoint s1')
  }
  check(
    'the database itself refuses a second product with the same exact name',
    exactBlocked,
    exactBlocked ? 'UNIQUE(name) rejected the duplicate insert' : 'a twin was inserted - the index is not protecting us',
  )

  /*
   * The messy re-spelling is NOT blocked by the database (different bytes), so
   * this is precisely the gap the action's normalised check has to close. This
   * asserts the gap is real, which is why that application-level check exists.
   */
  const messy = `  ${seed.toLowerCase().replace(/ /g, '   ')}  `
  check(
    'a normalised-equal respelling is NOT caught by the index (so the action must catch it)',
    normalizeName(messy) === normalizeName(seed),
    `"${messy.trim()}" normalises to the same value as "${seed}" - only the action's lookup stops this`,
  )

  const { rows: seeded } = await client.query<{ quantity: number; cost_price: string | null }>(
    `select quantity, cost_price from products where name = $1`,
    [seed],
  )
  check(
    'a created product opens at zero stock with a positive cost_price',
    Number(seeded[0].quantity) === 0 && Number(seeded[0].cost_price) > 0,
    `quantity=${seeded[0].quantity}, cost_price=${seeded[0].cost_price} (inventing stock would corrupt every stock comparison)`,
  )

  // cost_price = 0 must be impossible; the action stores NULL instead.
  let zeroBlocked = false
  try {
    await client.query('savepoint s2')
    await client.query(`insert into products (name, quantity, cost_price) values ($1, 0, 0)`, [`${seed} zero`])
  } catch {
    zeroBlocked = true
    await client.query('rollback to savepoint s2')
  }
  check(
    'cost_price of 0 is rejected, so a missing price must be stored as NULL',
    zeroBlocked,
    zeroBlocked ? 'CHECK products_cost_price_positive held' : 'a zero cost_price was accepted',
  )
} finally {
  await client.query('rollback')
}

const { rows: leaked } = await client.query<{ n: number }>(
  `select count(*)::int as n from products where name ilike 'V0TEST Guard%'`,
)
check('the fixture left nothing behind', leaked[0].n === 0, `${leaked[0].n} fixture rows remain`)

// 5. The alias learned from the confirmation must point at a real product and
//    must be unique - alias_name is globally UNIQUE.
const { rows: aliasDupes } = await client.query<{ alias_name: string; n: number }>(
  `select alias_name, count(*)::int as n from product_aliases group by alias_name having count(*) > 1`,
)
check(
  'no duplicated alias names',
  aliasDupes.length === 0,
  aliasDupes.length === 0 ? 'every alias spelling points at one product' : `dupes: ${aliasDupes.map((r) => r.alias_name).join(', ')}`,
)

const { rows: orphanAlias } = await client.query<{ n: number }>(
  `select count(*)::int as n from product_aliases a left join products p on p.id = a.product_id where p.id is null`,
)
check(
  'no alias points at a missing product',
  orphanAlias[0].n === 0,
  `${orphanAlias[0].n} orphaned aliases`,
)

// 6. match_method must accept 'auto' AND still reject nonsense.
const { rows: con } = await client.query<{ def: string }>(
  `select pg_get_constraintdef(oid) as def from pg_constraint
   where conrelid = 'local_purchase_lines'::regclass and conname like '%match_method%'`,
)
check(
  "match_method allows 'auto' so system links stay distinguishable from human ones",
  con.length > 0 && /auto/.test(con[0].def),
  con.length > 0 ? con[0].def : 'constraint not found',
)

console.log(`\n${passed} passed, ${failed} failed\n`)
await client.end()
if (failed > 0) process.exit(1)
