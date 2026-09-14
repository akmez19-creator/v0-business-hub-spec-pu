// Disposable PGlite cluster check for fair native scheduling.
// Run: pnpm exec tsx --conditions=react-server scripts/verify-green-native-schedule.mts
// No live database, provider or model is touched.
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const schedule: typeof import('../lib/inbox-autopilot/green-native-schedule.ts') = await import('../lib/inbox-autopilot/green-native-schedule.ts')
const { selectNativeCandidate, recordNativePass, nativeCooldownMs, NATIVE_MAX_PASSES } = schedule

const PHONE = '1090043534186338', CODE = 'MBM', INSTANCE = 'inst-qa'
const business = { phoneNumberId: PHONE, code: CODE }
const sql = new PGlite()
const db = { query: (text: string, params?: unknown[]) => sql.query<Record<string, any>>(text, params as any[]) }
const sha = (v: string) => createHash('sha256').update(v).digest('hex')
let passed = 0, failed = 0
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; console.log('ok  -', name) }
  catch (err) { failed++; console.log('FAIL-', name); console.log('     ', err instanceof Error ? err.message : err) }
}

await sql.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  grant usage on schema public to anon,authenticated,service_role;
  create table public.profiles(id uuid primary key, email text, name text, role text);
  create table public.whatsapp_inbox_numbers(phone_number_id text primary key);
  insert into public.whatsapp_inbox_numbers values('${PHONE}'),('968962882975955');
`)
for (const file of ['create-whatsapp-green-feed.sql', '20260914_inbox_autopilot.sql', '20260914_inbox_autopilot_green_sends.sql', '20260914_inbox_autopilot_green_native_runtime.sql', '20260914_inbox_autopilot_green_native_passes.sql']) {
  await sql.exec(await readFile(new URL(`./${file}`, import.meta.url), 'utf8'))
}
await sql.exec(`
  insert into public.whatsapp_green_bindings(phone_number_id,instance_id,account_id,api_host,version,enabled) values('${PHONE}','${INSTANCE}','acct','https://api.invalid',1,true);
  insert into public.inbox_autopilot_config(business_code,enabled,delivery_date) values('${CODE}',false,null) on conflict(business_code) do nothing;
