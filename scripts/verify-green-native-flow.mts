// Integrated disposable-PostgreSQL check for the GREEN-native Autopilot flow (handover blocker 2).
// Run: node --import tsx --import ./scripts/qa/register-pglite-inbox.mjs --conditions=react-server scripts/verify-green-native-flow.mts
// Real modules: runtime, engine, sender, PgGreenStore, context evaluator, policy, staff tasks, pass ledger,
// the real handover reconciler, real migrations. Faked: GREEN transport (account/history/sendMessage) and the
// model classifier. No live database, provider, model or customer is touched: the loader hook above redirects
// lib/messenger/pg to the PGlite client below and the live URLs are blanked so an unmocked path fails loudly.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

for (const key of ['DB_POSTGRES_URL', 'POSTGRES_URL', 'DB_POSTGRES_URL_NON_POOLING', 'POSTGRES_URL_NON_POOLING', 'DB_POSTGRES_PRISMA_URL', 'POSTGRES_PRISMA_URL']) delete process.env[key]
// The real reconciler reads bindings from env (configuredGreenBindings), so the live sandbox credentials are
// replaced by the QA binding below; otherwise our own echo is unverifiable and correctly blocks the customer.
for (const key of Object.keys(process.env)) if (key.startsWith('WHATSAPP_GREEN_')) delete process.env[key]
const QA_WEBHOOK_TOKEN = 'qa_webhook_token_0123456789abcdef_0123456789'
Object.assign(process.env, { WHATSAPP_GREEN_MADE_BY_MORIS_INSTANCE_ID: '7107000001', WHATSAPP_GREEN_MADE_BY_MORIS_API_URL: 'https://7107.api.greenapi.com',
  WHATSAPP_GREEN_MADE_BY_MORIS_API_TOKEN: 'qa_token_0123456789abcdef', WHATSAPP_GREEN_MADE_BY_MORIS_WEBHOOK_TOKEN: QA_WEBHOOK_TOKEN,
  WHATSAPP_GREEN_MADE_BY_MORIS_ACCOUNT_ID: '23059406784@c.us', WHATSAPP_GREEN_MADE_BY_MORIS_ENABLED: 'true', WHATSAPP_GREEN_MADE_BY_MORIS_VERSION: '1' })
const sql = new PGlite()
// pg reports `rowCount`; PGlite reports `affectedRows`. Production code (external-handoff settle) reads rowCount.
const db = { query: async (text: string, params?: unknown[]) => { const r = await sql.query<Record<string, any>>(text, params as any[]); return { ...r, rowCount: r.affectedRows ?? r.rows.length } }, end: async () => {} }
;(globalThis as { __qaInboxDb?: typeof db }).__qaInboxDb = db

const runtimeModule: typeof import('../lib/inbox-autopilot/green-native-runtime.ts') = await import('../lib/inbox-autopilot/green-native-runtime.ts')
const scheduleModule: typeof import('../lib/inbox-autopilot/green-native-schedule.ts') = await import('../lib/inbox-autopilot/green-native-schedule.ts')
const contextModule: typeof import('../lib/inbox-autopilot/green-native-context.ts') = await import('../lib/inbox-autopilot/green-native-context.ts')
const engineModule: typeof import('../lib/inbox-autopilot/green-native-engine.ts') = await import('../lib/inbox-autopilot/green-native-engine.ts')
const staffModule: typeof import('../lib/inbox-autopilot/staff-tasks.ts') = await import('../lib/inbox-autopilot/staff-tasks.ts')
const handoffRuntime: typeof import('../lib/inbox-autopilot/handoff-runtime.ts') = await import('../lib/inbox-autopilot/handoff-runtime.ts')
const contract: typeof import('../lib/inbox-autopilot/contract.ts') = await import('../lib/inbox-autopilot/contract.ts')
const releaseModule: typeof import('../lib/inbox-autopilot/handoff-release.ts') = await import('../lib/inbox-autopilot/handoff-release.ts')
const storeModule: typeof import('../lib/whatsapp-green/store.ts') = await import('../lib/whatsapp-green/store.ts')
const normalise: typeof import('../lib/whatsapp-green/normalise.ts') = await import('../lib/whatsapp-green/normalise.ts')
type GreenBinding = import('../lib/whatsapp-green/contract.ts').GreenBinding
type GreenSendScope = import('../lib/inbox-autopilot/green-native-send.ts').GreenSendScope
type CatalogueProduct = import('../lib/inbox-autopilot/green-native-policy.ts').CatalogueProduct
type ReplyDecision = import('../lib/inbox-autopilot/green-native-policy.ts').ReplyDecision
type NativeContext = import('../lib/inbox-autopilot/green-native-context.ts').NativeContext

