import 'server-only'
import { randomUUID } from 'node:crypto'
import type { GreenBinding } from '@/lib/whatsapp-green/contract'
import { createGreenNativeSender, type GreenSendDb, type GreenSendScope, type GreenSendResult } from './green-native-send'
import { nativeDigest, nativeTime, readNativeContext, reviewedNativeHash, type NativeContext, type NativeEnrollment } from './green-native-context'
import { buildReplyPlan, catalogueFingerprint, knownStaffIssue, type CatalogueProduct, type ReplyDecision, type ReplyPlan } from './green-native-policy'
import { loadHandoffRelease } from './handoff-release'

type Row=Record<string,any>
export const GREEN_NATIVE_RELEASE_KEY='inbox:autopilot:green-native:v1'
export type NativeJob={id:string;scope:GreenSendScope;bindingVersion:number;enrollmentId:string;configVersion:number;controlVersion:number;inboundId:string;eventKey:string;fingerprint:string;leaseToken:string}
type StaffTask={kind:'customer_issue'|'exchange_or_change_request'|'order_ready_for_staff';evidence:Record<string,string>;catalogueFingerprint:string|null;deliveryDate:string|null}
export type NativeEngineDependencies={
 connect():Promise<GreenSendDb>;authorizeScope(scope:GreenSendScope):Promise<void>;getBinding(phone:string):Promise<GreenBinding|null>;
 catalogue(scope:GreenSendScope,db?:GreenSendDb):Promise<CatalogueProduct[]>;
 classify(context:NativeContext,products:CatalogueProduct[]):Promise<ReplyDecision>;
 reconcileHandoff(scope:GreenSendScope):Promise<{complete:boolean}>;
 hasUnprocessedHandoff(db:GreenSendDb,scope:GreenSendScope):Promise<boolean>;
 recordStaffTask(db:GreenSendDb,input:{nativeJobId:string;scope:GreenSendScope;nativeInboundId:string;contextFingerprint:string;task:StaffTask}):Promise<void>;
 fetchImpl?:typeof fetch;now?:()=>number
}
const code=(scope:GreenSendScope)=>scope.businessKey==='destockage'?'DBM':'MBM'
const key=(b:GreenBinding)=>`green:v1:${b.phoneNumberId}:${b.instanceId}:journal`
const reason=(v:string)=>/^[a-z_]{1,100}$/.test(v)?v:'native_context_unavailable'
const forbiddenPast=/\b(?:order (?:is )?(?:confirmed|placed|delivered)|commande (?:est )?confirmee|komann (?:finn )?konfirme|refund|rembours|complaint|reclamation|exchange|replacement|change my order|cancel|annul|already paid|deja paye)\b/i
const normal=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
export const automaticNativeHistoryAllowed=(context:NativeContext)=>context.eligible&&!!context.latestInbound&&!context.messages.some(m=>forbiddenPast.test(normal(m.text)))

/** Explicit business opt-in, independent of the existing Meta engine switch.
 * An enabled global bot alone cannot select a new transport. */
