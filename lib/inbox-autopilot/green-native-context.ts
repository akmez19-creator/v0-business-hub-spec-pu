import 'server-only'
import { normaliseWebhook, normaliseHistory, stableGreenJson, greenHash } from '@/lib/whatsapp-green/normalise'
import { validateGreenBinding } from '@/lib/whatsapp-green/client'
import type { GreenBinding } from '@/lib/whatsapp-green/contract'
import type { GreenSendScope, GreenSendDb } from './green-native-send'

type Row = Record<string, any>
export type NativeEnrollment = { id:string; business_code:string; phone_number_id:string; wa_id:string; instance_id:string;
  account_id:string; binding_version:number; mode:'new_chat'|'staff_reviewed'|'provider_verified'; cutoff:string; reviewed_hash:string; trigger_message_id:string }
export type NativeHistory = { id:string; phone_number_id:string; wa_id:string; instance_id:string; account_id:string;
  binding_version:number; account_verified_at:string; fetched_at:string; sync_progress:number; records:Row[]; payload_hash:string }
export type NativeContext = { source:'green-api'; scope:GreenSendScope; eligible:boolean; reasons:string[]; fingerprint:string;
  enrollment:NativeEnrollment|null; coverage:'bounded_provider_history_and_observed_messages'; caveats:string[];
  messages:Array<{id:string; nativeId:string; direction:'in'|'out'; text:string; createdAt:string; eventKey:string|null}>;
  latestInbound:{id:string; nativeId:string; eventKey:string; createdAt:string}|null; transcript:string|null }
export const nativeContextId=(instance:string,chat:string,id:string)=>'green:'+JSON.stringify([instance,chat,id])
export const nativeDigest=(value:unknown)=>greenHash(stableGreenJson(value))
export const nativeTime=(value:unknown)=>value instanceof Date?value.getTime():typeof value==='string'?Date.parse(value):NaN
const exactTime=(a:unknown,b:unknown)=>Number.isFinite(nativeTime(a))&&nativeTime(a)===nativeTime(b)
const semantic=(r:Row)=>[r.provider_message_id,r.direction,r.kind,r.body,new Date(nativeTime(r.provider_accepted_at)).toISOString(),r.semantic_hash]
/** Provider timestamps are whole seconds while the cutoff is a millisecond clock, so our own reply sent in the
 * same second as enrolment is stamped UNDER the cutoff. Own accepted sends are therefore never part of the
 * reviewed history (measured: cutoff 17:37:43.685, own echo 17:37:43 -> permanent reviewed_history_changed). */
export function reviewedNativeHash(rows:Row[],cutoff:string,ownProviderMessageIds:ReadonlySet<string>=new Set()):string {
  return nativeDigest(rows.filter(r=>nativeTime(r.provider_accepted_at)<=nativeTime(cutoff)&&!ownProviderMessageIds.has(String(r.provider_message_id))).map(semantic).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))))
}
export type NativeSnapshot = {scope:GreenSendScope;binding:GreenBinding;enrollment:NativeEnrollment|null;proof:NativeHistory|null;
  rows:Row[];events:Row[];attempts:Row[];pending:number;now:number;connection:Row|undefined;number:Row|undefined;oldMetaCount:number}