const PHONE = '1090043534186338', CODE = 'MBM', PAGE = '308584892331429', BUSINESS_PHONE = '23059406784'
const binding: GreenBinding = { key: 'made_by_moris', env: 'MADE_BY_MORIS', phoneNumberId: PHONE, businessPhone: BUSINESS_PHONE, pageId: PAGE,
  instanceId: '7107000001', apiUrl: 'https://7107.api.greenapi.com', apiToken: 'qa_token_0123456789abcdef', webhookToken: QA_WEBHOOK_TOKEN, accountId: BUSINESS_PHONE + '@c.us', enabled: true, version: 1 }
assert.deepEqual((await import('../lib/whatsapp-green/config.ts')).configuredGreenBindings(), [binding], 'env binding must equal the in-memory QA binding')
const scopeFor = (waId: string): GreenSendScope => ({ businessKey: 'made_by_moris', channel: 'whatsapp', phoneNumberId: PHONE, waId })

let passed = 0, failed = 0
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; console.log('ok  -', name) }
  catch (err) { failed++; console.log('FAIL-', name); console.log('     ', err instanceof Error ? err.stack?.split('\n').slice(0, 4).join('\n      ') : err) }
}

await sql.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  grant usage on schema public to anon,authenticated,service_role;
  create table public.profiles(id uuid primary key, email text, name text, role text);
  create table public.products(id uuid primary key, name text);
  create table public.whatsapp_inbox_numbers(phone_number_id text primary key, display_phone text, business_name text not null default 'n', page_id text, waba_id text,
    can_read boolean not null default true, can_send boolean not null default false, created_at timestamptz not null default now());
  create table public.whatsapp_messages(id text primary key, phone_number_id text, wa_id text, created_at timestamptz not null default now());
  create table public.inbox_sync_state(key text primary key, cursor text, last_run_at timestamptz, last_ok_at timestamptz, last_error text, updated_at timestamptz not null default now());
  create table public.inbox_live_events(channel text primary key check(channel in ('messenger','whatsapp')), version bigint not null default 0, updated_at timestamptz not null default clock_timestamp());
  insert into public.inbox_live_events(channel) values('messenger'),('whatsapp');
  insert into public.whatsapp_inbox_numbers(phone_number_id,display_phone,page_id,can_read,can_send) values('${PHONE}','+230 5940 6784','${PAGE}',true,true),('968962882975955','+230 5250 0684','471644012696537',true,true);
