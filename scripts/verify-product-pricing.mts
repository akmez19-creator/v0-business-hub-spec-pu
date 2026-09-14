import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { z } from 'zod'
import * as receiptInput from '../lib/local-purchasing/receipt-input'
import * as evidence from '../lib/local-purchasing/evidence'
import * as reconcile from '../lib/local-purchasing/reconcile'
import * as supplierIdentity from '../lib/local-purchasing/supplier-identity'
import { compareOrderDocument, type OrderReviewInput } from '../lib/local-purchasing/order-reconcile'
import { calculateOrder, type LocalOrderLine, type OrderSnapshot } from '../lib/local-purchasing/order-types'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as pricing from '../lib/products/pricing'
import * as pricingServer from '../lib/products/pricing-server'
import { fetchAll } from '../lib/supabase/fetch-all'
import { normalizeName } from '../lib/products/match'
import { normaliseCategory } from '../lib/products/categories'
import { priceFor } from '../lib/orders/quick-order'
import * as vat from '../lib/local-purchasing/vat'
import { decideAutoLink } from '../lib/local-purchasing/autolink'

let passed = 0
let failed = 0
async function test(name: string, run: () => unknown | Promise<unknown>) {
  try { await run(); passed++; console.log(`PASS ${name}`) }
  catch (error) { failed++; console.error(`FAIL ${name}`, error) }
}

const unitDraft = (): pricing.PricingDraft => ({ ...pricing.createPricingDraft(), unitPrice: '175.50' })
const setDraft = (): pricing.PricingDraft => ({
  ...unitDraft(), soldInSets: true,
  bundleRows: [{ id: 'a', qty: '5', price: '375' }, { id: 'b', qty: '10', price: '575' }],
})
function payload(draft: pricing.PricingDraft) {
  const result = pricing.validateProductPricing(draft)
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error(result.issues[0].message)
  return result.value
}
function productRow(patch: Record<string, unknown> = {}) {
  return {
    id: randomUUID(), name: 'Verification Product', image_url: null, quantity: 7,
    price: 0, bundle_prices: {}, is_b1g1: false, price_spx2: null, price_spx3: null,
    price_b1g1: null, promo_price: null, has_variants: false,
    updated_at: '2026-09-05T00:00:00.000Z', cost_price: 34.7826, category: null,
    ...patch,
  }
}
const blankSnapshot = () => pricing.pricingProductFromRow(productRow() as pricing.PricingProductRow, false).pricing

await test('selling price retains cents without becoming purchase cost', () => {
  assert.deepEqual(payload(unitDraft()), { price: 175.5, bundle_prices: {}, is_b1g1: false })
})
await test('set-only prices serialize unchanged and existing order logic charges Rs 575 for 10', () => {
  const value = payload(setDraft())
  assert.deepEqual(value, { price: 0, bundle_prices: { '5': 375, '10': 575 }, is_b1g1: false })
  assert.equal(priceFor({ id: 'fixture', name: 'Fixture', ...value }, 10), 575)
})
await test('B1G1 never halves the paid price', () => {
  const value = payload({ ...unitDraft(), isB1g1: true })
  assert.equal(value.price, 175.5)
  assert.equal(priceFor({ id: 'fixture', name: 'Fixture', ...value }, 1), 175.5)
})
for (const value of ['', '0', '-1', 'NaN', 'Infinity', '1e3', '0x10', '175.501', '100000000', '12bad']) {
  await test(`rejects invalid unit price ${JSON.stringify(value)}`, () => {
    assert.equal(pricing.validateProductPricing({ ...unitDraft(), unitPrice: value }).ok, false)
  })
}
for (const qty of ['1', '2.5', '-2', '2x', 'Infinity', '10001', '']) {
  await test(`rejects invalid pack size ${JSON.stringify(qty)}`, () => {
    assert.equal(pricing.validateProductPricing({ ...setDraft(), bundleRows: [{ id: 'a', qty, price: '375' }] }).ok, false)
  })
}
for (const price of ['', '0', '-1', 'NaN', 'Infinity', '375.123']) {
  await test(`rejects invalid whole-set price ${JSON.stringify(price)}`, () => {
    assert.equal(pricing.validateProductPricing({ ...setDraft(), bundleRows: [{ id: 'a', qty: '5', price }] }).ok, false)
  })
}
await test('duplicates cannot collapse into one tier, including leading-zero sizes', () => {
  assert.equal(pricing.validateProductPricing({ ...setDraft(), bundleRows: [{ id: 'a', qty: '5', price: '375' }, { id: 'b', qty: '05', price: '575' }] }).ok, false)
})
await test('blank rows are ignored, but an empty set-only product is refused', () => {
  const blank = { id: 'empty', qty: ' ', price: '' }
  assert.deepEqual(payload({ ...unitDraft(), bundleRows: [blank] }), payload(unitDraft()))
  assert.equal(pricing.validateProductPricing({ ...setDraft(), bundleRows: [blank] }).ok, false)
})
await test('malformed direct POST payloads are rejected', () => {
  for (const bad of [null, undefined, {}, [], { ...unitDraft(), unitPrice: 175.5 }, { ...unitDraft(), isB1g1: 'false' }, { ...unitDraft(), bundleRows: [null] }]) {
    assert.equal(pricing.validateProductPricing(bad).ok, false)
  }
})
await test('Inventory can still edit unpriced legacy records', () => {
  assert.equal(pricing.validateProductPricing(pricing.createPricingDraft(), { requirePricing: false }).ok, true)
})
await test('string-valued JSON packs and decimal prices round-trip', () => {
  const draft = pricing.createPricingDraft({ price: '0.00', bundle_prices: { '10': '575.50', '5': '375.25' }, is_b1g1: false })
  assert.equal(draft.soldInSets, true)
  assert.deepEqual(payload(draft).bundle_prices, { '5': 375.25, '10': 575.5 })
  assert.notEqual(draft.bundleRows[0].id, draft.bundleRows[1].id)
  assert.notEqual(pricing.newBundlePriceRow().id, pricing.newBundlePriceRow().id)
  assert.equal(payload(pricing.createPricingDraft({ price: '175.50', bundle_prices: {}, is_b1g1: true })).price, 175.5)
})
await test('unit, sets, legacy, promo and variant prices are not marked unpriced', () => {
  for (const patch of [{ price: '175.50' }, { bundle_prices: { '5': '375' } }, { price_spx2: 375 }, { price_spx3: 500 }, { price_b1g1: 175 }, { promo_price: 150 }, { hasVariantPrice: true }]) {
    assert.equal(pricing.pricingStatus({ ...blankSnapshot(), ...patch }), 'priced')
  }
  assert.equal(pricing.pricingStatus({ ...blankSnapshot(), is_b1g1: true }), 'unpriced')
  assert.equal(pricing.pricingStatus({ ...blankSnapshot(), hasVariantPrice: null }), 'unknown')
  assert.equal(pricing.pricingStatus(undefined), 'unknown')
})
await test('product-ID merge updates repeated references and adds new picker entries', () => {
  const a = pricing.pricingProductFromRow(productRow() as pricing.PricingProductRow, false)
  const b = pricing.pricingProductFromRow(productRow({ name: 'Another' }) as pricing.PricingProductRow, false)
  const changed = { ...a, pricing: { ...a.pricing, price: 175.5 } }
  const merged = pricing.mergePricingProducts([a], [changed, b])
  assert.equal(merged.length, 2)
  const byId = new Map(merged.map((p) => [p.id, p]))
  assert.deepEqual([a.id, a.id].map((id) => byId.get(id)?.pricing.price), [175.5, 175.5])
})

