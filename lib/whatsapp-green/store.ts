import 'server-only'
import { randomUUID } from 'node:crypto'
import { connectInboxDatabase } from '@/lib/messenger/pg'
import { requireWhatsAppNumber, validateWhatsAppScope } from '@/lib/whatsapp/number-scope'
import { configuredGreenBindings } from './config'
import { greenFail, greenScope, type GreenBinding, type GreenEvent, type GreenReadiness, type GreenBlockReason, type GreenMessageView } from './contract'
import { greenHash, stableGreenJson, normaliseWebhook, normaliseHistory } from './normalise'
import { alignReceiptsWithCopies, decodeWamid } from './receipt-match'

type Db={query:(sql:string,values?:any[])=>Promise<{rows:any[];rowCount?:number|null}>}
const iso=(v:any):string|null=>v?new Date(v).toISOString():null
/** Reasons a reconcile run records when it finished PARTIALLY, as opposed to a broken provider link. */
const RECONCILE_PROGRESS_REASONS=new Set(['HISTORY_DEFERRED','JOURNAL_TRUNCATED','OUTSIDE_RECOVERY_WINDOW','STORED_RECOVERY_DEFERRED','QUARANTINED_EVENTS'])
const activeKey=(b:GreenBinding)=>`green:v1:${b.phoneNumberId}:${b.instanceId}:journal`
const fingerprint=(b:GreenBinding)=>stableGreenJson([b.phoneNumberId,b.instanceId,b.accountId,b.apiUrl,b.version,b.enabled,b.webhookToken,b.apiToken])
export const GREEN_QUOTED_RECOVERY_RELEASE_KEY='green:quoted-current-text:v1:release'
const quotedApproval=stableGreenJson({schema:1,enabled:true,phoneNumberIds:['1090043534186338','968962882975955']})
export class PgGreenStore {
  constructor(private db:Db,private currentBindings:()=>GreenBinding[]=configuredGreenBindings){}
  private assertCurrent(b:GreenBinding){const current=this.currentBindings().find(x=>x.phoneNumberId===b.phoneNumberId);if(!current||!current.enabled||fingerprint(current)!==fingerprint(b))greenFail('PROVIDER_PAUSED_OR_CHANGED',409)}
  private async tx<T>(fn:()=>Promise<T>):Promise<T>{
    await this.db.query('BEGIN')
    try{await this.db.query("SET LOCAL lock_timeout='3s'");await this.db.query("SET LOCAL statement_timeout='10s'");const result=await fn();await this.db.query('COMMIT');return result}
    catch(error){await this.db.query('ROLLBACK').catch(()=>{});throw error}
  }
  private async quotedRecoveryEnabled():Promise<boolean>{
    const row=(await this.db.query('select cursor from public.inbox_sync_state where key=$1',[GREEN_QUOTED_RECOVERY_RELEASE_KEY])).rows[0]
    try{return typeof row?.cursor==='string'&&stableGreenJson(JSON.parse(row.cursor))===quotedApproval}catch{return false}
  }
  private async binding(b:GreenBinding){
    this.assertCurrent(b)
    await this.db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`green:binding:${b.phoneNumberId}`])
    const n=(await this.db.query('select phone_number_id,page_id,display_phone,can_read from public.whatsapp_inbox_numbers where phone_number_id=$1 for share',[b.phoneNumberId])).rows[0]
    if(!n?.can_read||n.page_id!==b.pageId||String(n.display_phone).replace(/\D/g,'')!==b.businessPhone)greenFail('BUSINESS_BINDING_MISMATCH',403)
    const old=(await this.db.query('select * from public.whatsapp_green_bindings where phone_number_id=$1 for update',[b.phoneNumberId])).rows[0]
    if(old&&(Number(old.version)>b.version||(Number(old.version)===b.version&&(old.instance_id!==b.instanceId||old.account_id!==b.accountId||old.api_host!==new URL(b.apiUrl).hostname||!old.enabled))))greenFail('BINDING_VERSION_CONFLICT',409)
    await this.db.query(`insert into public.whatsapp_green_bindings(phone_number_id,instance_id,account_id,api_host,version,enabled)
      values($1,$2,$3,$4,$5,true) on conflict(phone_number_id) do update set instance_id=excluded.instance_id,account_id=excluded.account_id,api_host=excluded.api_host,version=excluded.version,enabled=true,updated_at=clock_timestamp()`,[b.phoneNumberId,b.instanceId,b.accountId,new URL(b.apiUrl).hostname,b.version])
  }
  async ingest(b:GreenBinding,event:GreenEvent):Promise<{duplicate:boolean;stored:boolean;quarantined:boolean;reprocessed?:boolean}>{
    return this.tx(async()=>{
      await this.binding(b)
      const raw=stableGreenJson(event.raw)
      if(Buffer.byteLength(raw)>1024*1024||greenHash(raw)!==event.payloadHash||event.eventKey!==greenHash(event.origin+'\0'+event.payloadHash))greenFail('EVENT_INTEGRITY_INVALID')
      const checked=event.origin==='webhook'?normaliseWebhook(b,event.raw,event.receivedAt):normaliseHistory(b,event.raw,event.receivedAt,event.origin)
      if(stableGreenJson(checked)!==stableGreenJson(event))greenFail('EVENT_NORMALIZATION_INVALID')
      const input=event.raw as any,quoted=event.origin==='webhook'?input?.messageData?.typeMessage==='quotedMessage':input?.typeMessage==='quotedMessage'
      const quotedEnabled=!quoted||await this.quotedRecoveryEnabled()
      if(quoted&&event.observation?.kind==='text'&&!quotedEnabled){
        const o=event.observation
        const prior=(await this.db.query('select * from public.whatsapp_green_messages where phone_number_id=$1 and instance_id=$2 and provider_chat_id=$3 and provider_message_id=$4 for update',[b.phoneNumberId,b.instanceId,o.providerChatId,o.providerMessageId])).rows[0]
        // Disabled rollout uses legacy interpretation for new copies. Already enriched text
        // stays protected, and real changed current text still reaches the conflict guard.
        if(!prior||prior.kind!=='text')event=event.origin==='webhook'?normaliseWebhook(b,event.raw,event.receivedAt,false):normaliseHistory(b,event.raw,event.receivedAt,event.origin,false)
      }
      const existing=(await this.db.query('select * from public.whatsapp_green_events where phone_number_id=$1 and instance_id=$2 and event_key=$3 for update',[b.phoneNumberId,b.instanceId,event.eventKey])).rows[0]
      let reprocessed=false
      if(existing){
        const r=event.raw as any,quoted=event.origin==='webhook'?r?.messageData?.typeMessage==='quotedMessage':r?.typeMessage==='quotedMessage'
        if(existing.state!=='quarantined'||existing.reason!=='UNSUPPORTED_CONTENT'||!quoted||!quotedEnabled||event.quarantineReason||event.observation?.kind!=='text'||!event.observation.waId||event.observation.edited)
          return{duplicate:true,stored:false,quarantined:existing.state==='quarantined'}
        // A replay may improve interpretation only, never replace the original observation or its ownership.
        if(existing.phone_number_id!==b.phoneNumberId||existing.instance_id!==b.instanceId||existing.payload_hash!==event.payloadHash||existing.origin!==event.origin||stableGreenJson(existing.raw)!==raw)
          greenFail('QUOTED_RECOVERY_IDENTITY_INVALID')
        const receivedAt=iso(existing.received_at)!
        const original=event.origin==='webhook'?normaliseWebhook(b,existing.raw,receivedAt):normaliseHistory(b,existing.raw,receivedAt,event.origin)
        const o=original.observation
        if(original.eventKey!==existing.event_key||original.payloadHash!==existing.payload_hash||original.eventType!==existing.event_type||original.quarantineReason||!o?.waId||o.kind!=='text'||o.edited||o.waId!==existing.wa_id||o.providerChatId!==existing.provider_chat_id||o.providerMessageId!==existing.provider_message_id||original.providerTimestamp!==iso(existing.provider_timestamp))
          greenFail('QUOTED_RECOVERY_IDENTITY_INVALID')
        const previous=(await this.db.query('select * from public.whatsapp_green_messages where phone_number_id=$1 and instance_id=$2 and provider_chat_id=$3 and provider_message_id=$4 for update',[b.phoneNumberId,b.instanceId,o.providerChatId,o.providerMessageId])).rows[0]
        if(previous&&(previous.conflicted||previous.deleted_observed||previous.edited||previous.kind==='deleted'))return{duplicate:true,stored:false,quarantined:true}
        event=original
        reprocessed=true
      }
      const eventId=existing?.id??randomUUID(),o=event.observation
      if(reprocessed)await this.db.query("update public.whatsapp_green_events set state='processed',reason=null where id=$1 and state='quarantined' and reason='UNSUPPORTED_CONTENT'",[eventId])
      else await this.db.query(`insert into public.whatsapp_green_events(id,phone_number_id,instance_id,event_key,payload_hash,origin,event_type,wa_id,provider_chat_id,provider_message_id,received_at,provider_timestamp,state,reason,raw)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)`,[eventId,b.phoneNumberId,b.instanceId,event.eventKey,event.payloadHash,event.origin,event.eventType,o?.waId??null,o?.providerChatId??null,o?.providerMessageId??null,event.receivedAt,event.providerTimestamp,event.quarantineReason?'quarantined':'processed',event.quarantineReason,raw])
      let stored=false,quarantined=!!event.quarantineReason
      if(o?.waId&&(!event.quarantineReason||event.quarantineReason==='UNSUPPORTED_CONTENT')){
        await this.db.query(`insert into public.whatsapp_green_conversations(phone_number_id,wa_id,profile_name) values($1,$2,$3) on conflict(phone_number_id,wa_id) do update set profile_name=coalesce(excluded.profile_name,whatsapp_green_conversations.profile_name)`,[b.phoneNumberId,o.waId,o.profileName??null])
        const previous=(await this.db.query('select * from public.whatsapp_green_messages where phone_number_id=$1 and instance_id=$2 and provider_chat_id=$3 and provider_message_id=$4 for update',[b.phoneNumberId,b.instanceId,o.providerChatId,o.providerMessageId])).rows[0]
        const semanticHash=greenHash(stableGreenJson([o.waId,o.direction,o.kind,o.text]))
        // Provider acceptance time does not establish edit order. Keep changed revisions in the event ledger for review.
        const conflict=previous&&(previous.wa_id!==o.waId||previous.direction!==o.direction||(previous.semantic_hash!==semanticHash&&!(previous.kind==='unsupported'&&o.kind==='text'&&!o.edited)))
        if(conflict){
          quarantined=true
          await this.db.query("update public.whatsapp_green_events set state='quarantined',reason='PROVIDER_CONFLICT' where id=$1",[eventId])
          await this.db.query('update public.whatsapp_green_messages set conflicted=true,deleted_observed=deleted_observed or $2 where id=$1',[previous.id,o.kind==='deleted'])
        }else if(!previous){
          await this.db.query(`insert into public.whatsapp_green_messages(id,phone_number_id,wa_id,instance_id,provider_chat_id,provider_message_id,direction,kind,body,provider_accepted_at,first_observed_at,last_observed_at,edited,semantic_hash,first_event_id,last_event_id)
            values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$13,$14,$14)`,[randomUUID(),b.phoneNumberId,o.waId,b.instanceId,o.providerChatId,o.providerMessageId,o.direction,o.kind,o.text,o.providerAcceptedAt,event.receivedAt,o.edited,semanticHash,eventId])
          stored=true
        }else{
          // An old unedited snapshot cannot resurrect deleted or replace already edited content.
          const change=previous.semantic_hash!==semanticHash&&(o.kind==='deleted'||(!previous.edited&&previous.kind!=='deleted'&&(o.edited||previous.kind==='unsupported')))
          if(previous.semantic_hash!==semanticHash&&!change){quarantined=true;await this.db.query("update public.whatsapp_green_events set state='quarantined',reason='REVISION_ORDER_UNKNOWN' where id=$1",[eventId])}
          else {
            await this.db.query(`update public.whatsapp_green_messages set kind=$2,body=$3,semantic_hash=$4,edited=edited or $5,provider_accepted_at=coalesce(provider_accepted_at,$6),last_observed_at=greatest(last_observed_at,$7),last_event_id=$8 where id=$1`,[previous.id,change?o.kind:previous.kind,change?o.text:previous.body,change?semanticHash:previous.semantic_hash,o.edited,o.providerAcceptedAt,event.receivedAt,eventId])
            stored=change||(!previous.provider_accepted_at&&!!o.providerAcceptedAt)
          }
        }
        if(stored||quarantined||reprocessed)await this.db.query(`update public.whatsapp_green_conversations set context_version=context_version+1,last_observed_at=greatest(last_observed_at,$3),last_provider_accepted_at=greatest(last_provider_accepted_at,$4),updated_at=clock_timestamp() where phone_number_id=$1 and wa_id=$2`,[b.phoneNumberId,o.waId,event.receivedAt,o.providerAcceptedAt])
      }
      if(event.origin==='webhook')await this.db.query('update public.whatsapp_green_bindings set last_event_at=greatest(last_event_at,$2) where phone_number_id=$1',[b.phoneNumberId,event.receivedAt])
      if(event.eventType==='stateInstanceChanged'){
        const state=(event.raw as any)?.stateInstance
        if(state==='authorized')await this.db.query("update public.whatsapp_green_bindings set connection_state='authorized',last_error=null where phone_number_id=$1",[b.phoneNumberId])
        else if(['notAuthorized','blocked','sleepMode'].includes(state))await this.db.query("update public.whatsapp_green_bindings set connection_state='disconnected',last_error='CONNECTION_LOST' where phone_number_id=$1",[b.phoneNumberId])
      }
      if(stored||quarantined||reprocessed)await this.db.query(`insert into public.inbox_live_events as live(channel,version,updated_at) values('whatsapp',1,clock_timestamp()) on conflict(channel) do update set version=live.version+1,updated_at=clock_timestamp()`)
      this.assertCurrent(b)
      return{duplicate:false,stored,quarantined,reprocessed}
    })
  }
  /** Replay already authenticated durable quoted text. Selection never fetches provider data. */
  async recoverableQuotedEvents(b:GreenBinding,limit:number):Promise<{events:GreenEvent[];hasMore:boolean}>{
    this.assertCurrent(b)
    if(!Number.isSafeInteger(limit)||limit<1||limit>25)greenFail('QUOTED_RECOVERY_BUDGET_INVALID')
    if(!await this.quotedRecoveryEnabled())return{events:[],hasMore:false}
    const rows=(await this.db.query(`select e.* from public.whatsapp_green_events e
      where e.phone_number_id=$1 and e.instance_id=$2 and e.state='quarantined' and e.reason='UNSUPPORTED_CONTENT'
      and e.wa_id ~ '^[0-9]{5,20}$' and e.provider_chat_id=e.wa_id||'@c.us'
      and length(e.provider_message_id) between 1 and 300
      and not exists(select 1 from public.whatsapp_green_messages m where m.phone_number_id=e.phone_number_id and m.instance_id=e.instance_id and m.provider_chat_id=e.provider_chat_id and m.provider_message_id=e.provider_message_id and (m.conflicted or m.deleted_observed or m.edited or m.kind='deleted'))
      and ((e.origin='webhook' and e.raw#>>'{messageData,typeMessage}'='quotedMessage'
        and e.raw->>'typeWebhook' in ('incomingMessageReceived','outgoingMessageReceived','outgoingAPIMessageReceived')
        and e.raw->>'idMessage'=e.provider_message_id and e.raw#>>'{senderData,chatId}'=e.provider_chat_id
        and e.raw#>>'{instanceData,idInstance}'=$2 and e.raw#>>'{instanceData,typeInstance}'='whatsapp'
        and e.raw#>>'{instanceData,wid}' in ($4,$5)
        and jsonb_typeof(e.raw#>'{messageData,extendedTextMessageData,text}')='string'
        and length(btrim(e.raw#>>'{messageData,extendedTextMessageData,text}')) between 1 and 16000)
      or (e.origin in ('history','journal') and e.raw->>'typeMessage'='quotedMessage'
        and e.raw->>'type' in ('incoming','outgoing') and e.raw->>'idMessage'=e.provider_message_id and e.raw->>'chatId'=e.provider_chat_id
        and (not(e.raw?'isEdited') or e.raw->'isEdited'='false'::jsonb)
        and (not(e.raw?'isDeleted') or e.raw->'isDeleted'='false'::jsonb)
        and jsonb_typeof(e.raw#>'{extendedTextMessage,text}')='string'
        and length(btrim(e.raw#>>'{extendedTextMessage,text}')) between 1 and 16000))
      order by e.received_at,e.id limit $3`,[b.phoneNumberId,b.instanceId,limit+1,b.accountId,b.businessPhone+'@c.us'])).rows
    const events=rows.slice(0,limit).map(r=>{
      const event=r.origin==='webhook'?normaliseWebhook(b,r.raw,iso(r.received_at)!):normaliseHistory(b,r.raw,iso(r.received_at)!,r.origin)
      if(event.eventKey!==r.event_key||event.payloadHash!==r.payload_hash||event.quarantineReason||event.observation?.kind!=='text'||event.observation.waId!==r.wa_id||event.observation.providerChatId!==r.provider_chat_id||event.observation.providerMessageId!==r.provider_message_id)greenFail('QUOTED_RECOVERY_IDENTITY_INVALID')
      return event
    })
    this.assertCurrent(b)
    return{events,hasMore:rows.length>limit}
  }
  /** Chats holding readable messages that still have no provider acceptance time. A journal record deliberately
   * carries no trusted time, so a journal-only message stays untimed until a getChatHistory snapshot arrives -
   * and untimed rows are invisible to the Autopilot selector (ORDER BY provider_accepted_at ... NULLS LAST,
   * 24h window). Measured 14 Sep after live webhooks stopped: 317 of 369 inbound messages sat untimed. */
  async historyCandidates(b:GreenBinding,limit:number):Promise<string[]>{
    this.assertCurrent(b)
    if(!Number.isSafeInteger(limit)||limit<1||limit>50)greenFail('HISTORY_CANDIDATE_BUDGET_INVALID')
    return(await this.db.query(`select m.provider_chat_id from public.whatsapp_green_messages m
      where m.phone_number_id=$1 and m.instance_id=$2 and m.provider_accepted_at is null and m.kind='text'
        and not m.conflicted and not m.deleted_observed and m.wa_id ~ '^[0-9]{5,20}$' and m.provider_chat_id=m.wa_id||'@c.us'
      group by m.provider_chat_id order by max(m.first_observed_at) desc,m.provider_chat_id limit $3`,[b.phoneNumberId,b.instanceId,limit])).rows.map(r=>String(r.provider_chat_id))
  }
  async acquire(b:GreenBinding,runId:string,expiresAt:string):Promise<boolean>{return this.tx(async()=>{await this.binding(b);const key=activeKey(b);await this.db.query('insert into public.inbox_sync_state(key,cursor) values($1,$2) on conflict do nothing',[key,'{}']);const row=(await this.db.query('select cursor from public.inbox_sync_state where key=$1 for update',[key])).rows[0];const state=JSON.parse(row.cursor||'{}');if(state.runId&&Date.parse(state.expiresAt)>Date.now())return false;await this.db.query('update public.inbox_sync_state set cursor=$2,last_run_at=clock_timestamp(),updated_at=clock_timestamp() where key=$1',[key,JSON.stringify({...state,runId,expiresAt,version:b.version})]);return true})}
  async isCurrent(b:GreenBinding,runId:string):Promise<boolean>{try{this.assertCurrent(b);const row=(await this.db.query('select cursor from public.inbox_sync_state where key=$1',[activeKey(b)])).rows[0];const state=JSON.parse(row?.cursor||'{}');return state.runId===runId&&state.version===b.version&&Date.parse(state.expiresAt)>Date.now()}catch{return false}}
  async readCheckpoint(b:GreenBinding):Promise<string|null>{const row=(await this.db.query('select cursor from public.inbox_sync_state where key=$1',[activeKey(b)])).rows[0];const state=JSON.parse(row?.cursor||'{}');return typeof state.checkpoint==='string'?state.checkpoint:null}
  async existingEventKeys(b:GreenBinding,keys:string[]):Promise<string[]>{this.assertCurrent(b);if(keys.length>20000||keys.some(k=>!/^[0-9a-f]{64}$/.test(k)))greenFail('EVENT_KEY_BUDGET_INVALID');if(!keys.length)return[];return(await this.db.query('select event_key from public.whatsapp_green_events where phone_number_id=$1 and instance_id=$2 and event_key=any($3::text[])',[b.phoneNumberId,b.instanceId,keys])).rows.map(r=>r.event_key)}
  async commitCheckpoint(b:GreenBinding,runId:string,startedAt:string):Promise<boolean>{return this.tx(async()=>{await this.binding(b);const row=(await this.db.query('select cursor from public.inbox_sync_state where key=$1 for update',[activeKey(b)])).rows[0];const state=JSON.parse(row?.cursor||'{}');if(state.runId!==runId||state.version!==b.version||Date.parse(state.expiresAt)<=Date.now())return false;await this.db.query('update public.inbox_sync_state set cursor=$2,last_ok_at=clock_timestamp(),last_error=null,updated_at=clock_timestamp() where key=$1',[activeKey(b),JSON.stringify({...state,checkpoint:startedAt})]);await this.db.query("update public.whatsapp_green_bindings set last_reconcile_at=clock_timestamp(),connection_state='authorized' where phone_number_id=$1",[b.phoneNumberId]);return true})}
  async recordResult(b:GreenBinding,runId:string,result:{state:string;reason:string|null;journalRows:number;historyRows:number;stored:number;duplicates:number;quarantined:number;outsideRecoveryWindow:boolean;truncated:boolean;historyDeferred:boolean;reprocessedStoredEvents?:number;storedRecoveryDeferred?:boolean;coverage:'unknown'}):Promise<void>{
    await this.tx(async()=>{await this.binding(b);const row=(await this.db.query('select cursor from public.inbox_sync_state where key=$1 for update',[activeKey(b)])).rows[0];const state=JSON.parse(row?.cursor||'{}');if(state.runId!==runId||state.version!==b.version)return
      const reason=result.reason&&/^[A-Z_]{1,80}$/.test(result.reason)?result.reason:result.state==='completed'?null:'RECONCILIATION_INCOMPLETE'
      const summary={state:['completed','partial','busy','paused','failed'].includes(result.state)?result.state:'failed',reason,journalRows:Math.max(0,result.journalRows),historyRows:Math.max(0,result.historyRows),stored:Math.max(0,result.stored),duplicates:Math.max(0,result.duplicates),quarantined:Math.max(0,result.quarantined),outsideRecoveryWindow:result.outsideRecoveryWindow===true,truncated:result.truncated===true,historyDeferred:result.historyDeferred===true,reprocessedStoredEvents:Math.max(0,Math.min(25,result.reprocessedStoredEvents??0)),storedRecoveryDeferred:result.storedRecoveryDeferred===true,coverage:'unknown'}
      await this.db.query('update public.inbox_sync_state set cursor=$2,last_error=$3,updated_at=clock_timestamp() where key=$1',[activeKey(b),JSON.stringify({...state,lastResult:summary}),reason])
      await this.db.query('update public.whatsapp_green_bindings set last_error=$2 where phone_number_id=$1',[b.phoneNumberId,reason])
    })
  }
  async release(b:GreenBinding,runId:string):Promise<void>{await this.tx(async()=>{const row=(await this.db.query('select cursor from public.inbox_sync_state where key=$1 for update',[activeKey(b)])).rows[0];const state=JSON.parse(row?.cursor||'{}');if(state.runId!==runId)return;delete state.runId;delete state.expiresAt;await this.db.query('update public.inbox_sync_state set cursor=$2,updated_at=clock_timestamp() where key=$1',[activeKey(b),JSON.stringify(state)])})}
}