`)
for (const file of ['create-whatsapp-green-feed.sql', '20260914_inbox_autopilot.sql', '20260914_inbox_autopilot_handoff.sql', '20260914_inbox_autopilot_handoff_observations.sql',
  '20260914_inbox_autopilot_green_sends.sql', '20260914_inbox_autopilot_handoff_green_pending.sql', '20260914_inbox_autopilot_green_native_runtime.sql',
  '20260914_inbox_autopilot_staff_tasks.sql', '20260914_inbox_autopilot_staff_tasks_green_fk.sql', '20260914_inbox_autopilot_green_native_passes.sql']) {
  await sql.exec(await readFile(new URL(`./${file}`, import.meta.url), 'utf8'))
}
const mauritiusDate = (offsetDays: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Indian/Mauritius', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + offsetDays * 86400000))
const DELIVERY = mauritiusDate(2)
await db.query('insert into public.inbox_autopilot_config(business_code,enabled,delivery_date,max_daily_replies) values($1,true,$2,30) on conflict(business_code) do update set enabled=true,delivery_date=excluded.delivery_date', [CODE, DELIVERY])
await db.query('insert into public.inbox_autopilot_config(business_code,enabled,delivery_date) values($1,false,null) on conflict do nothing', ['DBM'])
const activatedAt = new Date(Date.now() - 60000).toISOString()
const setMarkers = async (native: boolean) => {
  await db.query('insert into public.inbox_sync_state(key,cursor) values($1,$2) on conflict(key) do update set cursor=excluded.cursor',
    [releaseModule.HANDOFF_RELEASE_KEY, JSON.stringify({ schema: 1, enabled: true, activatedAt, businessCodes: ['MBM', 'DBM'], journalMaxAgeSeconds: 600 })])
  await db.query('insert into public.inbox_sync_state(key,cursor) values($1,$2) on conflict(key) do update set cursor=excluded.cursor',
    [engineModule.GREEN_NATIVE_RELEASE_KEY, native ? JSON.stringify({ schema: 1, enabled: true, source: 'green-api', businessCodes: ['MBM'], activatedAt }) : '{}'])
}

// --- fake GREEN provider: webhook echo, bounded history, sendMessage -------------------------------------------
const store = new storeModule.PgGreenStore(db, () => [binding])
type Rec = { type: 'incoming' | 'outgoing'; idMessage: string; timestamp: number; chatId: string; typeMessage: 'textMessage'; textMessage: string; sendByApi?: boolean }
const history = new Map<string, Rec[]>()
const sentBodies: Array<{ url: string; body: any }> = []
let sendMode: 'accept' | 'http500' | 'garbage' = 'accept', sendSeq = 0
const fetchImpl = (async (url: string, init: RequestInit) => {
  sentBodies.push({ url, body: JSON.parse(String(init.body)) })
  if (sendMode === 'http500') return new Response('oops', { status: 500 })
  if (sendMode === 'garbage') return new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } })
  return new Response(JSON.stringify({ idMessage: 'BAE5QA' + String(++sendSeq).padStart(6, '0') }), { status: 200, headers: { 'content-type': 'application/json' } })
}) as unknown as typeof fetch
let historyCalls = 0
const clientFactory = () => ({
  async verifyAccount() { return { businessPhone: BUSINESS_PHONE, accountId: binding.accountId, observedAt: new Date().toISOString(), historySyncProgress: 100 } },
  async history(chat: string) { historyCalls++; return (history.get(chat) ?? []).map(r => ({ ...r })) },
})
let seq = 0, lastStamp = 0
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
/** Provider timestamps are whole seconds, strictly increasing and never in the future - a message can only arrive after the last one. */
async function nextStamp(secondsAgo: number) {
  let timestamp = Math.max(Math.floor(Date.now() / 1000) - secondsAgo, lastStamp + 1)
  if (timestamp * 1000 > Date.now()) { await sleep(timestamp * 1000 - Date.now() + 20); timestamp = Math.max(timestamp, Math.floor(Date.now() / 1000)) }
  lastStamp = timestamp
  return timestamp
}
async function webhook(waId: string, direction: 'in' | 'out', text: string, secondsAgo: number, opts: { idMessage?: string; api?: boolean } = {}) {
  const idMessage = opts.idMessage ?? 'MSG' + String(++seq).padStart(8, '0'), timestamp = await nextStamp(secondsAgo), chatId = waId + '@c.us'
  const typeWebhook = direction === 'in' ? 'incomingMessageReceived' : opts.api ? 'outgoingAPIMessageReceived' : 'outgoingMessageReceived'
  const raw = { typeWebhook, instanceData: { idInstance: Number(binding.instanceId), wid: binding.accountId, typeInstance: 'whatsapp' }, timestamp, idMessage,
    senderData: { chatId, sender: chatId, chatName: 'QA ' + waId, senderName: 'QA ' + waId }, messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: text } } }
  await store.ingest(binding, normalise.normaliseWebhook(binding, raw, new Date().toISOString()))
  // The production reconcile job keeps this heartbeat; the context gate refuses a stale or unauthorised connection.
  await db.query("update public.whatsapp_green_bindings set connection_state='authorized',last_reconcile_at=clock_timestamp(),last_error=null where phone_number_id=$1", [PHONE])
  const recs = history.get(chatId) ?? []
  recs.push({ type: direction === 'in' ? 'incoming' : 'outgoing', idMessage, timestamp, chatId, typeMessage: 'textMessage', textMessage: text, ...(direction === 'out' && opts.api ? { sendByApi: true } : {}) })
  history.set(chatId, recs)
  return idMessage
}
/** The provider's live webhooks are DOWN: the message reaches us only through the journal poll (production shape:
 * `type`, `sendByApi`, `statusMessage`, no trustworthy time) and, on the next pass, the fresh history snapshot. */
async function journal(waId: string, direction: 'in' | 'out', text: string, secondsAgo: number, opts: { api?: boolean; idMessage?: string } = {}) {
  const idMessage = opts.idMessage ?? 'JRN' + String(++seq).padStart(8, '0'), timestamp = await nextStamp(secondsAgo), chatId = waId + '@c.us'
  const raw = { type: direction === 'in' ? 'incoming' : 'outgoing', chatId, idMessage, timestamp, typeMessage: 'textMessage', textMessage: text, isEdited: false, isDeleted: false,
    sendByApi: direction === 'out' && !!opts.api, statusMessage: direction === 'in' ? 'delivered' : 'sent', editedMessageId: '' }
  await store.ingest(binding, normalise.normaliseHistory(binding, raw, new Date().toISOString(), 'journal'))
  await db.query("update public.whatsapp_green_bindings set connection_state='authorized',last_reconcile_at=clock_timestamp(),last_error=null where phone_number_id=$1", [PHONE])
  const recs = history.get(chatId) ?? []
  recs.push({ type: raw.type as Rec['type'], idMessage, timestamp, chatId, typeMessage: 'textMessage', textMessage: text, ...(raw.sendByApi ? { sendByApi: true } : {}) })
  history.set(chatId, recs)
  return idMessage
}
// --- real runtime with production-shaped wiring ---------------------------------------------------------------
const products: CatalogueProduct[] = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Air Fryer', price: 1500, bundle_prices: null, is_b1g1: false, sold_out: false, has_variants: false } as CatalogueProduct,
  { id: '22222222-2222-4222-8222-222222222222', name: 'Sweeping Robot', price: 2200, bundle_prices: null, is_b1g1: false, sold_out: false, has_variants: false } as CatalogueProduct,
]
let decisionFor: (context: NativeContext) => ReplyDecision = () => { throw new Error('classifier not configured') }
let classifyCalls = 0
const reconcileCalls: string[] = []
const runtime = runtimeModule.createGreenNativeRuntime({
  connect: async () => db, authorizeScope: async scope => { contract.scopeIdentity(scope) },
  getBinding: async phone => phone === PHONE ? binding : null, configuredBindings: () => [binding],
  portFactory: () => store, clientFactory, fetchImpl, wait: ms => new Promise(r => setTimeout(r, ms)),
  catalogue: async () => products, classify: async context => { classifyCalls++; return decisionFor(context) },
  reconcileHandoff: async scope => { reconcileCalls.push(scope.waId); return handoffRuntime.reconcileHandoffScope(scope) },
  hasUnprocessedHandoff: handoffRuntime.hasUnprocessedHandoff,
  recordStaffTask: async (d, input) => { await staffModule.recordNativeStaffTaskAndHold(d, input) },
})
const business = { phoneNumberId: PHONE, code: CODE }
const pick = () => scheduleModule.selectNativeCandidate(db, business)
const one = async (text: string, params: unknown[] = []) => (await db.query(text, params)).rows[0]
const count = async (table: string, where = 'true', params: unknown[] = []) => Number((await one(`select count(*)::int as n from public.${table} where ${where}`, params)).n)
const priceDecision = (context: NativeContext, productId: string, evidence: string): ReplyDecision => ({ language: 'en', intent: 'price', needsStaff: false, productId,
  productEvidence: { value: evidence, messageId: context.latestInbound!.id }, quantity: null, quantityEvidence: null, name: null, phone: null, location: null })

const A = '23057000001', B = '23057000002', C = '23057000003', D = '23057000004', E = '23057000005'

await test('native marker absent: the run pauses before any provider or model call', async () => {
  await setMarkers(false)
  await webhook(A, 'in', 'Hello, what is the price of the Air Fryer please?', 90)
  const out = await runtime.runScope(scopeFor(A))
  assert.deepEqual(out, { state: 'paused', reason: 'native_transport_not_enabled' })
  assert.equal(historyCalls, 0); assert.equal(classifyCalls, 0); assert.equal(sentBodies.length, 0)
})

let aJobId = '', aSentText = '', aInboundId = ''
await test('selection -> history proof -> enrollment -> classification -> reservation -> ONE send -> accepted', async () => {
  await setMarkers(true)
  const cand = await pick()
  assert.equal(cand?.waId, A); aInboundId = cand!.inboundMessageId
  decisionFor = ctx => priceDecision(ctx, products[0].id, 'Air Fryer')
  const out = await runtime.runScope(scopeFor(cand!.waId))
  await scheduleModule.recordNativePass(db, scopeFor(cand!.waId), cand!.inboundMessageId, out)
  assert.equal(out.state, 'accepted', JSON.stringify(out)); assert.equal(out.reason, 'catalogue_price')
  assert.equal(historyCalls, 1); assert.equal(classifyCalls, 1); assert.equal(sentBodies.length, 1)
  assert.equal(sentBodies[0].url, `${binding.apiUrl}/waInstance${binding.instanceId}/sendMessage/${binding.apiToken}`)
  assert.equal(sentBodies[0].body.chatId, A + '@c.us'); assert.equal(sentBodies[0].body.linkPreview, false)
  aSentText = sentBodies[0].body.message
  assert.match(aSentText, /Air Fryer/); assert.match(aSentText, /Rs 1,500/); assert.match(aSentText, /Delivery is free/)
  assert.ok(!/confirmed|placed/i.test(aSentText))
  const job = await one('select * from public.inbox_autopilot_green_jobs where wa_id=$1', [A])
  aJobId = job.id
  assert.equal(job.state, 'accepted'); assert.equal(job.inbound_message_id, aInboundId); assert.equal(job.lease_token, null); assert.equal(job.reason, null)
  const send = await one('select * from public.inbox_autopilot_green_sends where wa_id=$1', [A])
  assert.equal(send.state, 'accepted'); assert.equal(send.provider_message_id, 'BAE5QA000001'); assert.equal(send.reply_text, aSentText); assert.equal(send.attempt_id, job.attempt_id)
  const daily = await one('select reserved_count,sent_count from public.inbox_autopilot_daily where business_code=$1', [CODE])
  assert.deepEqual([daily.reserved_count, daily.sent_count], [1, 1])
  const enrol = await one('select mode,history_id from public.inbox_autopilot_green_enrollments where wa_id=$1', [A])
  assert.equal(enrol.mode, 'provider_verified'); assert.ok(enrol.history_id)
  assert.equal(await count('inbox_autopilot_green_history', 'wa_id=$1', [A]), 1)
  const lease = JSON.parse((await one('select cursor from public.inbox_sync_state where key=$1', [`green:v1:${PHONE}:${binding.instanceId}:journal`])).cursor)
  assert.equal(lease.runId, undefined, 'scheduler lease released after finish'); assert.ok(lease.nativeNotBefore)
  assert.deepEqual(reconcileCalls, [A, A, A], 'handover reconciled before claim, before spending and again after durable acceptance')
  assert.deepEqual(await one('select attempts,last_state from public.inbox_autopilot_green_passes where wa_id=$1', [A]), { attempts: 1, last_state: 'accepted' })
})

await test('a second pass on the same accepted inbound is a no-op: no second send, job untouched', async () => {
  const before = await one('select updated_at from public.inbox_autopilot_green_jobs where id=$1', [aJobId])
  const out = await runtime.runScope(scopeFor(A))
  assert.equal(out.state, 'needs_review'); assert.equal(sentBodies.length, 1); assert.equal(classifyCalls, 1)
  assert.equal((await one('select state,updated_at from public.inbox_autopilot_green_jobs where id=$1', [aJobId])).state, 'accepted')
  assert.equal(String((await one('select updated_at from public.inbox_autopilot_green_jobs where id=$1', [aJobId])).updated_at), String(before.updated_at))
  assert.equal(await pick(), null, 'A is no longer a candidate while its job row exists')
})

await test('native own echo (outgoingAPIMessageReceived + sendByApi) is recognised as ours, not as a staff reply', async () => {
  await webhook(A, 'out', aSentText, 0, { idMessage: 'BAE5QA000001', api: true })
  assert.ok(await runtime.captureHistory(scopeFor(A)), 'fresh history proof captured')
  const ctx = await contextModule.readNativeContext(db, scopeFor(A), binding)
  assert.ok(!ctx.reasons.includes('staff_reply_requires_handover'), ctx.reasons.join(','))
  assert.ok(!ctx.reasons.includes('own_send_not_observed'), ctx.reasons.join(','))
  assert.ok(ctx.reasons.includes('latest_live_inbound_required'), ctx.reasons.join(','))
  assert.equal(ctx.messages.length, 2); assert.equal(ctx.messages[1].direction, 'out'); assert.equal(ctx.messages[1].nativeId, 'BAE5QA000001')
})

await test('a Business Suite reply (outgoingMessageReceived, no attempt) blocks the customer with staff_reply_requires_handover', async () => {
  await webhook(A, 'in', 'Ok and how many days for delivery?', 0)
  await webhook(A, 'out', 'Bonjour, we deliver Wednesday, thanks!', 0)
  const aFollowUp = await webhook(A, 'in', 'Great thanks', 0)
  assert.ok(await runtime.captureHistory(scopeFor(A)))
  const ctx = await contextModule.readNativeContext(db, scopeFor(A), binding)
  assert.ok(!ctx.eligible); assert.ok(ctx.reasons.includes('staff_reply_requires_handover'), ctx.reasons.join(','))
  const out = await runtime.runScope(scopeFor(A))
  await scheduleModule.recordNativePass(db, scopeFor(A), aFollowUp, out)
  assert.equal(out.state, 'needs_review'); assert.equal(sentBodies.length, 1)
  assert.equal(await pick(), null, 'A cools down after a reviewed pass instead of hogging the scheduler')
})

await test('unknown provider outcome: job/attempt stay unknown, never retried, customer leaves the queue', async () => {
  await webhook(B, 'in', 'Price for Sweeping Robot?', 60)
  const cand = await pick(); assert.equal(cand?.waId, B)
  decisionFor = ctx => priceDecision(ctx, products[1].id, 'Sweeping Robot')
  sendMode = 'http500'
  const out = await runtime.runScope(scopeFor(cand!.waId))
  await scheduleModule.recordNativePass(db, scopeFor(cand!.waId), cand!.inboundMessageId, out)
  assert.equal(out.state, 'unknown', JSON.stringify(out)); assert.equal(sentBodies.length, 2)
  const job = await one('select state,reason,attempt_id from public.inbox_autopilot_green_jobs where wa_id=$1', [B])
  assert.equal(job.state, 'unknown'); assert.ok(job.attempt_id)
  const attempt = await one('select state,provider_message_id from public.inbox_autopilot_green_sends where wa_id=$1', [B])
  assert.ok(['sending', 'unknown'].includes(attempt.state)); assert.equal(attempt.provider_message_id, null)
  sendMode = 'accept'
  const again = await runtime.runScope(scopeFor(cand!.waId))
  assert.equal(again.state, 'needs_review'); assert.equal(sentBodies.length, 2, 'no second transport call for an unknown outcome')
  assert.equal((await one('select state from public.inbox_autopilot_green_jobs where wa_id=$1', [B])).state, 'unknown')
  assert.equal(await pick(), null)
  const daily = await one('select reserved_count,sent_count from public.inbox_autopilot_daily where business_code=$1', [CODE])
  assert.deepEqual([daily.reserved_count, daily.sent_count], [2, 1], 'reservation consumed, sent not counted')
})

await test('first contact that mentions a refund is never enrolled: no job, no model call, no send, reason names the gate', async () => {
  await webhook(C, 'in', 'My air fryer arrived broken, I want a refund', 0)
  const cand = await pick(); assert.equal(cand?.waId, C)
  const before = classifyCalls
  const out = await runtime.runScope(scopeFor(cand!.waId))
  await scheduleModule.recordNativePass(db, scopeFor(cand!.waId), cand!.inboundMessageId, out)
  assert.deepEqual(out, { state: 'needs_review', reason: 'initial_history_requires_staff' })
  assert.equal(classifyCalls, before); assert.equal(sentBodies.length, 2)
  assert.equal(await count('inbox_autopilot_green_enrollments', 'wa_id=$1', [C]), 0); assert.equal(await count('inbox_autopilot_green_jobs', 'wa_id=$1', [C]), 0)
  assert.deepEqual(await one('select attempts,last_state,last_reason from public.inbox_autopilot_green_passes where wa_id=$1', [C]), { attempts: 1, last_state: 'needs_review', last_reason: 'initial_history_requires_staff' })
  assert.equal(await pick(), null, 'C cools down; staff keep answering in Business Suite')
})

let gJobId = ''
await test('complaint from an ENROLLED customer: staff task + per-customer hold, no model call, no send', async () => {
  const G = '23057000007'
  await webhook(G, 'in', 'Price of the Air Fryer?', 0)
  decisionFor = ctx => priceDecision(ctx, products[0].id, 'Air Fryer')
  const first = await runtime.runScope(scopeFor(G)); assert.equal(first.state, 'accepted', JSON.stringify(first))
  const gSend = await one("select provider_message_id from public.inbox_autopilot_green_sends where wa_id=$1 and state='accepted'", [G])
  assert.equal(gSend.provider_message_id, 'BAE5QA000002', 'second accepted transport call in the run')
  await webhook(G, 'out', sentBodies.at(-1)!.body.message, 0, { idMessage: gSend.provider_message_id, api: true })
  const complaint = await webhook(G, 'in', 'It arrived broken, I want a refund', 0)
  const before = classifyCalls, sends = sentBodies.length
  const out = await runtime.runScope(scopeFor(G))
  await scheduleModule.recordNativePass(db, scopeFor(G), complaint, out)
  assert.equal(out.state, 'needs_review', JSON.stringify(out)); assert.equal(out.reason, 'customer_issue'); assert.equal(classifyCalls, before); assert.equal(sentBodies.length, sends)
  const job = await one('select id,state,reason from public.inbox_autopilot_green_jobs where wa_id=$1 and inbound_message_id=$2', [G, complaint])
  gJobId = job.id
  assert.equal(job.state, 'needs_review'); assert.equal(job.reason, 'customer_issue')
  const task = await one('select * from public.inbox_autopilot_staff_tasks where customer_id=$1', [G])
  assert.equal(task.kind, 'customer_issue'); assert.equal(task.status, 'open'); assert.equal(task.job_source, 'green_api'); assert.equal(task.native_job_id, job.id); assert.equal(task.job_id, null)
  const control = await one("select paused,updated_by from public.inbox_autopilot_controls where business_code=$1 and channel='whatsapp' and owner_id=$2 and customer_id=$3", [CODE, PHONE, G])
  assert.equal(control.paused, true); assert.equal(control.updated_by, null, 'a machine hold is never dressed as a human action')
  assert.equal(await pick(), null)
})

await test('exchange request via the classifier lands in the staff queue with the specific reason', async () => {
  await webhook(D, 'in', 'Can I swap it for the bigger one?', 0)
  const cand = await pick(); assert.equal(cand?.waId, D)
  decisionFor = () => ({ language: 'en', intent: 'change_order', needsStaff: true, productId: null, productEvidence: null, quantity: null, quantityEvidence: null, name: null, phone: null, location: null })
  const sends = sentBodies.length
  const out = await runtime.runScope(scopeFor(cand!.waId))
  await scheduleModule.recordNativePass(db, scopeFor(cand!.waId), cand!.inboundMessageId, out)
  assert.equal(out.reason, 'exchange_or_change_request', JSON.stringify(out)); assert.equal(sentBodies.length, sends)
  assert.equal((await one('select kind from public.inbox_autopilot_staff_tasks where customer_id=$1', [D])).kind, 'exchange_or_change_request')
})

await test('staff queue reads oldest-open-first and spans scoped identities; Resume resolves only that scope', async () => {
  const G = '23057000007'
  const queue = (await db.query("select customer_id from public.inbox_autopilot_staff_tasks where status='open' order by created_at asc,id asc")).rows.map(r => r.customer_id)
  assert.deepEqual(queue, [G, D])
  const STAFF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' // resolved_by is a profile FK: Resume is a human decision, never a machine one
  await assert.rejects(staffModule.resolveStaffTasksOnResume(db, scopeFor(G) as any, STAFF), /resolved_by_fkey/, 'an unknown actor cannot resolve a task')
  await db.query("insert into public.profiles(id,email,name,role) values($1,'qa@akmez.test','QA Staff','admin')", [STAFF])
  await staffModule.resolveStaffTasksOnResume(db, scopeFor(G) as any, STAFF)
  const left = (await db.query("select customer_id,status,resolved_by from public.inbox_autopilot_staff_tasks order by created_at")).rows
  assert.deepEqual(left.map(r => [r.customer_id, r.status, r.resolved_by]), [[G, 'resolved', STAFF], [D, 'open', null]])
})

await test('history that cannot be proven (provider returns nothing) is left for staff, recorded, and does not starve others', async () => {
  await webhook(E, 'in', 'Hi', 60)
  history.set(E + '@c.us', [])
  const cand = await pick(); assert.equal(cand?.waId, E)
  const out = await runtime.runScope(scopeFor(cand!.waId))
  await scheduleModule.recordNativePass(db, scopeFor(cand!.waId), cand!.inboundMessageId, out)
  assert.deepEqual(out, { state: 'needs_review', reason: 'provider_history_unavailable' })
  assert.equal(await count('inbox_autopilot_green_jobs', 'wa_id=$1', [E]), 0, 'no job row before claim')
  assert.deepEqual(await one('select attempts,last_state from public.inbox_autopilot_green_passes where wa_id=$1', [E]), { attempts: 1, last_state: 'needs_review' })
  assert.equal(await pick(), null, 'E cools down instead of being re-selected immediately')
  assert.deepEqual(sentBodies.map(s => s.body.chatId), [A, B, '23057000007'].map(w => w + '@c.us'), 'only A, B (failed) and G ever reached the transport')
})

await test('daily budget exhausted: reservation fails inside the intent transaction and no transport call happens', async () => {
  // Cap exactly at what has already been reserved (A accepted, B unknown, G accepted = 3) so the next intent is the first refusal.
  const reservedSoFar = (await one('select reserved_count from public.inbox_autopilot_daily where business_code=$1', [CODE])).reserved_count
  assert.equal(reservedSoFar, 3)
  await db.query('update public.inbox_autopilot_config set max_daily_replies=$2,version=version+1 where business_code=$1', [CODE, reservedSoFar])
  const F = '23057000006', sends = sentBodies.length
  await webhook(F, 'in', 'Air Fryer price?', 0)
  decisionFor = ctx => priceDecision(ctx, products[0].id, 'Air Fryer')
  const out = await runtime.runScope(scopeFor(F))
  await scheduleModule.recordNativePass(db, scopeFor(F), (await one('select provider_message_id from public.whatsapp_green_messages where wa_id=$1', [F])).provider_message_id, out)
  assert.deepEqual(out, { state: 'needs_review', reason: 'daily_budget_exhausted' }); assert.equal(sentBodies.length, sends)
  assert.equal(await count('inbox_autopilot_green_sends', 'wa_id=$1', [F]), 0)
  await db.query('update public.inbox_autopilot_config set max_daily_replies=30,version=version+1 where business_code=$1', [CODE])
})

const H = '23057000008'
let hSentText = ''
await test('webhooks down, journal only (14 Sep production shape): the inbound is witnessed and ONE reply goes out', async () => {
  const sends = sentBodies.length, calls = classifyCalls
  const inboundId = await journal(H, 'in', 'Bonjour, prix du Sweeping Robot svp?', 45)
  assert.equal(await count('whatsapp_green_events', "wa_id=$1 and origin='webhook'", [H]), 0, 'no webhook ever arrived for H')
  assert.equal(await count('whatsapp_green_events', "wa_id=$1 and origin='journal' and state='processed'", [H]), 1)
  // A journal record carries no trusted time: the row exists but is untimed, so the selector cannot see it yet.
  assert.equal((await one('select provider_accepted_at from public.whatsapp_green_messages where wa_id=$1', [H])).provider_accepted_at, null)
  assert.equal(await pick(), null, 'untimed inbound is invisible to selection')
  // The reconcile job's history step (real store method) names the chat, then the snapshot supplies the time.
  assert.deepEqual(await store.historyCandidates(binding, 8), [H + '@c.us'])
  for (const rec of history.get(H + '@c.us')!) await store.ingest(binding, normalise.normaliseHistory(binding, rec, new Date().toISOString(), 'history'))
  assert.deepEqual(await store.historyCandidates(binding, 8), [], 'timed rows leave the candidate list')
  const cand = await pick(); assert.equal(cand?.waId, H); assert.equal(cand!.inboundMessageId, inboundId)
  decisionFor = ctx => priceDecision(ctx, products[1].id, 'Sweeping Robot')
  const out = await runtime.runScope(scopeFor(H))
  await scheduleModule.recordNativePass(db, scopeFor(H), inboundId, out)
  assert.equal(out.state, 'accepted', JSON.stringify(out)); assert.equal(out.reason, 'catalogue_price')
  assert.equal(classifyCalls, calls + 1); assert.equal(sentBodies.length, sends + 1)
  hSentText = sentBodies.at(-1)!.body.message
  assert.equal(sentBodies.at(-1)!.body.chatId, H + '@c.us'); assert.match(hSentText, /Sweeping Robot/); assert.match(hSentText, /Rs 2,200/)
  const job = await one('select * from public.inbox_autopilot_green_jobs where wa_id=$1', [H])
  const journalEvent = await one("select event_key from public.whatsapp_green_events where wa_id=$1 and origin='journal' and provider_message_id=$2", [H, inboundId])
  assert.equal(job.state, 'accepted'); assert.equal(job.inbound_message_id, inboundId); assert.equal(job.inbound_event_key, journalEvent.event_key, 'the journal record is the witness of record')
  const send = await one('select state,inbound_event_key,provider_message_id from public.inbox_autopilot_green_sends where wa_id=$1', [H])
  assert.deepEqual(send, { state: 'accepted', inbound_event_key: journalEvent.event_key, provider_message_id: sentBodies.at(-1)!.body.idMessage ?? send.provider_message_id })
})

await test('journal-only staff reply typed on the phone (sendByApi false) is still NOT ours: next inbound is held for staff', async () => {
  const sends = sentBodies.length, calls = classifyCalls
  // The provider echoes OUR send under the id sendMessage returned; the phone reply is a different id with sendByApi false.
  const ownId = (await one('select provider_message_id from public.inbox_autopilot_green_sends where wa_id=$1', [H])).provider_message_id
  assert.equal(ownId, 'BAE5QA000003')
  await journal(H, 'out', hSentText, 30, { api: true, idMessage: ownId })
  await journal(H, 'out', 'Je vous appelle tout de suite', 20)
  await journal(H, 'in', 'Ok merci', 10)
  for (const rec of history.get(H + '@c.us')!) await store.ingest(binding, normalise.normaliseHistory(binding, rec, new Date().toISOString(), 'history'))
  assert.equal((await pick())?.waId, H, 'the new inbound is selectable once timed')
  const out = await runtime.runScope(scopeFor(H))
  // The real handover reconciler reads the journal too: the phone reply becomes a held handover and the
  // controls gate closes before any context evaluation - the same protection webhooks used to give.
  assert.deepEqual(out, { state: 'needs_review', reason: 'native_controls_unavailable' })
  const held = await one("select native_message_id,disposition from public.inbox_autopilot_handoff_events where customer_id=$1 and disposition<>'proven_bot'", [H])
  assert.deepEqual(held, { native_message_id: 'JRN00000013', disposition: 'held' }, 'the phone-typed reply, not our echo, is the held handover')
  assert.equal(classifyCalls, calls, 'no model call'); assert.equal(sentBodies.length, sends, 'no second send')
  assert.equal(await count('inbox_autopilot_green_sends', 'wa_id=$1', [H]), 1)
})

await test('no Meta-side tables were written by the whole native flow', async () => {
  assert.equal(await count('inbox_autopilot_jobs'), 0)
  assert.equal(await count('whatsapp_messages'), 0)
  // The handover ledger is shared: the real reconciler settles every observed outgoing message. Our own echoes
  // must be proven ours; the Business Suite reply to A must be a held handover; nothing may come from Meta.
  const ledger = (await db.query("select customer_id,source,native_message_id,disposition from public.inbox_autopilot_handoff_events order by native_message_id")).rows
  assert.ok(ledger.length > 0, 'the real reconciler wrote nothing'); assert.ok(ledger.every(r => r.source === 'green_whatsapp'))
  console.log('      ledger:', JSON.stringify(ledger.map(r => [r.customer_id, r.native_message_id, r.disposition])))
  assert.deepEqual(ledger.filter(r => r.disposition === 'proven_bot').map(r => r.native_message_id), ['BAE5QA000001', 'BAE5QA000002', 'BAE5QA000003'], 'exactly the three accepted own sends echoed by the provider (H via journal only)')
  assert.deepEqual(ledger.filter(r => r.disposition !== 'proven_bot').map(r => [r.customer_id, r.disposition]), [[H, 'held'], [A, 'held']], 'Business Suite reply to A and the phone-typed journal reply to H are both held handovers')
  assert.equal(await count('inbox_autopilot_handoff_observations'), 0)
})

console.log(`${passed} passed, ${failed} failed`)
await sql.close()
process.exit(failed ? 1 : 0)