type Row = Record<string, any>
type Mutation = { client: string; op: string; values: Row; filters: Array<[string, string, unknown]>; count: number }
function freshState() {
  return {
    products: [] as Row[], variants: [] as Row[], purchases: [] as Row[], lines: [] as Row[], suppliers: [] as Row[], supplierItems: [] as Row[],
    chinaRefs: new Map<string, vat.ChinaCostRef>(), role: 'admin', signedIn: true,
    writes: [] as Mutation[], reads: [] as { table: string; orders: string[] }[],
    revalidated: [] as string[], beforeWrite: null as (() => void) | null, failVariants: false,
  }
}
let state = freshState()
const userId = randomUUID()
const knownColumns = new Set([...Object.keys(productRow()), 'sku', 'cost_price_at', 'created_at', 'is_active', 'description', 'remarks', 'sold_out', 'last_counted_at', 'shelf_code', 'zone'])

function client(clientName: string) {
  return {
    auth: { getUser: async () => ({ data: { user: state.signedIn ? { id: userId } : null } }) },
    async rpc(name: string, args: Row) {
      if (name === 'inventory_create_product') {
        assert.equal(clientName, 'authenticated')
        for (const key of Object.keys(args.p_product)) assert.ok(knownColumns.has(key), `Unknown product column in creation RPC: ${key}`)
        for (const variant of args.p_variants) for (const key of Object.keys(variant)) assert.ok(['attribute_name', 'attribute_value', 'price_override', 'quantity', 'sku'].includes(key), `Unknown variant creation column: ${key}`)
        const hook = state.beforeWrite; state.beforeWrite = null; hook?.()
        const twin = state.products.find((row) => row.id === args.p_product.id || normalizeName(row.name) === normalizeName(args.p_product.name))
        if (twin) return { data: { productId: twin.id, created: false, replayed: twin.id === args.p_product.id }, error: null }
        const row = productRow({ ...args.p_product, cost_price_at: args.p_product.cost_price ? new Date().toISOString() : null })
        state.products.push(row)
        state.variants.push(...args.p_variants.map((variant: Row) => ({ id: randomUUID(), product_id: row.id, is_active: true, image_url: null, ...variant })))
        state.writes.push({ client: clientName, op: 'rpc-create', values: args.p_product, filters: [], count: 1 })
        return { data: { productId: row.id, created: true, replayed: false }, error: null }
      }
      assert.equal(name, 'local_commit_purchase')
      assert.equal(args.p_actor, userId)
      const id = randomUUID()
      state.purchases.push({ id, ...args.p_payload })
      state.lines.push(...args.p_payload.lines.map((line: Row) => ({ id: randomUUID(), purchase_id: id, ...line })))
      return { data: { id, lineCount: args.p_payload.lines.length, replayed: false }, error: null }
    },
    from(table: string) {
      const filters: Array<[string, string, unknown]> = []
      const orders: string[] = []
      let range: [number, number] | null = null
      let op = 'read'
      let values: Row = {}
      let single = false
      const query = {
        select(columns = '*') {
          if (table === 'products' && columns !== '*') for (const column of columns.split(',')) assert.ok(knownColumns.has(column), `Unknown product column: ${column}`)
          return query
        },
        order(column: string) { orders.push(column); return query },
        range(from: number, to: number) { range = [from, to]; return query },
        limit(n: number) { range = [0, n - 1]; return query },
        eq(column: string, value: unknown) { filters.push(['eq', column, value]); return query },
        in(column: string, value: unknown[]) { filters.push(['in', column, value]); return query },
        is(column: string, value: unknown) { filters.push(['is', column, value]); return query },
        gt(column: string, value: unknown) { filters.push(['gt', column, value]); return query },
        insert(input: Row) { op = 'insert'; values = input; return query },
        update(input: Row) { op = 'update'; values = input; return query },
        maybeSingle() { single = true; return query },
        single() { single = true; return query },
        then(resolve: (result: any) => unknown, reject: (error: unknown) => unknown) {
          return Promise.resolve().then(() => {
            if (table === 'product_variants' && state.failVariants) return { data: null, error: { message: 'Fixture read failure' } }
            if (op !== 'read') {
              const allowed = table === 'products' ? knownColumns : table === 'local_purchases'
                ? new Set(['supplier_id', 'doc_ref', 'purchase_date', 'discount_percent', 'vat_percent', 'prices_include_vat', 'vat_reclaimable', 'document_total_gross', 'notes', 'status', 'created_by'])
                : new Set(['purchase_id', 'supplier_label', 'supplier_code', 'product_id', 'match_method', 'matched_at', 'matched_by', 'qty', 'unit_price_gross', 'discount_percent', 'china_cp_at_purchase', 'variance_percent'])
              for (const input of Array.isArray(values) ? values : [values]) {
                for (const key of Object.keys(input)) assert.ok(allowed.has(key), `Unknown ${table} written column: ${key}`)
              }
              const hook = state.beforeWrite
              state.beforeWrite = null
              hook?.()
            }
            let rows = table === 'products' ? state.products : table === 'product_variants' ? state.variants : table === 'local_purchases' ? state.purchases : table === 'local_purchase_lines' ? state.lines : table === 'local_suppliers' ? state.suppliers : [{ id: userId, role: state.role }]
            if (op === 'insert') {
              const inputs = Array.isArray(values) ? values : [values]
              if (table === 'products' && inputs.some((input) => rows.some((row) => row.name === input.name))) return { data: null, error: { code: '23505', message: 'duplicate name' } }
              const added = inputs.map((input) => table === 'products' ? productRow(input) : { id: randomUUID(), ...input })
              rows.push(...added)
              state.writes.push({ client: clientName, op, values, filters, count: added.length })
              return { data: structuredClone(single ? added[0] : added), error: null }
            }
            rows = rows.filter((row) => filters.every(([operator, column, value]) => {
              if (operator === 'in') return (value as unknown[]).includes(row[column])
              if (operator === 'is') return row[column] == null
              if (operator === 'gt') return Number(row[column]) > Number(value)
              if (column === 'bundle_prices') return JSON.stringify(row[column]) === value
              return String(row[column]) === String(value)
            }))
            if (op === 'update') {
              for (const row of rows) Object.assign(row, values)
              state.writes.push({ client: clientName, op, values, filters, count: rows.length })
            } else {
              state.reads.push({ table, orders })
              rows = [...rows].sort((a, b) => {
                for (const column of orders) { const order = String(a[column]).localeCompare(String(b[column])); if (order) return order }
                return 0
              })
            }
            if (range) rows = rows.slice(range[0], range[1] + 1)
            return { data: structuredClone(single ? rows[0] ?? null : rows), error: null }
          }).then(resolve, reject)
        },
      }
      return query
    },
  }
}

