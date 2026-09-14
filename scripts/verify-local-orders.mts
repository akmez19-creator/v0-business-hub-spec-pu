import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'
import { fetchAll } from '../lib/supabase/fetch-all'
import { normaliseEvidence, evidenceRevision, type ReceiptEvidence } from '../lib/local-purchasing/evidence'
import { reconcileReceipt } from '../lib/local-purchasing/reconcile'
import { draftEvidence, purchaseReviewRevision } from '../lib/local-purchasing/receipt-input'
import { persistLocalPurchase, type SavePurchaseInput } from '../lib/local-purchasing/purchase-service'
import { importLocalDocument, loadOwnedDocument, PURCHASE_DOC_BUCKET } from '../lib/local-purchasing/documents'
import { loadSupplierCatalogue } from '../lib/local-purchasing/supplier-catalogue'
import { compareOrderDocument, orderReviewRevision, type OrderReviewInput } from '../lib/local-purchasing/order-reconcile'
import { saveLocalOrder, changeLocalOrder, loadLocalOrder, loadOrderDocument, saveOrderReview, recordOrderPurchase, type ReviewRequest } from '../lib/local-purchasing/order-service'
import { loadSavedPurchase, listLocalPurchases } from '../lib/local-purchasing/history'
import { supplierOrderRows, spreadsheetText } from '../lib/local-purchasing/order-export'
import type { LocalOrderLine } from '../lib/local-purchasing/order-types'
import { cleanCopiedFigures } from '../lib/local-purchasing/extract'
import { analyseReceiptLines } from '../lib/local-purchasing/analyse'
import { createInventoryProductRecord, loadPricingProduct, loadPricingCatalogue } from '../lib/products/pricing-server'
import { createPricingDraft, newVariantRow, recordedVariantId, type NewInventoryProductInput, type VariantSnapshot } from '../lib/products/pricing'

const mode = process.argv[2]
assert.ok(['--live', '--prepare-browser', '--cleanup-browser'].includes(mode), 'Choose --live, --prepare-browser or --cleanup-browser.')
assert.equal(process.env.LOCAL_PURCHASING_TEST_APPROVED, '1', 'Live writes require explicit approval and LOCAL_PURCHASING_TEST_APPROVED=1.')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
const browserStatePath = process.env.LOCAL_PURCHASING_FIXTURE_REGISTRY || '/tmp/local-purchasing-browser-fixtures.json'
const date = new Date().toISOString().slice(0, 10)
const sessions: SupabaseClient[] = []
let passed = 0
async function test(name: string, run: () => unknown | Promise<unknown>) { await run(); passed++; console.log(`PASS ${name}`) }
function requireSuccess<T extends { error: unknown }>(result: T): T { if (result.error) throw result.error; return result }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

type FixtureState = { tag: string; users: { id: string; email: string; role: string }[]; suppliers: { id: string; name: string; vat_number: string }[]; productIds: string[]; productNames: string[]; beforeDocuments: string; variantProductId?: string; variantIds?: string[]; otherVariantId?: string }
async function documentFingerprint() {
  return digest(await fetchAll((from, to) => db.from('local_purchase_documents').select('id,url,purchase_id,order_id,extracted,review_revision,reviewed_document,accepted_review').order('id').range(from, to)))
}
async function prepare(password: string): Promise<FixtureState> {
  const tag = `LP-QA-${randomUUID().slice(0, 8)}`
  const state: FixtureState = { tag, users: [], suppliers: [], productIds: [], productNames: [], beforeDocuments: await documentFingerprint() }
  try {
    for (const role of ['manager', 'marketing_agent']) {
      const email = `${tag.toLowerCase()}-${role}@example.com`
      const { data } = requireSuccess(await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: `${tag} ${role}` }, app_metadata: { local_purchasing_qa: tag } }))
      assert.ok(data.user)
      state.users.push({ id: data.user.id, email, role })
      requireSuccess(await db.from('profiles').update({ role, name: `${tag} ${role}`, approved: true, email_verified: true }).eq('id', data.user.id))
    }
    for (let i = 0; i < 2; i++) {
      const supplier = { id: randomUUID(), name: `${tag} Supplier ${i + 1}`, vat_number: `QA${i + 1}000000` }
      requireSuccess(await db.from('local_suppliers').insert({ ...supplier, notes: `Isolated verification ${tag}; remove after tests.` }))
      state.suppliers.push(supplier)
      const product = { id: randomUUID(), name: `${tag} Internal item ${i + 1}`, quantity: 0, cost_price: 7, price: 9999, is_active: false, sold_out: true }
      requireSuccess(await db.from('products').insert(product))
      state.productIds.push(product.id); state.productNames.push(product.name)
    }
    return state
  } catch (error) { await cleanup(state); throw error }
}
async function prepareVariants(state: FixtureState) {
  const product = { id: randomUUID(), name: `${state.tag} Variant coating`, quantity: 500, cost_price: 7, price: 0, has_variants: true, is_active: false, sold_out: true }
  requireSuccess(await db.from('products').insert(product))
  state.productIds.push(product.id); state.productNames.push(product.name); state.variantProductId = product.id
  const rows = [
    { id: randomUUID(), attribute_value: '2Kg', price_override: 875, quantity: 0, is_active: true },
    { id: randomUUID(), attribute_value: '5Kg', price_override: 1500, quantity: 100, is_active: true },
    { id: randomUUID(), attribute_value: '10Kg', price_override: null, quantity: 0, is_active: true },
    { id: randomUUID(), attribute_value: 'Retired', price_override: 100, quantity: 0, is_active: false },
  ].map((row) => ({ ...row, product_id: product.id, attribute_name: 'Capacity' }))
  requireSuccess(await db.from('product_variants').insert(rows)); state.variantIds = rows.map((row) => row.id)
  const other = { id: randomUUID(), product_id: state.productIds[1], attribute_name: 'Size', attribute_value: 'Unrelated', quantity: 0, is_active: true }
  requireSuccess(await db.from('product_variants').insert(other)); state.otherVariantId = other.id
}

