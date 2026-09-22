import 'server-only'
import { connectInboxDatabase } from '@/lib/messenger/pg'
import { getInboxPage, sendReply } from '@/lib/facebook/messages'
import { recordMessengerMessage } from '@/lib/messenger/store'
import { sendText } from '@/lib/whatsapp/store'
import { AUTOPILOT_BUSINESSES, AutopilotError, businessOf, type AutopilotScope, type BusinessKey } from './contract'
import { dedupeMessages, ladderState, FOLLOWUP_LAST_STEP, type LadderDecision, type LadderLedgerRow, type LadderMessage } from './followup-schedule'
import { hasExistingOrder } from './order-guard'
import { draftFollowup, type FollowupDraft } from './followup-generate'
import type { AutopilotDb as QueryDb } from './store'
type AutopilotDb = QueryDb & { end(): Promise<unknown> }

export type FollowupConfig = {
  businessKey: BusinessKey; enabled: boolean; maxPerHour: number; version: number; updatedAt: string | null
  /** Shared with reply autopilot: inbox_autopilot_config.max_daily_replies / inbox_autopilot_daily. */
  maxDaily: number; reservedToday: number; sentToday: number; freeDelivery: boolean
  sentLastHour: number
}
export type FollowupCandidate = { scope: AutopilotScope; customerName: string | null; decision: LadderDecision; hasOrder: boolean; lastText: string | null }
export type FollowupRunResult = { businessKey: BusinessKey; enabled: boolean; scanned: number; sent: number; skipped: number; held: number; notes: string[] }
/** Test seams only: a fake transport can never reach a customer, so the production guard is relaxed when one is supplied. */
export type FollowupRunDeps = { connect?: () => Promise<AutopilotDb>; send?: (scope: AutopilotScope, text: string) => Promise<string>; draft?: typeof draftFollowup; now?: () => Date }
export const FOLLOWUP_MAX_SENDS_PER_RUN = 8
const MAX_CANDIDATES_PER_CHANNEL = 40
const codeOf = (key: BusinessKey) => AUTOPILOT_BUSINESSES[key].code
const customerOf = (scope: AutopilotScope) => scope.channel === 'messenger' ? scope.psid : scope.waId
const ownerOf = (scope: AutopilotScope) => scope.channel === 'messenger' ? scope.pageId : scope.phoneNumberId
const mauritiusDay = (now: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Indian/Mauritius', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)

async function usingDb<T>(connect: () => Promise<AutopilotDb>, run: (db: AutopilotDb) => Promise<T>): Promise<T> {
  const db = await connect()
  try { return await run(db) } finally { await db.end().catch(() => {}) }
}

export async function followupConfig(key: BusinessKey, db?: AutopilotDb, now = new Date()): Promise<FollowupConfig> {
  const read = async (client: AutopilotDb) => {
    const code = codeOf(key)
    const [own, shared, daily, hour] = await Promise.all([
      client.query('SELECT enabled,max_per_hour,version,updated_at FROM public.inbox_autopilot_followups_config WHERE business_code=$1', [code]),
      client.query('SELECT max_daily_replies,free_delivery FROM public.inbox_autopilot_config WHERE business_code=$1', [code]),
      client.query('SELECT reserved_count,sent_count FROM public.inbox_autopilot_daily WHERE business_code=$1 AND day=$2', [code, mauritiusDay(now)]),
      client.query("SELECT count(*)::int AS n FROM public.inbox_autopilot_followups WHERE business_code=$1 AND state IN ('sending','sent','unknown') AND created_at>clock_timestamp()-interval '60 minutes'", [code]),
    ])
    const row = own.rows[0], s = shared.rows[0], d = daily.rows[0]
    return { businessKey: key, enabled: row?.enabled === true, maxPerHour: Number(row?.max_per_hour ?? 20), version: Number(row?.version ?? 0),
      updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
      maxDaily: Number(s?.max_daily_replies ?? 0), freeDelivery: s?.free_delivery === true,
      reservedToday: Number(d?.reserved_count ?? 0), sentToday: Number(d?.sent_count ?? 0), sentLastHour: Number(hour.rows[0]?.n ?? 0) }
  }
  return db ? read(db) : usingDb(connectInboxDatabase, read)
}

export async function setFollowupConfig(key: BusinessKey, patch: { enabled?: boolean; maxPerHour?: number }, updatedBy: string | null): Promise<FollowupConfig> {
  businessOf(key)
  if (patch.maxPerHour !== undefined && (!Number.isInteger(patch.maxPerHour) || patch.maxPerHour < 1 || patch.maxPerHour > 200)) throw new AutopilotError('invalid_hourly_limit')
  if (patch.enabled !== undefined && typeof patch.enabled !== 'boolean') throw new AutopilotError('invalid_toggle')
  return usingDb(connectInboxDatabase, async db => {
    await db.query(`INSERT INTO public.inbox_autopilot_followups_config(business_code,enabled,max_per_hour,version,updated_by)
      VALUES($1,COALESCE($2,false),COALESCE($3,20),1,$4)
      ON CONFLICT(business_code) DO UPDATE SET enabled=COALESCE($2,inbox_autopilot_followups_config.enabled),
        max_per_hour=COALESCE($3,inbox_autopilot_followups_config.max_per_hour),version=inbox_autopilot_followups_config.version+1,
        updated_by=$4,updated_at=clock_timestamp()`, [codeOf(key), patch.enabled ?? null, patch.maxPerHour ?? null, updatedBy])
    return followupConfig(key, db)
  })
}

const asMessage = (r: Record<string, any>): LadderMessage | null => {
  if (typeof r.id !== 'string' || !r.id || (r.direction !== 'in' && r.direction !== 'out') || !r.at) return null
  const at = new Date(r.at)
  if (!Number.isFinite(at.getTime())) return null
  return { id: r.id, direction: r.direction, at: at.toISOString(), text: typeof r.text === 'string' ? r.text : null, followup: r.followup === true, media: r.media === true }
}

/** Every stored message of one chat, deduped by provider id.
 * Media rows are KEPT (a customer answering with a photo is a reply, not silence); `media` lets the
 * transcript say "[photo]" instead of showing an empty line. */
async function loadThread(db: AutopilotDb, scope: AutopilotScope): Promise<LadderMessage[]> {
  const rows = scope.channel === 'messenger'
    ? (await db.query(`SELECT mid AS id,direction,created_at AS at,body AS text,COALESCE(raw->>'_akmez_followup','false')='true' AS followup,
        NOT (attachments IS NULL OR attachments IN ('null'::jsonb,'[]'::jsonb,'{}'::jsonb,'{"data":[]}'::jsonb)) AS media
        FROM public.messenger_messages WHERE page_id=$1 AND psid=$2 ORDER BY created_at DESC,mid DESC LIMIT 80`, [scope.pageId, scope.psid])).rows
    : (await db.query(`SELECT id,direction,created_at AS at,body AS text,COALESCE(raw->>'_akmez_followup','false')='true' AS followup,type<>'text' AS media
        FROM public.whatsapp_messages WHERE phone_number_id=$1 AND wa_id=$2 AND type<>'external' AND COALESCE(raw->>'imported','false')<>'true'
        ORDER BY at DESC,id DESC LIMIT 120`, [scope.phoneNumberId, scope.waId])).rows
  return dedupeMessages(rows.map(asMessage).filter((m): m is LadderMessage => !!m))
}

async function loadLedger(db: AutopilotDb, key: BusinessKey, scope: AutopilotScope): Promise<LadderLedgerRow[]> {
  const rows = (await db.query(`SELECT anchor_message_id,step,state,provider_message_id FROM public.inbox_autopilot_followups
    WHERE business_code=$1 AND channel=$2 AND owner_id=$3 AND customer_id=$4 AND created_at>clock_timestamp()-interval '7 days'`,
    [codeOf(key), scope.channel, ownerOf(scope), customerOf(scope)])).rows
  return rows.map(r => ({ anchorMessageId: r.anchor_message_id, step: Number(r.step), state: r.state, providerMessageId: r.provider_message_id ?? null }))
}

/** Chats where the newest stored message is OURS within the ladder horizon and the chat is not paused. */
async function scanChats(db: AutopilotDb, key: BusinessKey, now: Date): Promise<Array<{ scope: AutopilotScope; customerName: string | null }>> {
  const b = businessOf(key), code = b.code
  const [messenger, whatsapp] = await Promise.all([
    db.query(`SELECT c.psid,c.customer_name FROM public.messenger_conversations c
      JOIN LATERAL (SELECT direction,created_at FROM public.messenger_messages WHERE page_id=c.page_id AND psid=c.psid ORDER BY created_at DESC,mid DESC LIMIT 1) m ON true
      WHERE c.page_id=$1 AND m.direction='out' AND m.created_at>$3::timestamptz-interval '34 hours' AND m.created_at<=$3::timestamptz
      AND EXISTS(SELECT 1 FROM public.messenger_messages i WHERE i.page_id=c.page_id AND i.psid=c.psid AND i.direction='in' AND i.created_at>$3::timestamptz-interval '24 hours')
      AND NOT EXISTS(SELECT 1 FROM public.inbox_autopilot_controls t WHERE t.business_code=$2 AND t.channel='messenger' AND t.owner_id=$1 AND t.customer_id=c.psid AND t.paused)
      ORDER BY m.created_at DESC LIMIT ${MAX_CANDIDATES_PER_CHANNEL}`, [b.pageId, code, now.toISOString()]),
    db.query(`WITH u AS (
        SELECT wa_id,direction,created_at AS at,id FROM public.whatsapp_messages WHERE phone_number_id=$1 AND type<>'external' AND COALESCE(raw->>'imported','false')<>'true' AND created_at>$3::timestamptz-interval '40 hours'
      ), latest AS (SELECT DISTINCT ON (wa_id) wa_id,direction,at FROM u ORDER BY wa_id,at DESC,id DESC)
      SELECT l.wa_id,l.at,c.profile_name FROM latest l LEFT JOIN public.whatsapp_conversations c ON c.phone_number_id=$1 AND c.wa_id=l.wa_id
      WHERE l.direction='out' AND l.at>$3::timestamptz-interval '34 hours' AND l.wa_id ~ '^[0-9]{5,20}$'
      AND NOT EXISTS(SELECT 1 FROM public.inbox_autopilot_controls t WHERE t.business_code=$2 AND t.channel='whatsapp' AND t.owner_id=$1 AND t.customer_id=l.wa_id AND t.paused)
      ORDER BY l.at DESC LIMIT ${MAX_CANDIDATES_PER_CHANNEL}`, [b.phoneNumberId, code, now.toISOString()]),
  ])
  const out: Array<{ scope: AutopilotScope; customerName: string | null }> = []
  for (const r of messenger.rows) out.push({ scope: { businessKey: key, channel: 'messenger', pageId: b.pageId, psid: r.psid }, customerName: r.customer_name ?? null })
  for (const r of whatsapp.rows) out.push({ scope: { businessKey: key, channel: 'whatsapp', phoneNumberId: b.phoneNumberId, waId: r.wa_id }, customerName: r.profile_name ?? null })
  return out
}

async function evaluate(db: AutopilotDb, key: BusinessKey, chat: { scope: AutopilotScope; customerName: string | null }, now: Date, thorough = false): Promise<FollowupCandidate & { messages: LadderMessage[] }> {
  const [messages, ledger] = await Promise.all([loadThread(db, chat.scope), loadLedger(db, key, chat.scope)])
  const first = ladderState({ channel: chat.scope.channel, messages, ledger, hasOrder: false, now })
  let hasOrder = false
  // The run checks Deliveries only when a send is imminent (freshest answer, fewest queries); the
  // preview checks it for waiting chats too so staff see "order exists" at night, not a fake "wait".
  if ((first.action === 'send' || (thorough && first.action === 'wait')) && first.anchor) hasOrder = await hasExistingOrder(db, { channel: chat.scope.channel, customerId: customerOf(chat.scope), messages, anchorAt: first.anchor.at })
  const decision = hasOrder ? ladderState({ channel: chat.scope.channel, messages, ledger, hasOrder, now }) : first
  return { ...chat, decision, hasOrder, messages, lastText: messages.at(-1)?.text ?? null }
}

/** Read-only view for the dashboard and for verification: what WOULD happen now. Nothing is written or sent. */
export async function previewFollowups(key: BusinessKey, deps: FollowupRunDeps = {}): Promise<FollowupCandidate[]> {
  businessOf(key)
  return usingDb(deps.connect ?? connectInboxDatabase, async db => {
    const now = deps.now?.() ?? new Date()
    const results: FollowupCandidate[] = []
    for (const chat of await scanChats(db, key, now)) { const { messages: _m, ...rest } = await evaluate(db, key, chat, now, true); results.push(rest) }
    return results
  })
}

export async function recentFollowups(key: BusinessKey, limit = 50) {
  businessOf(key)
  return usingDb(connectInboxDatabase, async db => (await db.query(`SELECT id,channel,owner_id,customer_id,anchor_message_id,anchor_at,step,state,reason,draft_text,provider_message_id,due_at,sent_at,created_at
    FROM public.inbox_autopilot_followups WHERE business_code=$1 ORDER BY created_at DESC LIMIT $2`, [codeOf(key), Math.min(Math.max(1, limit), 200)])).rows)
}

/** Ledger rows for a set of chats, newest first - feeds the inbox badge. */
export async function followupBadges(key: BusinessKey, db: AutopilotDb) {
  const rows = (await db.query(`SELECT DISTINCT ON (channel,customer_id) channel,customer_id,step,state,reason,sent_at,due_at,created_at
    FROM public.inbox_autopilot_followups WHERE business_code=$1 AND created_at>clock_timestamp()-interval '3 days'
    ORDER BY channel,customer_id,created_at DESC`, [codeOf(key)])).rows
  return rows as Array<{ channel: 'messenger' | 'whatsapp'; customer_id: string; step: number; state: string; reason: string | null; sent_at: string | null; due_at: string; created_at: string }>
}

async function record(db: AutopilotDb, key: BusinessKey, scope: AutopilotScope, anchor: LadderMessage, step: number, state: 'skipped' | 'sending', reason: string | null, dueAt: string, draft: string | null): Promise<string | null> {
  const r = await db.query(`INSERT INTO public.inbox_autopilot_followups(business_code,channel,owner_id,customer_id,anchor_message_id,anchor_at,step,state,reason,due_at,draft_text)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING id`,
    [codeOf(key), scope.channel, ownerOf(scope), customerOf(scope), anchor.id, anchor.at, step, state, reason, dueAt, draft])
  return r.rows[0]?.id ?? null
}

/** Shared daily budget with reply autopilot; exactly the engine's reservation statement. */
async function reserveBudget(db: AutopilotDb, key: BusinessKey, maxDaily: number, now: Date): Promise<boolean> {
  const code = codeOf(key), day = mauritiusDay(now)
  if (maxDaily <= 0) return false
  await db.query('INSERT INTO public.inbox_autopilot_daily(business_code,day) VALUES($1,$2) ON CONFLICT DO NOTHING', [code, day])
  const r = await db.query('UPDATE public.inbox_autopilot_daily SET reserved_count=reserved_count+1 WHERE business_code=$1 AND day=$2 AND reserved_count<$3 AND sent_count<$3 RETURNING reserved_count', [code, day, maxDaily])
  return r.rows.length === 1
}

async function liveTransport(scope: AutopilotScope, text: string): Promise<string> {
  if (scope.channel === 'messenger') {
    const page = await getInboxPage(scope.pageId)
    if (!page || page.id !== scope.pageId) throw new AutopilotError('page_unavailable', 503)
    const result = await sendReply(page, scope.psid, text)
    if (!result.messageId) throw new AutopilotError('provider_outcome_unknown', 503)
    await recordMessengerMessage({ pageId: scope.pageId, psid: scope.psid, mid: result.messageId, direction: 'out', body: text, isEcho: false,
      createdAt: new Date().toISOString(), raw: { _akmez_followup: true } }).catch(() => {})
    return result.messageId
  }
  // The Meta Cloud API is the only WhatsApp transport. sendText stores the row itself;
  // the ladder then marks it as its own so a follow-up never counts as a human reply.
  const { id } = await sendText(scope.waId, scope.phoneNumberId, text)
  if (!id) throw new AutopilotError('provider_outcome_unknown', 503)
  const db = await connectInboxDatabase()
  try {
    await db.query(`UPDATE public.whatsapp_messages SET raw=COALESCE(raw,'{}'::jsonb)||'{"_akmez_followup":true}'::jsonb WHERE id=$1`, [id])
  } catch { /* the send succeeded; the tag is bookkeeping only */ }
  finally { await db.end().catch(() => {}) }
  return id
}

/** One worker pass for one business. Nothing here retries a send: an uncertain provider outcome is recorded as `unknown` and that step is spent. */
export async function runFollowups(key: BusinessKey, deps: FollowupRunDeps = {}): Promise<FollowupRunResult> {
  businessOf(key)
  if (!deps.send && process.env.VERCEL_ENV !== 'production') throw new AutopilotError('production_worker_required', 503)
  if (!deps.draft && !process.env.OPENAI_API_KEY) throw new AutopilotError('reply_worker_unavailable', 503)
  const send = deps.send ?? liveTransport, draft = deps.draft ?? draftFollowup
  return usingDb(deps.connect ?? connectInboxDatabase, async db => {
    const result: FollowupRunResult = { businessKey: key, enabled: false, scanned: 0, sent: 0, skipped: 0, held: 0, notes: [] }
    const lock = await db.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', ['inbox_followups:' + codeOf(key)])
    if (lock.rows[0]?.ok !== true) { result.notes.push('another_pass_running'); return result }
    try {
      const now = deps.now?.() ?? new Date()
      const config = await followupConfig(key, db, now)
      result.enabled = config.enabled
      if (!config.enabled) return result
      let hourly = config.sentLastHour
      const chats = await scanChats(db, key, now)
      result.scanned = chats.length
      const business = AUTOPILOT_BUSINESSES[key].name
      const started = Date.now()
      for (const chat of chats) {
        if (Date.now() - started > 100_000) { result.notes.push('time_budget'); break }
        if (result.sent >= FOLLOWUP_MAX_SENDS_PER_RUN) { result.notes.push('per_run_cap'); break }
        const { decision, messages } = await evaluate(db, key, chat, now)
        if (decision.action !== 'send') continue
        const { anchor, step } = decision
        for (const lower of decision.skipLower) if (await record(db, key, chat.scope, anchor, lower, 'skipped', 'backfill_lower_step', decision.dueAt, null)) result.skipped++
        if (hourly >= config.maxPerHour) { result.notes.push('hourly_cap'); break }
        // Budget before the model: no draft for a message we could not send anyway.
        if (!(await reserveBudget(db, key, config.maxDaily, now))) { result.notes.push('daily_cap'); break }
        hourly++
        const products = productsMentioned(messages, await catalogueNames(db))
        const drafted: FollowupDraft = await draft({ businessName: business, step, messages, products, freeDelivery: config.freeDelivery })
        if (!drafted.ok) {
          await record(db, key, chat.scope, anchor, step, 'skipped', drafted.reason, decision.dueAt, null)
          result.held++; continue
        }
        const id = await record(db, key, chat.scope, anchor, step, 'sending', null, decision.dueAt, drafted.text)
        if (!id) { result.notes.push('ledger_conflict'); continue }
        try {
          const providerId = await send(chat.scope, drafted.text)
          await db.query("UPDATE public.inbox_autopilot_followups SET state='sent',provider_message_id=$2,sent_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 AND state='sending'", [id, providerId])
          await db.query('UPDATE public.inbox_autopilot_daily SET sent_count=sent_count+1 WHERE business_code=$1 AND day=$2', [codeOf(key), mauritiusDay(now)])
          result.sent++
          if (step === FOLLOWUP_LAST_STEP) result.notes.push('ladder_finished')
        } catch (error) {
          const reason = (error instanceof AutopilotError ? error.code : 'provider_outcome_unknown').replace(/[^a-z_]/g, '_').slice(0, 100)
          await db.query("UPDATE public.inbox_autopilot_followups SET state='unknown',reason=$2,updated_at=clock_timestamp() WHERE id=$1 AND state='sending'", [id, reason])
          console.warn('[followups] send_unknown', { businessKey: key, channel: chat.scope.channel, step, reason })
          result.held++
        }
      }
      return result
    } finally {
      await db.query('SELECT pg_advisory_unlock(hashtext($1))', ['inbox_followups:' + codeOf(key)]).catch(() => {})
    }
  })
}

let catalogueCache: { at: number; names: string[] } | null = null
async function catalogueNames(db: AutopilotDb): Promise<string[]> {
  if (catalogueCache && Date.now() - catalogueCache.at < 60_000) return catalogueCache.names
  const rows = (await db.query('SELECT name FROM public.products WHERE is_active=true AND name IS NOT NULL LIMIT 2000')).rows
  catalogueCache = { at: Date.now(), names: rows.map(r => String(r.name)) }
  return catalogueCache.names
}
const normal = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
/** Catalogue names literally present in the thread - context for the writer, never a recommendation. */
function productsMentioned(messages: readonly LadderMessage[], names: readonly string[]): string[] {
  const text = ' ' + normal(messages.slice(-20).map(m => m.text ?? '').join(' ')) + ' '
  return names.filter(n => { const k = normal(n); return k.length >= 4 && text.includes(' ' + k + ' ') }).slice(0, 5)
}

export async function runAllFollowups() {
  return Promise.all((Object.keys(AUTOPILOT_BUSINESSES) as BusinessKey[]).map(key => runFollowups(key).catch(error => ({ businessKey: key, error: error instanceof AutopilotError ? error.code : 'followups_unavailable' }))))
}
