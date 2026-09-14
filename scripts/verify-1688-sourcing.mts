import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { ACTOR, OTHER_BUYER, WRONG_ROLE, ResearchFixture, clone, interop, interpretationFixture, listingFixture, stamp, targetFixture, testId } from './1688-research-fixtures.mts'
import * as queueModule from '../lib/purchase-orders/1688-queue.ts'
import * as sourcingModule from '../lib/purchase-orders/1688-sourcing-service.ts'
import * as reviewModule from '../lib/purchase-orders/1688-sourcing-review.ts'
import * as comparisonModule from '../lib/purchase-orders/1688-comparison.ts'
import * as preferencesModule from '../lib/purchase-orders/1688-preferences.ts'
import * as checkModule from '../lib/purchase-orders/1688-check-service.ts'
import * as reorderModule from '../lib/purchase-orders/reorder-service.ts'
import type { SourcingInput, SourcingSelection, SourcingTerms } from '../lib/purchase-orders/1688-sourcing-types.ts'

const { advanceResearchJob, enqueueResearch, loadResearchQueue, queueMutation, stageReservation } = interop(queueModule)
const { cancelSourcingSelection, confirmSourcingSelection, getSourcingWorkspace, prepareSourcingPhotos, saveSourcingSelection } = interop(sourcingModule)
const { aggregateSkuReviews, initialSkuReviews, purchaseDifference, reviewSourcing, sourcingPrice, sourcingPurchasePreview } = interop(reviewModule)
const { sameBaseContext, stableEvidence } = interop(comparisonModule)
const { purchasingSource } = interop(preferencesModule)
const { resolveContext, hashContext1688 } = interop(checkModule)
const { createImportReorders, loadImportReorder, mutateImportReorder } = interop(reorderModule)
const fetchBefore = globalThis.fetch
globalThis.fetch = async () => { throw new Error('External requests are disabled during isolated sourcing verification') }
let passed = 0; let failed = 0
// One WASM engine avoids Node 24's JIT deallocation crash when PGlite is repeatedly closed.
const fixture = await new ResearchFixture().init()
const originalCatalogue = clone(fixture.catalogue)
const originalPorts = { ...fixture.ports, provider: { ...fixture.ports.provider } }
const tables = (await fixture.sql.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name")).rows.map(row => row.table_name)
const originals = await Promise.all(['profiles','products','product_variants','product_links','purchase_orders','import_reorder_items'].map(async table => ({ table, rows: (await fixture.sql.query(`select to_jsonb(t) value from public.${table} t`)).rows.map(row => row.value) })))
async function test(name: string, body: (f: ResearchFixture) => Promise<void>) {
  await fixture.sql.exec(`reset role; truncate ${tables.map(table=>`public.${table}`).join(',')} restart identity cascade`)
  for (const record of originals) if (record.rows.length) await fixture.sql.query(`insert into public.${record.table} select * from jsonb_populate_recordset(null::public.${record.table},$1::jsonb)`,[JSON.stringify(record.rows)])
  fixture.imageFiles.clear(); fixture.imageUploadError = null
  Object.assign(fixture,{ catalogue:clone(originalCatalogue),ports:{...originalPorts,provider:{...originalPorts.provider}},reads:[],writes:[],providerCalls:[],failRead:null,failRpc:null,failStage:null,terminal:false,delay:0,providerActive:0,maxProviderActive:0,afterProvider:null })
  try { await body(fixture); passed++; console.log(`PASS ${name}`) }
  catch (cause) { failed++; console.error(`FAIL ${name}: ${(cause as Error).stack}`) }
}
const terms: SourcingTerms = { orderDate: '2026-09-10', chinaFreight: null, fxRate: null }
async function research(f: ResearchFixture, count = 1) {
  await f.sql.query('update public.purchase_orders set unit_price=12,discounted_unit_price=10 where id=$1', [testId(3)])
  f.ports.provider.listing = (id: string) => f.call(`listing:${id}`, () => listingFixture(id, id === '888888000000' ? '12' : '8', id === '888888000001' ? count : 1))
  const check = await f.run()
  f.providerCalls.length = 0
  return check
}
async function inputFor(f: ResearchFixture, check: Awaited<ReturnType<ResearchFixture['check']>>, offerId = '888888000001'): Promise<SourcingInput> {
  assert(check)
  const workspace = await getSourcingWorkspace(f.db, check.item_id)
  const offer = offerId === check.evidence.current?.offerId ? check.evidence.current : check.evidence.offers[offerId]
  const selection = workspace.selection?.status === 'pending' ? workspace.selection : null
  return { itemId: check.item_id, itemRevision: workspace.guard.item.revision, generation: check.generation, checkVersion: check.version, offerId, guardHash: workspace.guardHash, selectionId: selection?.id ?? randomUUID(), selectionRevision: selection?.revision ?? 0, preferenceRevision: workspace.preference?.revision ?? 0, convertToVariants: false, quantityDifferenceAccepted: true, unverifiedTermsAccepted: true, reviews: initialSkuReviews(check, offer, workspace.guard).map((row, index) => ({ ...row, include: index === offer.skus.length - 1, reviewed: true, destination: 'parent', variantId: null, qty: index === offer.skus.length - 1 ? 100 : null, keepPhoto: true, samePreviousUnit: true })), requestKey: randomUUID() }
}
async function saved(f: ResearchFixture, count = 1) { const check = await research(f, count); return saveSourcingSelection(f.db, ACTOR, await inputFor(f, check)) }
const confirm = (f: ResearchFixture, s: SourcingSelection, overrides: Partial<SourcingTerms> = {}) => confirmSourcingSelection(f.db, ACTOR, { id: s.id, revision: s.revision, requestKey: randomUUID(), accepted: true, terms: { ...terms, ...overrides } })
async function queue(f: ResearchFixture, indices = [0], mode: 'fresh' | 'resume' = 'fresh', actor = ACTOR) {
  const items = await Promise.all(indices.map(async index => { const c = await f.command(index); return { itemId: c.itemId, revision: c.revision, generation: c.generation, version: c.version, mode } }))
  const input = { operation: 'enqueue' as const, requestKey: randomUUID(), items }
  const run = await enqueueResearch(f.db, actor, input)
  return { run, input }
}
async function own(f: ResearchFixture, runId: string, actor = ACTOR, workflowId = randomUUID()) { const claim = await queueMutation(f.db, actor, 'claim-run', runId, { workflowId }); return { ids: claim.jobs ?? [], workflowId, owned: claim.owned } }
async function advance(f: ResearchFixture, id: string, workflowId: string, key = randomUUID()) { return advanceResearchJob(f.db, id, workflowId, key, f.ports) }
async function drain(f: ResearchFixture, ids: string[], workflowId: string) {
  await Promise.all(ids.map(async id => { for (let n = 0; n < 180; n++) { const status = await advance(f, id, workflowId); if (status === 'done') return; if (status === 'wait') await new Promise(resolve => setTimeout(resolve, 5)) }; throw new Error('Queue failed to finish') }))
}

await test('Enqueue persists all six rows before dispatch and GET never purchases a lookup', async f => {
  const before = await f.businessHash(); const { run, input } = await queue(f, [0,1,2,3,4,5]); const status = await loadResearchQueue(f.db)
  assert.equal(run.status, 'accepted'); assert.equal(status.jobs.length, 6); assert.equal(f.providerCalls.length, 0)
  assert.equal((await enqueueResearch(f.db, ACTOR, input)).id, run.id); assert.equal((await loadResearchQueue(f.db)).jobs.length, 6)
  assert.equal(await f.businessHash(), before)
})
await test('Duplicate submissions and competing workflow starts converge on one owner', async f => {
  const { run, input } = await queue(f); await assert.rejects(() => enqueueResearch(f.db, ACTOR, { ...input, items: input.items.map(item => ({ ...item, mode: 'resume' })) }))
  await assert.rejects(() => queue(f))
  const first = await own(f, run.id); const second = await own(f, run.id); assert.equal(first.owned, true); assert.equal(second.owned, false)
  const before = f.providerCalls.length; await advance(f, first.ids[0], second.workflowId); assert.equal(f.providerCalls.length, before)
})
await test('Two batches share three global external-call slots and retain all 51 SKUs', async f => {
  const before = await f.businessHash(); f.delay = 8
  const a = await queue(f, [0,1,2]); const b = await queue(f, [3,4,5]); const ownA = await own(f, a.run.id); const ownB = await own(f, b.run.id)
  await Promise.all([drain(f, ownA.ids, ownA.workflowId), drain(f, ownB.ids, ownB.workflowId)])
  const status = await loadResearchQueue(f.db)
  assert.equal(status.jobs.filter(job => job.status === 'complete').length, 6, JSON.stringify(status.jobs.map(j => ({ status:j.status, reason:j.reason }))))
  assert.equal(f.maxProviderActive, 3); assert(status.jobs.every(job => job.tmapi_reserved <= 15 && job.ai_reserved <= 7)); assert(status.jobs.every(job => job.tmapi_reserved >= job.tmapi_actual && job.ai_reserved >= job.ai_actual))
  assert.equal(status.checks[0].evidence.offers['888888000001'].skus.length, 51); assert.equal(await f.businessHash(), before)
})
await test('Duplicate paid-step delivery spends once, including replay after save', async f => {
  const { run } = await queue(f); const owned = await own(f, run.id); await advance(f, owned.ids[0], owned.workflowId)
  f.delay = 30; const key = randomUUID()
  await Promise.all([advance(f, owned.ids[0], owned.workflowId, key), advance(f, owned.ids[0], owned.workflowId, key)])
  assert.equal(f.providerCalls.length, 1); await advance(f, owned.ids[0], owned.workflowId, key); assert.equal(f.providerCalls.length, 1)
  const state = await loadResearchQueue(f.db); assert.equal(state.jobs[0].tmapi_reserved, 1); assert.equal(state.jobs[0].tmapi_actual, 1)
})
await test('Stop finishes an already-dispatched lookup and stops all remaining work', async f => {
  const { run } = await queue(f, [0,1,2,3]); const owned = await own(f, run.id); await advance(f, owned.ids[0], owned.workflowId)
  f.afterProvider = () => queueMutation(f.db, ACTOR, 'stop', run.id).then(() => undefined)
  await advance(f, owned.ids[0], owned.workflowId); await drain(f, owned.ids, owned.workflowId)
  assert.equal(f.providerCalls.length, 1); assert.equal((await f.check())?.evidence.current?.offerId, '888888000000')
  assert((await loadResearchQueue(f.db)).jobs.every(job => ['partial','stopped'].includes(job.status)))
  const resumed = await queue(f, [0], 'resume'); const owner = await own(f, resumed.run.id); await drain(f, owner.ids, owner.workflowId)
  assert.equal(f.providerCalls.filter(value => value === 'listing:888888000000').length, 1)
})
await test('Provider credit failure pauses undispatched jobs without retrying', async f => {
  const { run } = await queue(f, [0,1,2]); const owner = await own(f, run.id); await advance(f, owner.ids[0], owner.workflowId)
  f.failStage = 'listing:888888000000'; f.terminal = true
  await advance(f, owner.ids[0], owner.workflowId); await drain(f, owner.ids, owner.workflowId)
  assert.equal(f.providerCalls.length, 1); const status = await loadResearchQueue(f.db); assert(status.runs[0].stop_requested); assert.equal(status.jobs.filter(job => job.status === 'stopped').length, 2)
})
await test('A paid response with failed persistence pauses and retains its reserved attempt', async f => {
  const { run } = await queue(f, [0,1]); const owner = await own(f, run.id); await advance(f, owner.ids[0], owner.workflowId)
  f.failRpc = 'complete'; await advance(f, owner.ids[0], owner.workflowId); await drain(f, owner.ids, owner.workflowId)
  const status = await loadResearchQueue(f.db); const job = status.jobs.find(job => job.item_id === testId(4))!
  assert.equal(f.providerCalls.length, 1); assert.equal(job.status, 'interrupted'); assert.equal(job.tmapi_reserved, 1); assert.equal(job.tmapi_actual, 0)
  assert.equal((await f.check())?.evidence.paid.tmapi, 1); assert.equal((await f.check())?.evidence.current, null)
})
await test('Crash after reservation is never automatically redelivered as paid work', async f => {
  const { run } = await queue(f); const owner = await own(f, run.id); await advance(f, owner.ids[0], owner.workflowId); const check = (await f.check())!
  const key = randomUUID(); await queueMutation(f.db, ACTOR, 'reserve', owner.ids[0], { workflowId: owner.workflowId, version: check.version, contextHash: check.context_hash, stage:'listing',tmapi:1,ai:0 }, key)
  await f.sql.exec("update public.import_reorder_1688_jobs set lease_until=now()-interval '1 second'; update public.import_reorder_1688_checks set lease_until=now()-interval '1 second'")
  await advance(f, owner.ids[0], owner.workflowId, key); assert.equal(f.providerCalls.length, 0)
  const resume = await queue(f, [0], 'resume'); const resumed = await own(f, resume.run.id); await drain(f, resumed.ids, resumed.workflowId)
  const newest = (await loadResearchQueue(f.db)).jobs[0]; assert.equal(newest.tmapi_reserved, newest.tmapi_actual + 1)
})
await test('Role revocation before dispatch prevents paid work; wrong-role submission is denied', async f => {
  await assert.rejects(() => queue(f, [0], 'fresh', WRONG_ROLE)); const { run } = await queue(f); const owner = await own(f, run.id)
  await f.sql.query("update public.profiles set role='marketing_agent' where id=$1", [ACTOR]); await drain(f, owner.ids, owner.workflowId); assert.equal(f.providerCalls.length, 0)
})
await test('Context edits before or during a paid lookup invalidate its result', async f => {
  const { run } = await queue(f); const owner = await own(f, run.id); await advance(f, owner.ids[0], owner.workflowId)
  f.afterProvider = async () => { await f.sql.query("update public.products set description='Edited evidence' where id=$1", [testId(2)]) }
  await advance(f, owner.ids[0], owner.workflowId); const status = await loadResearchQueue(f.db)
  assert.equal(status.jobs[0].status, 'stale'); assert.equal((await f.check())?.evidence.current, null); assert.equal(f.providerCalls.length, 1)
})
await test('Legacy interrupted context without preference metadata remains resumable', async f => {
  await f.process(await f.command()); await f.process(await f.command(0, 'stop'))
  const current = (await f.check())!; const context = { ...current.context }; delete context.sourcePreference
  await f.sql.query('update public.import_reorder_1688_checks set context=$1,context_hash=$2', [JSON.stringify(context), hashContext1688(context)])
  assert(sameBaseContext(context, await resolveContext(f.db, testId(4)))); const { run } = await queue(f, [0], 'resume'); assert(run.id)
})

await test('Saved replacement survives reload, remembers source, and changes no business record', async f => {
  const check = await research(f); const before = await f.businessHash(); const input = await inputFor(f, check); const selection = await saveSourcingSelection(f.db, ACTOR, input)
  assert.equal(selection.status,'pending'); assert.equal(await f.businessHash(),before); assert.equal(f.providerCalls.length,0)
  assert.equal((await getSourcingWorkspace(f.db, check.item_id)).selection?.id,selection.id); assert.equal((await saveSourcingSelection(f.db, ACTOR,input)).id,selection.id)
  const context = await resolveContext(f.db,check.item_id); assert.equal(context.sourceLink,selection.snapshot.source.pageUrl); assert.equal(context.supplierName,'QA Alternative Supplier'); assert.equal(context.reference?.supplier_name,'QA Original Supplier')
})
await test('Pinned ¥12 list / ¥10 negotiated / ¥8 chosen / 100 units produces -¥2, -20%, -¥200', async f => {
  const selection = await saved(f); const preview = sourcingPurchasePreview(selection,terms); const row=preview.rows.find(row=>row.review.include)!
  assert.deepEqual([row.difference.previousList,row.difference.previousNet,row.price,row.difference.perUnit,row.difference.percent,row.difference.goods],[12,10,8,-2,-20,-200]); assert.equal(preview.goods,800); assert.equal(preview.difference,-200); assert.equal(preview.blockers.length,0,preview.blockers.join('; '))
})
await test('Confirmation creates only a separate Ordered import; old costs, stock and retail values stay exact', async f => {
  const s=await saved(f); const original=await f.sql.query('select to_jsonb(p) as value from public.purchase_orders p where id=$1',[testId(3)]); const product=await f.sql.query('select to_jsonb(p) as value from public.products p where id=$1',[testId(2)])
  const result=await confirm(f,s); assert.equal(result.imports.length,1); const created=await f.sql.query('select status,qty,unit_price,discounted_unit_price,discounted_percentage,total_payment_supplier_yuan,total_payment_supplier,import_cp,total_cp_import,variant_id,variant_snapshot from public.purchase_orders where id=$1',[result.imports[0].id]); const row=created.rows[0]
  assert.equal(row.status,'Ordered'); assert.equal(row.qty,100); assert.equal(Number(row.unit_price),8); assert.equal(Number(row.discounted_unit_price),8); assert.equal(row.discounted_percentage,null); assert.equal(row.total_payment_supplier_yuan,null); assert.equal(row.total_payment_supplier,null); assert.equal(row.import_cp,null); assert.equal(row.total_cp_import,null); assert.equal(row.variant_id,null); assert.equal(row.variant_snapshot.sourcing.skuId,s.snapshot.rows[0].sku.id)
  assert.deepEqual((await f.sql.query('select to_jsonb(p) as value from public.purchase_orders p where id=$1',[testId(3)])).rows,original.rows); assert.deepEqual((await f.sql.query('select to_jsonb(p) as value from public.products p where id=$1',[testId(2)])).rows,product.rows)
  assert.equal((await f.sql.query('select count(*)::int n from public.product_variants')).rows[0].n,0); assert.equal(f.providerCalls.length,0)
})
await test('Explicit zero freight and reviewed FX are real values, not inherited supplier discounts', async f => {
  const s=await saved(f); const result=await confirm(f,s,{chinaFreight:0,fxRate:8}); const row=(await f.sql.query('select shipment_to_warehouse,total_payment_supplier_yuan,total_payment_supplier,import_cp,weight_kg,cbm,boxes from public.purchase_orders where id=$1',[result.imports[0].id])).rows[0]
  assert.equal(Number(row.shipment_to_warehouse),0); assert.equal(Number(row.total_payment_supplier_yuan),800); assert.equal(Number(row.total_payment_supplier),6400); assert.equal(row.import_cp,null); assert.equal(row.weight_kg,null); assert.equal(row.cbm,null); assert.equal(row.boxes,null)
})
await test('Concurrent confirmations and lost-response retries return the same recorded import', async f => {
  const s=await saved(f); const results=await Promise.all([confirm(f,s),confirm(f,s)]); assert.deepEqual(results[0],results[1]); assert.equal((await f.sql.query('select count(*)::int n from public.purchase_orders')).rows[0].n,7)
  await f.sql.query('delete from public.purchase_orders where id=$1',[results[0].imports[0].id]); assert.deepEqual(await confirm(f,s),results[0]); assert.equal((await f.sql.query('select count(*)::int n from public.purchase_orders')).rows[0].n,6)
})
await test('Discarding a proposal creates no purchase and retains the separately chosen source', async f => {
  const s=await saved(f); const before=await f.businessHash(); const cancelled=await cancelSourcingSelection(f.db,ACTOR,{id:s.id,revision:s.revision,requestKey:randomUUID()}); assert.equal(cancelled.status,'cancelled'); assert.equal(await f.businessHash(),before); assert.equal((await getSourcingWorkspace(f.db,s.item_id)).preference?.offer_id,s.snapshot.source.offerId); await assert.rejects(()=>confirm(f,s))
})
await test('Stale Inventory or historical money rejects confirmation with no partial mutation', async f => {
  const s=await saved(f); await f.sql.query('update public.purchase_orders set discounted_unit_price=11 where id=$1',[testId(3)]); const before=await f.businessHash(); await assert.rejects(()=>confirm(f,s),/changed/i); assert.equal(await f.businessHash(),before); assert.equal((await f.sql.query('select count(*)::int n from public.product_1688_sku_links')).rows[0].n,0)
})
await test('Changed reviewed version, fabricated prices and wrong-role calls are rejected', async f => {
  const check=await research(f); const input=await inputFor(f,check); await assert.rejects(()=>saveSourcingSelection(f.db,ACTOR,{...input,reviews:input.reviews.map(row=>({...row,price:1}))} as any)); await assert.rejects(()=>saveSourcingSelection(f.db,WRONG_ROLE,input)); await assert.rejects(()=>saveSourcingSelection(f.db,ACTOR,{...input,offerId:'999999000000'})); await assert.rejects(()=>saveSourcingSelection(f.db,ACTOR,{...input,guardHash:'a'.repeat(64)}))
})
await test('Every saved SKU is required, equal prices never identify the Inventory variant', async f => {
  const check=await research(f,51); const input=await inputFor(f,check); const workspace=await getSourcingWorkspace(f.db,input.itemId); assert.equal(initialSkuReviews(check,check.evidence.offers[input.offerId],workspace.guard).filter(row=>row.destination==='existing').length,0)
  await assert.rejects(()=>saveSourcingSelection(f.db,ACTOR,{...input,reviews:input.reviews.slice(0,50)})); const s=await saveSourcingSelection(f.db,ACTOR,input); assert.equal(s.snapshot.rows.length,51); assert.equal(s.snapshot.rows[50].review.qty,100)
})
await test('Simple products with nonzero parent stock cannot silently become variants', async f => {
  const check=await research(f); const input=await inputFor(f,check); input.convertToVariants=true; input.reviews=input.reviews.map(row=>({...row,destination:'new',attributeName:'Colour / Size',attributeValue:'Black / 60cm'})); const before=await f.businessHash(); await assert.rejects(()=>saveSourcingSelection(f.db,ACTOR,input),/stock/i); assert.equal(await f.businessHash(),before)
})
await test('Existing variant product ordering one variant stays variant-based and uses its own history', async f => {
  const variantId=testId(8); await f.sql.query('update public.products set has_variants=true where id=$1',[testId(2)]); await f.sql.query("insert into public.product_variants(id,product_id,attribute_name,attribute_value,quantity,price_override,sku,is_active) values($1,$2,'Colour / Size','Black / 60cm',19,37,'LOCAL-B60',true)",[variantId,testId(2)]); await f.sql.query('update public.purchase_orders set variant_id=$1 where id=$2',[variantId,testId(3)])
  const check=await research(f); const input=await inputFor(f,check); input.reviews=input.reviews.map(row=>({...row,destination:'existing',variantId,attributeName:'Colour / Size',attributeValue:'Black / 60cm'})); const s=await saveSourcingSelection(f.db,ACTOR,input); assert.equal(s.snapshot.rows[0].difference.previousNet,10)
  const before=(await f.sql.query('select to_jsonb(v) value from public.product_variants v where id=$1',[variantId])).rows; const result=await confirm(f,s); assert.equal((await f.sql.query('select variant_id from public.purchase_orders where id=$1',[result.imports[0].id])).rows[0].variant_id,variantId); assert.deepEqual((await f.sql.query('select to_jsonb(v) value from public.product_variants v where id=$1',[variantId])).rows,before)
})
await test('All reviewed catalogue variants sync; only positive buyer quantities become imports', async f => {
  await f.sql.query('update public.products set has_variants=true,quantity=0 where id=$1',[testId(2)]); const check=await research(f,2); const input=await inputFor(f,check); input.reviews=input.reviews.map((row,index)=>({...row,include:true,destination:'new',variantId:null,attributeName:'Colour / Size',attributeValue:index?'Black / 60cm':'Black / 30cm',qty:index?100:null})); const s=await saveSourcingSelection(f.db,ACTOR,input); const result=await confirm(f,s); assert.equal(result.imports.length,1)
  const variants=(await f.sql.query('select quantity,price_override,sku,is_active,attribute_value from public.product_variants order by attribute_value')).rows; assert.equal(variants.length,2); assert(variants.every(row=>row.quantity===0&&row.price_override===null&&row.sku===null&&row.is_active===true)); assert.equal((await f.sql.query('select count(*)::int n from public.product_1688_sku_links')).rows[0].n,2)
})
await test('New complete multi-attribute variants never create a Cartesian product', async f => {
  await f.sql.query('update public.products set quantity=0 where id=$1',[testId(2)]); const check=await research(f,2); const input=await inputFor(f,check); input.convertToVariants=true; input.reviews=input.reviews.map((row,index)=>({...row,include:true,destination:'new',variantId:null,attributeName:'Colour / Size / Contents',attributeValue:`Black / ${index?'60cm':'30cm'} / Complete rack`,qty:index?100:null})); const s=await saveSourcingSelection(f.db,ACTOR,input); await confirm(f,s); assert.equal((await f.sql.query('select count(*)::int n from public.product_variants')).rows[0].n,2); assert.equal((await f.sql.query('select has_variants,quantity from public.products where id=$1',[testId(2)])).rows[0].quantity,0)
})
await test('Unrelated/inactive variants, their stock and their price overrides are never replaced', async f => {
  await f.sql.query('update public.products set has_variants=true where id=$1',[testId(2)]); await f.sql.query("insert into public.product_variants(id,product_id,attribute_name,attribute_value,quantity,price_override,sku,is_active) values($1,$2,'Colour','Archived red',13,41,'RED',false)",[testId(8),testId(2)]); const check=await research(f); const input=await inputFor(f,check); input.reviews=input.reviews.map(row=>({...row,destination:'new',attributeName:'Colour / Size',attributeValue:'Black / 60cm'})); const before=(await f.sql.query('select to_jsonb(v) value from public.product_variants v where id=$1',[testId(8)])).rows; const s=await saveSourcingSelection(f.db,ACTOR,input); await confirm(f,s); assert.deepEqual((await f.sql.query('select to_jsonb(v) value from public.product_variants v where id=$1',[testId(8)])).rows,before)
})
await test('Same-price accessories, deposits, samples and missing stable IDs cannot be included', async f => {
  const check=await research(f); const input=await inputFor(f,check); const workspace=await getSourcingWorkspace(f.db,input.itemId)
  for(const name of ['Accessory only','Empty case','Deposit','Sample only']) { const c=clone(check); c.evidence.offers[input.offerId].skus[0].name=name; assert(reviewSourcing(input,c,workspace.guard).rows[0].blockers.length>0) }
  const c=clone(check); Object.assign(c.evidence.offers[input.offerId].skus[0],{providerId:null,specId:null,propsIds:null}); assert(reviewSourcing(input,c,workspace.guard).rows[0].blockers.some(value=>value.includes('identity')))
})
await test('Quantity tier gaps and ambiguous prices never fall back to a cheap headline', async f => {
  const check=await research(f); const offer=clone(check.evidence.offers['888888000001']); const sku=offer.skus[0]; sku.tiers=[{skuId:sku.id,minQty:200,maxQty:400,price:6,source:'SKU tier'}]; assert.equal(sourcingPrice(offer,sku,100,100).price,null); assert.equal(sourcingPrice(offer,sku,200,200).price,6); assert.equal(sourcingPrice(offer,sku,401,401).price,null); sku.tiers.push({...sku.tiers[0],price:7}); assert.equal(sourcingPrice(offer,sku,200,200).price,null)
})
await test('Unknown stock, pack, unit, MOQ or multiples cannot become verified savings', async f => {
  const check=await research(f); const input=await inputFor(f,check); const guard=(await getSourcingWorkspace(f.db,input.itemId)).guard
  for(const field of ['stock','packSize','unit','quantityMultiple','moq']) { const c=clone(check); if(field==='moq') c.evidence.offers[input.offerId].moq=null; else { (c.evidence.offers[input.offerId].skus[0] as any)[field]=null; if(field==='quantityMultiple')c.evidence.offers[input.offerId].quantityMultiple=null }; const row=reviewSourcing(input,c,guard).rows[0]; assert.equal(row.difference.goods,null,field); assert(row.warnings.length>0,field) }
})
await test('Duplicate SKU quantities aggregate, while conflicting destination reviews are rejected', async f => {
  const check=await research(f); const input=await inputFor(f,check); const row=input.reviews[0]; assert.equal(aggregateSkuReviews([{...row,qty:40},{...row,qty:60}])[0].qty,100); assert.throws(()=>aggregateSkuReviews([row,{...row,keepPhoto:false}]))
  const s=await saveSourcingSelection(f.db,ACTOR,{...input,reviews:[{...row,qty:40},{...row,qty:60}]}); assert.equal(s.snapshot.orderedQty,100)
})
await test('Listing MOQ applies to allocated total; stock and SKU tier apply to each ordered SKU', async f => {
  const check=await research(f); const offer=check.evidence.offers['888888000001']; const sku=offer.skus[0]; assert.equal(sourcingPrice(offer,sku,5,20).blockers.length,0); assert(sourcingPrice(offer,sku,5,5).blockers.some(value=>value.includes('MOQ'))); assert(sourcingPrice(offer,{...sku,stock:3},5,20).blockers.some(value=>value.includes('stock')))
})
await test('Failed or missing photo copy cannot erase an existing Inventory photo', async f => {
  const check=await research(f); const input=await inputFor(f,check); input.reviews[0].keepPhoto=false; const s=await saveSourcingSelection(f.db,ACTOR,input); const prepared=await prepareSourcingPhotos(f.db,ACTOR,{id:s.id,revision:s.revision,requestKey:randomUUID(),skuIds:[s.snapshot.rows[0].sku.id]},async()=>{throw new Error('Image unavailable')}); assert.equal(prepared.photos[s.snapshot.rows[0].sku.id].status,'failed'); const before=await f.businessHash(); await assert.rejects(()=>confirm(f,prepared),/photo/i); assert.equal(await f.businessHash(),before)
})
await test('Source-specific SKU mappings cannot silently move or outlive their Inventory variant', async f => {
  await f.sql.query('update public.products set has_variants=true where id=$1',[testId(2)]); const check=await research(f); const input=await inputFor(f,check); input.reviews[0]={...input.reviews[0],destination:'new',attributeName:'Colour',attributeValue:'Black'}; const s=await saveSourcingSelection(f.db,ACTOR,input); await confirm(f,s); const variantId=s.snapshot.rows[0].review.variantId!; await assert.rejects(()=>f.sql.query('delete from public.product_variants where id=$1',[variantId])); const guard=(await getSourcingWorkspace(f.db,input.itemId)).guard; const review=clone(input); review.reviews[0]={...review.reviews[0],destination:'new',variantId:randomUUID(),attributeValue:'Wrong mapping'}; assert(reviewSourcing(review,check,guard).rows[0].blockers.some(message=>message.includes('mapping')||message.includes('identity')))
})
await test('New sourcing tables deny anonymous and non-buyer reads and direct browser mutations', async f => {
  await saved(f)
  for(const name of ['import_reorder_1688_runs','import_reorder_1688_jobs','product_1688_preferences','product_1688_sku_links','import_reorder_1688_selections']) {
    const row=(await f.sql.query("select has_table_privilege('anon',$1,'select') a,has_table_privilege('authenticated',$1,'insert') i,has_table_privilege('authenticated',$1,'update') u",[`public.${name}`])).rows[0]; assert.deepEqual(row,{a:false,i:false,u:false})
  }
  await f.sql.query("select set_config('test.actor',$1,false)",[WRONG_ROLE]); await f.sql.exec('set role authenticated'); assert.equal((await f.sql.query('select count(*)::int n from public.product_1688_preferences')).rows[0].n,0); await f.sql.exec('reset role')
  for(const signature of ['public.import_1688_queue(uuid,text,uuid,uuid,jsonb)','public.import_1688_selection(uuid,text,uuid,integer,uuid,text,jsonb)','public.import_record_ordered_lines(uuid,uuid,jsonb,jsonb)']) { const row=(await f.sql.query("select has_function_privilege('authenticated',$1,'execute') allowed",[signature])).rows[0]; assert.equal(row.allowed,false) }
})

await test('Legacy buyer approval and supplier acceptance still use unchanged import arithmetic', async f => {
  const created=await createImportReorders(f.db,ACTOR,{requestKey:randomUUID(),selections:[{productId:testId(2),sourceImportId:testId(3),qty:100}]},f.catalogue)
  const id=created.requests[0].id;let current=await loadImportReorder(f.db,id)
  const draft={...current.draft,orderDate:'2026-09-10',terms:{...current.draft.terms,fxRate:7,sharedChinaFreight:0},lines:current.draft.lines.map(line=>({...line,chinaFreight:2,priceCny:5,priceMode:'net' as const,discountPercent:0}))}
  await mutateImportReorder(f.db,ACTOR,'save',{id,revision:current.revision,requestKey:randomUUID(),snapshot:draft});current=await loadImportReorder(f.db,id)
  await mutateImportReorder(f.db,ACTOR,'approve',{id,revision:current.revision,requestKey:randomUUID()});current=await loadImportReorder(f.db,id)
  const response={...current.requestedSnapshot!,lines:current.requestedSnapshot!.lines.map(line=>({...line,qty:80,priceCny:4}))}
  await mutateImportReorder(f.db,ACTOR,'response',{id,revision:current.revision,requestKey:randomUUID(),snapshot:response});current=await loadImportReorder(f.db,id)
  const command={id,revision:current.revision,requestKey:randomUUID(),accepted:true};const result=await mutateImportReorder(f.db,ACTOR,'confirm',command)
  assert.deepEqual(await mutateImportReorder(f.db,ACTOR,'confirm',command),result)
  const row=(await f.sql.query('select qty,total_payment_supplier_yuan,total_payment_supplier,import_cp from public.purchase_orders where id=$1',[result.imports[0].id])).rows[0]
  assert.deepEqual({qty:row.qty,cny:Number(row.total_payment_supplier_yuan),mur:Number(row.total_payment_supplier),landed:row.import_cp},{qty:80,cny:322,mur:2254,landed:null})
})
await test('Pending edits retain exact authored before and after review revisions', async f => {
  const check = await research(f); const firstInput = await inputFor(f, check); const first = await saveSourcingSelection(f.db, ACTOR, firstInput)
  const input = await inputFor(f, check); input.reviews[0].qty = 120
  const next = await saveSourcingSelection(f.db, ACTOR, input)
  const events = (await f.sql.query('select request_key,before_snapshot,after_snapshot,actor_id from public.import_purchase_events where request_key=any($1)', [[firstInput.requestKey,input.requestKey]])).rows
  assert.equal(events.find(e => e.request_key === firstInput.requestKey)!.before_snapshot, null)
  const edited = events.find(e => e.request_key === input.requestKey)!
  assert.equal(edited.before_snapshot.revision, first.revision); assert.equal(edited.before_snapshot.snapshot.orderedQty, 100)
  assert.equal(edited.after_snapshot.revision, next.revision); assert.equal(edited.after_snapshot.snapshot.orderedQty, 120); assert.equal(edited.actor_id, ACTOR)
})
await test('Prepared photo changes only the confirmed simple product and its new import snapshot', async f => {
  f.ports.provider.listing = (id: string) => f.call(`listing:${id}`, () => ({ ...listingFixture(id, id === '888888000000' ? '12' : '8'), imageUrl: 'https://cbu01.alicdn.com/reviewed-photo.jpg' }))
  const check = await f.run(); const input = await inputFor(f, check); input.reviews[0].keepPhoto = false
  const before = (await f.sql.query('select image_url,quantity,price from public.products where id=$1',[testId(2)])).rows[0]
  const original = (await f.sql.query('select to_jsonb(p) value from public.purchase_orders p where id=$1',[testId(3)])).rows[0].value
  const selection = await saveSourcingSelection(f.db,ACTOR,input)
  const prepared = await prepareSourcingPhotos(f.db,ACTOR,{id:selection.id,revision:selection.revision,requestKey:randomUUID(),skuIds:[selection.snapshot.rows[0].sku.id]},async()=>Buffer.from('immutable isolated image bytes'))
  assert.deepEqual((await f.sql.query('select image_url,quantity,price from public.products where id=$1',[testId(2)])).rows[0],before)
  const result = await confirm(f,prepared); const image = prepared.photos[selection.snapshot.rows[0].sku.id].url
  assert.equal(f.imageFiles.size,1); assert.equal((await f.sql.query('select image_url from public.products where id=$1',[testId(2)])).rows[0].image_url,image)
  const purchase = (await f.sql.query('select image_url,variant_snapshot from public.purchase_orders where id=$1',[result.imports[0].id])).rows[0]
  assert.equal(purchase.image_url,image); assert.equal(purchase.variant_snapshot.imageUrl,image)
  assert.deepEqual((await f.sql.query('select to_jsonb(p) value from public.purchase_orders p where id=$1',[testId(3)])).rows[0].value,original)
  assert.deepEqual((await f.sql.query('select quantity,price from public.products where id=$1',[testId(2)])).rows[0],{quantity:before.quantity,price:before.price})
})
await test('Image preparation is bounded and identical source photos reuse one immutable file', async f => {
  await f.sql.query('update public.products set has_variants=true,quantity=0 where id=$1',[testId(2)])
  f.ports.provider.listing=(id:string)=>f.call(`listing:${id}`,()=>{const offer=listingFixture(id,'8',id==='888888000001'?2:1);offer.skus=offer.skus.map(sku=>({...sku,imageUrl:'https://cbu01.alicdn.com/shared-photo.jpg'}));return offer})
  const check=await f.run();const input=await inputFor(f,check);input.reviews=input.reviews.map((row,index)=>({...row,include:true,destination:'new',attributeName:'Colour / Size',attributeValue:index?'Black / 60cm':'Black / 30cm',keepPhoto:false,qty:index?100:null}))
  const s=await saveSourcingSelection(f.db,ACTOR,input);let downloads=0;const download=async()=>{downloads++;return Buffer.from('shared immutable bytes')}
  await assert.rejects(()=>prepareSourcingPhotos(f.db,ACTOR,{id:s.id,revision:s.revision,requestKey:randomUUID(),skuIds:Array.from({length:5},()=>s.snapshot.rows[0].sku.id)},download));assert.equal(downloads,0)
  const prepared=await prepareSourcingPhotos(f.db,ACTOR,{id:s.id,revision:s.revision,requestKey:randomUUID(),skuIds:s.snapshot.rows.map(row=>row.sku.id)},download)
  assert.equal(downloads,1);assert.equal(f.imageFiles.size,1);await confirm(f,prepared)
  const variants=(await f.sql.query('select image_url,quantity,price_override from public.product_variants')).rows
  assert.equal(variants.length,2);assert(variants.every(v=>v.image_url===prepared.photos[s.snapshot.rows[0].sku.id].url&&v.quantity===0&&v.price_override===null))
})
await test('An import-write failure rolls back newly created variants, links and photos together', async f => {
  await f.sql.query('update public.products set has_variants=true,quantity=0 where id=$1',[testId(2)])
  const check=await research(f);const input=await inputFor(f,check);input.reviews=input.reviews.map(row=>({...row,destination:'new',attributeName:'Colour / Size',attributeValue:'Black / 60cm'}))
  const s=await saveSourcingSelection(f.db,ACTOR,input);const before=await f.businessHash()
  await f.sql.exec("create function public.qa_fail_import() returns trigger language plpgsql as $$ begin raise exception 'Isolated insert failure'; end $$; create trigger qa_fail_import before insert on public.purchase_orders for each row execute function public.qa_fail_import()")
  try { await assert.rejects(()=>confirm(f,s));assert.equal(await f.businessHash(),before);assert.equal((await f.sql.query('select count(*)::int n from public.product_1688_sku_links')).rows[0].n,0);assert.equal((await getSourcingWorkspace(f.db,s.item_id)).selection?.status,'pending') }
  finally { await f.sql.exec('drop trigger qa_fail_import on public.purchase_orders; drop function public.qa_fail_import()') }
})
await test('Explicit dispatch recovery never creates another accepted job or spends during status reads', async f => {
  const {run}=await queue(f,[0,1]);await queueMutation(f.db,ACTOR,'dispatch-failed',run.id)
  const before=f.writes.length;assert.equal((await loadResearchQueue(f.db)).runs[0].status,'dispatch_unknown');assert.equal(f.writes.length,before)
  const retried=await queueMutation(f.db,OTHER_BUYER,'redispatch',run.id);assert.equal(retried.run?.id,run.id);assert.equal(f.providerCalls.length,0)
  const first=await own(f,run.id);const duplicate=await own(f,run.id);assert.equal(duplicate.owned,false);await drain(f,first.ids,first.workflowId)
  assert.equal((await loadResearchQueue(f.db)).jobs.length,2)
})
await test('Removed interest rows become stale without dispatching a new paid check', async f => {
  const {run}=await queue(f);const owner=await own(f,run.id);await f.sql.query("update public.import_reorder_items set status='excluded',revision=revision+1 where id=$1",[testId(4)])
  await advance(f,owner.ids[0],owner.workflowId);assert.equal(f.providerCalls.length,0);assert.equal((await loadResearchQueue(f.db)).jobs[0].status,'stale')
})
await test('A later fresh check cannot replace the evidence preserved with a saved proposal', async f => {
  const s=await saved(f);const preserved=stableEvidence(s.snapshot.check);await f.run()
  const restored=(await getSourcingWorkspace(f.db,s.item_id)).selection!;assert.equal(stableEvidence(restored.snapshot.check),preserved);assert.equal(sourcingPurchasePreview(restored,terms).goods,800)
  const result=await confirm(f,restored);assert.equal(result.imports.length,1)
})
await test('Confirmed source mappings are reused by supplier identity, never by equal price', async f => {
  const s=await saved(f);await confirm(f,s);const workspace=await getSourcingWorkspace(f.db,s.item_id)
  const reviews=initialSkuReviews(s.snapshot.check,s.snapshot.source,workspace.guard);assert.equal(reviews[0].destination,'parent');assert.equal(reviews[0].qty,null)
  const unrelated=clone(s.snapshot.source);unrelated.offerId='999999000000';assert.equal(initialSkuReviews(s.snapshot.check,unrelated,workspace.guard)[0].destination,'review')
})

await fixture.close()
globalThis.fetch = fetchBefore
console.log(`\nIsolated sourcing checks: ${passed} passed, ${failed} failed. No live business writes or paid provider calls.`)
process.exitCode = failed ? 1 : 0
