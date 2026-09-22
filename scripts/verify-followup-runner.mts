// Disposable-PostgreSQL run of the follow-up ladder runner: real migration, real runtime, real order guard,
// fake transport + fake writer. Proves exactly one send per (customer, anchor, step), budget/hourly caps,
// order stop, backfill "highest step only", and that a customer reply closes the ladder.
// Run: node --import tsx --import ./scripts/qa/register-pglite-inbox.mjs --conditions=react-server scripts/verify-followup-runner.mts
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

for (const key of ['DB_POSTGRES_URL', 'POSTGRES_URL', 'DB_POSTGRES_URL_NON_POOLING', 'POSTGRES_URL_NON_POOLING', 'OPENAI_API_KEY']) delete process.env[key]
for (const key of Object.keys(process.env)) if (key.startsWith('WHATSAPP_GREEN_')) delete process.env[key]
const sql = new PGlite()
const db = { query: async (text: string, params?: unknown[]) => { const r = await sql.query<Record<string, any>>(text, params as any[]); return { ...r, rowCount: r.affectedRows ?? r.rows.length } }, end: async () => {} }
;(globalThis as { __qaInboxDb?: typeof db }).__qaInboxDb = db

const runtime: typeof import('../lib/inbox-autopilot/followup-runtime.ts') = await import('../lib/inbox-autopilot/followup-runtime.ts')
const PHONE = '1090043534186338', PAGE = '308584892331429', CODE = 'MBM'

await sql.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  grant usage on schema public to anon,authenticated,service_role;
  create table public.profiles(id uuid primary key);
  create table public.products(id uuid primary key default gen_random_uuid(), name text, is_active boolean default true);
  create table public.whatsapp_messages(id text primary key, phone_number_id text, wa_id text, direction text, type text default 'text', body text, raw jsonb default '{}'::jsonb, created_at timestamptz not null default now());
  create table public.whatsapp_conversations(phone_number_id text, wa_id text, profile_name text, primary key(phone_number_id,wa_id));
  create table public.messenger_conversations(page_id text, psid text, customer_name text, primary key(page_id,psid));
  create table public.messenger_messages(mid text primary key, page_id text, psid text, direction text, body text, attachments jsonb, raw jsonb default '{}'::jsonb, created_at timestamptz not null default now());
  create table public.deliveries(id bigint generated always as identity primary key, contact_1 text, contact_2 text, status text, created_at timestamptz not null default now());
  insert into public.products(name) values ('Air Fryer Basket'),('Sweeping Robot');
