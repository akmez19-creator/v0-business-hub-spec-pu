import 'server-only'
import { randomUUID } from 'node:crypto'
import { AutopilotError, assertFingerprint, assertMessageId, scopeIdentity, type AutopilotJob, type AutopilotScope } from './contract'
import type { AutopilotDb } from './store'

export type StaffTaskKind = 'customer_issue' | 'exchange_or_change_request' | 'order_ready_for_staff'
export type StaffTaskInput = { kind: StaffTaskKind; evidence: Record<string,string>; catalogueFingerprint: string | null; deliveryDate: string | null }
export type StaffTask = {
  id:string;jobId:string;jobSource:'meta'|'green_api';businessKey:AutopilotScope['businessKey'];channel:AutopilotScope['channel'];ownerId:string;customerId:string
  conversationKey:string;inboundMessageId:string;customerName:string|null;kind:StaffTaskKind;status:'open'|'resolved';createdAt:string
  evidence:Record<string,string>;catalogueFingerprint:string|null;deliveryDate:string|null;manualTakeover:boolean
}
const kinds=new Set<StaffTaskKind>(['customer_issue','exchange_or_change_request','order_ready_for_staff'])
const fields=new Set(['productId','productName','productMessageId','quantity','quantityMessageId','amount','name','nameMessageId','phone','phoneMessageId','location','locationMessageId'])
export function validateStaffTask(input:StaffTaskInput):StaffTaskInput {
  if(!input||!kinds.has(input.kind)||!input.evidence||typeof input.evidence!=='object'||Array.isArray(input.evidence)||
    Object.keys(input).sort().join(',')!=='catalogueFingerprint,deliveryDate,evidence,kind')throw new AutopilotError('invalid_staff_task')
  for(const [key,value] of Object.entries(input.evidence)){
    if(!fields.has(key)||typeof value!=='string'||!value.trim()||value.length>(key.endsWith('MessageId')?2048:300)||/[\u0000-\u001f]/.test(value))throw new AutopilotError('invalid_staff_evidence')
    if(key.endsWith('MessageId'))assertMessageId(value)
  }
  if(input.catalogueFingerprint!==null)assertFingerprint(input.catalogueFingerprint)
  if(input.deliveryDate!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(input.deliveryDate)||!Number.isFinite(Date.parse(input.deliveryDate))||new Date(input.deliveryDate).toISOString().slice(0,10)!==input.deliveryDate))throw new AutopilotError('invalid_staff_delivery_date')
  if(input.kind==='order_ready_for_staff'){
    if([...fields].some(key=>!input.evidence[key])||!input.catalogueFingerprint||!input.deliveryDate||
      !/^(?:[1-9]|[1-4]\d|50)$/.test(input.evidence.quantity)||!/^\d+(?:\.\d+)?$/.test(input.evidence.amount)||!Number.isFinite(Number(input.evidence.amount))||Number(input.evidence.amount)<=0||
      !/^(?:\+?230[\s-]?)?5(?:[\s-]?\d){7}$/.test(input.evidence.phone))throw new AutopilotError('incomplete_staff_order_details')
  }else if(Object.keys(input.evidence).length||input.catalogueFingerprint!==null||input.deliveryDate!==null)throw new AutopilotError('invalid_staff_issue_details')
  if(Buffer.byteLength(JSON.stringify(input))>16000)throw new AutopilotError('staff_task_too_large')
  return input
}

/** Caller already owns config → exact scope locks and its job row. The task and
 * hold commit with the current review/send-intent transaction. No order, send,
 * external star, cross-account merge or inferred attribution is performed. */
