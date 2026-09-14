import { reconcileHandoffScope, hasUnprocessedHandoff } from './handoff-runtime'
import { createGreenNativeRuntime } from './green-native-runtime'
import { nativeReleaseAllows } from './green-native-engine'
import { classifyConversation as classifyNativeConversation } from './green-native-generate'
import { recordNativeStaffTaskAndHold } from './staff-tasks'
import { PgGreenStore } from '@/lib/whatsapp-green/store'
import 'server-only'
import { connectInboxDatabase } from '@/lib/messenger/pg'
import { configuredGreenBindings } from '@/lib/whatsapp-green/config'
import { getInboxPage, sendReply, MessagingPermissionError } from '@/lib/facebook/messages'
import { FbGraphError } from '@/lib/facebook/graph'
import { PgHistoryStore } from '@/lib/messenger/recovery/history-store.mjs'
import { recordMessengerMessage } from '@/lib/messenger/store'
import { whatsappToken } from '@/lib/whatsapp/store'
import { requireWhatsAppNumber } from '@/lib/whatsapp/number-scope'
import { persistWhatsAppMessage } from '@/lib/whatsapp/persistence'
import { AUTOPILOT_BUSINESSES, AutopilotError, businessOf, scopeIdentity, type AutopilotScope, type BusinessKey } from './contract'
import { createAutopilotStore, type AutopilotDb } from './store'
import { loadTrustedContext, readTrustedContext, type ContextDependencies } from './context'
import { classifyConversation } from './generate'
import { createAutopilotEngine } from './engine'
import type { CatalogueProduct } from './policy'
import { createMessengerFreshness, type RecoveredMessengerRow } from './messenger-freshness'
import { createMessengerOwnership } from './messenger-ownership'

