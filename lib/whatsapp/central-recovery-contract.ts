import {RecoveryError,scopeOf,parseWorker,type RecoveryScope} from './web-recovery-contract'

export const CENTRAL_LIMITS={pairSeconds:600,workerSeconds:1800,presenceSeconds:20,qrSeconds:30,operationSeconds:90,maxQrBytes:131072,maxBodyBytes:245760} as const
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)
export const centralUuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
export function centralFail(status:number,code:string,message:string):never {throw new RecoveryError(status,code,message)}
function keys(v:Record<string,unknown>,allowed:string[]) {if(Object.keys(v).some(k=>!allowed.includes(k)))centralFail(400,'INVALID_REQUEST','The central recovery request contains unsupported fields.')}
function generation(v:unknown):v is number{return Number.isSafeInteger(v)&&Number(v)>=0}
export type CentralAdminRequest=RecoveryScope&({action:'connect';expectedGeneration:number}|{action:'pause'}|{action:'fetch';expectedGeneration:number;requestId:string})
export function parseCentralAdmin(value:unknown):CentralAdminRequest {
  const scope=scopeOf(value),v=value as Record<string,unknown>
  keys(v,['action','phoneNumberId','waId',...(v.action==='pause'?[]:['expectedGeneration']),...(v.action==='fetch'?['requestId']:[])])
  if(v.action==='pause')return {...scope,action:'pause'}
  if(!generation(v.expectedGeneration))return centralFail(400,'INVALID_GENERATION','Refresh the connection before continuing.')
  if(v.action==='connect')return {...scope,action:'connect',expectedGeneration:v.expectedGeneration}
  if(v.action==='fetch'&&centralUuid(v.requestId))return {...scope,action:'fetch',expectedGeneration:v.expectedGeneration,requestId:v.requestId}
  return centralFail(400,'INVALID_REQUEST','Choose a supported connection action.')
}
export type CentralWorkerRequest={action:'pair';sessionId:string;instanceId:string;pairToken:string}|
  {action:'poll';sessionId:string;instanceId:string;generation:number}|
  {action:'report';sessionId:string;instanceId:string;generation:number;sequence:number;observedAt:string;phase:'connecting'|'qr'|'linked'|'failed';businessPhone:string|null;qrPngBase64:string|null;reason:string|null}|
  {action:'complete';sessionId:string;instanceId:string;generation:number;operationId:string;claimToken:string;snapshotId:string;capturedAt:string;completeness:'partial'|'unknown';observations:unknown[]}|
  {action:'fail';sessionId:string;instanceId:string;generation:number;operationId:string;claimToken:string;reason:string}