export async function readGreenReadiness(db:Db,phoneNumberId:string,waId:string):Promise<GreenReadiness>{
  validateWhatsAppScope(waId,phoneNumberId)
  const canonical=(await db.query(`select id,wa_id,direction,type,body,media_id,created_at,
    (type='external' or coalesce(raw #>> '{_inbox,receiptOnly}','false')='true') as receipt_only
    from public.whatsapp_messages where phone_number_id=$1 and wa_id=$2 order by created_at desc,id desc limit 2000`,[phoneNumberId,waId])).rows
  const copies=(await db.query(`select provider_message_id,wa_id,direction,kind,body,provider_accepted_at,deleted_observed,conflicted
    from public.whatsapp_green_messages where phone_number_id=$1 and wa_id=$2 order by first_observed_at desc,id desc limit 2000`,[phoneNumberId,waId])).rows
  const alignment=alignReceiptsWithCopies(canonical.map(r=>({...r,receiptOnly:r.receipt_only===true})),copies)
  const c={total:canonical.length,missing:alignment.unresolvedOriginalCount,
    unsupported:canonical.filter(r=>r.type!=='external'&&(r.type!=='text'||r.media_id||!(r.body??'').trim())).length}
  // A copy is unaligned when no original carries its id; copies that fill a receipt are aligned by identity.
  const g={total:alignment.unalignedCopyCount,conflicts:copies.filter(r=>r.conflicted).length,unsupported:copies.filter(r=>r.kind!=='text').length}
  const pending=(await db.query(`select count(*)::integer as count from public.whatsapp_green_events where phone_number_id=$1 and (wa_id=$2 or wa_id is null) and state='quarantined'`,[phoneNumberId,waId])).rows[0]
  const revision=(await db.query(`select coalesce((select context_version from public.whatsapp_green_conversations where phone_number_id=$1 and wa_id=$2),0)+coalesce((select activity_version from public.whatsapp_conversations where phone_number_id=$1 and wa_id=$2),0) as version`,[phoneNumberId,waId])).rows[0]
  const binding=(await db.query('select enabled,connection_state,last_error from public.whatsapp_green_bindings where phone_number_id=$1',[phoneNumberId])).rows[0]
  const draftReasons:GreenBlockReason[]=[]
  if(Number(c.missing)>0)draftReasons.push('ORIGINAL_CONTENT_MISSING')
  if(Number(c.unsupported)>0||Number(g.unsupported)>0)draftReasons.push('UNSUPPORTED_CONTENT')
  if(Number(c.total)>100)draftReasons.push('HISTORY_TRUNCATED')
  if(Number(g.conflicts)>0)draftReasons.push('PROVIDER_CONFLICT')
  if(Number(pending.count)>0)draftReasons.push('PENDING_RECONCILIATION')
  // Readable copies without a Meta row are folded into both the thread and the draft transcript
  // (listMessages / loadWhatsAppDraftContext), so they no longer block; the count stays reported.
  if(!Number(c.total)&&!Number(g.total))draftReasons.push('NO_READABLE_CONTEXT')
  // A partial reconcile (other chats' history still queued) is account-wide progress, not a connection fault;
  // this chat's own gaps are already counted above. Only a lost/disabled/unauthorized link blocks here.
  if(binding&&(!binding.enabled||binding.connection_state!=='authorized'||(binding.last_error&&!RECONCILE_PROGRESS_REASONS.has(binding.last_error))))draftReasons.push('CONNECTION_UNVERIFIED')
  return {allowed:false,canDraft:draftReasons.length===0,reasons:['OBSERVATION_MODE','COVERAGE_UNKNOWN',...draftReasons],draftReasons,contextVersion:Number(revision.version),unresolvedOriginalCount:Number(c.missing),unsupportedOriginalCount:Number(c.unsupported),canonicalHasMore:Number(c.total)>100,providerConflictCount:Number(g.conflicts),pendingProviderCount:Number(pending.count),providerUnalignedCount:Number(g.total),coverage:'unknown',mode:'observation'}
}
export async function getGreenReadiness(scope:{phoneNumberId:string;waId:string}):Promise<GreenReadiness>{validateWhatsAppScope(scope.waId,scope.phoneNumberId);await requireWhatsAppNumber(scope.phoneNumberId);const db=await connectInboxDatabase();try{await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const result=await readGreenReadiness(db,scope.phoneNumberId,scope.waId);await db.query('COMMIT');return result}finally{await db.end().catch(()=>{})}}
export async function readGreenConversation(scope:{phoneNumberId:string;waId:string},cursor?:string){
  validateWhatsAppScope(scope.waId,scope.phoneNumberId);await requireWhatsAppNumber(scope.phoneNumberId)
  let before:null|[string,string]=null
  if(cursor){try{if(cursor.length>1000)throw Error();const parsed=JSON.parse(Buffer.from(cursor,'base64url').toString());if(!Array.isArray(parsed)||parsed.length!==4||parsed[0]!==scope.phoneNumberId||parsed[1]!==scope.waId||!Number.isFinite(Date.parse(parsed[2]))||!/^[0-9a-f-]{36}$/.test(parsed[3]))throw Error();before=[parsed[2],parsed[3]]}catch{greenFail('INVALID_CURSOR')}}
  const db=await connectInboxDatabase()
  try{
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const b=(await db.query('select * from public.whatsapp_green_bindings where phone_number_id=$1',[scope.phoneNumberId])).rows[0]
    const config=configuredGreenBindings().find(x=>x.phoneNumberId===scope.phoneNumberId)
    const rows=(await db.query(`select * from public.whatsapp_green_messages where phone_number_id=$1 and wa_id=$2 and ($3::timestamptz is null or (first_observed_at,id)<($3::timestamptz,$4::uuid)) order by first_observed_at desc,id desc limit 101`,[scope.phoneNumberId,scope.waId,before?.[0]??null,before?.[1]??null])).rows
    const hasMore=rows.length>100,selected=rows.slice(0,100),last=selected.at(-1)
    // An original whose wamid carries this copy's id proves the two are one message.
    const originalIds=new Set((await db.query('select id from public.whatsapp_messages where phone_number_id=$1 and wa_id=$2',[scope.phoneNumberId,scope.waId])).rows
      .map(r=>decodeWamid(r.id)).filter(d=>d&&d.waId===scope.waId).map(d=>d!.providerMessageId))
    const messages:GreenMessageView[]=selected.reverse().map(r=>({id:r.id,source:'green-api',providerInstanceId:r.instance_id,providerChatId:r.provider_chat_id,providerMessageId:r.provider_message_id,direction:r.direction,kind:r.deleted_observed?'deleted':r.kind,text:r.deleted_observed||r.conflicted?null:r.body,providerAcceptedAt:iso(r.provider_accepted_at),sentAt:null,observedAt:iso(r.first_observed_at)!,edited:r.edited,conflicted:r.conflicted,canonicalReceiptMatch:originalIds.has(r.provider_message_id)?'verified':'unverified'}))
    const readiness=await readGreenReadiness(db,scope.phoneNumberId,scope.waId)
    const enabled=!!config?.enabled&&(!b||Number(b.version)===config.version&&b.instance_id===config.instanceId&&b.enabled)
    await db.query('COMMIT')
    return{success:true,scope,binding:{configured:!!config,enabled,mode:'observation' as const,state:!config?'not_configured':!enabled?'paused':!b||b.connection_state!=='authorized'?'not_connected':(b.last_error&&!RECONCILE_PROGRESS_REASONS.has(b.last_error))||readiness.pendingProviderCount||readiness.providerConflictCount?'needs_attention':'observing',lastEventAt:iso(b?.last_event_at),lastReconcileAt:iso(b?.last_reconcile_at),lastError:b?.last_error??null},messages,hasMore,nextCursor:hasMore&&last?Buffer.from(JSON.stringify([scope.phoneNumberId,scope.waId,iso(last.first_observed_at),last.id])).toString('base64url'):null,readiness}
  }finally{await db.end().catch(()=>{})}
}

