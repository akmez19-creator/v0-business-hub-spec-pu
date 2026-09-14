export const PILOT_WA_ID = '23052583671'
export const RECOVERY_LIMITS = { maxMessages: 40, maxTextLength: 4000, maxBodyBytes: 65536, leaseSeconds: 120 } as const
export const RECOVERY_BINDINGS = [
  { phoneNumberId:'1090043534186338', businessPhone:'23059406784', businessName:'Made By Moris', pageId:'308584892331429' },
  { phoneNumberId:'968962882975955', businessPhone:'23052500684', businessName:'Destockage By Moris', pageId:'471644012696537' },
] as const
export type RecoveryScope = { phoneNumberId:string; waId:string }
export type RecoveryObservation = { sourceMessageId:string; direction:'in'|'out'; text:string|null;
  kind:'text'|'unsupported'; sentAt:string|null; displayedSentAt:string|null; unsupportedKind:string|null }
export class RecoveryError extends Error {
  constructor(public status:number,public code:string,message:string) { super(message) }
}
export const reject = (status:number, code:string, text:string):never => { throw new RecoveryError(status,code,text) }
const object = (v:unknown):v is Record<string,unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const uuid = (v:unknown):v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const iso = (v:unknown):v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,19)===v.slice(0,19)
const text = (v:unknown,max:number):v is string => typeof v === 'string' && v.trim().length>0 && v.length<=max && !/[\u0000]/.test(v)
function keys(v:Record<string,unknown>, allowed:string[]) {
  if(Object.keys(v).some(k=>!allowed.includes(k))) reject(400,'INVALID_REQUEST','The recovery request contains unsupported fields.')
}
export function scopeOf(v:unknown): RecoveryScope {
  if(!object(v) || !RECOVERY_BINDINGS.some(b=>b.phoneNumberId===v.phoneNumberId) || v.waId!==PILOT_WA_ID)
    return reject(403,'PILOT_SCOPE_ONLY','This pilot is available only for the approved internal test conversation.')
  return {phoneNumberId:v.phoneNumberId as string,waId:PILOT_WA_ID}
}
export type ControlRequest = RecoveryScope & ({action:'configure';expectedVersion:number;enabled:boolean;responseSurface:'business_suite'|'akmez_manual'} |
  {action:'enqueue';expectedVersion:number})
export function parseControl(v:unknown):ControlRequest {
  const scope=scopeOf(v); const o=v as Record<string,unknown>
  keys(o,['action','phoneNumberId','waId','expectedVersion',...(o.action==='configure'?['enabled','responseSurface']:[])])
  if(!Number.isSafeInteger(o.expectedVersion) || Number(o.expectedVersion)<0) reject(400,'INVALID_VERSION','Refresh this conversation before changing its recovery settings.')
  if(o.action==='enqueue') return {...scope,action:'enqueue',expectedVersion:o.expectedVersion as number}
  if(o.action!=='configure' || typeof o.enabled!=='boolean' || !['business_suite','akmez_manual'].includes(String(o.responseSurface)))
    return reject(400,'INVALID_REQUEST','Choose a valid recovery setting.')
  return {...scope,action:'configure',expectedVersion:o.expectedVersion as number,enabled:o.enabled,responseSurface:o.responseSurface as 'business_suite'|'akmez_manual'}
}
type ClaimBase = RecoveryScope & {connectionId:string;businessPhone:string;customerPhone:string}
type LeaseBase = ClaimBase & {jobId:string;claimToken:string}
export type WorkerRequest = (ClaimBase & {action:'claim'}) | (LeaseBase & {action:'fail';reason:string}) |
  (LeaseBase & {action:'complete';snapshotId:string;capturedAt:string;completeness:'unknown'|'partial';observations:RecoveryObservation[]})