export const autopilotStore = createAutopilotStore(connectInboxDatabase)
const messengerOwnership=createMessengerOwnership({
  getPage:getInboxPage,
  controlsAllow:async(scope,expectedVersion)=>{
    const before=await autopilotStore.getConfig(scope.businessKey)
    if(!before.enabled || before.reason || before.version!==expectedVersion || before.reservedToday>=before.maxDailyReplies) return false
    if(await autopilotStore.isBlockedScope(scope)) return false
    const current=await autopilotStore.getConfig(scope.businessKey)
    return current.enabled && !current.reason && current.version===expectedVersion && current.reservedToday<current.maxDailyReplies
  },
  // Both Pages' existing Akmezapp001 Take control permission was enabled and
  // re-opened to verify persistence on 2026-09-14. This never changes Page routing.
  takeoverAllowed:async scope=>scope.pageId==='308584892331429' || scope.pageId==='471644012696537',
})
const keys = Object.keys(AUTOPILOT_BUSINESSES) as BusinessKey[]
// Fixed hard failures need staff review for this inbound. New inbound IDs retain
// their own scoped jobs; no send or takeover is performed by this deferral.
const HARD_MESSENGER_PREFLIGHT_REASONS: Readonly<Record<string,string>> = Object.freeze({
  messenger_history_unsupported: 'messenger_preflight_unsupported',
  messenger_history_scope_mismatch: 'messenger_preflight_scope_mismatch',
  messenger_history_invalid: 'messenger_preflight_invalid',
})
async function usingDb<T>(db: AutopilotDb | undefined, read: (db: AutopilotDb) => Promise<T>): Promise<T> {
  if (db) return read(db)
  const own = await connectInboxDatabase()
  try { return await read(own) } finally { await own.end().catch(() => {}) }
}
const messengerFreshness=createMessengerFreshness({
  getPage:getInboxPage,
  conversationId:scope=>usingDb(undefined,async db=>{
    const row=(await db.query('SELECT conversation_id FROM public.messenger_conversations WHERE page_id=$1 AND psid=$2',[scope.pageId,scope.psid])).rows[0]
    return typeof row?.conversation_id==='string'?row.conversation_id:null
  }),
  merge:async(scope,conversationId,rows)=>usingDb(undefined,async db=>{
    // Existing recovery writer: one exact-owner fill-only transaction, no read marks
    // or message sends. Provider reads finished before acquiring these locks.
    type HistoryWriter={
      transaction<T>(run:()=>Promise<T>,readOnly?:boolean):Promise<T>
      mergeRows(rows:RecoveredMessengerRow[],conversations:Array<{pageId:string;psid:string;id:string}>):Promise<unknown>
      reconcileActivity(rows:RecoveredMessengerRow[],cutoff:string):Promise<void>
    }
    // PgHistoryStore uses only query on this caller-owned connection; its legacy
    // declaration names full pg.Client. Keep that structural adapter local.
    const HistoryWriterConstructor=PgHistoryStore as unknown as new(db:AutopilotDb,options:{dryRun:boolean;reconcileRecentActivity:boolean})=>HistoryWriter
    const history=new HistoryWriterConstructor(db,{dryRun:false,reconcileRecentActivity:true})
    await history.transaction(async()=>{
      await history.mergeRows(rows,[{pageId:scope.pageId,psid:scope.psid,id:conversationId}])
      await history.reconcileActivity(rows,rows[0].created_at)
    },false)
  }),
})
function contextDependencies(): ContextDependencies {
  return {
    authorizeScope: async scope => { scopeIdentity(scope as AutopilotScope) },
    connectDatabase: connectInboxDatabase,
    getGreenBinding: async phoneNumberId => {
      const b = configuredGreenBindings().find(b => b.phoneNumberId === phoneNumberId)
      return b ? { instanceId:b.instanceId,version:b.version,enabled:b.enabled } : null
    },
  }
}
export async function trustedContext(scope: AutopilotScope, db?: AutopilotDb) {
  const deps = contextDependencies()
  const caughtUp = db ? { complete: true } : await reconcileHandoffScope(scope)
  const context = db ? await readTrustedContext(scope,deps,db) : await loadTrustedContext(scope,deps)
  // Rechecked on the final existing Meta send transaction too. Native GREEN
  // opt-in cannot let previously queued Meta WhatsApp jobs dispatch alongside it.
  const nativeSelected=scope.channel==='whatsapp'&&await usingDb(db,client=>nativeReleaseAllows(client,scope))
  const pending = nativeSelected || !caughtUp.complete || await usingDb(db, client => hasUnprocessedHandoff(client, scope))
  return pending ? { ...context, eligible: false, reasons: ['PENDING_RECONCILIATION' as const, ...context.reasons] } : context
}
export async function catalogue(scope: AutopilotScope, db?: AutopilotDb): Promise<CatalogueProduct[]> {
  scopeIdentity(scope)
  return usingDb(db,async client => {
    const rows=(await client.query(`SELECT id,name,price,bundle_prices,is_b1g1,sold_out,has_variants FROM public.products WHERE is_active=true ORDER BY id LIMIT 2001${db?' FOR SHARE':''}`)).rows
    if (!rows.length || rows.length>2000 || rows.some(p=>!p.id || !p.name)) throw new AutopilotError('catalogue_unavailable',503)
    return rows as CatalogueProduct[]
  })
}
async function savedMessage(scope:AutopilotScope,id:string,body:string) {
  return usingDb(undefined,async db => {
    const {owner,customer}=scopeIdentity(scope)
    const sql=scope.channel==='messenger'
      ? "SELECT mid FROM public.messenger_messages WHERE mid=$1 AND page_id=$2 AND psid=$3 AND direction='out' AND body=$4"
      : "SELECT id FROM public.whatsapp_messages WHERE id=$1 AND phone_number_id=$2 AND wa_id=$3 AND direction='out' AND body=$4"
    return (await db.query(sql,[id,owner,customer,body])).rows.length===1
  }).catch(()=>false)
}
async function prepareSend(scope:AutopilotScope) {
  scopeIdentity(scope)
  if (scope.channel==='messenger') {
    const page=await getInboxPage(scope.pageId)
    if (!page || page.id!==scope.pageId) throw new AutopilotError('page_unavailable',503)
    return async (text:string) => {
      if (!text.trim() || text.length>2000) throw new AutopilotError('invalid_reply')
      let result:Awaited<ReturnType<typeof sendReply>>
      try { result=await sendReply(page,scope.psid,text) }
      catch (error) {
        if (error instanceof FbGraphError || error instanceof MessagingPermissionError) {
          const safeCode=(value:unknown)=>typeof value==='number' && Number.isInteger(value) && value>=0 && value<=2147483647 ? value : null
          const code=safeCode(error.code),subcode=safeCode(error.subcode)
          if (code!==null || subcode!==null) {
            // Numeric Meta diagnostics only. Never log the error object, trace, token, recipient or reply.
            console.warn('[autopilot] messenger_rejected',{businessKey:scope.businessKey,channel:'messenger',code,subcode})
          }
        }
        throw error // The engine keeps the durable send intent unknown; no automatic resend.
      }
      if (!result.messageId) throw new AutopilotError('provider_identity_missing',503)
      await recordMessengerMessage({pageId:scope.pageId,psid:scope.psid,mid:result.messageId,direction:'out',body:text,
        isEcho:false,createdAt:new Date().toISOString(),raw:{_akmez_autopilot:true}}).catch(()=>{})
      return {messageId:result.messageId,savedLocally:await savedMessage(scope,result.messageId,text)}
    }
  }
  await requireWhatsAppNumber(scope.phoneNumberId,true)
  const token=(scope.businessKey==='destockage'?process.env.DESTOCKAGE_WHATSAPP_ACCESS_TOKEN:undefined)||whatsappToken()
  if (!token) throw new AutopilotError('number_unavailable',503)
  return async (text:string) => {
    if (!text.trim() || text.length>2000) throw new AutopilotError('invalid_reply')
    // One provider request only. An uncertain outcome is held for staff; never automatically resent.
    const response=await fetch(`https://graph.facebook.com/v21.0/${scope.phoneNumberId}/messages`,{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      signal:AbortSignal.timeout(12000),cache:'no-store',
      body:JSON.stringify({messaging_product:'whatsapp',recipient_type:'individual',to:scope.waId,type:'text',text:{preview_url:false,body:text}}),
    })
    const result=await response.json()
    const id=result?.messages?.[0]?.id
    if (!response.ok || result?.error || typeof id!=='string' || !id.trim() || id.length>2048) throw new AutopilotError('provider_outcome_unknown',503)
    await persistWhatsAppMessage({phoneNumberId:scope.phoneNumberId,waId:scope.waId,messageId:id,direction:'out',type:'text',body:text,
      timestamp:new Date().toISOString(),status:'sent',source:'send',raw:{text:{body:text},_akmez_autopilot:true}}).catch(()=>{})
    return {messageId:id,savedLocally:await savedMessage(scope,id,text)}
  }
}
const engine=createAutopilotEngine({store:autopilotStore,loadContext:trustedContext,catalogue,classify:classifyConversation,prepareSend,
  afterAcknowledged:async scope=>{await reconcileHandoffScope(scope)},
  prepareOwnership:(scope,expectedVersion)=>scope.channel==='messenger'
    ?messengerOwnership.prepare(scope,{approvedReply:true,expectedVersion}):Promise.resolve({ok:true as const,checkedAt:Date.now()}),
  verifyFreshness:(scope,context)=>messengerFreshness.verify(scope,context)})

