import 'server-only'
import { randomUUID } from 'node:crypto'
import { AUTOPILOT_BUSINESSES, AUTOPILOT_LIMITS, AutopilotError, assertFingerprint, assertMessageId, businessOf, scopeIdentity, validateConfigPatch,
  type AutopilotConfig, type AutopilotJob, type AutopilotScope, type BusinessKey, type ConfigPatch } from './contract'

export type AutopilotRow = Record<string, any>
export type AutopilotDb = { query(sql: string, values?: unknown[]): Promise<{ rows: AutopilotRow[]; rowCount?: number | null }> }
export type AutopilotConnection = AutopilotDb & { end(): Promise<void> }
export type AutopilotConnect = () => Promise<AutopilotConnection>
export type ContextRecheck = (db: AutopilotDb, job: AutopilotJob) => Promise<{ eligible: boolean; fingerprint: string; latestInbound?: { id: string } | null }>
const iso = (v: unknown): string | null => v == null ? null : new Date(v as string).toISOString()
const keyFor = (code: string): BusinessKey => {
  if (code === 'MBM') return 'made_by_moris'
  if (code === 'DBM') return 'destockage'
  throw new AutopilotError('invalid_saved_business', 503)
}
const scopeFor = (r: AutopilotRow): AutopilotScope => r.channel === 'messenger'
  ? { businessKey: keyFor(r.business_code), channel: 'messenger', pageId: r.owner_id, psid: r.customer_id }
  : { businessKey: keyFor(r.business_code), channel: 'whatsapp', phoneNumberId: r.owner_id, waId: r.customer_id }
function jobOf(r: AutopilotRow): AutopilotJob {
  const scope = scopeFor(r), { conversationKey } = scopeIdentity(scope)
  return { id: r.id, businessKey: scope.businessKey, scope, conversationKey, customerName: r.customer_name ?? null,
    inboundMessageId: r.inbound_message_id, state: r.state, reason: r.reason, configVersion: Number(r.config_version),
    contextFingerprint: r.context_fingerprint, leaseToken: r.lease_token, leaseExpiresAt: iso(r.lease_expires_at),
    sendToken: r.send_token, providerMessageId: r.provider_message_id, draftText: r.draft_text, updatedAt: iso(r.updated_at)! }
}
function configOf(r: AutopilotRow): AutopilotConfig {
  const businessKey = keyFor(r.business_code)
  return { businessKey, name: AUTOPILOT_BUSINESSES[businessKey].name, version: Number(r.version), enabled: r.enabled,
    deliveryDate: r.delivery_date ? String(r.delivery_date).slice(0,10) : null, maxDailyReplies: r.max_daily_replies,
    repliesToday: Number(r.sent_count ?? 0), reservedToday: Number(r.reserved_count ?? 0), freeDelivery: true,
    enabledAt: iso(r.enabled_at), lastRunAt: iso(r.last_run_at), reason: !r.enabled ? 'paused' : r.date_valid === false ? 'delivery_date_expired' : null }
}
const CONFIG_SELECT = `SELECT c.*,c.delivery_date::text AS delivery_date,
  (c.delivery_date >= (clock_timestamp() AT TIME ZONE 'Indian/Mauritius')::date) AS date_valid,
  COALESCE(d.reserved_count,0) AS reserved_count,COALESCE(d.sent_count,0) AS sent_count
  FROM public.inbox_autopilot_config c LEFT JOIN public.inbox_autopilot_daily d
    ON d.business_code=c.business_code AND d.day=(clock_timestamp() AT TIME ZONE 'Indian/Mauritius')::date`