/** Read-only provider list overlay. The caller keeps canonical read/window/ad state authoritative. */
export async function getGreenContacts(options:{phoneNumberId?:string;waId?:string;q?:string;limit?:number}={}){
  if(options.phoneNumberId&&!/^\d{5,30}$/.test(options.phoneNumberId))greenFail('INVALID_BUSINESS_NUMBER')
  if(options.waId)validateWhatsAppScope(options.waId,options.phoneNumberId)
  const limit=options.waId?1:Math.max(1,Math.min(200,options.limit??200))
  const bindings=configuredGreenBindings().filter(b=>!options.phoneNumberId||b.phoneNumberId===options.phoneNumberId)
  if(!bindings.length)return[]
  const db=await connectInboxDatabase()
  try{
    const rows=(await db.query(`select c.phone_number_id,c.wa_id,c.profile_name,c.last_observed_at,n.page_id as configured_page,n.display_phone as configured_phone,
      exists(select 1 from public.whatsapp_conversations canonical where canonical.phone_number_id=c.phone_number_id and canonical.wa_id=c.wa_id) as canonical_exists,
      (select count(*)::integer from public.whatsapp_green_messages m where m.phone_number_id=c.phone_number_id and m.wa_id=c.wa_id) as message_count,
      latest.body,latest.direction,latest.provider_accepted_at,latest.first_observed_at,
      live.received_at as live_observed_at,live.provider_timestamp as live_provider_at,live.body as live_body,live.direction as live_direction
      from public.whatsapp_green_conversations c join public.whatsapp_inbox_numbers n on n.phone_number_id=c.phone_number_id and n.can_read
      join jsonb_to_recordset($5::jsonb) as approved(phone_number_id text,page_id text,business_phone text) on approved.phone_number_id=c.phone_number_id and n.page_id=approved.page_id and regexp_replace(n.display_phone,'[^0-9]','','g')=approved.business_phone
      left join lateral(select m.* from public.whatsapp_green_messages m where m.phone_number_id=c.phone_number_id and m.wa_id=c.wa_id and not m.conflicted and not m.deleted_observed and m.kind='text' order by m.first_observed_at desc,m.id desc limit 1) latest on true
      left join lateral(select e.received_at,e.provider_timestamp,case when m.kind='text' and not m.conflicted and not m.deleted_observed then m.body else null end as body,m.direction from public.whatsapp_green_events e join public.whatsapp_green_messages m on m.phone_number_id=e.phone_number_id and m.instance_id=e.instance_id and m.provider_chat_id=e.provider_chat_id and m.provider_message_id=e.provider_message_id where e.phone_number_id=c.phone_number_id and e.wa_id=c.wa_id and e.origin='webhook' and (e.state='processed' or (e.state='quarantined' and e.reason='UNSUPPORTED_CONTENT')) and e.event_type in ('incomingMessageReceived','outgoingMessageReceived','outgoingAPIMessageReceived') order by e.provider_timestamp desc nulls last,e.received_at desc,e.id desc limit 1) live on true
      where c.phone_number_id=any($1::text[]) and ($2::text is null or c.wa_id=$2) and ($4::text is null or c.wa_id ilike $4 or c.profile_name ilike $4)
      order by live.provider_timestamp desc nulls last,live.received_at desc nulls last,c.last_observed_at desc nulls last,c.phone_number_id,c.wa_id limit $3`,[bindings.map(b=>b.phoneNumberId),options.waId??null,limit,options.q?.trim()?`%${options.q.trim().slice(0,150)}%`:null,JSON.stringify(bindings.map(b=>({phone_number_id:b.phoneNumberId,page_id:b.pageId,business_phone:b.businessPhone})))])).rows
    return rows.filter(r=>{const b=bindings.find(b=>b.phoneNumberId===r.phone_number_id);return b&&r.configured_page===b.pageId&&String(r.configured_phone).replace(/\D/g,'')===b.businessPhone}).map(r=>{const b=bindings.find(b=>b.phoneNumberId===r.phone_number_id)!;return{phoneNumberId:r.phone_number_id,waId:r.wa_id,canonicalExists:r.canonical_exists===true,profileName:r.profile_name??null,providerMessageCount:Number(r.message_count),latestText:r.body??null,latestDirection:r.direction??null,latestObservedAt:iso(r.first_observed_at??r.last_observed_at),latestProviderAcceptedAt:iso(r.provider_accepted_at),hasLiveObservation:!!r.live_observed_at,liveText:r.live_body??null,liveDirection:r.live_direction??null,liveObservedAt:iso(r.live_observed_at),liveProviderAcceptedAt:iso(r.live_provider_at),businessName:b.key==='destockage'?'Destockage By Moris':'Made By Moris',pageId:b.pageId,businessPhone:b.businessPhone}}
    )
  }finally{await db.end().catch(()=>{})}
}