async function cleanup(state: FixtureState) {
  for (const session of sessions) requireSuccess(await session.auth.signOut({ scope: 'global' }))
  const users = state.users.map((user) => user.id)
  if (users.length) {
    const documents = await fetchAll<{ id: string; url: string; created_by: string }>((from, to) => db.from('local_purchase_documents').select('id,url,created_by').in('created_by', users).order('id').range(from, to))
    for (const document of documents) assert.ok(document.url.startsWith(`${document.created_by}/`), 'Refuse to delete a storage object outside a fixture user folder.')
    if (documents.length) {
      requireSuccess(await db.storage.from(PURCHASE_DOC_BUCKET).remove(documents.map((document) => document.url)))
      requireSuccess(await db.from('local_purchase_documents').delete().in('id', documents.map((document) => document.id)))
    }
    const purchases = await fetchAll<{ id: string; supplier_id: string }>((from, to) => db.from('local_purchases').select('id,supplier_id').in('created_by', users).order('id').range(from, to))
    assert.ok(purchases.every((purchase) => state.suppliers.some((supplier) => supplier.id === purchase.supplier_id)), 'Refuse to delete a non-fixture purchase.')
    if (purchases.length) requireSuccess(await db.from('local_purchases').delete().in('id', purchases.map((purchase) => purchase.id)))
    const orders = await fetchAll<{ id: string; supplier_id: string }>((from, to) => db.from('local_purchase_orders').select('id,supplier_id').in('created_by', users).order('id').range(from, to))
    assert.ok(orders.every((order) => state.suppliers.some((supplier) => supplier.id === order.supplier_id)), 'Refuse to delete a non-fixture order.')
    if (orders.length) requireSuccess(await db.from('local_purchase_orders').delete().in('id', orders.map((order) => order.id)))
  }
  for (const supplier of state.suppliers) {
    const mappings = await fetchAll<{ id: string; product_id: string }>((from, to) => db.from('local_supplier_products').select('id,product_id').eq('supplier_id', supplier.id).order('id').range(from, to))
    assert.ok(mappings.every((mapping) => state.productIds.includes(mapping.product_id)), 'Refuse to delete a non-fixture mapping.')
    if (mappings.length) requireSuccess(await db.from('local_supplier_products').delete().in('id', mappings.map((mapping) => mapping.id)))
    requireSuccess(await db.from('local_suppliers').delete().eq('id', supplier.id).eq('name', supplier.name))
  }
  for (const id of state.productIds) requireSuccess(await db.from('products').delete().eq('id', id))
  for (const user of state.users) {
    const { data } = requireSuccess(await db.auth.admin.getUserById(user.id))
    assert.equal(data.user.app_metadata.local_purchasing_qa, state.tag)
    requireSuccess(await db.auth.admin.deleteUser(user.id))
  }
  assert.equal(await documentFingerprint(), state.beforeDocuments, 'Original uploaded documents must remain unchanged.')
  console.log(`CLEANUP ${state.tag}: exact fixture records, mappings, accounts and source files removed; original documents unchanged.`)
}

if (mode === '--cleanup-browser') {
  await cleanup(JSON.parse(readFileSync(browserStatePath, 'utf8')) as FixtureState)
} else {
  const password = process.env.LOCAL_PURCHASING_TEST_PASSWORD || randomBytes(32).toString('base64url')
  const state = await prepare(password)
  if (mode === '--prepare-browser') {
    assert.ok(process.env.LOCAL_PURCHASING_TEST_PASSWORD, 'Browser tests need a one-run test password, never saved in the fixture registry.')
    await prepareVariants(state)
    writeFileSync(browserStatePath, JSON.stringify(state), { mode: 0o600 })
    console.log(JSON.stringify({ tag: state.tag, buyer: state.users[0], nonBuyer: state.users[1], suppliers: state.suppliers, productIds: state.productIds, productNames: state.productNames }))
  } else {
    try { await verify(state, password) } finally { await cleanup(state) }
  }
}