const nativeRuntime=createGreenNativeRuntime({
  connect:connectInboxDatabase,authorizeScope:async scope=>{scopeIdentity(scope)},
  getBinding:async phone=>configuredGreenBindings().find(b=>b.phoneNumberId===phone)??null,
  configuredBindings:configuredGreenBindings,portFactory:db=>new PgGreenStore(db,configuredGreenBindings),
  catalogue,classify:classifyNativeConversation,reconcileHandoff:reconcileHandoffScope,hasUnprocessedHandoff,
  recordStaffTask:async(db,input)=>{await recordNativeStaffTaskAndHold(db,input)},
})

/** Each candidate is the newest actual inbound on its exact Page/number. Done/read flags do not hide it. */
export async function scanCandidates(key:BusinessKey):Promise<Array<{scope:AutopilotScope;inboundMessageId:string;customerName:string|null}>> {
  const b=businessOf(key)
  return usingDb(undefined,async db => {
    const queries=[
      db.query(`SELECT m.mid AS id,m.psid AS customer,c.customer_name,j.id IS NOT NULL AS retry FROM public.messenger_conversations c
        JOIN LATERAL (SELECT mid,psid,created_at,direction FROM public.messenger_messages WHERE page_id=c.page_id AND psid=c.psid ORDER BY created_at DESC,mid DESC LIMIT 1) m ON true
        LEFT JOIN public.inbox_autopilot_jobs j ON j.business_code=$2 AND j.channel='messenger' AND j.owner_id=$1 AND j.customer_id=m.psid AND j.inbound_message_id=m.mid
        WHERE c.page_id=$1 AND m.direction='in' AND m.created_at>clock_timestamp()-interval '24 hours' AND m.created_at<=clock_timestamp()
        AND NOT EXISTS(SELECT 1 FROM public.inbox_autopilot_controls t WHERE t.business_code=$2 AND t.channel='messenger' AND t.owner_id=$1 AND t.customer_id=m.psid AND t.paused)
        AND (j.id IS NULL OR (j.state='needs_review' AND (starts_with(j.reason,'history_') OR j.reason='context_changed')
            AND j.reason NOT IN ('history_messenger_history_unsupported','history_messenger_history_scope_mismatch','history_messenger_history_invalid')
            AND j.updated_at<clock_timestamp()-interval '5 minutes')
          OR (j.state='needs_review' AND j.reason='business_paused' AND j.attempts<3
            AND j.send_token IS NULL AND j.send_started_at IS NULL AND j.provider_message_id IS NULL AND j.reservation_day IS NULL AND j.draft_text IS NULL
            AND j.lease_token IS NULL AND j.lease_expires_at IS NULL
            AND EXISTS(SELECT 1 FROM public.inbox_autopilot_config resumed WHERE resumed.business_code=$2 AND resumed.enabled
              AND resumed.version>j.config_version AND resumed.enabled_at>j.updated_at))
          OR (j.state='failed' AND j.reason='reply_service_rate_limited' AND j.attempts BETWEEN 1 AND 2
            AND j.send_token IS NULL AND j.send_started_at IS NULL AND j.provider_message_id IS NULL AND j.reservation_day IS NULL AND j.draft_text IS NULL
            AND j.lease_token IS NULL AND j.lease_expires_at IS NULL AND j.updated_at<=clock_timestamp()-interval '1 minute'*j.attempts))
        ORDER BY (j.id IS NULL) DESC,m.created_at DESC,m.mid DESC LIMIT 12`,[b.pageId,b.code]),
      db.query(`SELECT m.id,m.wa_id AS customer,c.profile_name AS customer_name,j.id IS NOT NULL AS retry FROM public.whatsapp_conversations c
        JOIN LATERAL (SELECT id,wa_id,created_at,direction,type,raw FROM public.whatsapp_messages WHERE phone_number_id=c.phone_number_id AND wa_id=c.wa_id ORDER BY created_at DESC,id DESC LIMIT 1) m ON true
        LEFT JOIN public.inbox_autopilot_jobs j ON j.business_code=$2 AND j.channel='whatsapp' AND j.owner_id=$1 AND j.customer_id=m.wa_id AND j.inbound_message_id=m.id
        WHERE c.phone_number_id=$1 AND m.direction='in' AND m.type<>'external' AND COALESCE(m.raw->>'imported','false')<>'true'
        AND m.created_at>clock_timestamp()-interval '24 hours' AND m.created_at<=clock_timestamp()
        AND NOT EXISTS(SELECT 1 FROM public.inbox_autopilot_controls t WHERE t.business_code=$2 AND t.channel='whatsapp' AND t.owner_id=$1 AND t.customer_id=m.wa_id AND t.paused)
        AND (j.id IS NULL OR (j.state='needs_review' AND (starts_with(j.reason,'history_') OR j.reason='context_changed') AND j.updated_at<clock_timestamp()-interval '5 minutes')
          OR (j.state='needs_review' AND j.reason='business_paused' AND j.attempts<3
            AND j.send_token IS NULL AND j.send_started_at IS NULL AND j.provider_message_id IS NULL AND j.reservation_day IS NULL AND j.draft_text IS NULL
            AND j.lease_token IS NULL AND j.lease_expires_at IS NULL
            AND EXISTS(SELECT 1 FROM public.inbox_autopilot_config resumed WHERE resumed.business_code=$2 AND resumed.enabled
              AND resumed.version>j.config_version AND resumed.enabled_at>j.updated_at))
          OR (j.state='failed' AND j.reason='reply_service_rate_limited' AND j.attempts BETWEEN 1 AND 2
            AND j.send_token IS NULL AND j.send_started_at IS NULL AND j.provider_message_id IS NULL AND j.reservation_day IS NULL AND j.draft_text IS NULL
            AND j.lease_token IS NULL AND j.lease_expires_at IS NULL AND j.updated_at<=clock_timestamp()-interval '1 minute'*j.attempts))
        ORDER BY (j.id IS NULL) DESC,m.created_at DESC,m.id DESC LIMIT 12`,[b.phoneNumberId,b.code]),
    ]
    const [messenger,whatsapp]=await Promise.all(queries)
    const candidates:Array<{scope:AutopilotScope;inboundMessageId:string;customerName:string|null}>=[]
    // New arrivals precede history rechecks. Alternate channels within each priority
    // while retaining each channel's newest-first database order.
    for (const retry of [false,true]) {
      const m=messenger.rows.slice(0,12).filter(r=>(r.retry===true)===retry)
      const w=whatsapp.rows.slice(0,12).filter(r=>(r.retry===true)===retry)
      for (let i=0;i<Math.max(m.length,w.length);i++) {
        if (m[i]) candidates.push({scope:{businessKey:key,channel:'messenger',pageId:b.pageId,psid:m[i].customer},inboundMessageId:m[i].id,customerName:m[i].customer_name??null})
        if (w[i]) candidates.push({scope:{businessKey:key,channel:'whatsapp',phoneNumberId:b.phoneNumberId,waId:w[i].customer},inboundMessageId:w[i].id,customerName:w[i].customer_name??null})
      }
    }
    return candidates
  })
}
export async function runAutopilot(key?:BusinessKey) {
  if (process.env.VERCEL_ENV!=='production') throw new AutopilotError('production_worker_required',503)
  if (!process.env.OPENAI_API_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new AutopilotError('reply_worker_unavailable',503)
  return Promise.all((key?[key]:keys).map(async businessKey=>{
    const started=Date.now()
    const summary={businessKey,state:'completed',scanned:0,eligible:0,queued:0,review:0,skipped:0,errors:0,processed:0,sent:0,unknown:0,failed:0,elapsedMs:0,nativeState:null as string|null,nativeReason:null as string|null}
    try {
      const initial=await autopilotStore.getConfig(businessKey)
      if (!initial.enabled || initial.reason || initial.reservedToday>=initial.maxDailyReplies) { summary.state='paused_or_limited'; return summary }
      await usingDb(undefined,async lockDb=>{
        const lockKey='autopilot:worker:'+businessKey
        // A transaction-scoped lock also works through PgBouncer transaction pooling.
        // This dedicated connection does no data writes and is always rolled back.
        await lockDb.query('BEGIN READ ONLY')
        try {
          await lockDb.query("SET LOCAL idle_in_transaction_session_timeout='170s'")
          await lockDb.query("SET LOCAL statement_timeout='10s'")
          const locked=(await lockDb.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked',[lockKey])).rows[0]?.locked===true
          if (!locked) { summary.state='busy'; return }
          const canContinue=async()=>{
            if (Date.now()-started>=100000) { summary.state='time_budget'; return false }
            const current=await autopilotStore.getConfig(businessKey)
            if (!current.enabled || current.reason || current.reservedToday>=current.maxDailyReplies) { summary.state='paused_or_limited'; return false }
            if (current.version!==initial.version) { summary.state='config_changed'; return false }
            if (await autopilotStore.replyServiceCoolingDown(businessKey)) { summary.state='reply_service_rate_limited'; return false }
            if (Date.now()-started>=100000) { summary.state='time_budget'; return false }
            return true
          }
          if (!await canContinue()) return
          const nativeSelected=await usingDb(undefined,db=>nativeReleaseAllows(db,{businessKey}))
          let nativePasses=0
          if(nativeSelected){
            const business=businessOf(businessKey)
            const candidate=await usingDb(undefined,async db=>(await db.query(`SELECT c.wa_id FROM public.whatsapp_green_conversations c
              JOIN LATERAL(SELECT provider_message_id,instance_id,direction,provider_accepted_at FROM public.whatsapp_green_messages
                WHERE phone_number_id=c.phone_number_id AND wa_id=c.wa_id ORDER BY provider_accepted_at DESC NULLS LAST,id DESC LIMIT 1)m ON true
              LEFT JOIN public.inbox_autopilot_green_jobs j ON j.phone_number_id=c.phone_number_id AND j.wa_id=c.wa_id AND j.instance_id=m.instance_id AND j.inbound_message_id=m.provider_message_id
              WHERE c.phone_number_id=$1 AND m.direction='in' AND m.provider_accepted_at>clock_timestamp()-interval '24 hours' AND m.provider_accepted_at<=clock_timestamp()
                AND NOT EXISTS(SELECT 1 FROM public.inbox_autopilot_controls h WHERE h.business_code=$2 AND h.channel='whatsapp' AND h.owner_id=$1 AND h.customer_id=c.wa_id AND h.paused)
                AND (j.id IS NULL OR (j.state='processing' AND j.attempt_id IS NULL AND j.lease_expires_at<clock_timestamp()))
              ORDER BY m.provider_accepted_at DESC,c.wa_id LIMIT 1`,[business.phoneNumberId,business.code])).rows[0])
            if(candidate&&await canContinue()){
              summary.scanned++
              nativePasses++
              const result=await nativeRuntime.runScope({businessKey,channel:'whatsapp',phoneNumberId:business.phoneNumberId,waId:candidate.wa_id})
              summary.nativeState=result.state
              summary.nativeReason=/^[a-z_]{1,100}$/.test(result.reason)?result.reason:'native_run_unavailable'
              summary.processed++
              if(result.state==='accepted')summary.sent++
              else if(result.state==='unknown')summary.unknown++
              else summary.review++
            }
          }
          let enginePasses=nativePasses
          const processOne=async()=>{
            if(enginePasses>=4 || !await canContinue()) return false
            enginePasses++
            const completed=await engine.runBusiness(businessKey)
            for(const result of completed){
              summary.processed++
              if(result.state==='sent') summary.sent++
              else if(result.state==='needs_review') summary.review++
              else if(result.state==='unknown') summary.unknown++
              else if(result.state==='failed') summary.failed++
            }
            if(completed.some(result=>result.state==='failed'&&result.reason==='reply_service_rate_limited'))
              summary.state='reply_service_rate_limited'
            return completed.length>0
          }
          const candidates=await scanCandidates(businessKey)
          let messengerPreflightFailed=false,whatsappDiscoveryChecked=false
          for (const candidate of candidates) {
            const messenger=candidate.scope.channel==='messenger'
            if(!messenger&&nativeSelected){summary.skipped++;continue}
            // A failed provider preflight cannot occupy every discovery slot.
            // Preserve one WhatsApp turn after a slow failure below 60s; the
            // overall 100s budget and four serial engine passes remain.
            if (messenger && messengerPreflightFailed) { summary.skipped++; continue }
            const elapsed=Date.now()-started
            if (elapsed>=35000 && !(messengerPreflightFailed && !messenger && !whatsappDiscoveryChecked && elapsed<60000)) continue
            if (!await canContinue()) return
            if (!messenger) whatsappDiscoveryChecked=true
            summary.scanned++
            let eligibleQueued=false
            try {
              const hydrated=candidate.scope.channel==='messenger'?await messengerFreshness.hydrate(candidate.scope):{ok:true as const}
              if(!hydrated.ok){
                messengerPreflightFailed=true
                summary.errors++
                console.info('[autopilot] messenger_history_deferred',{businessKey,reason:hydrated.reason})
                const reason=Object.hasOwn(HARD_MESSENGER_PREFLIGHT_REASONS,hydrated.reason)
                  ? HARD_MESSENGER_PREFLIGHT_REASONS[hydrated.reason] : null
                if(reason){
                  const heldContext=await trustedContext(candidate.scope)
                  // False eligibility records a hold only. Existing leases,
                  // review states and send intents cannot be reset here.
                  const held=await autopilotStore.enqueueJob(candidate.scope,candidate.inboundMessageId,heldContext.fingerprint,candidate.customerName,false)
                  if(held && await autopilotStore.markQueuedNeedsReview(held.id,held.configVersion,heldContext.fingerprint,reason)) summary.review++
                  else summary.skipped++
                }
                continue // Other failures retain their existing normal-pass retry.
              }
              const context=await trustedContext(candidate.scope)
              if (context.eligible) summary.eligible++
              const job=await autopilotStore.enqueueJob(candidate.scope,candidate.inboundMessageId,context.fingerprint,candidate.customerName,context.eligible)
              if (!job) { summary.skipped++; continue }
              if (!context.eligible) {
                const first=context.reasons[0]
                const reason=typeof first==='string' && /^[A-Z_]{1,64}$/.test(first) ? 'history_'+first.toLowerCase() : 'history_needs_review'
                if (await autopilotStore.markQueuedNeedsReview(job.id,job.configVersion,context.fingerprint,reason)) summary.review++
                else summary.skipped++
              } else if (job.state==='queued') { summary.queued++; eligibleQueued=true }
              else summary.skipped++
            } catch { summary.errors++ /* No partial context reaches the model or provider. */ }
            // Do not make the first eligible customer wait for every other
            // candidate's history reads. This is one of the same four serial passes.
            if(eligibleQueued && enginePasses===0){
              await processOne()
              if(summary.state!=='completed') return
            }
          }
          // Serial and finite: the engine retains its lease, context, cap and single-send
          // checks. Never abandon a started engine promise to enforce a wall-clock cutoff.
          while(enginePasses<4){
            if(!await processOne() || summary.state!=='completed') break
          }
        } finally { await lockDb.query('ROLLBACK') }
      })
    } catch { summary.errors++; summary.state='worker_failed' }
    finally {
      if(summary.state==='completed'&&summary.nativeState&&summary.nativeState!=='accepted')summary.state='partial_native_review'
      summary.elapsedMs=Math.max(0,Date.now()-started)
      // Fixed counters only: no customer IDs, message bodies, provider output or secrets.
      console.info('[autopilot] pass',summary)
    }
    return summary
  }))
}

/** Existing human send routes call this after their own authentication and scope validation. */
export async function pauseForHumanReply(actor:string,channel:'messenger'|'whatsapp',owner:string,customer:string) {
  const businessKey=keys.find(k=>(channel==='messenger'?AUTOPILOT_BUSINESSES[k].pageId:AUTOPILOT_BUSINESSES[k].phoneNumberId)===owner)
  if (!businessKey) return
  const scope:AutopilotScope=channel==='messenger'?{businessKey,channel,pageId:owner,psid:customer}:{businessKey,channel,phoneNumberId:owner,waId:customer}
  await autopilotStore.recordHumanTakeover(actor,scope)
}