// Execute the REAL action source, with only request/framework boundaries replaced.
// Reimplementing its inserts in the test would miss a broken application payload.
const source = readFileSync(new URL('../app/dashboard/purchasing/local/actions.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const actionExports: Record<string, any> = {}
const modules: Record<string, unknown> = {
  'next/cache': { revalidatePath: (path: string) => state.revalidated.push(path) },
  '@/lib/supabase/server': { createClient: async () => client('authenticated'), createAdminClient: () => client('admin') },
  '@/lib/products/pricing': pricing,
  '@/lib/products/pricing-server': pricingServer,
  '@/lib/supabase/fetch-all': { fetchAll },
  '@/lib/products/match': { normalizeName },
  '@/lib/products/categories': { normaliseCategory },
  '@/lib/local-purchasing/vat': vat,
  '@/lib/local-purchasing/existing': { findExistingPurchase: async () => null },
  '@/lib/local-purchasing/suggest': { suggestForLabels: async () => new Map() },
  '@/lib/local-purchasing/costs': { fetchChinaCostRefs: async () => state.chinaRefs, fetchProductRefs: async () => new Map(state.products.map((row) => [row.id, { id: row.id, name: row.name, stockOnHand: row.quantity, hasVariants: row.has_variants }])) },
  '@/lib/local-purchasing/autolink': { decideAutoLink },
}
function serviceModule(file: string, dependencies: Record<string, unknown>) {
  const output: Record<string, any> = {}
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'exports', code)((name: string) => dependencies[name] ?? modules[name] ?? {}, output)
  return output
}
const analyseModule = serviceModule('../lib/local-purchasing/analyse.ts', {
  './suggest': modules['@/lib/local-purchasing/suggest'], './autolink': { decideAutoLink }, './costs': modules['@/lib/local-purchasing/costs'],
  './vat': vat, './reconcile': reconcile, './receipt-input': receiptInput, './supplier-identity': supplierIdentity,
  './supplier-catalogue': { loadSupplierCatalogue: async () => state.supplierItems },
})
modules['@/lib/local-purchasing/analyse'] = analyseModule
modules['@/lib/local-purchasing/purchase-service'] = serviceModule('../lib/local-purchasing/purchase-service.ts', {
  'node:crypto': { createHash }, zod: { z }, './evidence': evidence, './reconcile': reconcile, './receipt-input': receiptInput,
  './analyse': analyseModule, './documents': { loadOwnedDocument: () => { throw new Error('No live documents in this contract suite.') } },
  './extract': {}, './supplier-identity': supplierIdentity,
})
new Function('require', 'exports', compiled)((name: string) => modules[name] ?? {}, actionExports)
const create = actionExports.createProductForLineAction
const save = actionExports.savePurchasingProductAction
const read = actionExports.getProductPricingAction
const inventoryActions = serviceModule('../app/dashboard/deliveries/inventory/actions.ts', {
  '@/lib/local-purchasing/auth': serviceModule('../lib/local-purchasing/auth.ts', {}),
})
const newVariants = (): pricing.NewVariantsDraft => ({ enabled: true, rows: [
  { ...pricing.newVariantRow(), attributeName: 'Capacity', attributeValue: '2Kg', priceOverride: '875' },
  { ...pricing.newVariantRow(), attributeName: 'Capacity', attributeValue: '5Kg', priceOverride: '1500' },
] })

await test('actual creation action rejects missing prices before any product write', async () => {
  state = freshState()
  for (const draft of [undefined, pricing.createPricingDraft(), { ...setDraft(), bundleRows: [] }]) {
    await assert.rejects(create({ name: 'Verification Create', pricing: draft }), /price|sets/i)
  }
  assert.equal(state.writes.length, 0)
  assert.equal(state.products.length, 0)
})
await test('actual create action inserts price 175.50 and cost 34.7826 separately with zero stock', async () => {
  state = freshState()
  const result = await create({ name: 'Verification Create', unitCostNet: 34.7826, pricing: unitDraft() })
  assert.equal(result.created, true)
  assert.equal(result.product.pricing.price, 175.5)
  assert.equal(state.products[0].cost_price, 34.7826)
  assert.equal(state.products[0].quantity, 0)
  assert.equal(state.writes[0].client, 'authenticated')
  assert.deepEqual(state.revalidated, ['/dashboard/purchasing/local', '/dashboard/deliveries/inventory'])
})
await test('variant-only new products accept buyer-entered prices without inventing a parent price', () => {
  const checked = pricing.validateNewProductPricing(pricing.createPricingDraft(), newVariants())
  assert.equal(checked.ok, true)
  if (!checked.ok) return
  assert.equal(checked.pricing.price, 0)
  assert.deepEqual(checked.variants.map((row) => row.price_override), [875, 1500])
  assert.deepEqual(checked.variants.map((row) => row.quantity), [0, 0])
})
await test('new variants inherit only entered defaults, never a sibling price', () => {
  const variants = newVariants(); variants.rows[1].priceOverride = ''
  assert.equal(pricing.validateNewProductPricing(pricing.createPricingDraft(), variants).ok, false)
  const checked = pricing.validateNewProductPricing(unitDraft(), variants)
  assert.equal(checked.ok, true)
  if (checked.ok) assert.deepEqual(checked.variants.map((row) => row.price_override), [875, null])
  assert.equal(pricing.validateNewProductPricing(pricing.createPricingDraft(), variants, { requirePricing: false }).ok, true)
})
await test('incomplete, duplicate and invalid new variants cannot create any product', async () => {
  const invalid = [
    (draft: pricing.NewVariantsDraft) => { draft.rows[0].attributeName = '' },
    (draft: pricing.NewVariantsDraft) => { draft.rows[0].attributeValue = '' },
    (draft: pricing.NewVariantsDraft) => { draft.rows[1].attributeValue = ' 2kg ' },
    (draft: pricing.NewVariantsDraft) => { draft.rows[1].key = draft.rows[0].key },
    (draft: pricing.NewVariantsDraft) => { draft.rows[0].priceOverride = '0' },
    (draft: pricing.NewVariantsDraft) => { draft.rows[0].priceOverride = '-1' },
    (draft: pricing.NewVariantsDraft) => { draft.rows[0].priceOverride = '875.123' },
    (draft: pricing.NewVariantsDraft) => { draft.rows[0].priceOverride = 'NaN' },
    (draft: pricing.NewVariantsDraft) => { draft.rows[0].quantity = '2.5' },
    (draft: pricing.NewVariantsDraft) => { draft.rows = [] },
    (draft: pricing.NewVariantsDraft) => { draft.rows = Array.from({ length: 101 }, () => pricing.newVariantRow()) },
  ]
  for (const amend of invalid) {
    state = freshState(); const variants = newVariants(); amend(variants)
    await assert.rejects(create({ name: 'Invalid variant create', pricing: pricing.createPricingDraft(), variants }))
    assert.equal(state.writes.length, 0); assert.equal(state.products.length, 0); assert.equal(state.variants.length, 0)
  }
})
await test('purchasing creation returns every new variant immediately and never seeds sibling cost or stock', async () => {
  state = freshState()
  const variants = newVariants(); variants.rows[0].quantity = '20'
  const result = await create({ name: 'New Variant Coating', pricing: pricing.createPricingDraft(), variants, unitCostNet: 252.1739 })
  assert.equal(result.created, true); assert.equal(result.product.pricing.has_variants, true)
  assert.deepEqual(result.product.variants.map((row: pricing.PricingVariant) => [row.attributeValue, row.priceOverride, row.stockOnHand]), [['2Kg', 875, 0], ['5Kg', 1500, 0]])
  assert.equal(state.products[0].cost_price, null); assert.equal(state.products[0].quantity, 0)
  const before = structuredClone(state.variants)
  const reused = await create({ name: ' new   variant coating ', pricing: unitDraft(), variants: newVariants(), unitCostNet: 999 })
  assert.equal(reused.created, false); assert.deepEqual(state.variants, before)
  assert.equal(reused.product.variants.length, 2); assert.equal(state.products.length, 1)
})
await test('ordinary new products return an explicitly loaded empty variant list', async () => {
  state = freshState()
  const result = await create({ name: 'Ordinary New Product', pricing: unitDraft() })
  assert.deepEqual(result.product.variants, [])
})
await test('Inventory Add Product uses the same transaction and new variants reach the purchasing catalogue', async () => {
  state = freshState()
  const variants = newVariants(); variants.rows[0].quantity = '7'
  const request = { requestId: randomUUID(), name: 'Inventory Variant Product', pricing: pricing.createPricingDraft(), variants, quantity: 80, isActive: false }
  const product = await inventoryActions.createInventoryProductAction(request)
  assert.equal(product.id, request.requestId); assert.equal(product.has_variants, true); assert.equal(product.quantity, 0)
  const catalogue = await actionExports.getPurchasingCatalogueAction()
  assert.equal(catalogue[0].variants.length, 2); assert.equal(catalogue[0].variants[0].stockOnHand, 7)
  assert.equal((await inventoryActions.createInventoryProductAction(request)).id, product.id)
  assert.equal(state.products.length, 1); assert.equal(state.variants.length, 2)
  await assert.rejects(inventoryActions.createInventoryProductAction({ ...request, requestId: randomUUID() }), /already exists/)
})
await test('a parent details edit does not empty the newly created variant selector', async () => {
  state = freshState()
  const { product } = await create({ name: 'Variant Edit Product', pricing: pricing.createPricingDraft(), variants: newVariants() })
  const saved = await save({ productId: product.id, expectedRevision: pricing.productEditRevision(product), draft: { ...pricing.createProductEditDraft(product), name: 'Renamed Variant Product' } })
  assert.deepEqual(saved.variants, product.variants)
  assert.equal(pricing.variantSelectionError(saved, product.variants[0].id), null)
})
await test('all new-product paths reject non-buyers and unsafe photo URLs before writing', async () => {
  state = freshState(); state.role = 'marketing_agent'
  await assert.rejects(inventoryActions.createInventoryProductAction({ requestId: randomUUID(), name: 'Forbidden', pricing: unitDraft(), variants: newVariants() }), /Not allowed/)
  state = freshState()
  for (const imageUrl of ['javascript:alert(1)', 'http://example.com/photo.jpg', 'https://user:password@example.com/photo.jpg']) {
    await assert.rejects(create({ name: 'Unsafe photo', imageUrl, pricing: unitDraft(), variants: newVariants() }), /HTTPS/)
  }
  assert.equal(state.products.length, 0); assert.equal(state.writes.length, 0)
})
await test('normalised-name reuse preserves all existing prices and returns their status', async () => {
  state = freshState()
  const existing = productRow({ name: 'Verification Twin', price: 999, bundle_prices: { '5': '4500' }, is_b1g1: true })
  state.products.push(existing)
  const before = structuredClone(existing)
  const result = await create({ name: ' verification   twin ', pricing: unitDraft(), unitCostNet: 10 })
  assert.equal(result.created, false)
  assert.equal(result.product.pricing.price, 999)
  assert.deepEqual(existing, before)
  assert.match(result.reusedReason, /not applied/)
})
await test('unique-conflict recovery does not overwrite a concurrently created product', async () => {
  state = freshState()
  state.beforeWrite = () => { state.products.push(productRow({ name: 'Verification Race', price: 875 })) }
  const result = await create({ name: 'Verification Race', pricing: unitDraft() })
  assert.equal(result.created, false)
  assert.equal(result.product.pricing.price, 875)
  assert.equal(state.products.length, 1)
  assert.equal(state.writes.length, 0)
})
await test('actual completion action updates only selling fields, with authenticated history attribution', async () => {
  state = freshState()
  const row = productRow()
  state.products.push(row)
  const current = await read(row.id)
  const result = await save({ productId: row.id, expectedRevision: pricing.productEditRevision(current), draft: { ...pricing.createProductEditDraft(current), pricing: setDraft() } })
  assert.deepEqual(result.pricing.bundle_prices, { '5': 375, '10': 575 })
  assert.equal(row.price, 0)
  assert.equal(row.cost_price, 34.7826)
  assert.equal(row.quantity, 7)
  assert.equal(row.name, 'Verification Product')
  assert.equal(state.writes[0].client, 'authenticated')
  assert.deepEqual(Object.keys(state.writes[0].values).sort(), ['bundle_prices', 'updated_at'])
})
for (const change of [{ price: 250 }, { bundle_prices: { '5': 300 } }, { is_b1g1: true }, { promo_price: 100 }, { name: 'Concurrent rename' }, { image_url: 'https://example.com/new-photo.png' }, { category: 'Home Appliances' }]) {
  await test(`compare-and-set rejects a racing ${Object.keys(change)[0]} edit even without updated_at`, async () => {
    state = freshState()
    const row = productRow()
    state.products.push(row)
    const current = await read(row.id)
    state.beforeWrite = () => { Object.assign(row, change) }
    await assert.rejects(save({ productId: row.id, expectedRevision: pricing.productEditRevision(current), draft: { ...pricing.createProductEditDraft(current), pricing: unitDraft() } }), /Nothing was overwritten/)
    assert.equal(state.writes[0].count, 0)
    for (const [key, value] of Object.entries(change)) assert.deepEqual(row[key], value)
  })
}
await test('a stale opening snapshot cannot save even if the current product is still unpriced', async () => {
  state = freshState()
  const row = productRow()
  state.products.push(row)
  const current = await read(row.id)
  row.is_b1g1 = true
  await assert.rejects(save({ productId: row.id, expectedRevision: pricing.productEditRevision(current), draft: { ...pricing.createProductEditDraft(current), pricing: unitDraft() } }), /changed while/)
  assert.equal(state.writes.length, 0)
})
await test('details-only edits preserve variant, legacy, promo and raw JSON pricing exactly', async () => {
  for (const patch of [{ price_spx2: 400 }, { promo_price: 120 }, { has_variants: true }, { price: null, bundle_prices: null, is_b1g1: null }, { price: 0, bundle_prices: { '5': '375.50' } }]) {
    state = freshState()
    const row = productRow({ category: 'Legacy category', ...patch })
    state.products.push(row)
    if (row.has_variants) state.variants.push({ id: randomUUID(), product_id: row.id, price_override: 175 })
    const current = await read(row.id)
    const before = structuredClone(row)
    await save({ productId: row.id, expectedRevision: pricing.productEditRevision(current), draft: { ...pricing.createProductEditDraft(current), name: 'Renamed product' } })
    assert.equal(row.name, 'Renamed product')
    assert.deepEqual(Object.keys(state.writes[0].values).sort(), ['name', 'updated_at'])
    for (const key of Object.keys(before).filter((key) => !['name', 'updated_at'].includes(key))) assert.deepEqual(row[key], before[key])
  }
})
await test('failed variant reads are unknown, not permission to set prices', async () => {
  state = freshState()
  const row = productRow()
  state.products.push(row)
  state.failVariants = true
  await assert.rejects(read(row.id), /Could not read/)
  await assert.rejects(actionExports.getPurchasingCatalogueAction())
  assert.equal(state.writes.length, 0)
})
await test('both creation and completion require a signed-in admin or manager', async () => {
  for (const signedIn of [false, true]) {
    state = freshState()
    state.signedIn = signedIn
    state.role = 'storekeeper'
    await assert.rejects(create({ name: 'Forbidden', pricing: unitDraft() }), /Not signed in|Not allowed/)
    await assert.rejects(save({ productId: randomUUID(), pricing: unitDraft(), expectedRevision: '' }), /Not signed in|Not allowed/)
    assert.equal(state.writes.length, 0)
  }
})
await test('catalogue and variant coverage pass the 1,000-row boundary with an ID tiebreaker', async () => {
  state = freshState()
  state.products = Array.from({ length: 1005 }, (_, index) => productRow({ name: `Product ${index}` }))
  state.variants = state.products.map((row) => ({ id: randomUUID(), product_id: row.id, price_override: 175 }))
  const result = await actionExports.getPurchasingCatalogueAction()
  assert.equal(result.length, 1005)
  assert.equal(result.filter((p: pricing.PricingProduct) => p.pricing.hasVariantPrice).length, 1005)
  for (const query of state.reads.filter((q) => q.table !== 'profiles')) assert.ok(query.orders.includes('id'))
})

await test('already-priced products can edit details and prices while preserving stock and cost', async () => {
  state = freshState()
  const row = productRow({ price: 475, promo_price: 450, price_spx2: 800, sku: 'KEEP', cost_price_at: '2026-09-01T00:00:00Z' })
  state.products.push(row)
  const current = await read(row.id)
  const result = await save({ productId: row.id, expectedRevision: pricing.productEditRevision(current), draft: {
    ...pricing.createProductEditDraft(current), name: 'Edited product', category: 'Beauty & Personal Care', imageUrl: 'https://example.com/fixture.png', pricing: unitDraft(),
  } })
  assert.equal(result.name, 'Edited product')
  assert.equal(result.category, 'Beauty & Personal Care')
  assert.equal(result.imageUrl, 'https://example.com/fixture.png')
  assert.equal(result.pricing.price, 175.5)
  assert.deepEqual([row.cost_price, row.quantity, row.promo_price, row.price_spx2, row.sku, row.cost_price_at], [34.7826, 7, 450, 800, 'KEEP', '2026-09-01T00:00:00Z'])
  assert.deepEqual(Object.keys(state.writes[0].values).sort(), ['category', 'image_url', 'name', 'price', 'updated_at'])
})
await test('no-op and currency-format-only edits do not write a timestamp or history', async () => {
  state = freshState()
  const row = productRow({ price: 175.5, bundle_prices: { '5': '375.50' }, is_b1g1: null })
  state.products.push(row)
  const current = await read(row.id)
  await save({ productId: row.id, expectedRevision: pricing.productEditRevision(current), draft: pricing.createProductEditDraft(current) })
  await save({ productId: row.id, expectedRevision: pricing.productEditRevision(current), draft: { ...pricing.createProductEditDraft(current), pricing: { ...pricing.createPricingDraft(current.pricing), unitPrice: '175.50' } } })
  assert.equal(state.writes.length, 0)
  assert.deepEqual(row.bundle_prices, { '5': '375.50' })
})
await test('invalid names, categories, photos and changed prices are rejected without writing', async () => {
  state = freshState()
  const row = productRow({ price: 475 })
  state.products.push(row)
  const current = await read(row.id)
  for (const patch of [{ name: ' ' }, { name: '***' }, { name: 'x'.repeat(201) }, { name: 'Bad\u0000name' }, { category: 'Invented' }, { imageUrl: 'javascript:alert(1)' }, { imageUrl: 'http://example.com/test.png' }, { pricing: pricing.createPricingDraft() }, { pricing: null }]) {
    await assert.rejects(save({ productId: row.id, expectedRevision: pricing.productEditRevision(current), draft: { ...pricing.createProductEditDraft(current), ...patch } }))
  }
  assert.equal(state.writes.length, 0)
})
await test('normalized duplicate rename checks the full catalogue beyond 1,000 rows', async () => {
  state = freshState()
  const row = productRow({ name: 'Editable' })
  state.products = [row, ...Array.from({ length: 1005 }, (_, index) => productRow({ name: `Existing ${index}` }))]
  const current = await read(row.id)
  await assert.rejects(save({ productId: row.id, expectedRevision: pricing.productEditRevision(current), draft: { ...pricing.createProductEditDraft(current), name: ' existing   1004 ' } }), /already exists/)
  assert.equal(state.writes.length, 0)
})
await test('deleted products cannot be recreated by a stale editor', async () => {
  state = freshState()
  const row = productRow()
  state.products.push(row)
  const current = await read(row.id)
  state.products = []
  await assert.rejects(save({ productId: row.id, expectedRevision: pricing.productEditRevision(current), draft: { ...pricing.createProductEditDraft(current), name: 'Edited' } }), /no longer/)
  assert.equal(state.writes.length, 0)
})
await test('product-ID cache merge refreshes all detail and photo references, not supplier text', () => {
  const current = pricing.pricingProductFromRow(productRow() as pricing.PricingProductRow, false)
  const receipt = [{ productId: current.id, supplierLabel: 'First label', qty: 2 }, { productId: current.id, supplierLabel: 'Different label', qty: 3 }]
  const before = structuredClone(receipt)
  const edited = { ...current, name: 'Edited', imageUrl: 'https://example.com/photo.png', category: 'Home Appliances' }
  const byId = new Map(pricing.mergePricingProducts([current], [edited]).map((product) => [product.id, product]))
  assert.deepEqual(receipt.map((line) => byId.get(line.productId)?.name), ['Edited', 'Edited'])
  assert.deepEqual(receipt, before)
})

for (const scenario of [
  { label: '40 inclusive', entered: 40, inclusive: true, discount: 0, override: null, rate: 15, claim: true, net: 34.7826, payable: 40, vat: 5.22, effectiveDiscount: 0 },
  { label: '210 exclusive less header 20%', entered: 210, inclusive: false, discount: 20, override: null, rate: 15, claim: true, net: 168, payable: 193.2, vat: 25.2, effectiveDiscount: 20 },
  { label: '40 inclusive less header 20%', entered: 40, inclusive: true, discount: 20, override: null, rate: 15, claim: true, net: 27.8261, payable: 32, vat: 4.17, effectiveDiscount: 20 },
  { label: 'line 0% overrides header 20%', entered: 210, inclusive: false, discount: 20, override: 0, rate: 15, claim: true, net: 210, payable: 241.5, vat: 31.5, effectiveDiscount: 0 },
  { label: 'zero VAT', entered: 40, inclusive: true, discount: 0, override: null, rate: 0, claim: false, net: 40, payable: 40, vat: 0, effectiveDiscount: 0 },
  { label: 'non-reclaimable inclusive VAT', entered: 40, inclusive: true, discount: 0, override: null, rate: 15, claim: false, net: 34.7826, payable: 40, vat: 5.22, effectiveDiscount: 0 },
]) {
  await test(`real analysis and RPC payload agree: ${scenario.label}`, async () => {
    state = freshState()
    const supplierId = randomUUID()
    state.suppliers.push({ id: supplierId, name: 'Contract-test supplier', vat_number: scenario.claim ? 'VAT123456' : null, is_active: true })
    const line = { key: 'line', supplierLabel: 'Test invoice item', qty: 3, unitPriceGross: scenario.entered, discountPercent: scenario.override }
    const terms = { discountPercent: scenario.discount, pricesIncludeVat: scenario.inclusive, vatPercent: scenario.rate, vatReclaimable: scenario.claim }
    const document = receiptInput.draftEvidence([line], evidence.normaliseEvidence({ docKind: 'invoice', declaredTotal: vat.round2(scenario.payable * 3),
      lines: [], pricesIncludeVat: scenario.inclusive, vatPercent: scenario.rate, discountPercent: scenario.discount, discountIncluded: false }))
    const [result] = await actionExports.analyseLinesAction({ lines: [line], supplierId, document, ...terms })
    assert.equal(result.unitPriceNet, scenario.net)
    assert.equal(result.unitAmounts.unitVat.gross, scenario.payable)
    assert.equal(result.unitAmounts.unitVat.vat, scenario.vat)
    assert.equal(result.unitAmounts.unitVat.reclaimable, scenario.claim ? scenario.vat : 0)
    const request = { supplierId, lines: [line], document, idempotencyKey: randomUUID(), actualPurchase: true, ...terms }
    const checked = reconcile.reconcileReceipt(document, {}, scenario.claim)
    await actionExports.savePurchaseAction({ ...request, acknowledgement: checked.status === 'verified' ? null : {
      revision: receiptInput.purchaseReviewRevision(checked.inputRevision, request), reason: 'Contract-test evidence: retain the explicit zero-percent line discount over the document discount.',
    } })
    assert.equal(state.lines.length, 1)
    assert.equal(state.lines[0].discount_percent, scenario.effectiveDiscount)
    assert.equal(vat.netUnitPrice(state.lines[0].unit_price_gross, state.lines[0].discount_percent), scenario.net)
    assert.equal(state.purchases[0].prices_include_vat, scenario.rate === 0 ? false : scenario.inclusive)
    assert.equal(state.purchases[0].vat_percent, scenario.rate)
  })
}
await test('invalid VAT and discounts are refused before creating a receipt header', async () => {
  for (const terms of [{ vatPercent: -1 }, { vatPercent: 101 }, { discountPercent: 150 }, { discountPercent: NaN }, { vatPercent: 15.0001 }]) {
    state = freshState()
    await assert.rejects(actionExports.savePurchaseAction({ supplierId: randomUUID(), lines: [{ key: 'a', supplierLabel: 'Item', qty: 1, unitPriceGross: 40 }], ...terms }))
    assert.equal(state.writes.length, 0)
  }
})

await test('all active variants remain selectable at zero stock, including missing selling prices', async () => {
  state = freshState()
  const product = productRow({ has_variants: true })
  state.products.push(product)
  state.variants = [
    { id: randomUUID(), product_id: product.id, attribute_name: 'Capacity', attribute_value: '2Kg', price_override: 875, quantity: 0, is_active: true },
    { id: randomUUID(), product_id: product.id, attribute_name: 'Capacity', attribute_value: '5Kg', price_override: 1500, quantity: 0, is_active: true },
    { id: randomUUID(), product_id: product.id, attribute_name: 'Capacity', attribute_value: '10Kg', price_override: null, quantity: 0, is_active: true },
    { id: randomUUID(), product_id: product.id, attribute_name: 'Capacity', attribute_value: '20Kg', price_override: 0, quantity: 9, is_active: false },
  ]
  const loaded = await pricingServer.loadPricingProduct(client('admin') as any, product.id)
  assert.equal(loaded.variants?.length, 4)
  assert.deepEqual(loaded.variants!.filter((v) => v.isActive).map((v) => [v.attributeValue, pricing.variantSellingPrice(loaded, v)]), [['2Kg', 875], ['5Kg', 1500], ['10Kg', null]])
  assert.equal(pricing.variantSellingPrice({ ...loaded, pricing: { ...loaded.pricing, price: 200 } }, loaded.variants![2]), 200)
  assert.ok(pricing.variantSelectionError(loaded, state.variants[3].id))
  assert.ok(pricing.variantSelectionError(loaded, randomUUID()))
  assert.ok(pricing.variantSelectionError({ ...loaded, variants: undefined }, state.variants[0].id))
  assert.equal(pricing.variantSelectionError(loaded, null), null)
  await assert.rejects(pricingServer.validatePurchasingVariants(client('admin') as any, [{ productId: product.id, variantId: state.variants[3].id }]), /inactive/)
  await assert.rejects(pricingServer.validatePurchasingVariants(client('admin') as any, [{ productId: randomUUID(), variantId: state.variants[0].id }]), /another product/)
  await assert.rejects(pricingServer.validatePurchasingVariants(client('admin') as any, [{ productId: product.id, variantId: state.variants[0].id, variantCleared: true }]))
  assert.equal(state.writes.length, 0)
})
await test('one product with over 1,000 variants is paged completely and deterministically', async () => {
  state = freshState()
  const product = productRow({ has_variants: true }); state.products.push(product)
  state.variants = Array.from({ length: 1005 }, (_, index) => ({ id: randomUUID(), product_id: product.id, attribute_name: 'Size', attribute_value: String(index), quantity: 0, price_override: null, is_active: true }))
  const loaded = await pricingServer.loadPricingProduct(client('admin') as any, product.id)
  assert.equal(loaded.variants?.length, 1005)
  assert.ok(state.reads.filter((read) => read.table === 'product_variants').every((read) => read.orders.includes('id')))
})
await test('variant changes revise review identity but never supplier evidence, quantities or VAT', async () => {
  const line = { key: 'coating', supplierLabel: 'waterproof glue 2kg.', supplierCode: 'DT1057', unit: 'piece', qty: 20, unitPriceGross: 290, productId: randomUUID() }
  const base = evidence.normaliseEvidence({ docKind: 'invoice', pricesIncludeVat: true, vatPercent: 15, discountPercent: 0, declaredTotal: 5800, lines: [] })
  const first = { ...line, variantId: randomUUID(), variantSource: 'manual' as const }, second = { ...first, variantId: randomUUID() }
  const a = receiptInput.draftEvidence([first], base), b = receiptInput.draftEvidence([second], base)
  assert.deepEqual(a, b)
  const check = reconcile.reconcileReceipt(a, {}, true)
  assert.equal(check.totals?.payable, 5800)
  assert.equal(check.lines[0].unitAmounts.unitPriceNet, 252.1739)
  const review = { supplierId: randomUUID(), lines: [first], actualPurchase: true }
  const hash = receiptInput.purchaseReviewRevision(check.inputRevision, review)
  for (const changed of [second, { ...first, variantId: null, variantCleared: true }, { ...first, variantSource: 'supplier' as const }]) assert.notEqual(hash, receiptInput.purchaseReviewRevision(check.inputRevision, { ...review, lines: [changed] }))
})
await test('actual analysis uses selected stock only and never compares unscoped China costs', async () => {
  state = freshState()
  const product = productRow({ has_variants: true, quantity: 1000 }); state.products.push(product)
  const a = { id: randomUUID(), product_id: product.id, attribute_name: 'Capacity', attribute_value: '2Kg', quantity: 0, price_override: 875, is_active: true }
  const b = { ...a, id: randomUUID(), attribute_value: '5Kg', quantity: 100, price_override: 1500 }
  state.variants = [a, b]
  state.chinaRefs.set(product.id, vat.chooseChinaReference([{ landedUnitCost: 50, importedAt: '2026-09-01', qty: 20, supplierName: null, label: null }], 1))
  const line = { key: 'coating', supplierLabel: 'waterproof glue 2kg.', supplierCode: 'DT1057', unit: 'piece', qty: 20, unitPriceGross: 290, productId: product.id }
  const document = receiptInput.draftEvidence([line], evidence.normaliseEvidence({ lines: [], declaredTotal: 5800, pricesIncludeVat: true, vatPercent: 15, discountPercent: 0 }))
  for (const [variantId, expectedStock, covers] of [[a.id, 0, false], [b.id, 100, true], [null, null, false]] as const) {
    const [result] = await actionExports.analyseLinesAction({ document, lines: [{ ...line, variantId }] })
    assert.equal(result.unitPriceNet, 252.1739)
    assert.equal(result.comparison.stockOnHand, expectedStock); assert.equal(result.comparison.stockCoversQty, covers)
    assert.equal(result.comparison.chinaUnitCost, null); assert.equal(result.comparison.totalDifference, null); assert.equal(result.comparison.variancePercent, null)
    assert.equal(result.productImportReference.unitCost, 50)
  }
})
await test('supplier identity conflicts include variants without merging receipt rows', () => {
  const productId = randomUUID(), a = randomUUID(), b = randomUUID()
  const line = { supplierLabel: 'Coating', supplierCode: 'CODE', unit: 'piece', productId, variantId: a }
  assert.equal(supplierIdentity.conflictingSupplierSelections([line, { ...line, variantId: b }]).size, 1)
  assert.equal(supplierIdentity.conflictingSupplierSelections([line, { ...line, supplierCode: 'OTHER', variantId: b }]).size, 0)
  const mapping = { ...line, id: randomUUID(), productName: 'Coating', provenance: 'manual', variantSnapshot: { id: a, attributeName: 'Capacity', attributeValue: '2Kg', provenance: 'manual' as const, selectedBy: null } }
  assert.ok(supplierIdentity.supplierSelectionConflict({ ...line, variantId: b }, mapping))
  assert.equal(supplierIdentity.supplierSelectionConflict({ ...line, variantId: null }, mapping), null)
  assert.equal(pricing.recordedVariantId({ ...mapping, variantId: null }), a)
})
await test('different or unspecified variants cannot fulfil issued ordered quantities', () => {
  const productId = randomUUID(), a = randomUUID(), b = randomUUID()
  const line: LocalOrderLine = { id: randomUUID(), productId, supplierProductId: null, supplierLabel: 'Waterproof glue', supplierCode: 'DT1057', unit: 'piece', qty: 20, expectedUnitPrice: 290, vatPercent: 15, pricesIncludeVat: true, discountPercent: 0, sourcePurchaseLineId: null, priceReferenceDate: null,
    variantId: a, variantSnapshot: { id: a, attributeName: 'Capacity', attributeValue: '2Kg', provenance: 'manual', selectedBy: null } }
  const terms = { charges: [], roundingAmount: null }, party = { name: 'Supplier', vatNumber: 'VAT123456', address: null, phone: null, email: null }
  const snapshot: OrderSnapshot = { orderId: randomUUID(), orderNumber: 'LPO-TEST', revision: 1, lines: [line], terms, supplier: party, buyer: party, notes: null, expectedDate: null, issuedAt: '2026-09-08', calculation: calculateOrder([line], terms, party) }
  const document = evidence.normaliseEvidence({ docKind: 'invoice', supplierName: party.name, vatNumber: party.vatNumber, pricesIncludeVat: true, vatPercent: 15, discountPercent: 0, declaredTotal: 5800, lines: [{ key: 'returned', label: line.supplierLabel, code: line.supplierCode, unit: line.unit, qty: 20, unitPrice: 290, lineTotal: 5800 }] })
  for (const variantId of [b, null]) {
    const input: OrderReviewInput = { document, overrides: {}, decisions: { returned: line.id }, products: { returned: { productId, matchMethod: 'manual', variantId } } }
    const result = compareOrderDocument(snapshot, input, {}, 0, true)
    assert.equal(result.canAccept, false); assert.equal(result.rows[0].thisDocument, 0); assert.equal(result.rows[0].remainingAfter, 20)
    assert.ok(result.differences.some((difference) => difference.kind === 'variant' && difference.blocking))
  }
  const correct: OrderReviewInput = { document, overrides: {}, decisions: {}, products: { returned: { productId, matchMethod: 'manual', variantId: a } } }
  const result = compareOrderDocument(snapshot, correct, {}, 0, true)
  assert.equal(result.canAccept, true); assert.equal(result.rows[0].thisDocument, 20)
  const legacy = { ...snapshot, lines: [{ ...line, variantId: null, variantSnapshot: null }] }
  assert.equal(compareOrderDocument(legacy, { ...correct, products: { returned: { productId, matchMethod: 'manual' } } }, {}, 0, true).canAccept, true)
})

console.log(`\n${passed} passed, ${failed} failed. No live data was changed by this suite.`)
if (failed) process.exitCode = 1