async function verify(state: FixtureState, password: string) {
  const actor = state.users[0].id
  const supplier = state.suppliers[0]
  const label = `${state.tag} Supplier chopper DT5044`
  const code = 'DT5044'
  const base = (patch: Partial<ReceiptEvidence> = {}) => normaliseEvidence({ docKind: 'invoice', supplierName: supplier.name, vatNumber: supplier.vat_number, docRef: `${state.tag}-${randomUUID().slice(0, 8)}`, docDate: date,
    pricesIncludeVat: true, vatPercent: 15, discountPercent: 20, declaredSubtotal: 135.65, declaredVat: 20.35, declaredTotal: 156,
    lines: [{ key: 'chopper', label, code, unit: 'piece', qty: 1, unitPrice: 156, lineTotal: 156 }], ...patch })
  const purchaseInput = (document: ReceiptEvidence, supplierId = supplier.id, productId: string | null = state.productIds[0]): SavePurchaseInput => ({ supplierId, docRef: document.docRef, purchaseDate: document.docDate,
    document, lines: document.lines.map((line) => ({ key: line.key!, supplierLabel: line.label, supplierCode: line.code, unit: line.unit, qty: line.qty, unitPriceGross: line.unitPrice, lineTotal: line.lineTotal, evidence: line,
      productId, matchMethod: productId ? 'auto' : 'unmatched' })), idempotencyKey: randomUUID(), actualPurchase: true })
  const acknowledge = (input: SavePurchaseInput, reason: string) => {
    const check = reconcileReceipt(draftEvidence(input.lines, input.document, input), input.overrides, true)
    return { ...input, acknowledgement: { revision: purchaseReviewRevision(check.inputRevision, input), reason } }
  }
  let firstId = ''
  const first = purchaseInput(base())
  await test('actual purchase service stores 156 payable / 135.6522 generated net without a second discount', async () => {
    const result = await persistLocalPurchase(db, actor, first); firstId = result.id
    const { data } = requireSuccess(await db.from('local_purchase_lines').select('unit_price_gross,unit_price_net,discount_percent,printed_discount_percent,matched_by,match_method').eq('purchase_id', result.id).single())
    assert.equal(Number(data!.unit_price_net), 135.6522); assert.equal(Number(data!.discount_percent), 0); assert.equal(Number(data!.printed_discount_percent), 20)
    assert.equal(data!.match_method, 'auto'); assert.equal(data!.matched_by, null)
    const saved = await loadSavedPurchase(db, result.id)
    assert.equal(saved?.payableTotal, 156); assert.equal(saved?.netTotal, 135.65); assert.equal(saved?.vatTotal, 20.35)
    assert.ok((await listLocalPurchases(db)).some((row) => row.id === result.id && row.lineCount === 1))
  })
  await test('idempotent retries return the same saved purchase', async () => {
    const results = await Promise.all([persistLocalPurchase(db, actor, first), persistLocalPurchase(db, actor, first)])
    assert.ok(results.every((result) => result.id === firstId && result.replayed))
    await assert.rejects(persistLocalPurchase(db, actor, { ...first, notes: 'Different request content' }), /different revision/)
  })
  await test('concurrent first saves serialize to one purchase', async () => {
    const input = purchaseInput(base())
    const results = await Promise.all([persistLocalPurchase(db, actor, input), persistLocalPurchase(db, actor, input)])
    assert.equal(results[0].id, results[1].id); assert.ok(results.some((result) => result.replayed))
  })
  await test('normalized supplier reference prevents a duplicate with a new request key', async () => {
    const input = { ...first, idempotencyKey: randomUUID(), docRef: `  ${first.docRef!.toLowerCase()}  ` }
    await assert.rejects(persistLocalPurchase(db, actor, input), /duplicate|already recorded/i)
  })
  await test('a real line FK failure rolls back purchase header and prior lines', async () => {
    const doc = base({ declaredSubtotal: null, declaredVat: null, declaredTotal: 312, lines: [{ ...base().lines[0], key: 'valid' }, { ...base().lines[0], key: 'invalid', label: `${state.tag} Invalid product reference`, code: 'INVALID' }] })
    const input = purchaseInput(doc); input.lines[1].productId = randomUUID()
    await assert.rejects(persistLocalPurchase(db, actor, input), /foreign key|not present|violates/i)
    const { count } = requireSuccess(await db.from('local_purchases').select('id', { count: 'exact', head: true }).eq('idempotency_key', input.idempotencyKey))
    assert.equal(count, 0)
  })
  await test('supplier-specific mappings auto-learn with truthful machine provenance', async () => {
    const catalogue = await loadSupplierCatalogue(db, supplier.id)
    assert.equal(catalogue.length, 1); assert.equal(catalogue[0].supplierLabel, label); assert.equal(catalogue[0].lastUnitPayable, 156)
    assert.equal(catalogue[0].lastUnitPriceNet, 135.6522); assert.equal(catalogue[0].provenance, 'auto')
    const second = state.suppliers[1]
    await persistLocalPurchase(db, actor, purchaseInput(base({ supplierName: second.name, vatNumber: second.vat_number }), second.id, state.productIds[1]))
    const other = await loadSupplierCatalogue(db, second.id)
    assert.equal(other[0].supplierLabel, label); assert.equal(other[0].productId, state.productIds[1]); assert.equal(catalogue[0].productId, state.productIds[0])
  })
  await test('Inventory rename does not replace supplier wording or last paid price', async () => {
    requireSuccess(await db.from('products').update({ name: `${state.tag} Renamed internal item` }).eq('id', state.productIds[0]))
    const [item] = await loadSupplierCatalogue(db, supplier.id)
    assert.equal(item.supplierLabel, label); assert.equal(item.supplierCode, code); assert.equal(item.lastUnitPayable, 156); assert.match(item.productName, /Renamed internal/)
  })
  await test('mapping conflict needs a current reason and never repoints a supplier identity', async () => {
    const input = purchaseInput(base(), supplier.id, state.productIds[1])
    await assert.rejects(persistLocalPurchase(db, actor, input), /mapped|conflict|reason|review/i)
    await persistLocalPurchase(db, actor, acknowledge(input, 'Isolated test: accept this documented mapping conflict without changing the existing identity.'))
    assert.equal((await loadSupplierCatalogue(db, supplier.id))[0].productId, state.productIds[0])
  })
  const importSheet = async (orderId: string | null, revision: number | null, ref: string, qty: number[], prices = qty.map(() => 156), extra = false, kind = 'Invoice') => {
    const rows: unknown[][] = [['Supplier', supplier.name], [kind, ref], ['Date', date], ['Prices', 'VAT included'], ['Description', 'Code', 'Unit', 'Qty', 'Unit price', 'Amount', 'VAT %'],
      ...qty.map((value, i) => [label, code, 'piece', value, prices[i], value * prices[i], 15])]
    if (extra) rows.push([`${state.tag} Extra item`, 'EXTRA', 'piece', 1, 10, 10, 15])
    rows.push(['Total', '', '', '', '', qty.reduce((total, q, i) => total + q * prices[i], extra ? 10 : 0)])
    const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Invoice')
    const form = new FormData(); form.set('file', new File([XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })], `${ref}.xlsx`, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
    if (orderId) { form.set('orderId', orderId); form.set('orderRevision', String(revision)) }
    const imported = await importLocalDocument(form, db, actor)
    assert.ok(imported.documentId, imported.warnings.join('; ')); assert.equal(imported.source, 'sheet'); assert.equal(imported.check.status, 'verified')
    return imported
  }
  await test('real spreadsheet importer files private evidence, checks money and enforces ownership', async () => {
    const imported = await importSheet(null, null, `${state.tag}-direct-sheet`, [1])
    const original = await loadOwnedDocument(db, actor, imported.documentId!)
    assert.equal(original.source, 'sheet'); assert.equal(original.extracted.lines.length, 1)
    await assert.rejects(loadOwnedDocument(db, state.users[1].id, imported.documentId!), /another buyer/)
    const input = { ...purchaseInput(imported.evidence), documentIds: [imported.documentId!], documentRevision: imported.documentRevision, reviewRevision: imported.reviewRevision }
    await assert.rejects(persistLocalPurchase(db, actor, { ...input, documentRevision: 2 }), /revision changed/)
    const saved = await persistLocalPurchase(db, actor, input)
    const detail = await loadSavedPurchase(db, saved.id)
    assert.equal(detail?.documents.length, 1); assert.ok(detail?.documents[0].url); assert.equal(detail?.lines[0].sourceEvidence?.label, label)
    await assert.rejects(persistLocalPurchase(db, actor, { ...input, idempotencyKey: randomUUID() }), /already recorded/)
  })
  const [catalogueItem] = await loadSupplierCatalogue(db, supplier.id)
  const orderLine: LocalOrderLine = { id: randomUUID(), supplierProductId: catalogueItem.id, productId: catalogueItem.productId,
    supplierLabel: catalogueItem.supplierLabel, supplierCode: catalogueItem.supplierCode, unit: catalogueItem.unit, qty: 5,
    expectedUnitPrice: catalogueItem.lastUnitPayable, vatPercent: catalogueItem.vatPercent ?? 15, pricesIncludeVat: true,
    discountPercent: 0, sourcePurchaseLineId: catalogueItem.sourcePurchaseLineId, priceReferenceDate: catalogueItem.lastPurchaseDate }
  const createInput = { id: randomUUID(), revision: 0, updatedAt: null, requestKey: randomUUID(), supplierId: supplier.id,
    lines: [orderLine], terms: { charges: [], roundingAmount: null }, notes: 'Isolated verification, never send to a supplier.', expectedDate: null }
  const orderId = createInput.id
  await test('save and issue freeze dated supplier prices without creating a purchase', async () => {
    const before = requireSuccess(await db.from('local_purchases').select('id', { count: 'exact', head: true }).eq('created_by', actor)).count
    const saved = await saveLocalOrder(db, actor, createInput); assert.equal(saved.revision, 1)
    assert.equal((await saveLocalOrder(db, actor, createInput)).replayed, true)
    const order = await loadLocalOrder(db, orderId)
    await changeLocalOrder(db, actor, 'issue', { id: order.id, revision: order.revision, updatedAt: order.updatedAt, requestKey: randomUUID() })
    const issued = await loadLocalOrder(db, orderId)
    assert.equal(issued.status, 'issued'); assert.equal(issued.issuedSnapshot?.calculation.totals?.payable, 780)
    assert.equal(issued.issuedSnapshot?.lines[0].discountPercent, 0)
    assert.equal(requireSuccess(await db.from('local_purchases').select('id', { count: 'exact', head: true }).eq('created_by', actor)).count, before)
    const exported = supplierOrderRows(issued.issuedSnapshot!)
    assert.ok(exported.flat().includes(label)); assert.ok(!JSON.stringify(exported).includes('Renamed internal'))
    for (const value of ['=SUM(A1)', '+1', '@HYPERLINK', '-1', ' \t=malicious']) assert.ok(spreadsheetText(value).startsWith("'"))
  })
  const reviewRequest = async (documentId: string): Promise<ReviewRequest> => {
    const order = await loadLocalOrder(db, orderId)
    const view = await loadOrderDocument(db, actor, orderId, documentId)
    const comparison = compareOrderDocument(order.issuedSnapshot!, view.input, order.received, order.allocationRevision, true)
    const source = { documentId, documentRevision: view.documentRevision, reviewRevision: view.reviewRevision, reviewEpoch: order.reviewEpoch }
    return { orderId, ...source, orderRevision: order.revision, allocationRevision: order.allocationRevision, input: view.input,
      acknowledgement: { revision: orderReviewRevision(comparison.revision, source), reason: 'Isolated verification: accept the specific partial quantities and changed supplier terms shown.' } }
  }
  const partial = await importSheet(orderId, 1, `${state.tag}-partial`, [1, 1], [160, 160])
  let oldRequest: ReviewRequest
  await test('repeated invoice rows aggregate; changed price and partial quantity are explicit', async () => {
    const request = await reviewRequest(partial.documentId!)
    const order = await loadLocalOrder(db, orderId)
    const compared = compareOrderDocument(order.issuedSnapshot!, request.input, order.received, order.allocationRevision, true)
    assert.equal(compared.rows[0].thisDocument, 2); assert.equal(compared.rows[0].remainingAfter, 3)
    assert.equal(compared.allocations.length, 2); assert.ok(compared.differences.some((difference) => difference.kind === 'price' && difference.actual === 160))
    assert.ok(compared.differences.some((difference) => difference.kind === 'quantity'))
    assert.equal(compared.canAccept, true)
    await assert.rejects(recordOrderPurchase(db, actor, { ...request, acknowledgement: null, actualPurchase: true, idempotencyKey: randomUUID() }), /specific reason/)
    oldRequest = request
  })
  await test('accepting confirmation leaves purchases and allocations unchanged', async () => {
    const before = requireSuccess(await db.from('local_purchases').select('id', { count: 'exact', head: true }).eq('created_by', actor)).count
    await saveOrderReview(db, actor, oldRequest!, true)
    const order = await loadLocalOrder(db, orderId)
    assert.equal(order.status, 'confirmed'); assert.equal(order.received[orderLine.id] ?? 0, 0)
    assert.equal(requireSuccess(await db.from('local_purchases').select('id', { count: 'exact', head: true }).eq('created_by', actor)).count, before)
    await assert.rejects(recordOrderPurchase(db, actor, { ...oldRequest!, actualPurchase: true, idempotencyKey: randomUUID() }), /changed|stale/i)
  })
  await test('confirming the partial invoice records once and preserves three outstanding', async () => {
    const request = { ...await reviewRequest(partial.documentId!), actualPurchase: true, idempotencyKey: randomUUID() }
    const result = await recordOrderPurchase(db, actor, request)
    const retry = await recordOrderPurchase(db, actor, request)
    assert.equal(retry.id, result.id); assert.equal(retry.replayed, true)
    const order = await loadLocalOrder(db, orderId)
    assert.equal(order.status, 'partial'); assert.equal(order.received[orderLine.id], 2)
    const detail = await loadSavedPurchase(db, result.id)
    assert.equal(detail?.payableTotal, 320); assert.equal(detail?.lines.length, 2)
    assert.equal(detail?.documents[0].comparison?.rows[0].remainingAfter, 3)
  })
  const remainder = await importSheet(orderId, 1, `${state.tag}-remainder`, [3])
  await test('concurrent confirmations cannot count remaining quantity twice', async () => {
    const request = await reviewRequest(remainder.documentId!)
    const results = await Promise.allSettled([recordOrderPurchase(db, actor, { ...request, actualPurchase: true, idempotencyKey: randomUUID() }), recordOrderPurchase(db, actor, { ...request, actualPurchase: true, idempotencyKey: randomUUID() })])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    const order = await loadLocalOrder(db, orderId)
    assert.equal(order.status, 'completed'); assert.equal(order.received[orderLine.id], 5)
  })
  await test('source corrections and product decisions invalidate acknowledgements', async () => {
    const doc = base(); const input = { ...purchaseInput(doc), overrides: { pricesIncludeVat: true, discountTreatment: 'included' as const, vatPercent: 15 } }; const accepted = acknowledge(input, 'Isolated test original evidence accepted.')
    const changed = { ...accepted, document: { ...doc, declaredTotal: 155 } }
    await assert.rejects(persistLocalPurchase(db, actor, changed), /reason|Review/i)
    const revised = purchaseReviewRevision(reconcileReceipt(doc, {}, true).inputRevision, { ...input, lines: [{ ...input.lines[0], productId: state.productIds[1] }] })
    assert.notEqual(accepted.acknowledgement.revision, revised)
  })
  await test('new order revisions reject stale evidence and cancellation refuses further recording', async () => {
    const input = { ...createInput, id: randomUUID(), requestKey: randomUUID(), lines: [{ ...orderLine, id: randomUUID() }] }
    await saveLocalOrder(db, actor, input)
    let order = await loadLocalOrder(db, input.id)
    await changeLocalOrder(db, actor, 'issue', { id: order.id, revision: order.revision, updatedAt: order.updatedAt, requestKey: randomUUID() })
    order = await loadLocalOrder(db, input.id)
    await saveLocalOrder(db, actor, { ...input, revision: order.revision, updatedAt: order.updatedAt, requestKey: randomUUID(), notes: 'Isolated changed revision' })
    await assert.rejects(importSheet(input.id, 1, `${state.tag}-stale`, [1]), /current order revision/)
    order = await loadLocalOrder(db, input.id); assert.equal(order.revision, 2); assert.equal(order.status, 'draft'); assert.equal(order.revisionHistory.length, 1)
    await changeLocalOrder(db, actor, 'cancel', { id: order.id, revision: order.revision, updatedAt: order.updatedAt, requestKey: randomUUID(), reason: 'Isolated test cancellation' })
    await assert.rejects(saveLocalOrder(db, actor, { ...input, revision: 2, updatedAt: (await loadLocalOrder(db, input.id)).updatedAt, requestKey: randomUUID() }), /closed/)
  })
  await test('non-buyers cannot mutate orders; RLS clients cannot read purchasing or invoke transactions', async () => {
    await assert.rejects(saveLocalOrder(db, state.users[1].id, { ...createInput, id: randomUUID(), requestKey: randomUUID(), lines: [{ ...orderLine, id: randomUUID() }] }), /Not allowed/)
    for (const user of state.users) {
      const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }); sessions.push(client)
      requireSuccess(await client.auth.signInWithPassword({ email: user.email, password }))
      const orders = await client.from('local_purchase_orders').select('id').eq('id', orderId)
      assert.ok(orders.error || orders.data?.length === 0)
      assert.ok((await client.rpc('local_commit_purchase', { p_actor: actor, p_payload: {} })).error)
    }
  })
  await test('stock, selling prices and global aliases were not changed by purchasing', async () => {
    const { data } = requireSuccess(await db.from('products').select('id,quantity,cost_price,price').in('id', state.productIds))
    for (const product of data!) { assert.equal(Number(product.quantity), 0); assert.equal(Number(product.cost_price), 7); assert.equal(Number(product.price), 9999) }
    const aliases = requireSuccess(await db.from('product_aliases').select('id', { count: 'exact', head: true }).in('product_id', state.productIds))
    assert.equal(aliases.count, 0)
    const { data: purchases } = requireSuccess(await db.from('local_purchases').select('payment_status,paid_amount').eq('created_by', actor))
    assert.ok(purchases!.every((purchase) => purchase.payment_status === 'unpaid' && Number(purchase.paid_amount) === 0))
  })
  await test('the untouched original QN2613501 extraction still verifies all 38 real lines', async () => {
    const originals = requireSuccess(await db.from('local_purchase_documents').select('id,extracted').eq('extracted->>docRef', 'QN2613501').order('created_at', { ascending: false }).order('id').limit(1))
    assert.equal(originals.data?.length, 1, 'The real regression document must be present, not a generated substitute.')
    const doc = cleanCopiedFigures(normaliseEvidence(originals.data![0].extracted)).doc
    const result = reconcileReceipt(doc, {}, true)
    assert.equal(result.status, 'verified', JSON.stringify(result.issues)); assert.equal(result.lines.length, 38)
    assert.equal(result.totals?.payable, 6012); assert.equal(result.totals?.net, 5227.83); assert.equal(result.totals?.vat, 784.17)
    const chopper = result.lines.find((line) => /chopper/i.test(line.label))!
    assert.equal(chopper.unitAmounts.unitVat.gross, 156); assert.equal(chopper.unitAmounts.unitPriceNet, 135.6522); assert.equal(chopper.unitAmounts.discountPercent, 0)
  })
  await prepareVariants(state)
  await verifyVariants(state)
  await verifyInventoryCreation(state)
  console.log(`\n${passed} isolated purchasing checks passed against application services and the live database.`)
}

