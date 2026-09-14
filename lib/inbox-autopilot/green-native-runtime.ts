import 'server-only'
import {randomUUID} from 'node:crypto'
import {GreenReadClient,type GreenAccountEvidence,type GreenRecord} from '@/lib/whatsapp-green/client'
import {normaliseHistory} from '@/lib/whatsapp-green/normalise'
import type {GreenBinding,GreenEvent} from '@/lib/whatsapp-green/contract'
import {createGreenNativeEngine,nativeReleaseAllows,lockNativeScope,type NativeEngineDependencies} from './green-native-engine'
import {nativeDigest,nativeTime} from './green-native-context'
import type {GreenSendDb,GreenSendScope} from './green-native-send'

type Port={acquire(b:GreenBinding,id:string,expires:string):Promise<boolean>;isCurrent(b:GreenBinding,id:string):Promise<boolean>;
 ingest(b:GreenBinding,event:GreenEvent):Promise<unknown>;release(b:GreenBinding,id:string):Promise<void>}
type Client={verifyAccount():Promise<GreenAccountEvidence>;history(chat:string,count:number):Promise<GreenRecord[]>}
type RuntimeDependencies=NativeEngineDependencies&{
 /** Production supplies the complete existing configured binding set, privately. */
 configuredBindings():GreenBinding[];
 /** Bind to the deployed PgGreenStore. Mandatory to share its real scheduler lease and ingestion safeguards. */
 portFactory:(db:GreenSendDb)=>Port;
 clientFactory?:(binding:GreenBinding)=>Client;
 wait?:(ms:number)=>Promise<void>
}

/** Opt-in runtime adapter. No import-time provider requests, scheduler registration,
 * customer discovery, account changes or automatic transport selection. */
export function createGreenNativeRuntime(deps:RuntimeDependencies){
 const engine=createGreenNativeEngine(deps)
 async function captureHistory(scope:GreenSendScope):Promise<boolean>{
  await deps.authorizeScope(scope)
  const b=await deps.getBinding(scope.phoneNumberId)
  if(!b?.enabled||b.key!==scope.businessKey)return false
  const binding={...b},db=await deps.connect(),runId=randomUUID(),started=Date.now(),controller=new AbortController()
  const timer=setTimeout(()=>controller.abort(),60000)
  const withinBudget=()=>!controller.signal.aborted&&Date.now()-started<60000
  const port=deps.portFactory(db)
  const client=deps.clientFactory?.(binding)??new GreenReadClient(binding,{signal:controller.signal})
  const current=()=>deps.getBinding(scope.phoneNumberId)
  const same=(v:GreenBinding|null)=>!!v&&v.enabled&&v.phoneNumberId===binding.phoneNumberId&&v.key===binding.key&&v.instanceId===binding.instanceId&&v.accountId===binding.accountId&&v.version===binding.version&&v.apiUrl===binding.apiUrl&&v.apiToken===binding.apiToken
  let acquired=false
  try{
   if(!await nativeReleaseAllows(db,scope))return false
   acquired=await port.acquire(binding,runId,new Date(Date.now()+90000).toISOString());if(!acquired)return false
   if(!withinBudget()||!await port.isCurrent(binding,runId)||!same(await current()))return false
   const before=await client.verifyAccount()
   if(!withinBudget()||before.accountId!==binding.accountId||before.businessPhone!==binding.businessPhone||before.historySyncProgress!==100)return false
   const records=await client.history(scope.waId+'@c.us',100)
   if(!withinBudget())return false
   const after=await client.verifyAccount()
   if(after.accountId!==binding.accountId||after.businessPhone!==binding.businessPhone||after.historySyncProgress!==100||
    !withinBudget()||records.length===0||records.length>=100||Buffer.byteLength(JSON.stringify(records))>=5000000||!same(await current())||!await port.isCurrent(binding,runId))return false
   const fetchedAt=new Date().toISOString(),events=records.map(raw=>normaliseHistory(binding,raw,fetchedAt,'history'))
   if(events.some(e=>e.quarantineReason||!e.observation||e.observation.waId!==scope.waId||e.observation.providerChatId!==scope.waId+'@c.us'||
    e.observation.kind!=='text'||!e.observation.text||e.observation.edited||!e.providerTimestamp)||new Set(events.map(e=>e.observation!.providerMessageId)).size!==events.length)return false
   for(const event of events){if(!withinBudget()||!await port.isCurrent(binding,runId))return false;await port.ingest(binding,event)}
   if(!withinBudget())return false
   await db.query('BEGIN')
   try{
    await db.query("SET LOCAL lock_timeout='3s'");await db.query("SET LOCAL statement_timeout='10s'");await lockNativeScope(db,scope)
    if(!same(await current())||!await port.isCurrent(binding,runId)||!await nativeReleaseAllows(db,scope))throw Error('binding_changed')
    await db.query(`INSERT INTO public.inbox_autopilot_green_history(id,phone_number_id,wa_id,instance_id,account_id,binding_version,account_verified_at,fetched_at,sync_progress,records,payload_hash)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,100,$9::jsonb,$10)`,[randomUUID(),scope.phoneNumberId,scope.waId,binding.instanceId,binding.accountId,binding.version,after.observedAt,fetchedAt,JSON.stringify(records),nativeDigest(records)])
    // Reconciliation reads and native sends share this instance lease. Preserve checkpoint/result fields.
    const schedulerKey=`green:v1:${binding.phoneNumberId}:${binding.instanceId}:journal`
    const stateRow=(await db.query('SELECT cursor,clock_timestamp() AS now FROM public.inbox_sync_state WHERE key=$1 FOR UPDATE',[schedulerKey])).rows[0]
    const state=JSON.parse(stateRow?.cursor??'{}');if(state.runId!==runId)throw Error('lease_changed')
    await db.query('UPDATE public.inbox_sync_state SET cursor=$2 WHERE key=$1',[schedulerKey,JSON.stringify({...state,nativeNotBefore:new Date(nativeTime(stateRow.now)+1100).toISOString()})])
    await db.query('COMMIT')
   }catch(err){await db.query('ROLLBACK').catch(()=>{});throw err}
   return true
  }catch{return false}
  finally{clearTimeout(timer);controller.abort();if(acquired)await port.release(binding,runId).catch(()=>{});await db.end().catch(()=>{})}
 }
 return{
  captureHistory,
  async runScope(scope:GreenSendScope){
   // Reconcile existing staff evidence before spending on a provider history check.
   await deps.authorizeScope(scope)
   const db=await deps.connect();try{if(!await nativeReleaseAllows(db,scope))return{state:'paused',reason:'native_transport_not_enabled'}}finally{await db.end().catch(()=>{})}
   if(!(await deps.reconcileHandoff(scope)).complete)return{state:'needs_review',reason:'handover_pending'}
   if(!await captureHistory(scope))return{state:'needs_review',reason:'provider_history_unavailable'}
   await(deps.wait??(ms=>new Promise<void>(resolve=>setTimeout(resolve,ms))))(1100)
   return engine.runScope(scope)
  },
  settleAccepted:engine.settleAccepted,
 }
}
