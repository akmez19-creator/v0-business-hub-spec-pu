import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'
import { fetchAll } from '../lib/supabase/fetch-all.ts'
import { emptyReorderSnapshot, emptyReorderTerms, newReorderLine, purchasingToday, type ReorderSnapshot, type ImportReference } from '../lib/purchase-orders/workflow.ts'
import { allocateMoney, calculateReorder, legacyConfirmedAmounts } from '../lib/purchase-orders/reorder-calculations.ts'
import { copyImportReference, clearSupplierReference, reviewImportReferences, referenceIsEstimate } from '../lib/purchase-orders/reorder-reference.ts'
import { suggestedQuantity, stockGuidance } from '../lib/purchase-orders/reorder-suggestions.ts'
import { supplierRequestRows } from '../lib/purchase-orders/reorder-export.ts'
import { createImportReorders, loadImportReorder, loadReorderCatalogue, loadReorderWorkspace, mutateImportReorder, saveReorderItem, saveReorderSettings, loadPurchaseEvents } from '../lib/purchase-orders/reorder-service.ts'
import { correctImportRecord, loadImportForCorrection } from '../lib/purchase-orders/import-correction-service.ts'

const mode=process.argv[2]||'--pure'
let passed=0
async function test(name:string,run:()=>unknown|Promise<unknown>){await run();passed++;console.log(`PASS ${name}`)}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const sample=():ReorderSnapshot=>({...emptyReorderSnapshot(),supplierName:'Test China supplier',orderDate:'2026-09-09',terms:{...emptyReorderTerms(),fxRate:7,sharedChinaFreight:30,importFreightMur:600,otherChargesMur:90},lines:[
 {...newReorderLine({id:randomUUID(),name:'A'}),qty:10,priceCny:5,chinaFreight:20,unitsPerCarton:5,kgPerUnit:.2,cbmPerUnit:.01},
 {...newReorderLine({id:randomUUID(),name:'B'}),qty:20,priceCny:3,priceMode:'discount',discountPercent:10,chinaFreight:.5,chinaFreightBasis:'unit',cbmPerUnit:.01},
]})
const reference=(id:string,cost:number):ImportReference=>({id,product_id:'p',product_name:'Historical wording',supplier_name:'Supplier',index_no:'ABC',link:'https://detail.1688.com/offer/123.html',image_url:null,status:'Received',qty:500,unit_price:5,discounted_unit_price:4,shipment_to_warehouse:20,discounted_shipment_to_warehouse:0,discounted_percentage:-20,total_payment_supplier_yuan:2020,total_payment_supplier:14140,weight_kg:100,cbm:.5,boxes:10,import_cp:cost,created_at:'2026-08-20T00:00:00Z'})

