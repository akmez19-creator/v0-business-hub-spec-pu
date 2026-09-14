import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import { ACTOR, OTHER_BUYER, ResearchFixture, clone, interop, rawListing, testId } from './1688-research-fixtures.mts'
import * as qualityModule from '../lib/purchase-orders/supplier-quality.ts'
import * as serviceModule from '../lib/purchase-orders/1688-check-service.ts'
import * as queueModule from '../lib/purchase-orders/1688-queue.ts'
import * as sourcingModule from '../lib/purchase-orders/1688-sourcing-service.ts'
import * as providerModule from '../lib/purchase-orders/1688-provider.ts'

const { advanceResearchJob, enqueueResearch, loadResearchQueue, queueMutation } = interop(queueModule)
const { getSourcingWorkspace, loadSourcingSelections, saveSourcingSelection, prepareSourcingPhotos, confirmSourcingSelection, cancelSourcingSelection } = interop(sourcingModule)
const { normalizeListing } = interop(providerModule)

const { appendSupplierNote, confirmSupplierIdentity, loadSupplierQuality, readQualityPage } = interop(qualityModule)
const { ResearchError } = interop(serviceModule)
const root = new URL('../', import.meta.url).pathname
const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 3100
const basePath = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : ''
if (basePath && !/^\/[a-z0-9-]+$/.test(basePath)) throw new Error('Use one simple path segment for the isolated browser base')
const originalFetch = globalThis.fetch
globalThis.fetch = async () => { throw new Error('External network disabled in isolated browser verification') }
const fixture = await new ResearchFixture().init()
const originalCatalogue = clone(fixture.catalogue)
const originalPorts = { ...fixture.ports, provider: { ...fixture.ports.provider } }
const tables = (await fixture.sql.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name")).rows.map(row => row.table_name)
const originalRows = await Promise.all(['profiles','products','product_variants','product_links','purchase_orders','import_reorder_items'].map(async table => ({table, rows:(await fixture.sql.query(`select to_jsonb(t) value from public.${table} t`)).rows.map(row=>row.value)})))
const samplePhoto = await readFile(new URL('../public/icons/icon-192x192.jpg', import.meta.url))
fixture.imagePublicBase = `${basePath}/__qa/images/`
let baseline = await fixture.businessHash()
const commands: Record<string, unknown>[] = []
const background = new Map<string, Promise<void>>()
let actionFailure = false
let responseFailure = false
let sessionFailure = false
let dispatchFailure = false

async function dispatch(run: Awaited<ReturnType<typeof enqueueResearch>>) {
  if (run.workflow_id || run.stop_requested || background.has(run.id)) return
  if (dispatchFailure) { dispatchFailure = false; await queueMutation(fixture.db, ACTOR, 'dispatch-failed', run.id); return }
  const workflowId = randomUUID()
  const work = (async () => {
    const claim = await queueMutation(fixture.db, run.actor_id, 'claim-run', run.id, { workflowId })
    if (!claim.owned) return
    try {
      await Promise.all([0,1,2].map(async lane => {
        for (let n=lane; n<(claim.jobs?.length??0); n+=3) {
          for (;;) {
            const state=await advanceResearchJob(fixture.db,claim.jobs![n],workflowId,randomUUID(),fixture.ports)
            if(state==='done')break
            if(state==='wait')await new Promise(resolve=>setTimeout(resolve,30))
          }
        }
      }))
      await queueMutation(fixture.db,run.actor_id,'finish-run',run.id,{workflowId})
    } catch { await queueMutation(fixture.db,run.actor_id,'abort-run',run.id,{workflowId}) }
  })().finally(()=>background.delete(run.id))
  background.set(run.id,work)
}
async function reset() {
  if (background.size || fixture.providerActive) throw new Error('Cannot reset active isolated work')
  await fixture.sql.exec(`reset role; truncate ${tables.map(table=>`public.${table}`).join(',')} restart identity cascade`)
  for (const {table,rows} of originalRows) if(rows.length)await fixture.sql.query(`insert into public.${table} select * from jsonb_populate_recordset(null::public.${table},$1::jsonb)`,[JSON.stringify(rows)])
  fixture.imageFiles.clear(); fixture.imageUploadError=null
  Object.assign(fixture,{catalogue:clone(originalCatalogue),ports:{...originalPorts,provider:{...originalPorts.provider}},providerCalls:[],reads:[],writes:[],providerActive:0,maxProviderActive:0,failStage:null,failRpc:null,failRead:null,terminal:false,afterProvider:null,delay:0})
  commands.length=0; actionFailure=false; responseFailure=false; sessionFailure=false; dispatchFailure=false
}
async function seed(variants=false) {
  await fixture.sql.query('update public.purchase_orders set unit_price=12,discounted_unit_price=10 where id=$1',[testId(3)])
  await fixture.sql.query("update public.import_reorder_items set item=jsonb_set(item,'{qty}','100') where id=$1",[testId(4)])
  if(variants){
    await fixture.sql.query('update public.products set has_variants=true,quantity=0 where id=$1',[testId(2)])
    await fixture.sql.query("insert into public.product_variants(id,product_id,attribute_name,attribute_value,quantity,price_override,sku) values($1,$2,'color / size / contents','black / 60cm / complete rack',19,37,'LOCAL-B60')",[testId(8),testId(2)])
    await fixture.sql.query('update public.purchase_orders set variant_id=$1 where id=$2',[testId(8),testId(3)])
  }
  fixture.ports.provider.listing=(id:string)=>fixture.call(`listing:${id}`,()=>{
    const raw=rawListing(id,id==='888888000000'?'12':'8',id==='888888000001'?51:1)
    if(id==='888888000001')raw.skus=raw.skus.map((sku,index)=>({...sku,props_names:`color: black; size: ${index+10}cm; contents: complete rack`}))
    const offer=normalizeListing(raw,id)
    offer.skus=offer.skus.map(sku=>({...sku,imageUrl:'https://cbu01.alicdn.com/isolated-review-photo.jpg'}))
    return offer
  })
  baseline=await fixture.businessHash()
  await appendSupplierNote(fixture.db, ACTOR, { name: 'QA Original Supplier', revision: 0, rating: 2, body: 'One bracket arrived cracked. Inspect the next batch before ordering again.', kind: 'defect', productId: testId(2), importId: testId(3), requestKey: randomUUID() })
  await fixture.run()
  fixture.providerCalls = []
  fixture.maxProviderActive = 0
  fixture.delay = 100
}
await seed(process.argv.includes('--variants'))

const navigation = `
import React from 'react';
const base=${JSON.stringify(basePath)};
const scope=url=>url.startsWith(base+'/')?url:base+url;
const router={refresh:()=>window.dispatchEvent(new Event('qa-refresh')),push:(url)=>{history.pushState({},'',scope(url));window.dispatchEvent(new Event('popstate'))},replace:(url)=>{history.replaceState({},'',scope(url));window.dispatchEvent(new Event('popstate'))}};
export const useRouter=()=>router;
export const usePathname=()=>location.pathname;
export const useSearchParams=()=>new URLSearchParams(location.search);
export const redirect=(url)=>router.push(url);
export default function Link({href,children,...props}){return React.createElement('a',{...props,href,onClick:e=>{props.onClick?.(e);if(!e.defaultPrevented&&!props.target&&String(href).startsWith('/')){e.preventDefault();router.push(href)}}},children)}
`
const actions = `
const action=async(name,args)=>{const response=await fetch('/__qa/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,args})});const json=await response.json();if(!response.ok)throw new Error(json.error);return json.data};
export const loadSupplierQualitySummariesAction=()=>action('quality',[]);
export const loadSupplierQualityAction=(...args)=>action('quality-page',args);
export const saveSupplierQualityAction=(...args)=>action('save-note',args);
export const confirmSupplierIdentityAction=(...args)=>action('identity',args);
export const saveReorderItemAction=(...args)=>action('save-item',args);
export const getSourcingWorkspaceAction=(...args)=>action('source-workspace',args);
export const saveSourcingSelectionAction=(...args)=>action('source-save',args);
export const prepareSourcingPhotosAction=(...args)=>action('source-photos',args);
export const confirmSourcingSelectionAction=(...args)=>action('source-confirm',args);
export const cancelSourcingSelectionAction=(...args)=>action('source-cancel',args);
`
const entry = `
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import useSWR,{SWRConfig} from 'swr';
import {Toaster} from 'sonner';
import {ReorderList} from './components/purchase-orders/reorder-list';
import {SuppliersContent} from './components/purchase-orders/po-suppliers-content';
import {InventoryVariantFields} from './components/products/inventory-variant-fields';
import {ImageLightbox} from './components/ui/image-lightbox';
function Inventory({data}){return <section className="flex flex-col gap-5"><h1 className="text-2xl font-semibold">Inventory · isolated confirmed photos</h1>{data.inventory.filter(product=>data.links.some(link=>link.product_id===product.id)).map(product=><section key={product.id} className="flex flex-col gap-3"><h2 className="text-lg font-medium">{product.name}</h2><p>Recorded stock {product.quantity} · retail price {product.price}</p>{product.has_variants?<InventoryVariantFields variants={data.variants.filter(v=>v.product_id===product.id)} links={data.links.filter(l=>l.product_id===product.id)} onChange={()=>{}} disabled loading={false}/>:<ImageLightbox src={product.image_url} alt={product.name} className="size-32"/>}</section>)}</section>}
const base=${JSON.stringify(basePath)};
const scope=url=>url.startsWith(base+'/')?url:base+url;
const isolatedFetch=window.fetch.bind(window);
window.fetch=(resource,options)=>{const url=new URL(resource instanceof Request?resource.url:String(resource),location.origin);if(url.origin!==location.origin)return Promise.reject(new Error('External browser requests disabled in isolated verification'));const path=scope(url.pathname)+url.search;return isolatedFetch(resource instanceof Request?new Request(path,resource):path,options)};
const read=async url=>{const res=await fetch(url);const json=await res.json();if(!res.ok)throw new Error(json.error);return json};
function App(){
 const [url,setUrl]=useState(location.pathname+location.search);
 const {data,error,mutate}=useSWR('/__qa/props',read,{revalidateOnFocus:false,shouldRetryOnError:false});
 useEffect(()=>{const refresh=()=>void mutate();const nav=()=>setUrl(location.pathname+location.search);window.addEventListener('qa-refresh',refresh);window.addEventListener('popstate',nav);return()=>{window.removeEventListener('qa-refresh',refresh);window.removeEventListener('popstate',nav)}},[mutate]);
 const page=url.includes('/suppliers')?'suppliers':url.includes('/inventory')?'inventory':'reorders';
 const navigate=where=>{history.pushState({},'',scope(where));setUrl(scope(where))};
 return <><header className="border-b border-border bg-muted text-foreground"><div className="p-3"><div className="flex flex-wrap items-center justify-between gap-3 text-sm"><span>Isolated verification — no live data or paid calls</span><nav className="flex gap-4" aria-label="Verification pages"><button onClick={()=>navigate('/dashboard/purchasing/reorders')}>Reorders</button><button onClick={()=>navigate('/dashboard/purchasing/suppliers')}>Foreign Suppliers</button><button onClick={()=>navigate('/dashboard/deliveries/inventory')}>Inventory</button></nav></div></div></header><main className="min-w-0 p-3 sm:p-6">{error?<p role="alert">{error.message}</p>:!data?<p>Loading isolated evidence…</p>:page==='suppliers'?<SuppliersContent suppliers={data.suppliers} allProducts={data.catalogue.products} initialOpenName={new URLSearchParams(url.split('?')[1]||'').get('supplier')}/>:page==='inventory'?<Inventory data={data}/>:<ReorderList {...data}/>}</main><Toaster/></>
}
createRoot(document.getElementById('root')).render(<SWRConfig value={{provider:()=>new Map()}}><App/></SWRConfig>);
`
const bundle = await build({ stdin: { contents: entry, resolveDir: root, sourcefile: 'isolated-research-browser.tsx', loader: 'tsx' }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'isolated-server-boundary', setup(builder) {
  builder.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: 'qa-navigation' }))
  builder.onLoad({ filter: /.*/, namespace: 'qa-navigation' }, () => ({ contents: navigation, loader: 'tsx', resolveDir: root }))
  builder.onResolve({ filter: /app\/dashboard\/purchasing\/(suppliers|reorders)\/actions$/ }, args => ({ path: args.path, namespace: 'qa-actions' }))
  builder.onLoad({ filter: /.*/, namespace: 'qa-actions' }, () => ({ contents: actions, loader: 'js' }))
  // img requests do not use window.fetch; route the real media helper's output to the isolated server too.
  builder.onResolve({ filter: /^@\/lib\/media-url$/ }, args => ({ path: args.path, namespace: 'qa-media' }))
  builder.onLoad({ filter: /.*/, namespace: 'qa-media' }, () => ({ contents: `
    export * from ${JSON.stringify(`${root}lib/media-url.ts`)};
    import { mediaSrc as originalMediaSrc } from ${JSON.stringify(`${root}lib/media-url.ts`)};
    export const mediaSrc = url => { const resolved = originalMediaSrc(url); return resolved.startsWith('/api/') ? ${JSON.stringify(basePath)} + resolved : resolved; };
  `, loader: 'js', resolveDir: root }))
} }] })
const javascript = bundle.outputFiles[0].text
// next/font does not run in this standalone bundle; keep the dashboard's sans fallback.
const style = (await postcss([tailwindcss({ base: root })]).process(await readFile(new URL('../app/globals.css', import.meta.url), 'utf8'), { from: `${root}app/globals.css` })).css + '\n.font-sans { font-family: Arial, Helvetica, sans-serif; }'
const page = `<!doctype html><html lang="en" class="dark bg-background"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated 1688 research verification</title><link rel="stylesheet" href="${basePath}/__qa/style.css"></head><body class="bg-background text-foreground font-sans"><div id="root"></div><script src="${basePath}/__qa/app.js"></script></body></html>`
async function body(request: AsyncIterable<Buffer>) { const chunks: Buffer[] = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > 2_000_000) throw new Error('Test request too large'); chunks.push(chunk) }; return JSON.parse(Buffer.concat(chunks).toString() || '{}') }
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  const send = (data: unknown, status = 200) => { response.statusCode = status; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(data)) }
  try {
    const url = new URL(request.url ?? '/', `http://localhost:${port}`)
    if (url.pathname === '/__qa/app.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(javascript); return }
    if (url.pathname === '/__qa/style.css') { response.setHeader('Content-Type', 'text/css'); response.end(style); return }
    if (url.pathname === '/__qa/props') {
      const props = await fixture.props()
      const suppliers = fixture.catalogue.suppliers.map(name => { const references = fixture.catalogue.references.filter(row => row.supplier_name === name); return { name, orders: references.length, qty: references.reduce((sum,row)=>sum+(row.qty??0),0), spend: references.reduce((sum,row)=>sum+(row.total_payment_supplier??0),0), spendYuan: references.reduce((sum,row)=>sum+(row.total_payment_supplier_yuan??0),0), landed: 0, products: references.map(row=>row.product_name), lastOrder: references[0]?.created_at??null, lastActualOrder: references[0]?.order_date??null, statuses: { Received: references.length }, sampleLink: null, threads: [], manualProducts: [], quality: props.initialQuality.find(value=>value.aliases.includes(name))??null, imports: references.map(row=>({id:row.id,caption:row.index_no,productId:row.product_id})) } })
      const [initialQueue,initialSelections] = await Promise.all([loadResearchQueue(fixture.db),loadSourcingSelections(fixture.db)])
      const inventory=(await fixture.sql.query('select id,name,image_url,quantity,price,has_variants from public.products order by id')).rows
      const variants=(await fixture.sql.query('select id,product_id,attribute_name,attribute_value,image_url,quantity,price_override,sku,is_active from public.product_variants order by id')).rows
      const links=(await fixture.sql.query('select product_id,offer_id,sku_key,target_kind,variant_id from public.product_1688_sku_links order by offer_id,sku_key')).rows
      send({ ...props, suppliers,initialQueue,initialSelections,inventory,variants,links }); return
    }
    if (url.pathname === '/__qa/metrics') { send({ calls: fixture.providerCalls, active: fixture.providerActive, maximum: fixture.maxProviderActive, commands, baseline, businessHash: await fixture.businessHash() }); return }
    if (url.pathname === '/__qa/control' && request.method === 'POST') {
      const input = await body(request)
      if (input.reset) { await reset(); if (input.seed) await seed(!!input.variants); else baseline=await fixture.businessHash() }
      if (input.failDispatch != null) dispatchFailure=!!input.failDispatch
      if (input.failImage != null) fixture.imageUploadError=input.failImage?'Isolated image storage failure':null
      if (input.delay != null) fixture.delay = Number(input.delay)
      if (input.failStage) fixture.failStage = input.failStage
      if (input.failRpc) fixture.failRpc = input.failRpc
      if (input.terminal != null) fixture.terminal = Boolean(input.terminal)
      if (input.failAction != null) actionFailure = Boolean(input.failAction)
      if (input.failResponse != null) responseFailure = Boolean(input.failResponse)
      if (input.failSession != null) sessionFailure = Boolean(input.failSession)
      if (input.changeProduct) await fixture.sql.query('update public.products set description=$1 where id=$2', [input.description ?? 'Changed by another buyer in isolation', testId(2, input.index ?? 0)])
      if (input.expireLeases) await fixture.sql.exec("update public.import_reorder_1688_checks set lease_until=now()-interval '1 minute',updated_at=now()-interval '2 minutes' where status in ('running','paused','partial')")
      if (input.externalNote) { const summary = (await loadSupplierQuality(fixture.db)).find(row => row.aliases.includes('QA Original Supplier')); await appendSupplierNote(fixture.db, OTHER_BUYER, { name: 'QA Original Supplier', revision: summary?.revision ?? 0, rating: 1, body: input.externalNote, kind: 'defect', productId: null, importId: null, requestKey: randomUUID() }) }
      send({ ok: true }); return
    }
    if (url.pathname === '/__qa/action' && request.method === 'POST') {
      const input = await body(request)
      if (sessionFailure) { send({error:'Isolated expired session'},401); return }
      if (input.name === 'source-workspace') { send({ data: await getSourcingWorkspace(fixture.db,input.args[0]) }); return }
      if (input.name === 'source-save') { send({ data: await saveSourcingSelection(fixture.db,ACTOR,input.args[0]) }); return }
      if (input.name === 'source-photos') { send({ data: await prepareSourcingPhotos(fixture.db,ACTOR,input.args[0],async()=>samplePhoto) }); return }
      if (input.name === 'source-confirm') { send({ data: await confirmSourcingSelection(fixture.db,ACTOR,input.args[0]) }); return }
      if (input.name === 'source-cancel') { send({ data: await cancelSourcingSelection(fixture.db,ACTOR,input.args[0]) }); return }
      if (input.name === 'quality') { send({ data: await loadSupplierQuality(fixture.db) }); return }
      if (input.name === 'quality-page') { send({ data: await readQualityPage(fixture.db, input.args[0], input.args[1]) }); return }
      if (input.name === 'save-note') {
        if (actionFailure) { actionFailure = false; throw new Error('Isolated save failure. Your note text has been kept.') }
        const data = await appendSupplierNote(fixture.db, ACTOR, input.args[0]); send({ data }); return
      }
      if (input.name === 'identity') { send({ data: await confirmSupplierIdentity(fixture.db, ACTOR, input.args[0]) }); return }
      if (input.name === 'save-item') {
        const inputRow = input.args[0]
        const result = await fixture.sql.query('update public.import_reorder_items set item=$1,status=$2,revision=revision+1,updated_at=now() where id=$3 and revision=$4 returning id,revision', [JSON.stringify(inputRow.item), inputRow.status, inputRow.id, inputRow.revision])
        if (!result.rows.length) throw new Error('The isolated row changed. Reload before saving.')
        send({ data: result.rows[0] }); return
      }
      throw new Error('Unsupported isolated action')
    }
    if (url.pathname === '/api/product-master/video-fetch' && url.searchParams.get('src') === 'https://cbu01.alicdn.com/isolated-review-photo.jpg') { response.setHeader('Content-Type','image/jpeg'); response.end(samplePhoto); return }
    if (url.pathname.startsWith('/__qa/images/')) { const image=fixture.imageFiles.get(url.pathname.slice('/__qa/images/'.length)); if(!image){send({error:'Missing prepared image'},404);return};response.setHeader('Content-Type','image/jpeg');response.end(image);return }
    if (url.pathname === '/api/purchase-orders/1688-check' && request.method === 'GET') {
      if(sessionFailure){send({success:false,error:'Isolated expired session'},401);return}
      send({success:true,...await loadResearchQueue(fixture.db)});return
    }
    if (url.pathname === '/api/purchase-orders/1688-check' && request.method === 'POST') {
      const command = await body(request); commands.push(command)
      if (sessionFailure) { send({ success: false, error: 'Isolated expired session', reason: 'auth' }, 401); return }
      if(command.operation==='enqueue'){
        const run=await enqueueResearch(fixture.db,ACTOR,command);await dispatch(run)
        if(responseFailure){responseFailure=false;send({success:false,error:'Isolated lost submission response'},503);return}
        send({success:true,runId:run.id},202);return
      }
      if(command.operation==='stop-batch'){await queueMutation(fixture.db,ACTOR,'stop',command.runId);send({success:true});return}
      if(command.operation==='retry-dispatch'){const result=await queueMutation(fixture.db,ACTOR,'redispatch',command.runId);if(result.run)await dispatch(result.run);send({success:true});return}
      if(command.operation!=='confirm-target'){send({success:false,error:'Use the shared queue'},400);return}
      const result = await fixture.process(command)
      if (responseFailure) { responseFailure = false; send({ success: false, error: 'Isolated lost response', reason: 'storage', stopReason: 'Persistence response interrupted; remaining work stopped.' }, 503); return }
      send(result); return
    }
    if (url.pathname.startsWith('/api/')) { send({ error: 'This service is outside the isolated verification boundary' }, 403); return }
    if (url.pathname === '/' || url.pathname.startsWith('/dashboard/')) { response.setHeader('Content-Type', 'text/html'); response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"); response.end(page); return }
    send({ error: 'Not found' }, 404)
  } catch (cause) {
    if (cause instanceof ResearchError) send({ success: false, error: cause.message, reason: cause.reason, check: cause.check, checkedButNotSaved: cause.checkedButNotSaved, stopReason: cause.reason === 'storage' ? 'Research persistence needs attention. Remaining paid work was stopped.' : undefined }, cause.status)
    else send({ success: false, error: (cause as Error).message }, 400)
  }
})
server.listen(port, '0.0.0.0', () => console.log(`Isolated browser verification listening on http://localhost:${port}; in-memory Postgres, external network disabled.`))
async function stop() { server.close(); await fixture.close(); globalThis.fetch = originalFetch; process.exit(0) }
process.once('SIGTERM', stop)
process.once('SIGINT', stop)