/** Pure validation. Provider history is a bounded authenticated snapshot, not a claim of complete lifelong history. */
export function evaluateNativeSnapshot(s:NativeSnapshot):NativeContext {
  const reasons=new Set<string>(),caveats=new Set<string>(),fail=(v:string)=>{reasons.add(v)},b=s.binding,e=s.enrollment,p=s.proof,chat=s.scope.waId+'@c.us'
  const fresh=(at:unknown,ms:number)=>Number.isFinite(nativeTime(at))&&nativeTime(at)<=s.now&&s.now-nativeTime(at)<=ms
  try{validateGreenBinding(b)}catch{fail('connection_unverified')}
  if(!b.enabled||b.phoneNumberId!==s.scope.phoneNumberId||b.key!==s.scope.businessKey||s.scope.channel!=='whatsapp'||!/^\d{5,20}$/.test(s.scope.waId))fail('scope_unverified')
  if(!s.number||s.number.page_id!==b.pageId||String(s.number.display_phone).replace(/\D/g,'')!==b.businessPhone||!s.number.can_read||!s.number.can_send)fail('number_unavailable')
  const c=s.connection
  if(!c||c.enabled!==true||c.connection_state!=='authorized'||(c.last_error!=null&&c.last_error!=='QUARANTINED_EVENTS')||c.instance_id!==b.instanceId||c.account_id!==b.accountId||
    Number(c.version)!==b.version||c.api_host!==new URL(b.apiUrl).hostname||!fresh(c.last_reconcile_at,900000))fail('connection_unverified')
  if(!e||e.business_code!==(s.scope.businessKey==='destockage'?'DBM':'MBM')||e.phone_number_id!==b.phoneNumberId||e.wa_id!==s.scope.waId||
    e.instance_id!==b.instanceId||e.account_id!==b.accountId||Number(e.binding_version)!==b.version||!['new_chat','staff_reviewed','provider_verified'].includes(e.mode)||
    !Number.isFinite(nativeTime(e.cutoff))||nativeTime(e.cutoff)>s.now)fail('enrollment_unverified')
  if(!p||p.phone_number_id!==b.phoneNumberId||p.wa_id!==s.scope.waId||p.instance_id!==b.instanceId||p.account_id!==b.accountId||
    Number(p.binding_version)!==b.version||p.sync_progress!==100||!fresh(p.fetched_at,60000)||!fresh(p.account_verified_at,60000)||
    nativeTime(p.account_verified_at)>nativeTime(p.fetched_at)||!Array.isArray(p.records)||p.records.length>=100||nativeDigest(p.records)!==p.payload_hash)fail('history_proof_unverified')
  if(s.rows.length===0||s.rows.length>=100||s.events.length>=500||s.attempts.length>=100||!Array.isArray(p?.records)||!p.records.length)fail('history_not_bounded')
  if(s.pending!==0)fail('pending_reconciliation')
  const history=new Map<string,ReturnType<typeof normaliseHistory>>()
  for(const raw of Array.isArray(p?.records)?p!.records.slice(0,100):[]){
    try{const h=normaliseHistory(b,raw,new Date(nativeTime(p!.fetched_at)).toISOString(),'history'),o=h.observation
      if(!o||h.quarantineReason||o.providerChatId!==chat||o.waId!==s.scope.waId||o.kind!=='text'||!o.text||o.edited||history.has(o.providerMessageId)||
        raw.isDeleted===true||raw.deletedMessageId||raw.editedMessageId||!h.providerTimestamp)fail('unsupported_history')
      else history.set(o.providerMessageId,h)
    }catch{fail('unsupported_history')}
  }
  /** A witness is an authenticated provider delivery of this exact message: a live webhook, or a journal poll
   * record fetched with the instance token. Journal records carry no trustworthy message time (their timestamp
   * can be last-action time) so they prove identity, direction and text only; the time is pinned separately by
   * the fresh provider-history proof (`history_not_caught_up` requires exact equality with the stored row).
   * Measured 14 Sep: live webhooks stopped for 15h while the journal kept the inbox complete, and every customer
   * was sent to staff review because only webhook witnesses counted. */
  const events=new Map<string,Array<{row:Row;event:ReturnType<typeof normaliseWebhook>}>>()
  for(const row of s.events.slice(0,500)){
    try{if(!['webhook','journal'].includes(row.origin)||row.state!=='processed'||row.reason!=null||row.phone_number_id!==b.phoneNumberId||row.instance_id!==b.instanceId||row.wa_id!==s.scope.waId)continue
      const raw=stableGreenJson(row.raw);if(Buffer.byteLength(raw)>1048576||greenHash(raw)!==row.payload_hash||greenHash(row.origin+'\0'+row.payload_hash)!==row.event_key)continue
      const at=new Date(nativeTime(row.received_at)).toISOString()
      const event=row.origin==='webhook'?normaliseWebhook(b,row.raw,at):normaliseHistory(b,row.raw,at,'journal'),o=event.observation
      if(!o||event.quarantineReason||o.kind!=='text'||!o.text||o.edited||o.providerChatId!==chat||o.waId!==s.scope.waId||o.providerMessageId!==row.provider_message_id||
        event.eventKey!==row.event_key||event.eventType!==row.event_type)continue
      if(row.origin==='webhook'?!exactTime(event.providerTimestamp,row.provider_timestamp):(event.providerTimestamp!=null||row.provider_timestamp!=null))continue
      const entries=events.get(o.providerMessageId)??[];entries.push({row,event});events.set(o.providerMessageId,entries)
    }catch{/* Invalid evidence never qualifies. */}
  }
  const messages:NativeContext['messages']=[],seen=new Set<string>(),times=new Set<number>(),own=new Map<string,Row>()
  for(const a of s.attempts){
    if(a.phone_number_id!==b.phoneNumberId||a.wa_id!==s.scope.waId||a.instance_id!==b.instanceId||a.account_id!==b.accountId||Number(a.binding_version)!==b.version||a.chat_id!==chat){fail('own_send_scope_changed');continue}
    if(a.state!=='accepted'||typeof a.provider_message_id!=='string'){fail('own_send_uncertain');continue}
    if(own.has(a.provider_message_id))fail('own_send_conflict');own.set(a.provider_message_id,a)
  }
  for(const row of s.rows.slice(0,100)){
    const id=row.provider_message_id,h=history.get(id),o=h?.observation,at=nativeTime(row.provider_accepted_at)
    if(typeof id!=='string'||!id||seen.has(id)||row.phone_number_id!==b.phoneNumberId||row.wa_id!==s.scope.waId||row.instance_id!==b.instanceId||row.provider_chat_id!==chat){fail('message_scope_changed');continue}
    seen.add(id)
    if(!['in','out'].includes(row.direction)||row.kind!=='text'||typeof row.body!=='string'||!row.body.trim()||row.edited!==false||row.conflicted!==false||row.deleted_observed!==false||
      row.semantic_hash!==nativeDigest([s.scope.waId,row.direction,'text',row.body])||!Number.isFinite(at)||at>s.now){fail('unreadable_context');continue}
    if(!o||o.direction!==row.direction||o.text!==row.body||!exactTime(o.providerAcceptedAt,row.provider_accepted_at))fail('history_not_caught_up')
    if(times.has(at))fail('ambiguous_message_order');times.add(at)
    const witnesses=(events.get(id)??[]).filter(x=>x.event.observation?.direction===row.direction&&x.event.observation?.text===row.body&&
      (x.event.providerTimestamp==null?x.row.origin==='journal':exactTime(x.event.providerTimestamp,row.provider_accepted_at)))
    // An outbound journal record counts only when the provider itself marks it as an API send, matching outgoingAPIMessageReceived.
    const live=witnesses.find(x=>x.event.eventType===(row.direction==='in'?'incomingMessageReceived':'outgoingAPIMessageReceived'))
      ??witnesses.find(x=>x.row.origin==='journal'&&(row.direction==='in'||(x.row.raw as Row)?.sendByApi===true))
    const reviewed=!!e&&at<=nativeTime(e.cutoff)
    if(!reviewed&&!live)fail('live_message_unverified')
    if(row.direction==='out'&&!reviewed){const a=own.get(id);if(!a||a.reply_text!==row.body||!live||h?.raw==null||(h.raw as Row).sendByApi!==true)fail('staff_reply_requires_handover')}
    if(row.direction==='in'&&own.has(id))fail('own_send_conflict')
    const raw=(h?.raw??{}) as Row
    if(raw.quotedMessage||raw.extendedTextMessage?.stanzaId)caveats.add('quoted_original_not_resolved')
    messages.push({id:nativeContextId(b.instanceId,chat,id),nativeId:id,direction:row.direction,text:row.body,createdAt:new Date(at).toISOString(),eventKey:live?.row.event_key??null})
  }
  if(history.size!==seen.size||[...history.keys()].some(id=>!seen.has(id)))fail('history_not_caught_up')
  if([...own.keys()].some(id=>!seen.has(id)))fail('own_send_not_observed')
  if(e){try{if(reviewedNativeHash(s.rows,e.cutoff,new Set(own.keys()))!==e.reviewed_hash)fail('reviewed_history_changed')}catch{fail('reviewed_history_changed')}
    if(e.mode==='new_chat'&&(s.oldMetaCount>0||s.rows.filter(r=>nativeTime(r.provider_accepted_at)<=nativeTime(e.cutoff)).length!==1||s.rows.find(r=>r.provider_message_id===e.trigger_message_id)?.direction!=='in'))fail('new_chat_not_proven')}
  messages.sort((a,b)=>nativeTime(a.createdAt)-nativeTime(b.createdAt))
  const latest=messages.at(-1)
  if(!latest||latest.direction!=='in'||!latest.eventKey)fail('latest_live_inbound_required')
  if(latest&&s.now-nativeTime(latest.createdAt)>=86400000)fail('reply_window_closed')
  if(messages.reduce((sum,m)=>sum+m.text.length,0)>30000)fail('context_too_long')
  const fingerprint=nativeDigest({scope:s.scope,binding:[b.instanceId,b.accountId,b.version],enrollment:e?[e.id,e.business_code,e.phone_number_id,e.wa_id,e.instance_id,e.account_id,Number(e.binding_version),e.mode,new Date(nativeTime(e.cutoff)).toISOString(),e.reviewed_hash,e.trigger_message_id]:null,
   messages,attempts:s.attempts.map(a=>[a.attempt_id,a.state,a.provider_message_id]),caveats:[...caveats].sort()})
  const eligible=reasons.size===0
  return{source:'green-api',scope:s.scope,eligible,reasons:[...reasons].sort(),fingerprint,enrollment:e,coverage:'bounded_provider_history_and_observed_messages',caveats:[...caveats].sort(),
    messages,latestInbound:latest?.direction==='in'&&latest.eventKey?{id:latest.id,nativeId:latest.nativeId,eventKey:latest.eventKey,createdAt:latest.createdAt}:null,
    transcript:eligible?JSON.stringify(messages.map(m=>({id:m.id,role:m.direction==='in'?'customer':'business',text:m.text}))):null}
}