await test('manual planning formula: 140 units, or 150 with a verified 50-unit multiple',()=>{assert.deepEqual(suggestedQuantity(90/30,40,20,30,10,50),{baseline:140,rounded:150})})
await test('missing settings and unknown zero do not become made-up quantities',()=>{assert.equal(suggestedQuantity(3,null,20,30,10).rounded,null);assert.equal(suggestedQuantity(3,40,null,30,10).rounded,null);const row=stockGuidance({id:'p',name:'P',quantity:0,sold_out:false,last_counted_at:null,zone:null,is_active:true},[],[]);assert.equal(row.stock,null);assert.equal(row.suggestedQty,null)})
await test('CNY, FX, shared freight and landed amounts reconcile to actual values',()=>{const result=calculateReorder(sample());assert.equal(result.supplierCny,164);assert.equal(result.supplierMur,1148);assert.equal(result.landed,1838);assert.equal(result.lines[0].landed,790);assert.equal(result.lines[1].landed,1048)})
await test('changing quantity updates per-unit freight, cartons, CBM and totals',()=>{const s=sample();s.lines[0].qty=13;const result=calculateReorder(s);assert.equal(result.lines[0].cartons,3);assert.equal(result.lines[0].cbm,.13);s.terms.importFreightMode='cbm';s.terms.cbmRateMur=10000;assert.equal(calculateReorder(s).freight,3300)})
await test('net prices are never discounted twice',()=>{const s=sample();s.lines[1].priceMode='net';assert.equal(calculateReorder(s).lines[1].goods,60)})
await test('unknown freight stays unknown; complete estimates stay out of actual landed columns',()=>{const s=sample();s.terms.importFreightMur=null;assert.equal(calculateReorder(s).landed,null);assert.equal(legacyConfirmedAmounts(s)[0].import_cp,null);const complete=sample();assert.equal(legacyConfirmedAmounts(complete)[0].import_cp,null);complete.terms.landedReviewed=true;assert.equal(legacyConfirmedAmounts(complete)[0].import_cp,79)})
await test('shared-charge allocation reconciles cents exactly',()=>{assert.deepEqual(allocateMoney(.01,[1,1,1]),[.01,0,0]);assert.equal(allocateMoney(123.45,[3,7,11]).reduce((a,b)=>a+Math.round((b??0)*100),0),12345)})
await test('source prefill keeps manual quantity; stock and customer data are not inputs',()=>{const line={...newReorderLine({id:'p',name:'Current'}),qty:100};const copy=copyImportReference(line,reference('r',10));assert.equal(copy.qty,100);assert.equal(copy.priceCny,4);assert.equal(copy.discountPercent,0);assert.equal(copy.unitsPerCarton,null);assert.equal(clearSupplierReference(copy).qty,100);assert.equal(clearSupplierReference(copy).priceCny,null);assert.equal((copy as unknown as {tracking_number?:unknown}).tracking_number,undefined)})
await test('variant prices are not guessed from parent imports',()=>{const line={...newReorderLine({id:'p',name:'Current'}),variantId:'variant'};const copy=copyImportReference(line,reference('r',10));assert.equal(copy.priceCny,null);assert.equal(copy.cbmPerUnit,null)})
await test("a product with no own import can borrow every cost column from another product's import as an estimate",()=>{const line=newReorderLine({id:'flynova',name:'Flynova PRO Spinner'});const copy=copyImportReference(line,reference('other-import',12));assert.ok(referenceIsEstimate(copy),'a different product is an estimate');assert.equal(copy.sourceImportId,'other-import');assert.equal(copy.priceCny,4);assert.equal(copy.chinaFreight,20);assert.equal(copy.kgPerUnit,100/500);assert.equal(copy.cbmPerUnit,.5/500);assert.equal(copy.productName,'Flynova PRO Spinner','the line stays the chosen product, not the reference');assert.equal(copy.supplierLabel,'Flynova PRO Spinner','a different product name never relabels the line');assert.equal(copy.listingUrl,'',"a different product's listing link is not copied");assert.equal(copy.qty,null,'quantity is the buyer’s to set')})
await test('a suspect cross-product cost is still never seeded automatically',()=>{const rows=reviewImportReferences([reference('a',10),reference('b',11),reference('spike',4000)]);const copy=copyImportReference(newReorderLine({id:'flynova',name:'Flynova PRO Spinner'}),rows.find((row)=>row.id==='spike')!);assert.ok(referenceIsEstimate(copy));assert.equal(copy.priceCny,null,'a >4× outlier price is refused even cross-product');assert.equal(copy.chinaFreight,20,'non-price columns still populate as an estimate')})
await test('the established cost outlier guard rejects the wrong expensive reference',()=>{const rows=reviewImportReferences([reference('a',131.43),reference('b',133.56),reference('wrong',3104.55)]);assert.ok(rows.find((row)=>row.id==='wrong')!.referenceWarning);assert.equal(copyImportReference(newReorderLine({id:'p',name:'P'}),rows[2]).priceCny,null)})
await test('supplier exports include shared freight once and no internal costs or sales data',()=>{const s=sample();s.lines[0].supplierLabel='=DANGEROUS()';const rows=supplierRequestRows('IR-QA',s);assert.ok(String(rows[0].Product).startsWith("'="));assert.equal(rows[0]['Shared China freight (CNY, once per request)'],30);assert.equal(rows[1]['Shared China freight (CNY, once per request)'],'');assert.ok(!JSON.stringify(rows).match(/landed|stockOnHand|selling|customerId/i))})
await test('complete dataset paging survives 1,000 rows',async()=>{const rows=Array.from({length:2301},(_,id)=>({id}));const all=await fetchAll((from,to)=>Promise.resolve({data:rows.slice(from,to+1),error:null}),500);assert.equal(all.length,2301);assert.equal(new Set(all.map((row)=>row.id)).size,2301)})
await test('new workflow never queries client orders or deliveries',async()=>{for(const name of ['reorder-service.ts','reorder-suggestions.ts','import-correction-service.ts']){const source=await readFile(new URL(`../lib/purchase-orders/${name}`,import.meta.url),'utf8');assert.ok(!/\.from\(['"](?:deliveries|orders)['"]\)/.test(source));assert.ok(!/localStorage/.test(source))}})

if(mode==='--pure'){console.log(`${passed} import reorder checks passed.`);process.exit(0)}
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}})
const must=<T extends {error:unknown}>(response:T):T=>{if(response.error)throw response.error;return response}

if(mode==='--read-only'){
 await test('all actual imports are visible, with original 3,000-unit Pest Repellent history',async()=>{const cat=await loadReorderCatalogue(db);const count=must(await db.from('purchase_orders').select('id',{count:'exact',head:true})).count;assert.equal(cat.references.length,count);assert.ok(cat.references.some((row)=>row.qty===3000&&/pest/i.test(row.product_name||'')));const workspace=await loadReorderWorkspace(db,cat);assert.ok(Array.isArray(workspace.savedItems));console.log(`Loaded ${cat.references.length} real imports and ${cat.products.length} active catalogue products.`)})
 console.log(`${passed} checks passed.`);process.exit(0)
}
assert.equal(process.env.IMPORT_REORDER_QA_APPROVED,'1','Live fixtures require explicit approval.')
const registry='/tmp/import-reorder-qa.json'
type Fixture={tag:string;managerId:string;agentId:string;email:string;productIds:string[];sourceId:string;browserDraftId?:string;startedAt?:string;baseline?:{products:string;deliveries:string;payments:string;imports:string;importCount:number}}
async function cleanup(state:Fixture){
 assert.match(state.tag,/^IR-QA-[a-f0-9]{8}$/)
 const actors=[state.managerId,state.agentId].filter(Boolean)
 for(const id of actors){
  const response=await db.auth.admin.getUserById(id)
  if(response.data.user)assert.equal(response.data.user.app_metadata.import_reorder_qa,state.tag,'Never delete an unregistered user')
  else if(response.error&&response.error.status!==404)throw response.error
 }
 if(state.productIds.length){
  const products=must(await db.from('products').select('id,name').in('id',state.productIds)).data??[]
  assert.ok(products.every((product)=>product.name.startsWith(`${state.tag} `)),'Never delete an unregistered product')
 }
 must(await db.from('purchase_orders').delete().eq('id',state.sourceId))
 if(state.productIds.length)must(await db.from('purchase_orders').delete().in('product_id',state.productIds))
 if(actors.length){
  const reorders=must(await db.from('import_reorders').select('id').in('created_by',actors)).data??[]
  must(await db.from('import_purchase_events').delete().in('actor_id',actors))
  must(await db.from('import_reorder_items').delete().in('created_by',actors))
  if(reorders.length)must(await db.from('import_reorder_lines').delete().in('reorder_id',reorders.map((row)=>row.id)))
  must(await db.from('import_reorders').delete().in('created_by',actors))
 }
 if(state.productIds.length){
  must(await db.from('import_reorder_settings').delete().in('product_id',state.productIds))
  must(await db.from('product_variants').delete().in('product_id',state.productIds))
  must(await db.from('products').delete().in('id',state.productIds))
 }
 for(const id of actors){const result=await db.auth.admin.deleteUser(id);if(result.error&&result.error.status!==404)throw result.error}
 console.log('Removed only the registered QA buyers, products, imports and reorder fixtures.')
}
async function fixtureStartedAt(state:Fixture){
 if(!state.startedAt){
  const user=must(await db.auth.admin.getUserById(state.managerId)).data.user!
  assert.equal(user.app_metadata.import_reorder_qa,state.tag)
  state.startedAt=user.created_at
 }
 return state.startedAt
}
async function checkBrowserIsolation(state:Fixture){
 assert.ok(state.baseline,'This fixture has no browser isolation baseline')
 const products=(await fetchAll<{id:string}>((from,to)=>db.from('products').select('id,quantity,cost_price,price,updated_at').order('id').range(from,to))).filter((row)=>!state.productIds.includes(row.id))
 const imports=(await fetchAll<{product_id:string|null}>((from,to)=>db.from('purchase_orders').select('id,product_id,status,qty,import_cp,total_cp_import,total_payment_supplier_yuan,total_payment_supplier,updated_at').order('id').range(from,to))).filter((row)=>!state.productIds.includes(row.product_id??''))
 assert.equal(digest(products),state.baseline.products,'Original product quantities or prices changed')
 assert.equal(digest(imports),state.baseline.imports,'Original import records changed')
 assert.equal(imports.length,state.baseline.importCount)
 const deliveries=await fetchAll<{id:string}>((from,to)=>db.from('deliveries').select('id,status,qty,updated_at').order('id').range(from,to))
 let liveAdditions=0
 if(digest(deliveries)!==state.baseline.deliveries){
  const startedAt=await fixtureStartedAt(state)
  const newer=await fetchAll<{id:string;created_by:string|null}>((from,to)=>db.from('deliveries').select('id,created_by').gte('created_at',startedAt).order('id').range(from,to))
  const externalIds=new Set(newer.filter((row)=>row.created_by!=null&&![state.managerId,state.agentId].includes(row.created_by)).map((row)=>row.id))
  const originalDeliveries=deliveries.filter((row)=>!externalIds.has(row.id))
  assert.equal(digest(originalDeliveries),state.baseline.deliveries,'Original deliveries changed; newer external entries do not explain the difference')
  liveAdditions=deliveries.length-originalDeliveries.length
 }
 assert.equal(digest(await fetchAll((from,to)=>db.from('payment_transactions').select('id,transaction_type,amount,reference_type,reference_id,status').order('id').range(from,to))),state.baseline.payments,'Existing payments changed')
 console.log(`Verified ${imports.length} original imports, original product quantities/prices, original deliveries and every payment remain unchanged.`)
 if(liveAdditions)console.log(`Preserved ${liveAdditions} new deliveries entered by other users during QA. They were never test fixtures.`)
}
if(mode==='--assert-isolation'){await checkBrowserIsolation(JSON.parse(await readFile(registry,'utf8')) as Fixture);process.exit(0)}
if(mode==='--cleanup'){const state=JSON.parse(await readFile(registry,'utf8')) as Fixture;await fixtureStartedAt(state);await writeFile(registry,JSON.stringify(state));await cleanup(state);if(state.baseline)await checkBrowserIsolation(state);process.exit(0)}
assert.ok(['--live','--prepare-browser'].includes(mode),'Unknown verification mode.')
const password=process.env.IMPORT_REORDER_QA_PASSWORD
assert.ok(password&&password.length>=16,'Set a one-use QA password for the isolated test buyers.')
const state:Fixture={tag:`IR-QA-${randomUUID().slice(0,8)}`,managerId:'',agentId:'',email:'',productIds:[],sourceId:randomUUID()}
const persist=()=>writeFile(registry,JSON.stringify(state))
const ownerBefore=digest(await fetchAll((from,to)=>db.from('products').select('id,quantity,cost_price,price,updated_at').order('id').range(from,to)))
const deliveriesBefore=digest(await fetchAll((from,to)=>db.from('deliveries').select('id,status,qty,updated_at').order('id').range(from,to)))
const paymentsBefore=digest(await fetchAll((from,to)=>db.from('payment_transactions').select('id,transaction_type,amount,reference_type,reference_id,status').order('id').range(from,to)))
const originalImportsBefore=digest(await fetchAll((from,to)=>db.from('purchase_orders').select('id,product_id,status,qty,import_cp,total_cp_import,total_payment_supplier_yuan,total_payment_supplier,updated_at').order('id').range(from,to)))
const importBefore=must(await db.from('purchase_orders').select('id',{count:'exact',head:true})).count!
state.baseline={products:ownerBefore,deliveries:deliveriesBefore,payments:paymentsBefore,imports:originalImportsBefore,importCount:importBefore}
let keep=false
try{
 for(const role of ['manager','marketing_agent']){
  const email=`${state.tag.toLowerCase()}-${role}@example.com`
  const {data}=must(await db.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{name:`${state.tag} ${role}`},app_metadata:{import_reorder_qa:state.tag}}))
  assert.ok(data.user)
  if(role==='manager'){state.managerId=data.user.id;state.email=email}else state.agentId=data.user.id
  await persist()
  must(await db.from('profiles').update({role,name:`${state.tag} ${role}`,approved:true,email_verified:true}).eq('id',data.user.id))
 }
 for(let n=0;n<3;n++){const id=randomUUID();state.productIds.push(id);await persist();must(await db.from('products').insert({id,name:`${state.tag} item ${n+1}`,is_active:true,quantity:n===2?900:0,sold_out:n!==2,cost_price:7,price:9999}))}
 const variantIds=[randomUUID(),randomUUID()]
 must(await db.from('product_variants').insert(variantIds.map((id,index)=>({id,product_id:state.productIds[2],attribute_name:'Size',attribute_value:index?'Large':'Small',quantity:index?27:13,is_active:true,price_override:9999}))))
 must(await db.from('purchase_orders').insert({id:state.sourceId,product_id:state.productIds[0],product_name:`${state.tag} supplier wording`,supplier_name:`${state.tag} Supplier`,status:'Received',index_no:`${state.tag}-source`,qty:10,unit_price:5,discounted_unit_price:4,shipment_to_warehouse:20,discounted_percentage:-20,import_cp:6.5,order_date:'2026-08-01'}))
 const originalSource=await loadImportForCorrection(db,state.sourceId)
 const create={requestKey:randomUUID(),selections:[{productId:state.productIds[0],sourceImportId:state.sourceId,qty:100}]}
 const created=await createImportReorders(db,state.managerId,create)
 const id=created.requests[0].id
 await test('draft creation is idempotent and does not create incoming import rows',async()=>{assert.deepEqual(await createImportReorders(db,state.managerId,create),created);assert.equal(must(await db.from('purchase_orders').select('id',{count:'exact',head:true})).count,importBefore+1);await assert.rejects(()=>createImportReorders(db,state.managerId,{...create,selections:[{...create.selections[0],qty:999}]}),/different content/);const row=await loadImportReorder(db,id);assert.equal(row.draft.lines[0].qty,100);assert.equal(row.draft.lines[0].priceCny,4)})
 let current=await loadImportReorder(db,id)
 await test('settings and saved-list refreshes preserve the manual draft quantity',async()=>{await saveReorderSettings(db,state.managerId,{id:randomUUID(),productId:state.productIds[0],supplierName:null,leadDays:20,coverDays:30,bufferDays:10,dailyUnits:3,quantityMultiple:50,revision:0,requestKey:randomUUID()});const item={id:randomUUID(),revision:0,item:{...current.draft.lines[0],qty:123},supplierName:current.draft.supplierName,status:'active' as const,priority:1,reviewDate:null,requestKey:randomUUID()};await saveReorderItem(db,state.managerId,item);const cat=await loadReorderCatalogue(db);const workspace=await loadReorderWorkspace(db,cat);assert.equal(workspace.savedItems.find((row)=>row.id===item.id)?.item.qty,123);assert.equal((await loadImportReorder(db,id)).draft.lines[0].qty,100);assert.equal(workspace.guidance.find((row)=>row.productId===state.productIds[0])?.suggestedQty,200)})
 await test('wrong-role buyers and direct untrusted RPC callers are rejected',async()=>{await assert.rejects(()=>createImportReorders(db,state.agentId,{requestKey:randomUUID(),selections:[],supplierName:'Denied'}),/Not allowed/);const anon=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}});const result=await anon.rpc('import_reorder_mutate',{p_actor:state.managerId,p_id:id,p_revision:current.revision,p_key:randomUUID(),p_hash:'forged',p_operation:'approve',p_payload:{}});assert.ok(result.error)})
 const draft={...current.draft,terms:{...emptyReorderTerms(),fxRate:7,sharedChinaFreight:0},lines:current.draft.lines.map((line)=>({...line,chinaFreight:2,priceCny:5}))}
 await mutateImportReorder(db,state.managerId,'save',{id,revision:current.revision,requestKey:randomUUID(),snapshot:draft})
 current=await loadImportReorder(db,id)
 await mutateImportReorder(db,state.managerId,'approve',{id,revision:current.revision,requestKey:randomUUID()})
 current=await loadImportReorder(db,id)
 await test('buyer approval preserves request but creates no import',async()=>{assert.equal(current.status,'awaiting_supplier');assert.equal(current.requestedSnapshot!.lines[0].qty,100);assert.equal(must(await db.from('purchase_orders').select('id',{count:'exact',head:true})).count,importBefore+1)})
 const response={...current.requestedSnapshot!,orderDate:purchasingToday(),lines:current.requestedSnapshot!.lines.map((line)=>({...line,qty:80,priceCny:4}))}
 await mutateImportReorder(db,state.managerId,'response',{id,revision:current.revision,requestKey:randomUUID(),snapshot:response})
 current=await loadImportReorder(db,id)
 await test('supplier response changes do not overwrite the buyer request',()=>{assert.equal(current.requestedSnapshot!.lines[0].qty,100);assert.equal(current.supplierSnapshot!.lines[0].qty,80)})
 const confirm={id,revision:current.revision,requestKey:randomUUID(),accepted:true}
 const confirmed=await mutateImportReorder(db,state.managerId,'confirm',confirm)
 const importedId=confirmed.imports![0].id
 await test('acceptance creates one correctly priced import and retry creates none',async()=>{const po=await loadImportForCorrection(db,importedId);assert.equal(po.qty,80);assert.equal(po.status,'Ordered');assert.equal(po.total_payment_supplier_yuan,322);assert.equal(po.total_payment_supplier,2254);assert.equal(po.import_cp,null);assert.equal(po.total_cp_import,null);assert.equal(po.tracking_number,null);assert.deepEqual(await mutateImportReorder(db,state.managerId,'confirm',confirm),confirmed);assert.equal(must(await db.from('purchase_orders').select('id',{count:'exact',head:true})).count,importBefore+2);await assert.rejects(()=>mutateImportReorder(db,state.managerId,'confirm',{...confirm,requestKey:randomUUID()}));assert.deepEqual(await loadImportForCorrection(db,state.sourceId),originalSource)})
 await test('correction preserves unrelated raw values and rejects a stale legacy write',async()=>{const before=await loadImportForCorrection(db,importedId);const input={id:importedId,requestKey:randomUUID(),expected:before,patch:{product_name:`${state.tag} corrected wording`},reason:'QA: correct wording only',acknowledged:true};const changed=await correctImportRecord(db,state.managerId,input);assert.deepEqual(await correctImportRecord(db,state.managerId,input),changed);const after=await loadImportForCorrection(db,importedId);for(const key of Object.keys(before))if(!['product_name','updated_at'].includes(key))assert.deepEqual(after[key],before[key],key);must(await db.from('purchase_orders').update({carton:'QA raw legacy writer'}).eq('id',importedId));await assert.rejects(()=>correctImportRecord(db,state.managerId,{...input,requestKey:randomUUID(),expected:after,patch:{tracking_number:'should-not-save'}}),/changed/);assert.equal((await loadImportForCorrection(db,importedId)).tracking_number,null);assert.ok((await loadPurchaseEvents(db,importedId,'import')).some((event)=>event.eventType==='correction'))})
 await test('correcting a source import never changes the approved reorder snapshots',async()=>{
  const before=await loadImportForCorrection(db,state.sourceId)
  const snapshotBefore=(await loadImportReorder(db,id)).requestedSnapshot
  await correctImportRecord(db,state.managerId,{id:state.sourceId,requestKey:randomUUID(),expected:before,patch:{product_name:`${state.tag} source correction`},reason:'QA source wording correction only',acknowledged:true})
  assert.deepEqual((await loadImportReorder(db,id)).requestedSnapshot,snapshotBefore)
  assert.equal((await loadImportReorder(db,id)).requestedSnapshot!.lines[0].sourceSnapshot!.product_name,originalSource.product_name)
 })
 await test('confirmation replay cannot recreate a deleted linked test import',async()=>{
  must(await db.from('purchase_orders').delete().eq('id',importedId).eq('product_id',state.productIds[0]))
  const count=must(await db.from('purchase_orders').select('id',{count:'exact',head:true})).count
  assert.deepEqual(await mutateImportReorder(db,state.managerId,'confirm',confirm),confirmed)
  await assert.rejects(()=>mutateImportReorder(db,state.managerId,'confirm',{...confirm,requestKey:randomUUID()}))
  assert.equal(must(await db.from('purchase_orders').select('id',{count:'exact',head:true})).count,count)
 })
 await test('variant stock is counted once without its 900-unit parent quantity',async()=>{
  const cat=await loadReorderCatalogue(db)
  const workspace=await loadReorderWorkspace(db,cat)
  assert.equal(workspace.guidance.find((row)=>row.productId===state.productIds[2])?.stock,40)
 })
 await test('anonymous and non-buyer clients cannot read or mutate purchasing workflows',async()=>{
  for(const role of ['anonymous','marketing_agent'] as const){
   const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}})
   if(role==='marketing_agent')must(await client.auth.signInWithPassword({email:`${state.tag.toLowerCase()}-marketing_agent@example.com`,password}))
   try{
    const read=await client.from('import_reorders').select('id').eq('id',id)
    assert.ok(read.error||read.data?.length===0)
    const forged=await client.rpc('import_reorder_mutate',{p_actor:state.managerId,p_id:id,p_revision:1,p_key:randomUUID(),p_hash:'forged',p_operation:'save',p_payload:{}})
    assert.ok(forged.error)
   }finally{if(role==='marketing_agent')must(await client.auth.signOut())}
  }
 })
 await test('requests from different suppliers are separated without creating imports',async()=>{
  const split=await createImportReorders(db,state.managerId,{requestKey:randomUUID(),supplierName:`${state.tag} Other supplier`,selections:[{productId:state.productIds[0],sourceImportId:state.sourceId,qty:12},{productId:state.productIds[1],qty:17}]})
  assert.equal(split.requests.length,2)
  const requests=await Promise.all(split.requests.map((request)=>loadImportReorder(db,request.id)))
  assert.equal(new Set(requests.map((request)=>request.draft.supplierName)).size,2)
  assert.ok(requests.every((request)=>request.draft.lines.length===1&&request.status==='draft'))
 })
 await test('concurrent saves reject one stale revision without mixing the drafts',async()=>{
  const created=await createImportReorders(db,state.managerId,{requestKey:randomUUID(),supplierName:`${state.tag} Concurrent supplier`,selections:[{productId:state.productIds[1],qty:11}]})
  const row=await loadImportReorder(db,created.requests[0].id)
  const results=await Promise.allSettled([31,47].map((qty)=>mutateImportReorder(db,state.managerId,'save',{id:row.id,revision:row.revision,requestKey:randomUUID(),snapshot:{...row.draft,lines:row.draft.lines.map((line)=>({...line,qty}))}})))
  assert.equal(results.filter((result)=>result.status==='fulfilled').length,1)
  assert.equal(results.filter((result)=>result.status==='rejected').length,1)
  const saved=await loadImportReorder(db,row.id)
  assert.equal(saved.revision,row.revision+1)
  assert.ok([31,47].includes(saved.draft.lines[0].qty!))
 })
 await test('a failing second import line rolls back the first line and leaves approval intact',async()=>{
  const created=await createImportReorders(db,state.managerId,{requestKey:randomUUID(),supplierName:`${state.tag} Atomic supplier`,selections:[{productId:state.productIds[0],qty:3},{productId:state.productIds[1],qty:7}]})
  let row=await loadImportReorder(db,created.requests[0].id)
  await mutateImportReorder(db,state.managerId,'approve',{id:row.id,revision:row.revision,requestKey:randomUUID()})
  row=await loadImportReorder(db,row.id)
  const supplier={...row.requestedSnapshot!,orderDate:purchasingToday(),lines:row.requestedSnapshot!.lines.map((line)=>({...line,priceCny:4,chinaFreight:0})),terms:{...emptyReorderTerms(),fxRate:7,sharedChinaFreight:0}}
  await mutateImportReorder(db,state.managerId,'response',{id:row.id,revision:row.revision,requestKey:randomUUID(),snapshot:supplier})
  row=await loadImportReorder(db,row.id)
  const count=must(await db.from('purchase_orders').select('id',{count:'exact',head:true})).count
  const imports=legacyConfirmedAmounts(row.supplierSnapshot!)
  const failure=await db.rpc('import_reorder_mutate',{p_actor:state.managerId,p_id:row.id,p_revision:row.revision,p_key:randomUUID(),p_hash:'QA atomic rollback',p_operation:'confirm',p_payload:{accepted:true,snapshot:row.supplierSnapshot,imports:[imports[0],{...imports[1],unit_price:1e20}]}})
  assert.ok(failure.error)
  assert.equal(must(await db.from('purchase_orders').select('id',{count:'exact',head:true})).count,count)
  assert.equal((await loadImportReorder(db,row.id)).revision,row.revision)
  assert.ok(must(await db.from('import_reorder_lines').select('created_import_id').eq('reorder_id',row.id)).data!.every((line)=>line.created_import_id===null))
  const result=await mutateImportReorder(db,state.managerId,'confirm',{id:row.id,revision:row.revision,requestKey:randomUUID(),accepted:true})
  assert.equal(result.imports!.length,2)
  assert.equal(must(await db.from('purchase_orders').select('id',{count:'exact',head:true})).count,count!+2)
 })
 await test('changing a saved variant does not reuse the old variant quotation',async()=>{
  const itemId=randomUUID()
  const item={...newReorderLine({id:state.productIds[2],name:`${state.tag} item 3`}),variantId:variantIds[0],qty:100,priceCny:8,chinaFreight:15,kgPerUnit:.5,cbmPerUnit:.02,unitsPerCarton:20}
  await saveReorderItem(db,state.managerId,{id:itemId,revision:0,requestKey:randomUUID(),item,supplierName:`${state.tag} Variant supplier`,status:'active',priority:2,reviewDate:null})
  const created=await createImportReorders(db,state.managerId,{requestKey:randomUUID(),selections:[{productId:state.productIds[2],savedItemId:itemId,variantId:variantIds[1],qty:100}]})
  const row=await loadImportReorder(db,created.requests[0].id)
  assert.equal(row.draft.lines[0].qty,100)
  assert.equal(row.draft.lines[0].variantId,variantIds[1])
  assert.equal(row.draft.lines[0].priceCny,null)
  assert.equal(row.draft.lines[0].kgPerUnit,null)
  assert.equal(row.draft.lines[0].unitsPerCarton,null)
 })
 await test('all original product quantities and selling prices, plus every delivery, are unchanged',async()=>{const ownerAfter=digest((await fetchAll<{id:string}>((from,to)=>db.from('products').select('id,quantity,cost_price,price,updated_at').order('id').range(from,to))).filter((row)=>!state.productIds.includes(row.id)));assert.equal(ownerAfter,ownerBefore);assert.equal(digest(await fetchAll((from,to)=>db.from('deliveries').select('id,status,qty,updated_at').order('id').range(from,to))),deliveriesBefore);for(const productId of state.productIds){const row=must(await db.from('products').select('quantity,price,cost_price').eq('id',productId).single()).data;assert.deepEqual(row,{quantity:productId===state.productIds[2]?900:0,price:9999,cost_price:7})}})
 await test('original import quantities, costs and all payment records are unchanged',async()=>{
  assert.equal(digest(await fetchAll((from,to)=>db.from('payment_transactions').select('id,transaction_type,amount,reference_type,reference_id,status').order('id').range(from,to))),paymentsBefore)
  const originals=(await fetchAll<{id:string;product_id:string|null}>((from,to)=>db.from('purchase_orders').select('id,product_id,status,qty,import_cp,total_cp_import,total_payment_supplier_yuan,total_payment_supplier,updated_at').order('id').range(from,to))).filter((row)=>!state.productIds.includes(row.product_id??''))
  assert.equal(digest(originals),originalImportsBefore)
 })
 if(mode==='--prepare-browser'){
  const browser=await createImportReorders(db,state.managerId,{requestKey:randomUUID(),supplierName:`${state.tag} Browser supplier`,selections:[{productId:state.productIds[1],qty:25}]})
  state.browserDraftId=browser.requests[0].id;await persist();keep=true
  console.log(JSON.stringify({qaEmail:state.email,browserDraftId:state.browserDraftId,qaTag:state.tag,sourceImportId:state.sourceId}))
 }
 console.log(`${passed} import reorder checks passed.`)
}finally{if(!keep)await cleanup(state)}