const reasons=['source_unavailable','identity_unconfirmed','unsupported_dom','capture_incomplete','connection_lost','cancelled']
export function parseCentralWorker(value:unknown,now=Date.now()):CentralWorkerRequest {
  if(!object(value))return centralFail(400,'INVALID_REQUEST','A central worker request is required.')
  const v=value,base=['action','sessionId','instanceId']
  const extra=v.action==='pair'?['pairToken']:v.action==='poll'?['generation']:v.action==='report'?['generation','sequence','observedAt','phase','businessPhone','qrPngBase64','reason']:
    v.action==='complete'?['generation','operationId','claimToken','snapshotId','capturedAt','completeness','observations']:['generation','operationId','claimToken','reason']
  keys(v,[...base,...extra])
  if(!centralUuid(v.sessionId)||!centralUuid(v.instanceId))return centralFail(400,'INVALID_SESSION','The worker session identity is invalid.')
  if(v.action==='pair') {
    if(typeof v.pairToken!=='string'||!/^akm_pair_[0-9a-f]{64}$/.test(v.pairToken))return centralFail(401,'PAIR_INVALID','Pairing is unavailable or expired.')
    return v as CentralWorkerRequest
  }
  if(!generation(v.generation))return centralFail(400,'INVALID_GENERATION','The worker generation is invalid.')
  if(v.action==='poll')return v as CentralWorkerRequest
  if(v.action==='report') {
    if(typeof v.observedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v.observedAt)||!Number.isFinite(Date.parse(v.observedAt))||Date.parse(v.observedAt)<now-15000||Date.parse(v.observedAt)>now+5000||
      !Number.isSafeInteger(v.sequence)||Number(v.sequence)<1||!['connecting','qr','linked','failed'].includes(String(v.phase))||
      !(v.businessPhone===null||typeof v.businessPhone==='string'&&/^\d{5,20}$/.test(v.businessPhone))||
      (v.phase==='linked'?(v.businessPhone===null||v.qrPngBase64!==null||v.reason!==null):v.businessPhone!==null)||
      (v.phase==='qr'?(typeof v.qrPngBase64!=='string'||v.reason!==null):v.qrPngBase64!==null)||
      (v.phase==='failed'?!reasons.includes(String(v.reason)):v.reason!==null))
      return centralFail(400,'INVALID_REPORT','Report only the actual connection state.')
    if(v.phase==='qr')validateQr(v.qrPngBase64 as string)
    return v as CentralWorkerRequest
  }
  if(!centralUuid(v.operationId)||typeof v.claimToken!=='string'||! /^[0-9a-f]{64}$/.test(v.claimToken))return centralFail(400,'INVALID_LEASE','The finite recovery operation is invalid.')
  if(v.action==='fail'&&reasons.includes(String(v.reason)))return v as CentralWorkerRequest
  if(v.action==='complete'&&centralUuid(v.snapshotId)&&typeof v.capturedAt==='string'&&['unknown','partial'].includes(String(v.completeness))&&Array.isArray(v.observations))return v as CentralWorkerRequest
  return centralFail(400,'INVALID_REQUEST','Choose a supported finite worker action.')
}
export function validateQr(base64:string):Buffer {
  if(base64.length>Math.ceil(CENTRAL_LIMITS.maxQrBytes/3)*4||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))return centralFail(400,'INVALID_QR','The connection image is invalid.')
  const bytes=Buffer.from(base64,'base64')
  if(bytes.length<33||bytes.length>CENTRAL_LIMITS.maxQrBytes||bytes.toString('base64')!==base64||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.toString('ascii',12,16)!=='IHDR')return centralFail(400,'INVALID_QR','The connection image is invalid.')
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20)
  if(width!==height||width<128||width>1024)return centralFail(400,'INVALID_QR','Supply only the cropped square connection code.')
  return bytes
}
export function centralCompletion(v:Extract<CentralWorkerRequest,{action:'complete'}>,scope:RecoveryScope) {
  // Existing observation validation remains the canonical contract for separate Web copies.
  const phones:Record<string,string>={'968962882975955':'23052500684','1090043534186338':'23059406784'}
  const p=parseWorker({action:'complete',...scope,connectionId:v.sessionId,jobId:v.operationId,claimToken:v.claimToken,
    businessPhone:phones[scope.phoneNumberId],customerPhone:scope.waId,snapshotId:v.snapshotId,capturedAt:v.capturedAt,completeness:v.completeness,observations:v.observations})
  if(p.action!=='complete')return centralFail(400,'INVALID_CAPTURE','The capture shape is invalid.')
  return p
}
export async function readCentralJson(request:Request):Promise<unknown> {
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return centralFail(415,'JSON_REQUIRED','Use a JSON request.')
  if(!request.body)return centralFail(400,'INVALID_REQUEST','A request body is required.')
  const reader=request.body.getReader(),chunks:Uint8Array[]=[];let size=0
  try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>CENTRAL_LIMITS.maxBodyBytes){await reader.cancel();return centralFail(413,'REQUEST_TOO_LARGE','The central recovery request is too large.')}chunks.push(value)}} finally{reader.releaseLock()}
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))}catch{return centralFail(400,'INVALID_JSON','The request could not be read.')}
}