/** Inject the existing server Pg client (Pool callers adapt end() to release()). No provider calls occur here. */
export function createAutopilotStore(connect: AutopilotConnect) {
  async function tx<T>(fn: (db: AutopilotDb) => Promise<T>): Promise<T> {
    const db = await connect()
    try {
      await db.query('BEGIN')
      await db.query("SET LOCAL statement_timeout='10s'")
      await db.query("SET LOCAL lock_timeout='3s'")
      const value = await fn(db)
      await db.query('COMMIT')
      return value
    } catch (e) { await db.query('ROLLBACK').catch(() => {}); throw e }
    finally { await db.end().catch(() => {}) }
  }
  async function read<T>(fn: (db: AutopilotDb) => Promise<T>): Promise<T> {
    const db = await connect(); try { return await fn(db) } finally { await db.end().catch(() => {}) }
  }
  async function admin(db: AutopilotDb, actor: string) {
    if (!/^[a-f0-9-]{36}$/i.test(actor ?? '')) throw new AutopilotError('admin_required',403)
    const r = (await db.query('SELECT role,approved FROM public.profiles WHERE id=$1 FOR SHARE',[actor])).rows[0]
    if (r?.role !== 'admin' || !r.approved) throw new AutopilotError('admin_required',403)
  }
  async function config(db: AutopilotDb, key: BusinessKey, lock = false) {
    const r = (await db.query(CONFIG_SELECT + ' WHERE c.business_code=$1' + (lock ? ' FOR UPDATE OF c' : ''),[businessOf(key).code])).rows[0]
    if (!r) throw new AutopilotError('autopilot_schema_not_ready',503)
    return r
  }
  // Match the canonical writers. A fresh inbound/agent reply cannot commit during the final context check.
  async function lockScope(db: AutopilotDb, scope: AutopilotScope) {
    const { owner, customer } = scopeIdentity(scope)
    const keys = scope.channel === 'messenger' ? [JSON.stringify([owner,customer])] :
      [`whatsapp:customer:${customer}`,JSON.stringify(['whatsapp:conversation',owner,customer]),`green:binding:${owner}`]
    for (const key of keys) await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[key])
  }
  async function canSendOnNumber(db: AutopilotDb, scope: AutopilotScope) {
    if (scope.channel !== 'whatsapp') return true
    const r = (await db.query('SELECT page_id,can_read,can_send FROM public.whatsapp_inbox_numbers WHERE phone_number_id=$1 FOR SHARE',[scope.phoneNumberId])).rows[0]
    return Boolean(r?.can_read && r?.can_send && r.page_id === businessOf(scope.businessKey).pageId)
  }
  async function paused(db: AutopilotDb, scope: AutopilotScope) {
    const { business, owner, customer } = scopeIdentity(scope)
    return (await db.query(`SELECT paused FROM public.inbox_autopilot_controls
      WHERE business_code=$1 AND channel=$2 AND owner_id=$3 AND customer_id=$4`,[business.code,scope.channel,owner,customer])).rows[0]?.paused === true
  }
  async function existsInbound(db: AutopilotDb, scope: AutopilotScope, id: string) {
    const { owner, customer } = scopeIdentity(scope)
    const sql = scope.channel === 'messenger'
      ? "SELECT mid FROM public.messenger_messages WHERE mid=$1 AND page_id=$2 AND psid=$3 AND direction='in'"
      : "SELECT id FROM public.whatsapp_messages WHERE id=$1 AND phone_number_id=$2 AND wa_id=$3 AND direction='in' AND type<>'external' AND COALESCE(raw->>'imported','false')<>'true'"
    return (await db.query(sql,[id,owner,customer])).rows.length === 1
  }
  async function lockedJob(db: AutopilotDb, id: string) {
    const found = (await db.query('SELECT business_code FROM public.inbox_autopilot_jobs WHERE id=$1',[id])).rows[0]
    if (!found) throw new AutopilotError('job_not_found',404)
    const c = await config(db,keyFor(found.business_code),true)
    const row = (await db.query('SELECT * FROM public.inbox_autopilot_jobs WHERE id=$1 FOR UPDATE',[id])).rows[0]
    return { c, row }
  }
  async function review(db: AutopilotDb, id: string, reason: string) {
    await db.query("UPDATE public.inbox_autopilot_jobs SET state='needs_review',reason=$2,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1 AND state='processing'",[id,reason])
    return { ok: false as const, reason }
  }
  async function cancelPresend(db: AutopilotDb, code: string) {
    await db.query("UPDATE public.inbox_autopilot_jobs SET state='needs_review',reason='business_paused',lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE business_code=$1 AND state IN ('queued','processing')",[code])
  }
  async function takeover(db: AutopilotDb, actor: string, scope: AutopilotScope, isPaused: boolean) {
    const {business,owner,customer}=scopeIdentity(scope)
    await config(db,scope.businessKey,true); await lockScope(db,scope)
    await db.query(`INSERT INTO public.inbox_autopilot_controls(business_code,channel,owner_id,customer_id,paused,updated_by)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(business_code,channel,owner_id,customer_id)
      DO UPDATE SET paused=excluded.paused,updated_by=excluded.updated_by,version=inbox_autopilot_controls.version+1,updated_at=clock_timestamp()`,
      [business.code,scope.channel,owner,customer,isPaused,actor])
    if (isPaused) await db.query(`UPDATE public.inbox_autopilot_jobs SET state='needs_review',reason='manual_takeover',lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
      WHERE business_code=$1 AND channel=$2 AND owner_id=$3 AND customer_id=$4 AND state IN ('queued','processing')`,[business.code,scope.channel,owner,customer])
    return {paused:isPaused}
  }
  const safeReason = (reason: string) => /^[a-z][a-z0-9_]{0,79}$/.test(reason ?? '') ? reason : 'worker_failed'
  return {
    async listConfigs() { return read(async db => (await db.query(CONFIG_SELECT+' ORDER BY c.business_code')).rows.map(configOf)) },
    async getConfig(key: BusinessKey) { return read(async db => configOf(await config(db,key))) },
    /** A short business-wide cooldown keeps new webhook wakes from exhausting more
     * conversations while the same provider token window is still limited. */
    async replyServiceCoolingDown(key: BusinessKey) {
      return read(async db=>(await db.query(`SELECT EXISTS(SELECT 1 FROM public.inbox_autopilot_jobs
        WHERE business_code=$1 AND state='failed' AND reason='reply_service_rate_limited' AND attempts BETWEEN 1 AND 3
        AND send_token IS NULL AND send_started_at IS NULL AND provider_message_id IS NULL AND reservation_day IS NULL AND draft_text IS NULL
        AND lease_token IS NULL AND lease_expires_at IS NULL
        AND updated_at>clock_timestamp()-interval '1 minute'*LEAST(attempts,2)) AS cooling_down`,[businessOf(key).code])).rows[0]?.cooling_down===true)
    },
    async updateConfig(actor: string, key: BusinessKey, expectedVersion: number, patch: ConfigPatch) {
      validateConfigPatch(patch)
      return tx(async db => {
        await admin(db,actor); const c = await config(db,key,true)
        if (Number(c.version) !== expectedVersion) throw new AutopilotError('config_changed',409)
        const enabled = patch.enabled ?? c.enabled, delivery = patch.deliveryDate === undefined ? c.delivery_date : patch.deliveryDate
        const valid = (await db.query("SELECT $1::date BETWEEN (clock_timestamp() AT TIME ZONE 'Indian/Mauritius')::date AND (clock_timestamp() AT TIME ZONE 'Indian/Mauritius')::date+365 AS valid",[delivery])).rows[0]?.valid
        if ((enabled || patch.deliveryDate != null) && !valid) throw new AutopilotError('current_delivery_date_required')
        await db.query(`UPDATE public.inbox_autopilot_config SET enabled=$2,delivery_date=$3,max_daily_replies=$4,
          enabled_at=CASE WHEN $2 AND NOT enabled THEN clock_timestamp() ELSE enabled_at END,
          version=version+1,updated_by=$5,updated_at=clock_timestamp() WHERE business_code=$1`,
          [c.business_code,enabled,delivery,patch.maxDailyReplies ?? c.max_daily_replies,actor])
        if (!enabled) await cancelPresend(db,c.business_code)
        return configOf(await config(db,key))
      })
    },
    async pauseConfig(actor:string,key:BusinessKey) {
      return tx(async db=>{await admin(db,actor);const c=await config(db,key,true)
        await db.query('UPDATE public.inbox_autopilot_config SET enabled=false,version=version+1,updated_by=$2,updated_at=clock_timestamp() WHERE business_code=$1',[c.business_code,actor])
        await cancelPresend(db,c.business_code);return configOf(await config(db,key))})
    },
    /** A retry of a manual run UUID never advances to another customer, even after a lost HTTP response. */
    async claimRun(actor:string,key:BusinessKey,expectedVersion:number,requestId:string) {
      if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId??''))throw new AutopilotError('invalid_run_id')
      return tx(async db=>{
        await admin(db,actor);const c=await config(db,key,true)
        if(Number(c.version)!==expectedVersion)throw new AutopilotError('config_changed',409)
        if(!c.enabled||!c.date_valid)throw new AutopilotError('business_paused_or_delivery_expired',409)
        return (await db.query(`INSERT INTO public.inbox_autopilot_runs(request_id,business_code,version,actor)
          VALUES($1,$2,$3,$4) ON CONFLICT(request_id) DO NOTHING RETURNING request_id`,[requestId,c.business_code,c.version,actor])).rows.length===1
      })
    },
    async getManualTakeover(scope: AutopilotScope) { scopeIdentity(scope); return read(db => paused(db,scope)) },
    async isBlockedScope(scope: AutopilotScope) {
      scopeIdentity(scope); return read(async db => {
        const c=await config(db,scope.businessKey)
        return !c.enabled || !c.date_valid || await paused(db,scope) || !await canSendOnNumber(db,scope)
      })
    },
    async setManualTakeover(actor: string, scope: AutopilotScope, isPaused: boolean) {
      scopeIdentity(scope)
      if (typeof isPaused !== 'boolean') throw new AutopilotError('invalid_pause')
      return tx(async db => {
        await admin(db,actor)
        // An already committed send intent cannot be recalled; it remains visible as sending/unknown/sent.
        return takeover(db,actor,scope,isPaused)
      })
    },
    /** Existing manual-send routes call only after their usual authenticated inbox access check. */
    async recordHumanTakeover(actor:string,scope:AutopilotScope) {
      scopeIdentity(scope)
      return tx(async db=>{
        const p=(await db.query('SELECT role,approved FROM public.profiles WHERE id=$1 FOR SHARE',[actor])).rows[0]
        if(!p||(!p.approved&&p.role!=='admin'))throw new AutopilotError('inbox_user_required',403)
        return takeover(db,actor,scope,true)
      })
    },
    async enqueueJob(scope: AutopilotScope, inboundMessageId: string, contextFingerprint: string, customerName?: string | null, contextEligible = false) {
      const { business,owner,customer }=scopeIdentity(scope); assertMessageId(inboundMessageId); assertFingerprint(contextFingerprint)
      return tx(async db => {
        const c=await config(db,scope.businessKey,true); await lockScope(db,scope)
        if (!c.enabled || !c.date_valid || await paused(db,scope) || !await canSendOnNumber(db,scope)) return null
        if (!await existsInbound(db,scope,inboundMessageId)) throw new AutopilotError('inbound_identity_not_found',409)
        await db.query(`INSERT INTO public.inbox_autopilot_jobs(id,business_code,channel,owner_id,customer_id,inbound_message_id,customer_name,config_version,context_fingerprint)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(business_code,channel,owner_id,customer_id,inbound_message_id) DO NOTHING`,
          [randomUUID(),business.code,scope.channel,owner,customer,inboundMessageId,customerName?.slice(0,200) ?? null,c.version,contextFingerprint])
        // Freshly verified context may resolve a changed history hold, a known
        // token-rate failure, or a pre-send business pause after an explicit
        // disable/enable transition. Resumption never resets an attempt or intent.
        if (contextEligible) await db.query(`UPDATE public.inbox_autopilot_jobs SET state='queued',reason=NULL,context_fingerprint=$6,config_version=$7,
          lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
          WHERE business_code=$1 AND channel=$2 AND owner_id=$3 AND customer_id=$4 AND inbound_message_id=$5
          AND send_token IS NULL AND attempts<3
          AND ((context_fingerprint<>$6 AND (state='queued' OR (state='needs_review' AND (reason LIKE 'history\\_%' ESCAPE '\\' OR reason='context_changed'))))
            OR (state='failed' AND reason='reply_service_rate_limited' AND attempts BETWEEN 1 AND 2
              AND send_started_at IS NULL AND provider_message_id IS NULL AND reservation_day IS NULL AND draft_text IS NULL
              AND lease_token IS NULL AND lease_expires_at IS NULL AND updated_at<=clock_timestamp()-interval '1 minute'*attempts)
            OR (state='needs_review' AND reason='business_paused' AND config_version<$7
              AND EXISTS(SELECT 1 FROM public.inbox_autopilot_config resumed WHERE resumed.business_code=$1 AND resumed.enabled AND resumed.version=$7
                AND resumed.enabled_at>inbox_autopilot_jobs.updated_at)
              AND send_started_at IS NULL AND provider_message_id IS NULL AND reservation_day IS NULL AND draft_text IS NULL
              AND lease_token IS NULL AND lease_expires_at IS NULL))`,
          [business.code,scope.channel,owner,customer,inboundMessageId,contextFingerprint,c.version])
        return jobOf((await db.query(`SELECT * FROM public.inbox_autopilot_jobs WHERE business_code=$1 AND channel=$2 AND owner_id=$3 AND customer_id=$4 AND inbound_message_id=$5`,
          [business.code,scope.channel,owner,customer,inboundMessageId])).rows[0])
      })
    },
    async markQueuedNeedsReview(jobId:string,expectedConfigVersion:number,expectedContextFingerprint:string,reason:string) {
      assertFingerprint(expectedContextFingerprint)
      return tx(async db=>{
        const {row}=await lockedJob(db,jobId)
        if(row.state!=='queued'||row.send_token||Number(row.config_version)!==expectedConfigVersion||row.context_fingerprint!==expectedContextFingerprint)return false
        return (await db.query(`UPDATE public.inbox_autopilot_jobs SET state='needs_review',reason=$2,updated_at=clock_timestamp()
          WHERE id=$1 AND state='queued' AND send_token IS NULL`,[jobId,safeReason(reason)])).rowCount===1
      })
    },
    /** Call once for each business per worker pass to retain fair scheduling. */
    async claimJobs(key: BusinessKey, limit=5) {
      if (!Number.isInteger(limit) || limit<1 || limit>AUTOPILOT_LIMITS.maxJobs) throw new AutopilotError('invalid_job_limit')
      return tx(async db => {
        const c=await config(db,key,true)
        await db.query("UPDATE public.inbox_autopilot_config SET last_run_at=clock_timestamp() WHERE business_code=$1",[c.business_code])
        await db.query(`UPDATE public.inbox_autopilot_jobs SET state='unknown',reason='send_confirmation_missing',lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
          WHERE business_code=$1 AND state='sending' AND lease_expires_at<=clock_timestamp()`,[c.business_code])
        await db.query(`UPDATE public.inbox_autopilot_jobs SET state=CASE WHEN attempts>=3 THEN 'failed' ELSE 'queued' END,
          reason=CASE WHEN attempts>=3 THEN 'processing_attempt_limit' ELSE 'processing_lease_expired' END,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
          WHERE business_code=$1 AND state='processing' AND lease_expires_at<=clock_timestamp() AND send_token IS NULL`,[c.business_code])
        if (!c.enabled || !c.date_valid) return []
        const rows=(await db.query(`SELECT j.* FROM public.inbox_autopilot_jobs j WHERE business_code=$1 AND state='queued' AND attempts<3 AND send_token IS NULL
          AND NOT EXISTS(SELECT 1 FROM public.inbox_autopilot_controls t WHERE t.business_code=j.business_code AND t.channel=j.channel AND t.owner_id=j.owner_id AND t.customer_id=j.customer_id AND t.paused)
          ORDER BY CASE WHEN j.channel='messenger' THEN
            (SELECT m.created_at FROM public.messenger_messages m WHERE m.page_id=j.owner_id AND m.psid=j.customer_id AND m.mid=j.inbound_message_id)
            ELSE (SELECT m.created_at FROM public.whatsapp_messages m WHERE m.phone_number_id=j.owner_id AND m.wa_id=j.customer_id AND m.id=j.inbound_message_id) END DESC NULLS LAST,
            j.created_at DESC,j.id LIMIT $2 FOR UPDATE OF j SKIP LOCKED`,[c.business_code,limit])).rows
        const result:AutopilotJob[]=[]
        for (const r of rows) result.push(jobOf((await db.query(`UPDATE public.inbox_autopilot_jobs SET state='processing',lease_token=$2,
          lease_expires_at=clock_timestamp()+interval '120 seconds',attempts=attempts+1,reason=NULL,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,[r.id,randomUUID()])).rows[0]))
        return result
      })
    },
    async beginSend(a: { jobId:string; leaseToken:string; expectedVersion:number; expectedContextFingerprint:string; draftText:string; recheck:ContextRecheck }) {
      assertFingerprint(a.expectedContextFingerprint)
      if (!a.draftText?.trim() || a.draftText.length>4000 || typeof a.recheck!=='function') throw new AutopilotError('invalid_send_plan')
      return tx(async db => {
        const {c,row}=await lockedJob(db,a.jobId)
        if (row.state!=='processing' || row.lease_token!==a.leaseToken || row.send_token || new Date(row.lease_expires_at).getTime()<=Date.now()) return {ok:false as const,reason:'lease_unavailable'}
        const job=jobOf(row); await lockScope(db,job.scope)
        if (!c.enabled || !c.date_valid) return review(db,row.id,'business_paused_or_delivery_expired')
        if (Number(c.version)!==a.expectedVersion || Number(row.config_version)!==a.expectedVersion) return review(db,row.id,'config_changed')
        if (row.context_fingerprint!==a.expectedContextFingerprint) return review(db,row.id,'context_changed')
        if (await paused(db,job.scope)) return review(db,row.id,'manual_takeover')
        if (!await canSendOnNumber(db,job.scope)) return review(db,row.id,'number_unavailable')
        if (!await existsInbound(db,job.scope,job.inboundMessageId)) return review(db,row.id,'inbound_identity_changed')
        const checked=await a.recheck(db,job)
        if (!checked.eligible || checked.fingerprint!==row.context_fingerprint || checked.latestInbound?.id!==row.inbound_message_id) return review(db,row.id,'context_changed')
        // A previous ambiguous attempt blocks later inbound jobs for this conversation too.
        const uncertain=(await db.query(`SELECT id FROM public.inbox_autopilot_jobs WHERE business_code=$1 AND channel=$2 AND owner_id=$3 AND customer_id=$4 AND state IN ('sending','unknown') LIMIT 1`,
          [row.business_code,row.channel,row.owner_id,row.customer_id])).rows[0]
        if (uncertain) return review(db,row.id,'previous_send_unconfirmed')
        const day=(await db.query("SELECT (clock_timestamp() AT TIME ZONE 'Indian/Mauritius')::date::text AS day")).rows[0].day
        await db.query('INSERT INTO public.inbox_autopilot_daily(business_code,day) VALUES($1,$2) ON CONFLICT DO NOTHING',[row.business_code,day])
        const reserve=await db.query(`UPDATE public.inbox_autopilot_daily SET reserved_count=reserved_count+1
          WHERE business_code=$1 AND day=$2 AND reserved_count<$3 RETURNING reserved_count`,[row.business_code,day,c.max_daily_replies])
        if (!reserve.rows.length) return review(db,row.id,'daily_reply_limit')
        const sendToken=randomUUID()
        const saved=(await db.query(`UPDATE public.inbox_autopilot_jobs SET state='sending',send_token=$2,send_started_at=clock_timestamp(),reservation_day=$3,
          draft_text=$4,lease_expires_at=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,[row.id,sendToken,day,a.draftText])).rows[0]
        return {ok:true as const,job:jobOf(saved),config:configOf(c),sendToken}
      })
    },
    /** Provider acceptance evidence may finish a late unknown attempt; it never permits another send. */
    async finishSend(jobId:string,sendToken:string,providerMessageId:string,reason:string|null=null) {
      assertMessageId(providerMessageId)
      return tx(async db => {
        const {row}=await lockedJob(db,jobId)
        if (row.send_token!==sendToken || !['sending','unknown','sent'].includes(row.state)) return {ok:false,reason:'send_token_mismatch'}
        if (row.state==='sent') return {ok:row.provider_message_id===providerMessageId,reason:row.provider_message_id===providerMessageId?null:'provider_identity_conflict'}
        await db.query("UPDATE public.inbox_autopilot_jobs SET state='sent',provider_message_id=$2,reason=$3,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1",[jobId,providerMessageId,reason?safeReason(reason):null])
        await db.query('UPDATE public.inbox_autopilot_daily SET sent_count=sent_count+1 WHERE business_code=$1 AND day=$2',[row.business_code,row.reservation_day])
        return {ok:true,reason:null}
      })
    },
    async markSendUnknown(jobId:string,sendToken:string,reason='provider_outcome_unknown') {
      return tx(async db => {
        const {row}=await lockedJob(db,jobId)
        if (row.send_token!==sendToken || !['sending','unknown'].includes(row.state)) return false
        await db.query("UPDATE public.inbox_autopilot_jobs SET state='unknown',reason=$2,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1",[jobId,safeReason(reason)])
        return true
      })
    },
    async markNeedsReview(jobId:string,leaseToken:string,reason:string) {
      return tx(async db=>{const {row}=await lockedJob(db,jobId);if(row.state!=='processing'||row.lease_token!==leaseToken||row.send_token)return false;await review(db,jobId,safeReason(reason));return true})
    },
    /** Only definite pre-send failures qualify. Once sending, use markSendUnknown. */
    async markFailed(jobId:string,leaseToken:string,reason:string) {
      return tx(async db=>{const {row}=await lockedJob(db,jobId);if(row.state!=='processing'||row.lease_token!==leaseToken||row.send_token)return false;
        await db.query("UPDATE public.inbox_autopilot_jobs SET state='failed',reason=$2,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1",[jobId,safeReason(reason)]);return true})
    },
    async listRecentJobs(key?:BusinessKey,limit=50) {
      if (!Number.isInteger(limit)||limit<1||limit>50) throw new AutopilotError('invalid_job_limit')
      const code=key?businessOf(key).code:null
      return read(async db=>(await db.query('SELECT * FROM public.inbox_autopilot_jobs WHERE ($1::text IS NULL OR business_code=$1) ORDER BY updated_at DESC,id DESC LIMIT $2',[code,limit])).rows.map(jobOf))
    },
  }
}