export async function nativeReleaseAllows(db:Pick<GreenSendDb,'query'>,scope:Pick<GreenSendScope,'businessKey'>):Promise<boolean>{
 const row=(await db.query('SELECT cursor,clock_timestamp() AS now FROM public.inbox_sync_state WHERE key=$1',[GREEN_NATIVE_RELEASE_KEY])).rows[0]
 try{if(typeof row?.cursor!=='string'||row.cursor.length>1024)return false
  const r=JSON.parse(row.cursor)
  return r.schema===1&&r.enabled===true&&r.source==='green-api'&&Array.isArray(r.businessCodes)&&r.businessCodes.length>0&&r.businessCodes.length<=2&&
   r.businessCodes.every((v:unknown)=>v==='MBM'||v==='DBM')&&new Set(r.businessCodes).size===r.businessCodes.length&&r.businessCodes.includes(scope.businessKey==='destockage'?'DBM':'MBM')&&
   typeof r.activatedAt==='string'&&new Date(r.activatedAt).toISOString()===r.activatedAt&&nativeTime(r.activatedAt)<=nativeTime(row.now)&&
   Object.keys(r).sort().join(',')==='activatedAt,businessCodes,enabled,schema,source'&&!!await loadHandoffRelease(db)
 }catch{return false}
}
export async function lockNativeScope(db:GreenSendDb,scope:GreenSendScope){
 await db.query('SELECT business_code FROM public.inbox_autopilot_config WHERE business_code=$1 FOR UPDATE',[code(scope)])
 for(const v of ['whatsapp:customer:'+scope.waId,JSON.stringify(['whatsapp:conversation',scope.phoneNumberId,scope.waId]),'green:binding:'+scope.phoneNumberId])
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[v])
}
export function createGreenNativeEngine(deps:NativeEngineDependencies){
 const now=deps.now??Date.now
 const withDb=async<T>(fn:(db:GreenSendDb)=>Promise<T>)=>{const db=await deps.connect();try{return await fn(db)}finally{await db.end().catch(()=>{})}}
 const tx=async<T>(fn:(db:GreenSendDb)=>Promise<T>)=>withDb(async db=>{await db.query('BEGIN');try{await db.query("SET LOCAL lock_timeout='3s'");await db.query("SET LOCAL statement_timeout='10s'");const out=await fn(db);await db.query('COMMIT');return out}catch(err){await db.query('ROLLBACK').catch(()=>{});throw err}})
 const binding=async(scope:GreenSendScope)=>{await deps.authorizeScope(scope);const b=await deps.getBinding(scope.phoneNumberId);if(!b||!b.enabled||b.key!==scope.businessKey)throw Error('binding_unavailable');return{...b}}
 async function controls(db:GreenSendDb,scope:GreenSendScope){
  const c=(await db.query(`SELECT *,delivery_date::text AS delivery_date,(delivery_date >= (clock_timestamp() AT TIME ZONE 'Indian/Mauritius')::date) AS date_valid
   FROM public.inbox_autopilot_config WHERE business_code=$1`,[code(scope)])).rows[0]
  if(!c?.enabled||!c.date_valid||!await nativeReleaseAllows(db,scope))return null
  const control=(await db.query("SELECT paused,version FROM public.inbox_autopilot_controls WHERE business_code=$1 AND channel='whatsapp' AND owner_id=$2 AND customer_id=$3",[code(scope),scope.phoneNumberId,scope.waId])).rows[0]
  if(control?.paused===true)return null
  c.control_version=Number(control?.version??0)
  if(await deps.hasUnprocessedHandoff(db,scope))return null
  // An uncertain Meta send blocks the separate native path; it is never relabelled or retried.
  if((await db.query("SELECT id FROM public.inbox_autopilot_jobs WHERE business_code=$1 AND channel='whatsapp' AND owner_id=$2 AND customer_id=$3 AND state IN ('sending','unknown') LIMIT 1",[code(scope),scope.phoneNumberId,scope.waId])).rows.length)return null
  return c
 }
 async function settle(scope:GreenSendScope){return tx(async db=>{
  await lockNativeScope(db,scope)
  const rows=(await db.query(`SELECT j.id,j.business_code,j.reservation_day,a.attempt_id,a.state AS attempt_state FROM public.inbox_autopilot_green_jobs j
   JOIN public.inbox_autopilot_green_sends a ON a.attempt_id=j.attempt_id WHERE j.phone_number_id=$1 AND j.wa_id=$2 AND j.state IN ('sending','unknown') AND a.state='accepted' FOR UPDATE OF j`,[scope.phoneNumberId,scope.waId])).rows
  for(const r of rows){await db.query("UPDATE public.inbox_autopilot_green_jobs SET state='accepted',reason=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1",[r.id]);await db.query('UPDATE public.inbox_autopilot_daily SET sent_count=sent_count+1 WHERE business_code=$1 AND day=$2',[r.business_code,r.reservation_day])}
 })}
 async function ensureEnrollment(db:GreenSendDb,scope:GreenSendScope,b:GreenBinding):Promise<NativeContext>{
  const current=(await db.query('SELECT enrollment_id,enabled FROM public.inbox_autopilot_green_scopes WHERE phone_number_id=$1 AND wa_id=$2',[scope.phoneNumberId,scope.waId])).rows[0]
  if(current)return readNativeContext(db,scope,b) // Never slide a cutoff or revive a disabled scope automatically.
  const cutoff=new Date(nativeTime((await db.query('SELECT clock_timestamp() AS now')).rows[0]?.now)).toISOString()
  const rows=(await db.query('SELECT * FROM public.whatsapp_green_messages WHERE phone_number_id=$1 AND wa_id=$2 ORDER BY provider_accepted_at,id LIMIT 100',[scope.phoneNumberId,scope.waId])).rows
  const p=(await db.query('SELECT id FROM public.inbox_autopilot_green_history WHERE phone_number_id=$1 AND wa_id=$2 ORDER BY fetched_at DESC,id DESC LIMIT 1',[scope.phoneNumberId,scope.waId])).rows[0]
  const latest=rows.filter(r=>r.direction==='in').at(-1)
  if(!p||!latest)throw Error('native_history_required')
  const e:NativeEnrollment={id:randomUUID(),business_code:code(scope),phone_number_id:scope.phoneNumberId,wa_id:scope.waId,instance_id:b.instanceId,
   account_id:b.accountId,binding_version:b.version,mode:'provider_verified',cutoff,reviewed_hash:reviewedNativeHash(rows,cutoff),trigger_message_id:latest.provider_message_id}
  const context=await readNativeContext(db,scope,b,e)
  if(!automaticNativeHistoryAllowed(context))return{...context,eligible:false,reasons:[...context.reasons,'initial_history_requires_staff']}
  await db.query(`INSERT INTO public.inbox_autopilot_green_enrollments(id,business_code,phone_number_id,wa_id,instance_id,account_id,binding_version,mode,cutoff,reviewed_hash,trigger_message_id,history_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[e.id,e.business_code,e.phone_number_id,e.wa_id,e.instance_id,e.account_id,e.binding_version,e.mode,e.cutoff,e.reviewed_hash,e.trigger_message_id,p.id])
  await db.query('INSERT INTO public.inbox_autopilot_green_scopes(phone_number_id,wa_id,enrollment_id,enabled) VALUES($1,$2,$3,true)',[scope.phoneNumberId,scope.waId,e.id])
  return context
 }
 async function claim(scope:GreenSendScope,b:GreenBinding):Promise<{job:NativeJob;context:NativeContext;config:Row}|null>{return tx(async db=>{
  await lockNativeScope(db,scope);const c=await controls(db,scope);if(!c)return null
  const daily=(await db.query("SELECT reserved_count,sent_count FROM public.inbox_autopilot_daily WHERE business_code=$1 AND day=(clock_timestamp() AT TIME ZONE 'Indian/Mauritius')::date",[code(scope)])).rows[0]
  if(Number(daily?.reserved_count??0)>=Number(c.max_daily_replies)||Number(daily?.sent_count??0)>=Number(c.max_daily_replies))return null
  const context=await ensureEnrollment(db,scope,b),latest=context.latestInbound
  if(!context.eligible||!latest||!context.enrollment)return null
  const existing=(await db.query('SELECT * FROM public.inbox_autopilot_green_jobs WHERE phone_number_id=$1 AND wa_id=$2 AND instance_id=$3 AND inbound_message_id=$4 FOR UPDATE',[scope.phoneNumberId,scope.waId,b.instanceId,latest.nativeId])).rows[0]
  // Only abandoned pre-intent processing may be reclaimed. A new run never resets review/unknown/accepted.
  if(existing&&(existing.state!=='processing'||existing.attempt_id||nativeTime(existing.lease_expires_at)>now()||existing.context_fingerprint!==context.fingerprint||Number(existing.config_version)!==Number(c.version)))return null
  if(existing&&Number(existing.control_version)!==Number(c.control_version))return null
  const job:NativeJob={id:existing?.id??randomUUID(),scope:{...scope},bindingVersion:b.version,enrollmentId:context.enrollment.id,configVersion:Number(c.version),controlVersion:Number(c.control_version),inboundId:latest.nativeId,eventKey:latest.eventKey,fingerprint:context.fingerprint,leaseToken:randomUUID()}
  if(existing)await db.query("UPDATE public.inbox_autopilot_green_jobs SET lease_token=$2,lease_expires_at=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp() WHERE id=$1",[job.id,job.leaseToken])
  else await db.query(`INSERT INTO public.inbox_autopilot_green_jobs(id,business_code,phone_number_id,wa_id,instance_id,chat_id,binding_version,enrollment_id,config_version,inbound_message_id,inbound_event_key,context_fingerprint,state,lease_token,lease_expires_at,control_version)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'processing',$13,clock_timestamp()+interval '120 seconds',$14)`,[job.id,code(scope),scope.phoneNumberId,scope.waId,b.instanceId,scope.waId+'@c.us',b.version,job.enrollmentId,job.configVersion,job.inboundId,job.eventKey,job.fingerprint,job.leaseToken,job.controlVersion])
  return{job,context,config:c}
 })}
 async function review(job:NativeJob,why:string,task?:StaffTask){return tx(async db=>{
  await lockNativeScope(db,job.scope)
  const row=(await db.query('SELECT * FROM public.inbox_autopilot_green_jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0]
  if(row?.state!=='processing'||row.lease_token!==job.leaseToken||row.attempt_id)return
  if(task){const c=await controls(db,job.scope);if(!c||Number(c.control_version)!==job.controlVersion)return
   const b=await binding(job.scope),fresh=await readNativeContext(db,job.scope,b)
   if(!fresh.eligible||fresh.fingerprint!==job.fingerprint||fresh.latestInbound?.nativeId!==job.inboundId)return
   await deps.recordStaffTask(db,{nativeJobId:job.id,scope:job.scope,nativeInboundId:job.inboundId,contextFingerprint:job.fingerprint,task})}
  await db.query("UPDATE public.inbox_autopilot_green_jobs SET state='needs_review',reason=$2,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1",[job.id,reason(why)])
 })}
 async function reserve(db:GreenSendDb,job:NativeJob,context:NativeContext,decision:ReplyDecision,plan:Extract<ReplyPlan,{action:'send'}>,b:GreenBinding,attemptId:string){
  const c=await controls(db,job.scope),row=(await db.query('SELECT * FROM public.inbox_autopilot_green_jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0]
  if(!c||!row||row.state!=='processing'||row.lease_token!==job.leaseToken||row.attempt_id||nativeTime(row.lease_expires_at)<=now()||
   Number(c.version)!==job.configVersion||Number(row.config_version)!==job.configVersion||Number(c.control_version)!==job.controlVersion||Number(row.control_version)!==job.controlVersion||row.context_fingerprint!==job.fingerprint||row.enrollment_id!==job.enrollmentId||
   row.phone_number_id!==job.scope.phoneNumberId||row.wa_id!==job.scope.waId||row.instance_id!==b.instanceId||row.inbound_message_id!==job.inboundId||row.inbound_event_key!==job.eventKey)return false
  const fresh=await readNativeContext(db,job.scope,b)
  if(!fresh.eligible||fresh.enrollment?.id!==job.enrollmentId||fresh.fingerprint!==context.fingerprint||fresh.latestInbound?.nativeId!==job.inboundId||fresh.latestInbound.eventKey!==job.eventKey)return false
  const products=await deps.catalogue(job.scope,db)
  const checked=buildReplyPlan(decision,fresh,products,c.delivery_date,new Date(now()))
  if(catalogueFingerprint(products)!==plan.catalogueFingerprint||checked.action!=='send'||checked.text!==plan.text||checked.reason!==plan.reason||nativeDigest(checked.evidence)!==nativeDigest(plan.evidence))return false
  // Share the existing read/reconciliation lease, without touching its checkpoint.
  await db.query('INSERT INTO public.inbox_sync_state(key,cursor) VALUES($1,$2) ON CONFLICT DO NOTHING',[key(b),'{}'])
  const scheduler=(await db.query('SELECT cursor,clock_timestamp() AS now FROM public.inbox_sync_state WHERE key=$1 FOR UPDATE',[key(b)])).rows[0]
  let state:Row;try{state=JSON.parse(scheduler?.cursor??'{}')}catch{return false}
  if(!state||Array.isArray(state)||state.runId&&nativeTime(state.expiresAt)>nativeTime(scheduler.now)||nativeTime(state.nativeNotBefore)>nativeTime(scheduler.now))return false
  const day=(await db.query("SELECT (clock_timestamp() AT TIME ZONE 'Indian/Mauritius')::date::text AS day")).rows[0]?.day
  await db.query('INSERT INTO public.inbox_autopilot_daily(business_code,day) VALUES($1,$2) ON CONFLICT DO NOTHING',[code(job.scope),day])
  const reserved=await db.query('UPDATE public.inbox_autopilot_daily SET reserved_count=reserved_count+1 WHERE business_code=$1 AND day=$2 AND reserved_count<$3 AND sent_count<$3 RETURNING reserved_count',[code(job.scope),day,c.max_daily_replies])
  if(reserved.rows.length!==1)return false
  await db.query("UPDATE public.inbox_autopilot_green_jobs SET state='sending',attempt_id=$2,reservation_day=$3,updated_at=clock_timestamp() WHERE id=$1",[job.id,attemptId,day])
  if(plan.reason==='order_ready_for_staff')await deps.recordStaffTask(db,{nativeJobId:job.id,scope:job.scope,nativeInboundId:job.inboundId,contextFingerprint:job.fingerprint,
   task:{kind:'order_ready_for_staff',evidence:plan.evidence,catalogueFingerprint:plan.catalogueFingerprint,deliveryDate:c.delivery_date}})
  await db.query('UPDATE public.inbox_sync_state SET cursor=$2,updated_at=clock_timestamp() WHERE key=$1',[key(b),JSON.stringify({...state,runId:'native:'+attemptId,version:b.version,expiresAt:new Date(nativeTime(scheduler.now)+90000).toISOString()})])
  return true
 }
 async function finish(job:NativeJob,b:GreenBinding,result:GreenSendResult){return tx(async db=>{
  await lockNativeScope(db,job.scope)
  const row=(await db.query('SELECT * FROM public.inbox_autopilot_green_jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0]
  if(row?.attempt_id!==result.attemptId||!['sending','unknown'].includes(row.state))return
  const saved=(await db.query('SELECT state,provider_message_id FROM public.inbox_autopilot_green_sends WHERE attempt_id=$1',[result.attemptId])).rows[0]
  if(saved?.state==='accepted'&&saved.provider_message_id===result.messageId){await db.query("UPDATE public.inbox_autopilot_green_jobs SET state='accepted',reason=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1",[job.id]);await db.query('UPDATE public.inbox_autopilot_daily SET sent_count=sent_count+1 WHERE business_code=$1 AND day=$2',[code(job.scope),row.reservation_day])}
  else await db.query("UPDATE public.inbox_autopilot_green_jobs SET state='unknown',reason='provider_outcome_unknown',lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=$1",[job.id])
  const scheduler=(await db.query('SELECT cursor FROM public.inbox_sync_state WHERE key=$1 FOR UPDATE',[key(b)])).rows[0]
  const state=JSON.parse(scheduler?.cursor??'{}');if(state.runId==='native:'+result.attemptId){delete state.runId;delete state.expiresAt;await db.query('UPDATE public.inbox_sync_state SET cursor=$2,updated_at=clock_timestamp() WHERE key=$1',[key(b),JSON.stringify(state)])}
 })}
 async function runScope(scope:GreenSendScope){
  const b=await binding(scope)
  if(!await withDb(db=>nativeReleaseAllows(db,scope)))return{state:'paused',reason:'native_transport_not_enabled'}
  await settle(scope)
  if(!(await deps.reconcileHandoff(scope)).complete)return{state:'needs_review',reason:'handover_pending'}
  const claimed=await claim(scope,b);if(!claimed)return{state:'needs_review',reason:'native_context_or_controls_unavailable'}
  const{job,context,config}=claimed
  let attempted=false
  try{
   const issue=knownStaffIssue(context)
   if(issue){await review(job,issue,{kind:issue,evidence:{},catalogueFingerprint:null,deliveryDate:null});return{state:'needs_review',reason:issue,jobId:job.id}}
   const products=await deps.catalogue(scope),decision=await deps.classify(context,products)
   const plan=buildReplyPlan(decision,context,products,config.delivery_date,new Date(now()))
   if(plan.action!=='send'){const kind=plan.reason==='customer_issue'||plan.reason==='exchange_or_change_request'?plan.reason:null;await review(job,plan.reason,kind?{kind,evidence:{},catalogueFingerprint:null,deliveryDate:null}:undefined);return{state:'needs_review',reason:plan.reason,jobId:job.id}}
   const sender=createGreenNativeSender({connect:deps.connect,authorizeScope:deps.authorizeScope,getBinding:deps.getBinding,fetchImpl:deps.fetchImpl,
    authorizeAndReserve:async(db,input,current,intent)=>input.inboundMessageId===job.inboundId&&input.inboundEventKey===job.eventKey&&input.contextFingerprint===job.fingerprint&&
     input.configVersion===job.configVersion&&input.bindingVersion===job.bindingVersion&&input.text===plan.text&&await reserve(db,job,context,decision,plan,current,intent.attemptId)})
   attempted=true
   const sent=await sender.sendOnce({scope,inboundMessageId:job.inboundId,inboundEventKey:job.eventKey,bindingVersion:job.bindingVersion,configVersion:job.configVersion,contextFingerprint:job.fingerprint,text:plan.text})
   await finish(job,b,sent)
   if(sent.state==='accepted'&&sent.savedLocally){try{await deps.reconcileHandoff(scope)}catch{/* Durable acceptance is final. */}}
   return{state:sent.state,reason:sent.savedLocally?plan.reason:'send_confirmation_pending',jobId:job.id}
  }catch{await review(job,'native_run_failed').catch(()=>{});return{state:attempted?'unknown':'needs_review',reason:attempted?'send_intent_or_outcome_unconfirmed':'native_run_failed',jobId:job.id}}
 }
 return{runScope,settleAccepted:async(scope:GreenSendScope)=>{await deps.authorizeScope(scope);return settle(scope)}}
}