type TaskOrigin=Pick<AutopilotJob,'id'|'scope'|'inboundMessageId'|'customerName'|'contextFingerprint'>&{source:'meta'|'green_api'}
export async function recordStaffTaskAndHold(db:AutopilotDb,job:AutopilotJob,input:StaffTaskInput):Promise<{created:boolean;taskId:string}> {
  return recordTaskAndHold(db,{...job,source:'meta'},input)
}
async function recordTaskAndHold(db:AutopilotDb,job:TaskOrigin,input:StaffTaskInput):Promise<{created:boolean;taskId:string}> {
  validateStaffTask(input)
  const {business,owner,customer}=scopeIdentity(job.scope),payload=JSON.stringify({schema:1,...input})
  const inserted=(await db.query('INSERT INTO public.inbox_autopilot_staff_tasks ' +
    '(id,job_id,business_code,channel,owner_id,customer_id,inbound_message_id,customer_name,kind,context_fingerprint,payload,job_source,native_job_id) ' +
    'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13) ON CONFLICT(business_code,channel,owner_id,customer_id,job_source,inbound_message_id) DO NOTHING RETURNING id',
    [randomUUID(),job.source==='meta'?job.id:null,business.code,job.scope.channel,owner,customer,job.inboundMessageId,job.customerName,input.kind,job.contextFingerprint,payload,job.source,job.source==='green_api'?job.id:null])).rows
  if(inserted.length!==1){
    const existing=(await db.query('SELECT id,(COALESCE(job_id,native_job_id)=$6 AND kind=$7 AND context_fingerprint=$8 AND payload=$9::jsonb) AS same ' +
      'FROM public.inbox_autopilot_staff_tasks WHERE business_code=$1 AND channel=$2 AND owner_id=$3 AND customer_id=$4 AND inbound_message_id=$5 AND job_source=$10',
      [business.code,job.scope.channel,owner,customer,job.inboundMessageId,job.id,input.kind,job.contextFingerprint,payload,job.source])).rows
    if(existing.length!==1||existing[0].same!==true)throw new AutopilotError('staff_task_identity_conflict',409)
    // Exact replay cannot restore a hold after an administrator deliberately resumed.
    return{created:false,taskId:existing[0].id}
  }
  await db.query('INSERT INTO public.inbox_autopilot_controls(business_code,channel,owner_id,customer_id,paused,updated_by) ' +
    'VALUES($1,$2,$3,$4,true,NULL) ON CONFLICT(business_code,channel,owner_id,customer_id) DO UPDATE SET paused=true,' +
    'updated_by=CASE WHEN inbox_autopilot_controls.paused AND inbox_autopilot_controls.updated_by IS NOT NULL THEN inbox_autopilot_controls.updated_by ELSE NULL END,' +
    'version=CASE WHEN inbox_autopilot_controls.paused AND inbox_autopilot_controls.updated_by IS NOT NULL THEN inbox_autopilot_controls.version ELSE inbox_autopilot_controls.version+1 END,' +
    'updated_at=CASE WHEN inbox_autopilot_controls.paused AND inbox_autopilot_controls.updated_by IS NOT NULL THEN inbox_autopilot_controls.updated_at ELSE clock_timestamp() END',
    [business.code,job.scope.channel,owner,customer])
  // A new automatic hold advances a temporary echo generation; a later proven
  // self-echo cannot clear this independent staff task. Human hold ownership stays.
  await db.query("UPDATE public.inbox_autopilot_jobs SET state='needs_review',reason=$5,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() " +
    "WHERE business_code=$1 AND channel=$2 AND owner_id=$3 AND customer_id=$4 AND state IN ('queued','processing') " +
    'AND send_token IS NULL AND send_started_at IS NULL AND reservation_day IS NULL AND provider_message_id IS NULL AND draft_text IS NULL',
    [business.code,job.scope.channel,owner,customer,input.kind])
  return{created:true,taskId:inserted[0].id}
}

/** Existing explicitly authorized Resume resolves the scoped staff queue. It
 * does not create an order, assert delivery, or reset an unknown send. */
export async function resolveStaffTasksOnResume(db:AutopilotDb,scope:AutopilotScope,actor:string):Promise<void>{
  const {business,owner,customer}=scopeIdentity(scope)
  await db.query("UPDATE public.inbox_autopilot_staff_tasks SET status='resolved',resolved_at=clock_timestamp(),resolved_by=$5 " +
    "WHERE business_code=$1 AND channel=$2 AND owner_id=$3 AND customer_id=$4 AND status='open'",[business.code,scope.channel,owner,customer,actor])
}

export function staffTaskFromRow(row:Record<string,any>):StaffTask{
  const businessKey=row.business_code==='MBM'?'made_by_moris':row.business_code==='DBM'?'destockage':null
  if(!businessKey)throw new AutopilotError('invalid_staff_scope',503)
  const scope:AutopilotScope=row.channel==='messenger'?{businessKey,channel:'messenger',pageId:row.owner_id,psid:row.customer_id}
    :{businessKey,channel:'whatsapp',phoneNumberId:row.owner_id,waId:row.customer_id}
  const identity=scopeIdentity(scope),{schema,...payload}=row.payload??{}
  if(schema!==1||row.kind!==payload.kind)throw new AutopilotError('invalid_saved_staff_task',503)
  validateStaffTask(payload)
  if((row.job_source!=='meta'&&row.job_source!=='green_api')||(row.job_source==='meta'?(!row.job_id||row.native_job_id!==null):(!row.native_job_id||row.job_id!==null)))throw new AutopilotError('invalid_saved_staff_origin',503)
  return{id:row.id,jobId:row.job_source==='meta'?row.job_id:row.native_job_id,jobSource:row.job_source,businessKey,channel:scope.channel,ownerId:identity.owner,customerId:identity.customer,
    conversationKey:identity.conversationKey,inboundMessageId:row.inbound_message_id,customerName:row.customer_name??null,kind:row.kind,status:row.status,
    createdAt:new Date(row.created_at).toISOString(),evidence:payload.evidence,catalogueFingerprint:payload.catalogueFingerprint,deliveryDate:payload.deliveryDate,manualTakeover:row.paused===true}
}