`)
for (const file of ['20260914_inbox_autopilot.sql', '20260915_inbox_autopilot_followups.sql']) await sql.exec(await readFile(new URL(`./${file}`, import.meta.url), 'utf8'))
await db.query('insert into public.inbox_autopilot_config(business_code,enabled,max_daily_replies) values($1,false,30),($2,false,30) on conflict(business_code) do update set max_daily_replies=30', [CODE, 'DBM'])

let passed = 0, failed = 0
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log('ok  -', name) }
  catch (err) { failed++; console.log('FAIL-', name); console.log('     ', err instanceof Error ? err.stack?.split('\n').slice(0, 4).join('\n      ') : err) }
}
// Fixed clock: Tue 15 Sep 2026 14:00 Mauritius (10:00Z), well inside business hours.
let clock = new Date('2026-09-15T10:00:00Z')
const at = (minutesAgo: number) => new Date(clock.getTime() - minutesAgo * 60000).toISOString()
const sent: Array<{ customer: string; text: string }> = []
let nextId = 1
const deps = () => ({
  now: () => clock,
  send: async (scope: any, text: string) => { sent.push({ customer: scope.waId ?? scope.psid, text }); return `fake-${nextId++}` },
  draft: async (input: any) => ({ ok: true as const, text: `Hello, just checking in about the ${input.products[0] ?? 'item'} (step ${input.step}).`, language: 'en' as const }),
})
const wa = async (waId: string, id: string, direction: 'in' | 'out', minutesAgo: number, body: string) =>
  db.query('insert into public.whatsapp_messages(id,phone_number_id,wa_id,direction,body,created_at) values($1,$2,$3,$4,$5,$6)', [id, PHONE, waId, direction, body, at(minutesAgo)])
const ledger = async (customer: string) => (await db.query('select step,state,reason from public.inbox_autopilot_followups where customer_id=$1 order by step', [customer])).rows

await test('disabled: scans nothing, sends nothing', async () => {
  await wa('23057000001', 'a1', 'in', 60, 'Do you have the Air Fryer Basket?')
  await wa('23057000001', 'a2', 'out', 45, 'Yes, Rs 475. Shall I reserve one?')
  const r = await runtime.runFollowups('made_by_moris', deps())
  assert.equal(r.enabled, false); assert.equal(r.sent, 0); assert.equal(sent.length, 0)
})
await db.query('update public.inbox_autopilot_followups_config set enabled=true where business_code=$1', [CODE])

await test('45 min after our message -> exactly one step-1 send, ledger sent with provider id', async () => {
  const r = await runtime.runFollowups('made_by_moris', deps())
  assert.equal(r.sent, 1); assert.equal(sent.length, 1); assert.equal(sent[0].customer, '23057000001')
  assert.match(sent[0].text, /Air Fryer Basket/)
  assert.deepEqual(await ledger('23057000001'), [{ step: 1, state: 'sent', reason: null }])
  const daily = (await db.query('select reserved_count,sent_count from public.inbox_autopilot_daily where business_code=$1', [CODE])).rows[0]
  assert.deepEqual(daily, { reserved_count: 1, sent_count: 1 })
})
await test('second pass one minute later: nothing (step 2 not due, step 1 spent)', async () => {
  clock = new Date(clock.getTime() + 60000)
  const r = await runtime.runFollowups('made_by_moris', deps())
  assert.equal(r.sent, 0); assert.equal(sent.length, 1)
})
await test('our follow-up is stored as a message and does NOT restart the clock', async () => {
  await db.query("insert into public.whatsapp_messages(id,phone_number_id,wa_id,direction,body,raw,created_at) values($1,$2,$3,'out',$4,'{\"_akmez_followup\":true}',$5)", ['fake-1', PHONE, '23057000001', sent[0].text, at(0)])
  clock = new Date(clock.getTime() + 3 * 3600000)  // now 3h46m after anchor a2
  const r = await runtime.runFollowups('made_by_moris', deps())
  assert.equal(r.sent, 1); assert.equal(sent.length, 2)
  assert.deepEqual((await ledger('23057000001')).map(x => `${x.step}:${x.state}`), ['1:sent', '2:sent'])
})
await test('customer replies -> ladder closes, no step 3', async () => {
  await wa('23057000001', 'a3', 'in', 1, 'Yes please reserve it')
  clock = new Date(clock.getTime() + 3 * 3600000)
  const r = await runtime.runFollowups('made_by_moris', deps())
  assert.equal(r.sent, 0); assert.equal(sent.length, 2)
  const preview = await runtime.previewFollowups('made_by_moris', deps())
  assert.equal(preview.find(p => (p.scope as any).waId === '23057000001'), undefined, 'customer spoke last -> not a candidate at all')
})
await test('backlog anchor 9h old -> ONE send, step 3, steps 1-2 skipped backfill_lower_step', async () => {
  await wa('23057000002', 'b1', 'in', 600, 'Price of the Sweeping Robot?')
  await wa('23057000002', 'b2', 'out', 540, 'Rs 1,290 with free delivery.')
  const r = await runtime.runFollowups('made_by_moris', deps())
  assert.equal(r.sent, 1); assert.equal(r.skipped, 2)
  assert.deepEqual((await ledger('23057000002')).map(x => `${x.step}:${x.state}:${x.reason ?? ''}`), ['1:skipped:backfill_lower_step', '2:skipped:backfill_lower_step', '3:sent:'])
})
await test('order in Deliveries (last 7 digits of contact_1) -> no send, ledger says order_exists', async () => {
  await wa('23057000003', 'c1', 'in', 120, 'I want it')
  await wa('23057000003', 'c2', 'out', 100, 'Great, noted. Delivery tomorrow.')
  await db.query("insert into public.deliveries(contact_1,status,created_at) values('57000003','Confirmed',$1)", [at(30)])
  const before = sent.length
  const r = await runtime.runFollowups('made_by_moris', deps())
  assert.equal(sent.length, before)
  const preview = await runtime.previewFollowups('made_by_moris', deps())
  const row = preview.find(p => (p.scope as any).waId === '23057000003')!
  assert.equal(row.hasOrder, true); assert.equal(row.decision.action, 'stop'); assert.equal((row.decision as any).reason, 'order_exists')
  void r
})
await test('paused chat is never a candidate', async () => {
  await wa('23057000004', 'd1', 'in', 120, 'hello')
  await wa('23057000004', 'd2', 'out', 100, 'Hi, how can we help?')
  await db.query("insert into public.inbox_autopilot_controls(business_code,channel,owner_id,customer_id,paused) values($1,'whatsapp',$2,'23057000004',true)", [CODE, PHONE])
  const preview = await runtime.previewFollowups('made_by_moris', deps())
  assert.equal(preview.find(p => (p.scope as any).waId === '23057000004'), undefined)
})
await test('writer says needsStaff -> step recorded skipped, nothing sent, budget still reserved (honest count)', async () => {
  await wa('23057000005', 'e1', 'in', 120, 'my item arrived broken')
  await wa('23057000005', 'e2', 'out', 100, 'So sorry, let me check with the team.')
  const before = sent.length
  const d = deps(); d.draft = async () => ({ ok: false as const, reason: 'model_needs_staff' as const })
  await runtime.runFollowups('made_by_moris', d)
  assert.equal(sent.length, before)
  assert.deepEqual(await ledger('23057000005'), [{ step: 1, state: 'skipped', reason: 'model_needs_staff' }])
})
await test('provider outcome unknown -> row unknown, never resent on the next pass', async () => {
  await wa('23057000006', 'f1', 'in', 120, 'ok')
  await wa('23057000006', 'f2', 'out', 100, 'Let me know if you want it.')
  const d = deps(); d.send = async () => { throw new Error('socket hang up') }
  await runtime.runFollowups('made_by_moris', d)
  assert.deepEqual(await ledger('23057000006'), [{ step: 1, state: 'unknown', reason: 'provider_outcome_unknown' }])
  const before = sent.length
  await runtime.runFollowups('made_by_moris', deps())
  assert.equal(sent.length, before); assert.equal((await ledger('23057000006')).length, 1)
})
await test('hourly cap: with max_per_hour=1 and one already sent this hour, the next due chat waits', async () => {
  await db.query('update public.inbox_autopilot_followups_config set max_per_hour=1 where business_code=$1', [CODE])
  await wa('23057000007', 'g1', 'in', 120, 'price?')
  await wa('23057000007', 'g2', 'out', 100, 'Rs 300.')
  const before = sent.length
  const r = await runtime.runFollowups('made_by_moris', deps())
  assert.equal(sent.length, before); assert.ok(r.notes.includes('hourly_cap'))
  assert.deepEqual(await ledger('23057000007'), [])
  await db.query('update public.inbox_autopilot_followups_config set max_per_hour=20 where business_code=$1', [CODE])
})
await test('shared daily budget: max_daily_replies reached -> daily_cap, no send', async () => {
  await db.query('update public.inbox_autopilot_config set max_daily_replies=1 where business_code=$1', [CODE])
  const before = sent.length
  const r = await runtime.runFollowups('made_by_moris', deps())
  assert.equal(sent.length, before); assert.ok(r.notes.includes('daily_cap'))
  await db.query('update public.inbox_autopilot_config set max_daily_replies=30 where business_code=$1', [CODE])
})
await test('night: anchor 22:50 MU, pass at 23:30 MU sends nothing; pass at 08:05 MU sends step 3 only', async () => {
  clock = new Date('2026-09-15T19:30:00Z')  // 23:30 MU
  await wa('23057000008', 'h1', 'in', 50, 'still available?')
  await wa('23057000008', 'h2', 'out', 40, 'Yes it is.')   // 22:50 MU
  let r = await runtime.runFollowups('made_by_moris', deps())
  assert.equal((await ledger('23057000008')).length, 0)
  clock = new Date('2026-09-16T04:05:00Z')  // 08:05 MU - the other held chats of this run are due too, so only chat 08's ledger is pinned
  r = await runtime.runFollowups('made_by_moris', deps())
  assert.equal(sent.filter(x => x.customer === '23057000008').length, 1)
  assert.deepEqual((await ledger('23057000008')).map(x => `${x.step}:${x.state}`), ['1:skipped', '2:skipped', '3:sent'])
  void r
})
await test('messenger: customer 23h58 ago -> messenger_window_closed, no send', async () => {
  clock = new Date('2026-09-16T06:00:00Z')
  await db.query('insert into public.messenger_conversations(page_id,psid,customer_name) values($1,$2,$3)', [PAGE, '7001000000000001', 'Test Person'])
  await db.query('insert into public.messenger_messages(mid,page_id,psid,direction,body,created_at) values($1,$2,$3,$4,$5,$6)', ['m1', PAGE, '7001000000000001', 'in', 'hi', at(23 * 60 + 58)])
  await db.query('insert into public.messenger_messages(mid,page_id,psid,direction,body,created_at) values($1,$2,$3,$4,$5,$6)', ['m2', PAGE, '7001000000000001', 'out', 'Hello, how can we help?', at(60)])
  const preview = await runtime.previewFollowups('made_by_moris', deps())
  const row = preview.find(p => (p.scope as any).psid === '7001000000000001')!
  assert.equal(row.decision.action, 'stop'); assert.equal((row.decision as any).reason, 'messenger_window_closed')
  const before = sent.length
  await runtime.runFollowups('made_by_moris', deps())
  assert.equal(sent.length, before)
})
await test('messenger inside the window -> step 1 sends through the messenger scope', async () => {
  await db.query('insert into public.messenger_conversations(page_id,psid) values($1,$2)', [PAGE, '7001000000000002'])
  await db.query('insert into public.messenger_messages(mid,page_id,psid,direction,body,created_at) values($1,$2,$3,$4,$5,$6)', ['m3', PAGE, '7001000000000002', 'in', 'hello', at(90)])
  await db.query('insert into public.messenger_messages(mid,page_id,psid,direction,body,created_at) values($1,$2,$3,$4,$5,$6)', ['m4', PAGE, '7001000000000002', 'out', 'Hi there', at(50)])
  const before = sent.length
  await runtime.runFollowups('made_by_moris', deps())
  assert.equal(sent.length, before + 1); assert.equal(sent.at(-1)!.customer, '7001000000000002')
  assert.deepEqual((await ledger('7001000000000002')).map(x => `${x.step}:${x.state}`), ['1:sent'])
})
await test('unique ledger key: a second insert of the same (customer, anchor, step) is rejected', async () => {
  await assert.rejects(db.query(`insert into public.inbox_autopilot_followups(business_code,channel,owner_id,customer_id,anchor_message_id,anchor_at,step,state,due_at)
    values($1,'messenger',$2,'7001000000000002','m4',now(),1,'sending',now())`, [CODE, PAGE]))
})

console.log(`\nfollow-up runner: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
