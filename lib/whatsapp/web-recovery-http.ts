import {NextResponse} from 'next/server'
import {RECOVERY_LIMITS,RecoveryError} from './web-recovery-contract'
export function recoveryHeaders(request:Request,extension=false) {
  const headers:Record<string,string>={'Cache-Control':'private, no-store','Vary':'Origin'}
  const origin=request.headers.get('origin')
  if(extension && origin && (/^chrome-extension:\/\/[a-p]{32}$/.test(origin) || origin===new URL(request.url).origin)) {
    headers['Access-Control-Allow-Origin']=origin
    headers['Access-Control-Allow-Headers']='Authorization, Content-Type'
    headers['Access-Control-Allow-Methods']='GET, POST, OPTIONS'
  }
  return headers
}
export function assertRecoveryOrigin(request:Request,extension=false) {
  const origin=request.headers.get('origin')
  if(extension) {
    if(origin && origin!==new URL(request.url).origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin))
      throw new RecoveryError(403,'ORIGIN_FORBIDDEN','This recovery request has an unrecognized origin.')
  } else if(origin!==new URL(request.url).origin) throw new RecoveryError(403,'ORIGIN_FORBIDDEN','Open recovery from the signed-in Akmez page.')
}
export async function readRecoveryJson(request:Request):Promise<unknown> {
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    throw new RecoveryError(415,'JSON_REQUIRED','Recovery requests must use JSON.')
  if(!request.body) throw new RecoveryError(400,'INVALID_JSON','The recovery request is empty.')
  const reader=request.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true}); let bytes=0,value=''
  try {
    while(true) {
      const chunk=await reader.read(); if(chunk.done) break
      bytes+=chunk.value.byteLength
      if(bytes>RECOVERY_LIMITS.maxBodyBytes) {await reader.cancel().catch(()=>{});throw new RecoveryError(413,'CAPTURE_TOO_LARGE','Reduce this copy to a smaller group of messages.')}
      value+=decoder.decode(chunk.value,{stream:true})
    }
    value+=decoder.decode(); return JSON.parse(value)
  } catch(error) {
    if(error instanceof RecoveryError) throw error
    throw new RecoveryError(400,'INVALID_JSON','The recovery request could not be read.')
  } finally {reader.releaseLock()}
}
export function recoveryFailure(error:unknown,headers:Record<string,string>) {
  const known=error instanceof RecoveryError
  return NextResponse.json({success:false,code:known?error.code:'SERVICE_UNAVAILABLE',
    error:known?error.message:'Recovery is temporarily unavailable. Existing inbox messages are unchanged.'},
    {status:known?error.status:503,headers})
}