export function parseWorker(v:unknown, now=Date.now()):WorkerRequest {
  const scope=scopeOf(v); const o=v as Record<string,unknown>
  const base=['action','phoneNumberId','waId','connectionId','businessPhone','customerPhone']
  keys(o,[...base,...(o.action==='claim'?[]:['jobId','claimToken']),...(o.action==='complete'?['snapshotId','capturedAt','completeness','observations']:o.action==='fail'?['reason']:[])])
  const binding=RECOVERY_BINDINGS.find(b=>b.phoneNumberId===scope.phoneNumberId)!
  if(!uuid(o.connectionId) || o.businessPhone!==binding.businessPhone || o.customerPhone!==scope.waId)
    return reject(409,'IDENTITY_UNCONFIRMED','The observed business and customer do not match this pilot conversation.')
  const common={...scope,connectionId:o.connectionId,businessPhone:binding.businessPhone,customerPhone:scope.waId}
  if(o.action==='claim') return {...common,action:'claim'}
  if(!uuid(o.jobId) || typeof o.claimToken!=='string' || !/^[0-9a-f]{64}$/.test(o.claimToken))
    return reject(400,'INVALID_LEASE','The recovery claim is invalid. Request a new recovery job.')
  const lease={...common,jobId:o.jobId,claimToken:o.claimToken}
  if(o.action==='fail') {
    if(!['source_unavailable','identity_unconfirmed','capture_incomplete','connection_lost'].includes(String(o.reason)))
      return reject(400,'INVALID_REASON','Choose a supported recovery failure reason.')
    return {...lease,action:'fail',reason:o.reason as string}
  }
  if(o.action!=='complete' || !uuid(o.snapshotId) || !iso(o.capturedAt) || Date.parse(o.capturedAt)>now+300000 ||
    Date.parse(o.capturedAt)<now-86400000 || !['unknown','partial'].includes(String(o.completeness)) ||
    !Array.isArray(o.observations) || o.observations.length<1 || o.observations.length>RECOVERY_LIMITS.maxMessages)
    return reject(400,'INVALID_CAPTURE','Supply a recent, bounded capture. Complete history cannot be asserted by this pilot.')
  const seen=new Set<string>()
  const observations:RecoveryObservation[]=o.observations.map((raw:unknown)=>{
    if(!object(raw)) return reject(400,'INVALID_OBSERVATION','A copied message has an invalid shape.')
    keys(raw,['sourceMessageId','direction','text','kind','sentAt','displayedSentAt','unsupportedKind'])
    if(!text(raw.sourceMessageId,600) || seen.has(raw.sourceMessageId) || !['in','out'].includes(String(raw.direction)) ||
      !['text','unsupported'].includes(String(raw.kind)) || (raw.sentAt!==null && !iso(raw.sentAt)) ||
      (raw.sentAt!==null && Date.parse(raw.sentAt as string)>Date.parse(o.capturedAt as string)+300000) ||
      (raw.displayedSentAt!==null && !text(raw.displayedSentAt,160)))
      return reject(400,'INVALID_OBSERVATION','A copied message has unknown identity, direction or time metadata.')
    if(raw.kind==='text' && (!text(raw.text,RECOVERY_LIMITS.maxTextLength) || raw.unsupportedKind!==null))
      return reject(400,'INVALID_OBSERVATION','Text copies require their original text and no media claim.')
    if(raw.kind==='unsupported' && ((raw.text!==null && !text(raw.text,RECOVERY_LIMITS.maxTextLength)) || !text(raw.unsupportedKind,80)))
      return reject(400,'INVALID_OBSERVATION','Unsupported content needs an explicit content label.')
    seen.add(raw.sourceMessageId)
    return {sourceMessageId:raw.sourceMessageId,direction:raw.direction as 'in'|'out',kind:raw.kind as 'text'|'unsupported',
      text:raw.text as string|null,sentAt:raw.sentAt as string|null,displayedSentAt:raw.displayedSentAt as string|null,unsupportedKind:raw.unsupportedKind as string|null}
  })
  return {...lease,action:'complete',snapshotId:o.snapshotId,capturedAt:o.capturedAt,completeness:o.completeness as 'unknown'|'partial',observations}
}
