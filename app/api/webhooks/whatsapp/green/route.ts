import { configuredGreenBindings, greenBindingForBearer } from '@/lib/whatsapp-green/config'
import { GreenError } from '@/lib/whatsapp-green/contract'
import { normaliseWebhook } from '@/lib/whatsapp-green/normalise'
import { PgGreenStore } from '@/lib/whatsapp-green/store'
import { connectInboxDatabase } from '@/lib/messenger/pg'
import { createAutopilotWake } from '@/lib/inbox-autopilot/wake'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=180
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}

// A non-200 makes the provider retry the same event every minute and hold every newer one behind it, so a
// rejection must be visible in the function log. Only shape is logged: never the bearer, the body or the token.
function reject(request:Request,status:number,error:string,detail?:string){
  const auth=request.headers.get('authorization')
  console.warn('[green-webhook] rejected',{status,error,detail,authScheme:auth?auth.split(' ')[0]:null,authLength:auth?.length??0,
    contentType:request.headers.get('content-type'),contentLength:request.headers.get('content-length'),bindings:configuredGreenBindings().length})
  return Response.json({success:false,error},{status,headers})
}

export async function POST(request:Request){
  let db:Awaited<ReturnType<typeof connectInboxDatabase>>|undefined
  try{
    if(new URL(request.url).search)return reject(request,400,'QUERY_NOT_ALLOWED')
    const binding=greenBindingForBearer(request.headers.get('authorization'),configuredGreenBindings())
    if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return reject(request,415,'JSON_REQUIRED')
    const declared=Number(request.headers.get('content-length')||0)
    if(declared>1024*1024)return reject(request,413,'EVENT_TOO_LARGE')
    const reader=request.body?.getReader()
    if(!reader)return reject(request,400,'EMPTY_BODY')
    const chunks:Uint8Array[]=[];let bytes=0
    try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>1024*1024){await reader.cancel();throw new GreenError('EVENT_TOO_LARGE',413)}chunks.push(part.value)}}finally{reader.releaseLock()}
    let raw:unknown
    try{raw=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw new GreenError('INVALID_JSON')}
    const event=normaliseWebhook(binding,raw,new Date().toISOString())
    db=await connectInboxDatabase()
    const result=await new PgGreenStore(db).ingest(binding,event)
    // Green is no longer a send transport (Meta is the only one), so there is no
    // outgoing Green reply for autopilot to observe and hand off on. Straggler
    // provider events are still ingested and acknowledged, because a non-200
    // would make the provider retry this event forever.
    if(!result.quarantined&&!event.quarantineReason&&event.origin==='webhook'&&event.eventType==='incomingMessageReceived'&&event.observation?.direction==='in'&&event.observation.kind==='text'&&event.observation.waId){
      const autopilotWake=createAutopilotWake()
      autopilotWake.add('whatsapp',binding.phoneNumberId)
      autopilotWake.schedule()
    }
    // Provider HTTP200 acknowledgement follows the committed event ledger, never an unpersisted async task.
    return Response.json({success:true},{status:200,headers})
  }catch(error){
    if(error instanceof GreenError)return reject(request,error.status,error.code)
    return reject(request,503,'PROVIDER_EVENT_NOT_SAVED',error instanceof Error?`${error.name}: ${error.message.slice(0,200)}`:String(error).slice(0,200))
  }
  finally{await db?.end().catch(()=>{})}
}