`)

let seq = 0
async function inbound(waId: string, minutesAgo: number, direction: 'in' | 'out' = 'in') {
  seq++
  const messageId = `msg-${waId}-${seq}`, eventId = randomUUID()
  await db.query('insert into public.whatsapp_green_conversations(phone_number_id,wa_id) values($1,$2) on conflict do nothing', [PHONE, waId])
  await db.query(`insert into public.whatsapp_green_events(id,phone_number_id,instance_id,event_key,payload_hash,origin,event_type,wa_id,provider_chat_id,provider_message_id,received_at,provider_timestamp,state,raw)
    values($1,$2,$3,$4,$5,'webhook','incomingMessageReceived',$6,$7,$8,clock_timestamp(),clock_timestamp()-($9::text)::interval,'processed','{}'::jsonb)`,
    [eventId, PHONE, INSTANCE, sha(eventId), sha('p' + eventId), waId, waId + '@c.us', messageId, `${minutesAgo} minutes`])
  await db.query(`insert into public.whatsapp_green_messages(id,phone_number_id,wa_id,instance_id,provider_chat_id,provider_message_id,direction,kind,body,provider_accepted_at,first_observed_at,last_observed_at,semantic_hash,first_event_id,last_event_id)
    values($1,$2,$3,$4,$5,$6,$7,'text','hello',clock_timestamp()-($8::text)::interval,clock_timestamp(),clock_timestamp(),$9,$10,$10)`,
    [randomUUID(), PHONE, waId, INSTANCE, waId + '@c.us', messageId, direction, `${minutesAgo} minutes`, sha('s' + messageId), eventId])
  return messageId
}
const pick = () => selectNativeCandidate(db, business)
const fail = (waId: string, messageId: string, reason = 'provider_history_unavailable') => recordNativePass(db, { phoneNumberId: PHONE, waId }, messageId, { state: 'needs_review', reason })
const rewind = (waId: string, messageId: string, minutes: number) => db.query(
  `update public.inbox_autopilot_green_passes set last_run_at=clock_timestamp()-($3::text)::interval,next_eligible_at=clock_timestamp()-($3::text)::interval where wa_id=$1 and inbound_message_id=$2`,
  [waId, messageId, `${minutes} minutes`])
const intentHash = async () => (await db.query(`select md5(coalesce(string_agg(t::text,'|' order by t::text),'')) as h from (
  select to_jsonb(j) as t from public.inbox_autopilot_green_jobs j union all select to_jsonb(s) from public.inbox_autopilot_green_sends s
  union all select to_jsonb(e) from public.inbox_autopilot_green_enrollments e union all select to_jsonb(h) from public.inbox_autopilot_green_history h) x`)).rows[0].h

await test('cooldown grows and is bounded', () => {
  assert.equal(nativeCooldownMs(1), 5 * 60_000); assert.equal(nativeCooldownMs(2), 10 * 60_000); assert.equal(nativeCooldownMs(3), 20 * 60_000)
  assert.equal(nativeCooldownMs(9), 30 * 60_000); assert.equal(nativeCooldownMs(0), 5 * 60_000); assert.equal(NATIVE_MAX_PASSES, 3)
})

const A = '23050000001', B = '23050000002', C = '23050000003', D = '23050000004'
const mA = await inbound(A, 1), mB = await inbound(B, 2), mC = await inbound(C, 3), mD = await inbound(D, 4)
const before = await intentHash()

await test('newest never-attempted customer is chosen first', async () => {
  const c = await pick(); assert.equal(c?.waId, A); assert.equal(c?.inboundMessageId, mA); assert.equal(c?.attempts, 0)
})
await test('a pre-claim failure moves the next pass to another customer instead of re-selecting the same one', async () => {
  const r = await fail(A, mA); assert.deepEqual(r, { attempts: 1, exhausted: false })
  assert.equal((await pick())?.waId, B); await fail(B, mB)
  assert.equal((await pick())?.waId, C); await fail(C, mC)
  assert.equal((await pick())?.waId, D); await fail(D, mD)
})
await test('with every recent customer cooling down the pass idles rather than hammering one', async () => {
  assert.equal(await pick(), null)
})
await test('a cooled-down customer becomes eligible again with its attempt count kept', async () => {
  await rewind(A, mA, 6)
  const c = await pick(); assert.equal(c?.waId, A); assert.equal(c?.attempts, 1)
  const r = await fail(A, mA); assert.deepEqual(r, { attempts: 2, exhausted: false })
  const row = (await db.query('select attempts,last_reason,next_eligible_at>clock_timestamp()+interval \'9 minutes\' as long_wait from public.inbox_autopilot_green_passes where wa_id=$1', [A])).rows[0]
  assert.equal(row.attempts, 2); assert.equal(row.last_reason, 'provider_history_unavailable'); assert.equal(row.long_wait, true)
})
await test('eligible attempted customers rotate least-recently-tried first', async () => {
  await rewind(B, mB, 30); await rewind(C, mC, 20); await rewind(D, mD, 10); await rewind(A, mA, 5)
  assert.equal((await pick())?.waId, B); await fail(B, mB)
  assert.equal((await pick())?.waId, C); await fail(C, mC)
  assert.equal((await pick())?.waId, D); await fail(D, mD)
  assert.equal((await pick())?.waId, A)
})
await test('a brand-new arrival outranks every attempted customer even with an older timestamp', async () => {
  const E = '23050000005'; const mE = await inbound(E, 20)
  const c = await pick(); assert.equal(c?.waId, E); assert.equal(c?.attempts, 0)
  await fail(E, mE)
  assert.equal((await pick())?.waId, A)
})
await test('the third failure exhausts the inbound: it is left for staff and never re-selected', async () => {
  const r = await fail(A, mA); assert.deepEqual(r, { attempts: 3, exhausted: true })
  await rewind(A, mA, 120)
  const c = await pick(); assert.notEqual(c?.waId, A)
  const extra = await fail(A, mA); assert.equal(extra.attempts, 3)
})
await test('a new inbound from an exhausted customer is a fresh key and is scheduled immediately', async () => {
  const mA2 = await inbound(A, 0)
  const c = await pick(); assert.equal(c?.waId, A); assert.equal(c?.inboundMessageId, mA2); assert.equal(c?.attempts, 0)
  await fail(A, mA2)
})
await test('a customer whose latest message is outbound is not a candidate', async () => {
  const F = '23050000006'; await inbound(F, 1); await inbound(F, 0, 'out')
  const rows = (await db.query('select wa_id from public.whatsapp_green_conversations')).rows.map(r => r.wa_id)
  assert.ok(rows.includes(F)); assert.notEqual((await pick())?.waId, F)
})
await test('a paused per-customer control excludes the customer', async () => {
  const G = '23050000007'; await inbound(G, 0)
  assert.equal((await pick())?.waId, G)
  await db.query("insert into public.inbox_autopilot_controls(business_code,channel,owner_id,customer_id,paused) values($1,'whatsapp',$2,$3,true)", [CODE, PHONE, G])
  assert.notEqual((await pick())?.waId, G)
})
await test('existing job rows keep their original exclusion: review/unknown stay out, only an abandoned processing lease is reclaimable', async () => {
  const H = '23050000008'; const mH = await inbound(H, 0)
  const historyId = randomUUID(), enrollmentId = randomUUID(), jobId = randomUUID()
  await db.query(`insert into public.inbox_autopilot_green_history(id,phone_number_id,wa_id,instance_id,account_id,binding_version,account_verified_at,fetched_at,sync_progress,records,payload_hash)
    values($1,$2,$3,$4,'acct',1,clock_timestamp(),clock_timestamp(),100,'[{}]'::jsonb,$5)`, [historyId, PHONE, H, INSTANCE, sha('h')])
  await db.query(`insert into public.inbox_autopilot_green_enrollments(id,business_code,phone_number_id,wa_id,instance_id,account_id,binding_version,mode,cutoff,reviewed_hash,trigger_message_id,history_id)
    values($1,$2,$3,$4,$5,'acct',1,'provider_verified',clock_timestamp(),$6,$7,$8)`, [enrollmentId, CODE, PHONE, H, INSTANCE, sha('r'), mH, historyId])
  await db.query(`insert into public.inbox_autopilot_green_jobs(id,business_code,phone_number_id,wa_id,instance_id,chat_id,binding_version,enrollment_id,config_version,inbound_message_id,inbound_event_key,context_fingerprint,state,lease_token,lease_expires_at,control_version)
    values($1,$2,$3,$4,$5,$6,1,$7,1,$8,$9,$10,'needs_review',null,null,0)`, [jobId, CODE, PHONE, H, INSTANCE, H + '@c.us', enrollmentId, mH, sha('e'), sha('f')])
  assert.notEqual((await pick())?.waId, H)
  await db.query("update public.inbox_autopilot_green_jobs set state='processing',lease_token=$2,lease_expires_at=clock_timestamp()-interval '1 minute' where id=$1", [jobId, randomUUID()])
  assert.equal((await pick())?.waId, H)
  await db.query("update public.inbox_autopilot_green_jobs set state='unknown',attempt_id=null,lease_token=null,lease_expires_at=null where id=$1", [jobId]).catch(() => {})
  await db.query("update public.inbox_autopilot_green_jobs set state='needs_review',lease_token=null,lease_expires_at=null where id=$1", [jobId])
  assert.notEqual((await pick())?.waId, H)
})
await test('recording a pass sanitises foreign reason strings and never writes intent, send, enrollment or history rows', async () => {
  const I = '23050000009'; const mI = await inbound(I, 0)
  await recordNativePass(db, { phoneNumberId: PHONE, waId: I }, mI, { state: 'Weird State!', reason: 'DROP TABLE x; --' })
  const row = (await db.query('select last_state,last_reason from public.inbox_autopilot_green_passes where wa_id=$1', [I])).rows[0]
  assert.equal(row.last_state, 'native_run_unavailable'); assert.equal(row.last_reason, 'native_run_unavailable')
  const jobsBefore = (await db.query('select count(*)::int as n from public.inbox_autopilot_green_jobs')).rows[0].n
  assert.equal(jobsBefore, 1)
  // A(first inbound), B, C, D, E, A(second inbound), I: one row per attempted (customer, inbound) pair.
  const ledger = (await db.query('select wa_id,inbound_message_id,attempts from public.inbox_autopilot_green_passes order by wa_id,inbound_message_id')).rows
  assert.deepEqual(ledger.map(r => [r.wa_id, r.attempts]), [[A, 3], [A, 1], [B, 2], [C, 2], [D, 2], ['23050000005', 1], [I, 1]])
})
await test('ledger constraints reject impossible rows', async () => {
  await assert.rejects(db.query(`insert into public.inbox_autopilot_green_passes(phone_number_id,wa_id,inbound_message_id,attempts,last_state,last_reason,next_eligible_at) values('1','23050000001','m',1,'x','y',clock_timestamp())`))
  await assert.rejects(db.query(`insert into public.inbox_autopilot_green_passes(phone_number_id,wa_id,inbound_message_id,attempts,last_state,last_reason,next_eligible_at) values($1,'23050000099','m',4,'x','y',clock_timestamp())`, [PHONE]))
  await assert.rejects(db.query(`insert into public.inbox_autopilot_green_passes(phone_number_id,wa_id,inbound_message_id,attempts,last_state,last_reason,last_run_at,next_eligible_at) values($1,'23050000099','m',1,'x','y',clock_timestamp(),clock_timestamp()-interval '1 minute')`, [PHONE]))
})
await test('grants match the other dormant autopilot tables (service_role only)', async () => {
  const rows = (await db.query(`select grantee,string_agg(privilege_type,',' order by privilege_type) as p from information_schema.role_table_grants where table_name='inbox_autopilot_green_passes' group by grantee`)).rows
  assert.deepEqual(rows.filter(r => r.grantee !== 'postgres').map(r => [r.grantee, r.p]), [['service_role', 'INSERT,SELECT,UPDATE']])
  const rls = (await db.query("select relrowsecurity from pg_class where relname='inbox_autopilot_green_passes'")).rows[0]
  assert.equal(rls.relrowsecurity, true)
})
await test('the pass ledger never changed intent, send, enrollment or history tables beyond the explicit fixture insert', async () => {
  // The only expected change is the fixture job/enrollment/history for customer H above.
  const now = await intentHash(); assert.notEqual(now, before)
  await db.query('delete from public.inbox_autopilot_green_jobs'); await db.query('delete from public.inbox_autopilot_green_enrollments'); await db.query('delete from public.inbox_autopilot_green_history')
  assert.equal(await intentHash(), before)
})

await sql.close()
console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