async function verifyInventoryCreation(state: FixtureState) {
  const buyer = sessions[0], nonBuyer = sessions[1], actor = state.users[0].id, supplier = state.suppliers[0]
  assert.ok(buyer && nonBuyer, 'Use the authenticated fixture clients from the authorization checks.')
  const input = (suffix: string): NewInventoryProductInput => {
    const requestId = randomUUID(), name = `${state.tag} New ${suffix}`
    state.productIds.push(requestId); state.productNames.push(name)
    return { requestId, name, isActive: false, quantity: 20, unitCostNet: 252.1739, pricing: createPricingDraft(), variants: { enabled: true, rows: [
      { ...newVariantRow(), attributeName: 'Capacity', attributeValue: '2Kg', priceOverride: '875', quantity: '20' },
      { ...newVariantRow(), attributeName: 'Capacity', attributeValue: '5Kg', priceOverride: '1500', quantity: '9' },
    ] } }
  }
  const request = input('Purchasing Coating')
  const options = { requirePricing: true, allowOpeningStock: false }
  await test('new purchasing products and their variants commit together with zero stock and no guessed common cost', async () => {
    const result = await createInventoryProductRecord(buyer, request, options)
    assert.equal(result.productId, request.requestId); assert.equal(result.created, true)
    const product = await loadPricingProduct(db, result.productId)
    assert.equal(product.pricing.has_variants, true); assert.equal(Number(product.pricing.price), 0)
    assert.deepEqual(product.variants!.map((variant) => [variant.attributeValue, Number(variant.priceOverride), variant.stockOnHand]), [['2Kg',875,0],['5Kg',1500,0]])
    const row = requireSuccess(await db.from('products').select('cost_price,cost_price_at,quantity').eq('id', result.productId).single()).data!
    assert.equal(row.cost_price, null); assert.equal(row.cost_price_at, null); assert.equal(row.quantity, 0)
  })
  await test('creation retries retain the same variant IDs and reject changed prices', async () => {
    const before = await loadPricingProduct(db, request.requestId)
    const repeated = await createInventoryProductRecord(buyer, request, options)
    assert.equal(repeated.productId, request.requestId); assert.equal(repeated.replayed, true)
    const changed = structuredClone(request); changed.variants!.rows[0].priceOverride = '999'
    await assert.rejects(createInventoryProductRecord(buyer, changed, options), /different details or variants/)
    assert.deepEqual((await loadPricingProduct(db, request.requestId)).variants, before.variants)
    const duplicate = { ...request, requestId: randomUUID(), name: request.name.toLowerCase().replaceAll(' ', '  ') }
    assert.equal((await createInventoryProductRecord(buyer, duplicate, options)).productId, request.requestId)
    assert.deepEqual((await loadPricingProduct(db, request.requestId)).variants, before.variants)
  })
  await test('concurrent creation requests cannot make a second parent or second set of variants', async () => {
    const fresh = input('Concurrent Coating')
    const results = await Promise.all([createInventoryProductRecord(buyer, fresh, options), createInventoryProductRecord(buyer, fresh, options)])
    assert.ok(results.every((result) => result.productId === fresh.requestId))
    assert.equal(results.filter((result) => result.created).length, 1)
    assert.equal((await loadPricingProduct(db, fresh.requestId)).variants!.length, 2)
  })
  await test('database validation rejects invalid variants even if the application payload is tampered with', async () => {
    for (const change of [
      (args: Record<string, any>) => { args.p_variants[1].attribute_value = '2kg' },
      (args: Record<string, any>) => { args.p_variants[1].price_override = -1 },
      (args: Record<string, any>) => { args.p_variants[1].attribute_name = '' },
    ]) {
      const fresh = input(`Rejected ${randomUUID().slice(0, 6)}`)
      const tampered = new Proxy(buyer, { get(target, property) {
        if (property === 'rpc') return (name: string, args: Record<string, any>) => { const copy = structuredClone(args); change(copy); return target.rpc(name, copy) }
        const value = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value
      } })
      await assert.rejects(createInventoryProductRecord(tampered, fresh, options), /variant/i)
      assert.equal(requireSuccess(await db.from('products').select('id', { count: 'exact', head: true }).eq('id', fresh.requestId)).count, 0)
      assert.equal(requireSuccess(await db.from('product_variants').select('id', { count: 'exact', head: true }).eq('product_id', fresh.requestId)).count, 0)
    }
  })
  await test('Inventory-created variants appear in the complete purchasing catalogue with their explicit opening quantities', async () => {
    const fresh = input('Inventory Coating')
    await createInventoryProductRecord(buyer, { ...fresh, unitCostNet: null })
    const product = (await loadPricingCatalogue(db)).find((product) => product.id === fresh.requestId)!
    assert.ok(product); assert.equal(product.stockOnHand, 0)
    assert.deepEqual(product.variants!.map((variant) => variant.stockOnHand), [20, 9])
    const ordinary = input('Ordinary Item')
    await createInventoryProductRecord(buyer, { ...ordinary, pricing: { ...createPricingDraft(), unitPrice: '175.50' }, variants: { enabled: false, rows: [] }, quantity: 4, unitCostNet: null })
    const normal = await loadPricingProduct(db, ordinary.requestId)
    assert.equal(Number(normal.pricing.price), 175.5); assert.equal(normal.stockOnHand, 4); assert.deepEqual(normal.variants, [])
  })
  await test('a newly created variant survives an actual purchase save, history read and supplier catalogue read', async () => {
    const product = await loadPricingProduct(db, request.requestId), selected = product.variants![0]
    const document = normaliseEvidence({ docKind: 'invoice', docRef: `${state.tag}-new-variant`, docDate: date, supplierName: supplier.name, vatNumber: supplier.vat_number,
      pricesIncludeVat: true, vatPercent: 15, discountPercent: 0, declaredTotal: 5800,
      lines: [{ key: 'new-variant', label: `${state.tag} new coating 2kg`, code: 'NEW-2KG', unit: 'piece', qty: 20, unitPrice: 290, lineTotal: 5800 }] })
    const purchase = await persistLocalPurchase(db, actor, { supplierId: supplier.id, docRef: document.docRef, purchaseDate: date, document,
      actualPurchase: true, idempotencyKey: randomUUID(), lines: [{ key: 'new-variant', supplierLabel: document.lines[0].label, supplierCode: 'NEW-2KG', unit: 'piece',
        qty: 20, unitPriceGross: 290, lineTotal: 5800, productId: product.id, matchMethod: 'created', variantId: selected.id, variantSource: 'manual' }] })
    const saved = await loadSavedPurchase(db, purchase.id)
    assert.equal(saved!.lines[0].variantId, selected.id); assert.equal(saved!.lines[0].variantSnapshot!.attributeValue, '2Kg')
    assert.equal(saved!.payableTotal, 5800); assert.equal(saved!.lines[0].unitPriceNet, 252.1739)
    const mapping = (await loadSupplierCatalogue(db, supplier.id)).find((mapping) => mapping.productId === product.id)!
    assert.equal(mapping.variantId, selected.id); assert.equal(mapping.lastUnitPayable, 290)
    assert.deepEqual(await loadPricingProduct(db, product.id), product)
    assert.equal(requireSuccess(await db.from('product_price_history').select('id', { count: 'exact', head: true }).eq('product_id', product.id)).count, 0)
  })
  await test('new Inventory transactions reject non-buyers and unauthenticated callers', async () => {
    const fresh = input('Forbidden')
    await assert.rejects(createInventoryProductRecord(nonBuyer, fresh, options), /Not allowed/)
    const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
    assert.ok((await anon.rpc('inventory_create_product', { p_product: {}, p_variants: [] })).error)
    assert.equal(requireSuccess(await db.from('products').select('id', { count: 'exact', head: true }).eq('id', fresh.requestId)).count, 0)
  })
}