/** Caller uses repeatable read or the final config/customer/pair/binding transaction. No provider calls. */
export async function readNativeContext(db:GreenSendDb,scope:GreenSendScope,binding:GreenBinding,enrollmentOverride?:NativeEnrollment):Promise<NativeContext>{
  const pair=[scope.phoneNumberId,scope.waId]
  const enrollment=enrollmentOverride??(await db.query(`SELECT e.* FROM public.inbox_autopilot_green_enrollments e JOIN public.inbox_autopilot_green_scopes s ON s.enrollment_id=e.id
    WHERE s.phone_number_id=$1 AND s.wa_id=$2 AND s.enabled=true`,pair)).rows[0]??null
  const proof=(await db.query('SELECT * FROM public.inbox_autopilot_green_history WHERE phone_number_id=$1 AND wa_id=$2 ORDER BY fetched_at DESC,id DESC LIMIT 1',pair)).rows[0]??null
  const rows=(await db.query('SELECT * FROM public.whatsapp_green_messages WHERE phone_number_id=$1 AND wa_id=$2 ORDER BY provider_accepted_at,id LIMIT 100',pair)).rows
  const events=(await db.query("SELECT * FROM public.whatsapp_green_events WHERE phone_number_id=$1 AND wa_id=$2 AND origin IN ('webhook','journal') ORDER BY received_at DESC,id DESC LIMIT 500",pair)).rows
  const attempts=(await db.query('SELECT * FROM public.inbox_autopilot_green_sends WHERE phone_number_id=$1 AND wa_id=$2 ORDER BY started_at LIMIT 100',pair)).rows
  const pending=Number((await db.query("SELECT count(*) AS count FROM public.whatsapp_green_events WHERE phone_number_id=$1 AND (wa_id=$2 OR wa_id IS NULL) AND state='quarantined'",pair)).rows[0]?.count??-1)
  const number=(await db.query('SELECT * FROM public.whatsapp_inbox_numbers WHERE phone_number_id=$1',[scope.phoneNumberId])).rows[0]
  const connection=(await db.query('SELECT * FROM public.whatsapp_green_bindings WHERE phone_number_id=$1',[scope.phoneNumberId])).rows[0]
  const now=nativeTime((await db.query('SELECT clock_timestamp() AS now')).rows[0]?.now)
  const earliest=rows.length?rows.reduce((v,r)=>Math.min(v,nativeTime(r.provider_accepted_at)),Infinity):NaN
  const oldMetaCount=Number.isFinite(earliest)?Number((await db.query('SELECT count(*) AS count FROM public.whatsapp_messages WHERE phone_number_id=$1 AND wa_id=$2 AND created_at<$3::timestamptz',[...pair,new Date(earliest).toISOString()])).rows[0]?.count??-1):-1
  return evaluateNativeSnapshot({scope,binding,enrollment:enrollment as NativeEnrollment|null,proof:proof as NativeHistory|null,rows,events,attempts,pending,now,number,connection,oldMetaCount})
}