async function verifyVariants(state: FixtureState) {
  const actor = state.users[0].id, supplier = state.suppliers[0], productId = state.variantProductId!
  const [small, large, unpriced, inactive] = state.variantIds!
  const label = `${state.tag} waterproof glue 2kg.`, code = 'DT1057'
  const productBefore = requireSuccess(await db.from('products').select('id,quantity,price,cost_price,updated_at').eq('id', productId).single()).data
  const variantBefore = requireSuccess(await db.from('product_variants').select('id,quantity,price_override,updated_at').eq('product_id', productId).order('id')).data
  const historyBefore = requireSuccess(await db.from('product_price_history').select('id', { count: 'exact', head: true }).eq('product_id', productId)).count
  const inputFor = (variantId: string | null = small, unitPrice = 290, description = label): SavePurchaseInput => {
    const document = normaliseEvidence({ docKind: 'invoice', supplierName: supplier.name, vatNumber: supplier.vat_number,
      docRef: `${state.tag}-variant-${randomUUID().slice(0, 8)}`, docDate: date, pricesIncludeVat: true, vatPercent: 15,
      discountPercent: 0, declaredTotal: unitPrice * 20,
      lines: [{ key: 'coating', label: description, code, unit: 'piece', qty: 20, unitPrice, lineTotal: unitPrice * 20 }] })
    return { supplierId: supplier.id, docRef: document.docRef, purchaseDate: date, document, actualPurchase: true, idempotencyKey: randomUUID(),
      lines: [{ key: 'coating', supplierLabel: description, supplierCode: code, unit: 'piece', qty: 20, unitPriceGross: unitPrice,
        lineTotal: unitPrice * 20, productId, matchMethod: 'auto', variantId, variantSource: 'manual', variantCleared: variantId === null }] }
  }
  const acknowledged = (input: SavePurchaseInput) => ({ ...input, acknowledgement: {
    revision: purchaseReviewRevision(reconcileReceipt(draftEvidence(input.lines, input.document, input), input.overrides, true).inputRevision, input),
    reason: 'Isolated verification: accept these explicit variant and supplier identity differences without changing the learned mapping.',
  } })
  const tampered = (change: (payload: Record<string, any>) => void): SupabaseClient => new Proxy(db, {
    get(target, property) {
      if (property === 'rpc') return (name: string, args: Record<string, any>) => {
        const copy = structuredClone(args)
        if (name === 'local_commit_purchase') change(copy.p_payload)
        return target.rpc(name, copy)
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const noSave = async (key: string) => assert.equal(requireSuccess(await db.from('local_purchases').select('id', { count: 'exact', head: true }).eq('idempotency_key', key)).count, 0)
  let purchaseId = '', largePurchaseId = ''
  const first = inputFor()
  await test('zero-stock 2Kg and unpriced variants load without inheriting sibling stock', async () => {
    const product = await loadPricingProduct(db, productId)
    assert.equal(product.variants?.length, 4)
    assert.equal(product.variants?.find((v) => v.id === small)?.stockOnHand, 0)
    assert.equal(product.variants?.find((v) => v.id === unpriced)?.isActive, true)
    const [analysed] = await analyseReceiptLines(db, { supplierId: supplier.id, lines: first.lines, document: first.document })
    assert.equal(analysed.comparison.stockCoversQty, false); assert.equal(analysed.comparison.stockOnHand, 0)
    assert.equal(analysed.comparison.chinaUnitCost, null); assert.equal(analysed.unitPriceNet, 252.1739)
  })
  await test('actual save and read-back retain variant identity without changing money or parent provenance', async () => {
    purchaseId = (await persistLocalPurchase(db, actor, first)).id
    const saved = await loadSavedPurchase(db, purchaseId)
    assert.equal(saved?.payableTotal, 5800); assert.equal(saved?.netTotal, 5043.48); assert.equal(saved?.vatTotal, 756.52)
    assert.equal(saved?.lines[0].qty, 20); assert.equal(saved?.lines[0].unitPriceNet, 252.1739)
    assert.equal(saved?.lines[0].variantId, small)
    assert.deepEqual(saved?.lines[0].variantSnapshot, { id: small, attributeName: 'Capacity', attributeValue: '2Kg', provenance: 'manual', selectedBy: actor })
    const row = requireSuccess(await db.from('local_purchase_lines').select('matched_by,match_method,china_cp_at_purchase,variance_percent').eq('purchase_id', purchaseId).single()).data!
    assert.equal(row.match_method, 'auto'); assert.equal(row.matched_by, null)
    assert.equal(row.china_cp_at_purchase, null); assert.equal(row.variance_percent, null)
    assert.equal((await persistLocalPurchase(db, actor, first)).id, purchaseId)
    await assert.rejects(persistLocalPurchase(db, actor, { ...first, lines: [{ ...first.lines[0], variantId: large }] }), /different revision/)
  })
  await test('supplier catalogue restores its known variant and contradicting selections do not repoint it', async () => {
    const mapping = (await loadSupplierCatalogue(db, supplier.id)).find((item) => item.productId === productId)!
    assert.equal(mapping.variantId, small); assert.equal(mapping.variantSnapshot?.attributeValue, '2Kg')
    const incoming = inputFor(null)
    const [answer] = await analyseReceiptLines(db, { supplierId: supplier.id, lines: incoming.lines, document: incoming.document })
    assert.equal(answer.supplierVariant?.variantId, small)
    const different = inputFor(large)
    await assert.rejects(persistLocalPurchase(db, actor, different), /variant|reason/i)
    largePurchaseId = (await persistLocalPurchase(db, actor, acknowledged(different))).id
    const after = (await loadSupplierCatalogue(db, supplier.id)).find((item) => item.id === mapping.id)!
    assert.equal(after.variantId, small); assert.equal(after.sourcePurchaseLineId, mapping.sourcePurchaseLineId)
    const unspecified = await persistLocalPurchase(db, actor, inputFor(null, 310))
    assert.equal((await loadSavedPurchase(db, unspecified.id))?.lines[0].variantSnapshot, null)
    const kept = (await loadSupplierCatalogue(db, supplier.id)).find((item) => item.id === mapping.id)!
    assert.equal(kept.lastUnitPayable, 290); assert.equal(kept.sourcePurchaseLineId, mapping.sourcePurchaseLineId)
  })
  await test('contradictory repeated rows retain both variants and learn neither, not last-row-wins', async () => {
    const input = inputFor(small, 290, `${state.tag} mixed coating`)
    input.lines.push({ ...input.lines[0], key: 'other', variantId: large })
    input.document = { ...input.document!, declaredTotal: 11600 }
    await assert.rejects(persistLocalPurchase(db, actor, input), /different product or variant|contradictory/i)
    const saved = await loadSavedPurchase(db, (await persistLocalPurchase(db, actor, acknowledged(input))).id)
    assert.equal(saved?.lines.length, 2); assert.equal(saved?.payableTotal, 11600)
    assert.deepEqual(new Set(saved?.lines.map((line) => line.variantId)), new Set([small, large]))
    assert.ok(!(await loadSupplierCatalogue(db, supplier.id)).some((item) => item.supplierLabel === input.lines[0].supplierLabel))
  })
  await test('server validation rejects inactive, deleted and wrong-parent variants without saving', async () => {
    for (const variantId of [inactive, randomUUID(), state.otherVariantId!]) {
      const input = inputFor(variantId)
      await assert.rejects(persistLocalPurchase(db, actor, input), /inactive|another product|missing/i)
      await noSave(input.idempotencyKey)
    }
    const input = inputFor(unpriced, 290, `${state.tag} unpriced capacity`)
    assert.equal((await loadSavedPurchase(db, (await persistLocalPurchase(db, actor, input)).id))?.lines[0].variantId, unpriced)
  })
  await test('transaction rejects forged variants after server validation and rolls back preceding rows', async () => {
    for (const invalid of [inactive, randomUUID(), state.otherVariantId!]) {
      const input = inputFor(small, 290, `${state.tag} rollback coating`)
      input.lines.push({ ...input.lines[0], key: 'second', supplierCode: 'ROLLBACK-2' })
      input.document = { ...input.document!, declaredTotal: 11600 }
      await assert.rejects(persistLocalPurchase(tampered((payload) => { payload.lines[1].variant_id = invalid }), actor, input), /inactive|another product|missing/i)
      await noSave(input.idempotencyKey)
      assert.ok(!(await loadSupplierCatalogue(db, supplier.id)).some((item) => item.supplierLabel === input.lines[0].supplierLabel))
    }
    const input = inputFor(small, 290, `${state.tag} authoritative snapshot`)
    const saved = await loadSavedPurchase(db, (await persistLocalPurchase(tampered((payload) => { payload.lines[0].variant_snapshot = { id: large, attributeValue: 'Forged', price: 1 } }), actor, input)).id)
    assert.equal(saved?.lines[0].variantSnapshot?.id, small); assert.equal(saved?.lines[0].variantSnapshot?.attributeValue, '2Kg')
  })
  const mapping = (await loadSupplierCatalogue(db, supplier.id)).find((item) => item.supplierLabel === label)!
  const line: LocalOrderLine = { id: randomUUID(), supplierProductId: mapping.id, productId, supplierLabel: label, supplierCode: code, unit: 'piece', qty: 20,
    expectedUnitPrice: mapping.lastUnitPayable, vatPercent: 15, pricesIncludeVat: true, discountPercent: 0,
    sourcePurchaseLineId: mapping.sourcePurchaseLineId, priceReferenceDate: mapping.lastPurchaseDate,
    variantId: mapping.variantId, variantSource: 'supplier' }
  const orderRequest = { id: randomUUID(), revision: 0, updatedAt: null, requestKey: randomUUID(), supplierId: supplier.id,
    lines: [line], terms: { charges: [], roundingAmount: null }, notes: 'Isolated variant verification. Never send.', expectedDate: null }
  await test('reorder save, load and issue retain the variant and expose only supplier prices in export', async () => {
    await saveLocalOrder(db, actor, orderRequest)
    const loaded = await loadLocalOrder(db, orderRequest.id)
    assert.equal(loaded.lines[0].variantId, small); assert.equal(loaded.lines[0].expectedUnitPrice, 290)
    await changeLocalOrder(db, actor, 'issue', { id: loaded.id, revision: loaded.revision, updatedAt: loaded.updatedAt, requestKey: randomUUID() })
    const issued = await loadLocalOrder(db, loaded.id)
    assert.equal(issued.issuedSnapshot?.lines[0].variantSnapshot?.attributeValue, '2Kg')
    const rows = supplierOrderRows(issued.issuedSnapshot!)
    assert.ok(rows.flat().includes('Capacity: 2Kg')); assert.ok(!rows.flat().includes(875)); assert.ok(!rows.flat().includes(1500))
    assert.equal(issued.issuedSnapshot?.calculation.totals?.payable, 5800)
  })
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Supplier', supplier.name], ['Invoice', `${state.tag}-variant-partial`], ['Date', date], ['Prices', 'VAT included'],
    ['Description', 'Code', 'Unit', 'Qty', 'Unit price', 'Amount', 'VAT %'], [label, code, 'piece', 10, 290, 2900, 15], ['Total', '', '', '', '', 2900]]), 'Invoice')
  const form = new FormData()
  form.set('file', new File([XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })], 'variant-partial.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  form.set('orderId', orderRequest.id); form.set('orderRevision', '1')
  const imported = await importLocalDocument(form, db, actor)
  assert.ok(imported.documentId)
  const review = async (): Promise<ReviewRequest> => {
    const order = await loadLocalOrder(db, orderRequest.id), view = await loadOrderDocument(db, actor, orderRequest.id, imported.documentId!)
    const comparison = compareOrderDocument(order.issuedSnapshot!, view.input, order.received, order.allocationRevision, true)
    const source = { documentId: view.id, documentRevision: view.documentRevision, reviewRevision: view.reviewRevision, reviewEpoch: order.reviewEpoch }
    return { orderId: order.id, orderRevision: order.revision, allocationRevision: order.allocationRevision, ...source, input: view.input,
      acknowledgement: { revision: orderReviewRevision(comparison.revision, source), reason: 'Isolated verification: the selected 2Kg variant is correct and this is a partial purchase of ten units.' } }
  }
  await test('returned-document review restores the issued variant and mismatches cannot be accepted', async () => {
    const request = await review(), key = request.input.document.lines[0].key!
    assert.equal(request.input.products[key].variantId, small); assert.equal(request.input.products[key].variantSource, 'order')
    const wrong = { ...request, input: { ...request.input, products: { ...request.input.products, [key]: { ...request.input.products[key], variantId: large, variantSource: 'manual' as const } } } }
    const order = await loadLocalOrder(db, orderRequest.id)
    const blocked = compareOrderDocument(order.issuedSnapshot!, wrong.input, order.received, order.allocationRevision, true)
    assert.equal(blocked.canAccept, false); assert.equal(blocked.rows[0].thisDocument, 0)
    assert.ok(blocked.differences.some((difference) => difference.kind === 'variant' && difference.blocking))
    wrong.acknowledgement = { revision: orderReviewRevision(blocked.revision, wrong), reason: 'Isolated verification: even an explicit reason must not allocate a different-size variant.' }
    await assert.rejects(saveOrderReview(db, actor, wrong, true), /variant|essential|Resolve/i)
    await saveOrderReview(db, actor, request, true)
    const after = await loadLocalOrder(db, orderRequest.id)
    assert.equal(after.received[line.id] ?? 0, 0)
    assert.equal((await review()).input.products[key].variantId, small)
  })
  await test('atomic allocations independently reject a different-size variant, then record the correct partial once', async () => {
    const request = { ...await review(), actualPurchase: true, idempotencyKey: randomUUID() }
    await assert.rejects(recordOrderPurchase(tampered((payload) => { payload.lines[0].variant_id = large }), actor, request), /variant disagrees/)
    await noSave(request.idempotencyKey)
    assert.equal((await loadLocalOrder(db, orderRequest.id)).received[line.id] ?? 0, 0)
    const recorded = await recordOrderPurchase(db, actor, request)
    assert.equal((await recordOrderPurchase(db, actor, request)).id, recorded.id)
    const saved = await loadSavedPurchase(db, recorded.id), order = await loadLocalOrder(db, orderRequest.id)
    assert.equal(saved?.lines[0].variantId, small); assert.equal(saved?.payableTotal, 2900)
    assert.equal(order.received[line.id], 10); assert.equal(order.status, 'partial')
    await assert.rejects(saveLocalOrder(db, actor, { ...orderRequest, revision: order.revision, updatedAt: order.updatedAt, requestKey: randomUUID(),
      lines: [{ ...line, variantId: large, supplierProductId: null, sourcePurchaseLineId: null, priceReferenceDate: null }] }), /Keep the identity/)
  })
  await test('variant purchases never mutate stock, selling prices, cost, price history or payments', async () => {
    assert.deepEqual(requireSuccess(await db.from('products').select('id,quantity,price,cost_price,updated_at').eq('id', productId).single()).data, productBefore)
    assert.deepEqual(requireSuccess(await db.from('product_variants').select('id,quantity,price_override,updated_at').eq('product_id', productId).order('id')).data, variantBefore)
    assert.equal(requireSuccess(await db.from('product_price_history').select('id', { count: 'exact', head: true }).eq('product_id', productId)).count, historyBefore)
    assert.equal(requireSuccess(await db.from('stock_movements').select('id', { count: 'exact', head: true }).eq('product_id', productId)).count, 0)
    const payments = requireSuccess(await db.from('local_purchases').select('payment_status,paid_amount').eq('created_by', actor)).data!
    assert.ok(payments.every((row) => row.payment_status === 'unpaid' && Number(row.paid_amount) === 0))
    for (const session of sessions) assert.ok((await session.rpc('local_variant_snapshot', { p_product: productId, p_variant: small, p_provenance: 'manual', p_actor: actor })).error)
  })
  await test('renaming and deleting fixture variants keep historical identity in purchases, mappings and issued orders', async () => {
    requireSuccess(await db.from('product_variants').update({ attribute_value: 'Renamed fixture size' }).eq('id', small))
    assert.equal((await loadSavedPurchase(db, purchaseId))?.lines[0].variantSnapshot?.attributeValue, '2Kg')
    requireSuccess(await db.from('product_variants').delete().in('id', [small, large]))
    const saved = await loadSavedPurchase(db, purchaseId), other = await loadSavedPurchase(db, largePurchaseId)
    assert.equal(saved?.lines[0].variantId, null); assert.equal(saved?.lines[0].variantSnapshot?.id, small)
    assert.equal(other?.lines[0].variantId, null); assert.equal(other?.lines[0].variantSnapshot?.attributeValue, '5Kg')
    const remembered = (await loadSupplierCatalogue(db, supplier.id)).find((item) => item.id === mapping.id)!
    assert.equal(remembered.variantId, null); assert.equal(recordedVariantId(remembered), small)
    const order = await loadLocalOrder(db, orderRequest.id)
    assert.equal(order.lines[0].variantId, null); assert.equal(recordedVariantId(order.lines[0]), small)
    assert.equal(order.issuedSnapshot?.lines[0].variantSnapshot?.attributeValue, '2Kg')
  })
}
