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

export async function POST(request:Request){
  let db:Awaited<ReturnType<typeof connectInboxDatabase>>|undefined
  try{
    if(new URL(request.url).search)return Response.json({success:false,error:'QUERY_NOT_ALLOWED'},{status:400,headers})
    const binding=greenBindingForBearer(request.headers.get('authorization'),configuredGreenBindings())
    if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return Response.json({success:false,error:'JSON_REQUIRED'},{status:415,headers})
    const declared=Number(request.headers.get('content-length')||0)
    if(declared>1024*1024)return Response.json({success:false,error:'EVENT_TOO_LARGE'},{status:413,headers})
    const reader=request.body?.getReader()
    if(!reader)return Response.json({success:false,error:'EMPTY_BODY'},{status:400,headers})
    const chunks:Uint8Array[]=[];let bytes=0
    try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>1024*1024){await reader.cancel();throw new GreenError('EVENT_TOO_LARGE',413)}chunks.push(part.value)}}finally{reader.releaseLock()}
    let raw:unknown
    try{raw=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw new GreenError('INVALID_JSON')}
    const event=normaliseWebhook(binding,raw,new Date().toISOString())
    db=await connectInboxDatabase()
    const result=await new PgGreenStore(db).ingest(binding,event)
    if(!result.quarantined&&!event.quarantineReason&&event.origin==='webhook'&&event.eventType==='incomingMessageReceived'&&event.observation?.direction==='in'&&event.observation.kind==='text'&&event.observation.waId){
      const autopilotWake=createAutopilotWake()
      autopilotWake.add('whatsapp',binding.phoneNumberId)
      autopilotWake.schedule()
    }
    // Provider HTTP200 acknowledgement follows the committed event ledger, never an unpersisted async task.
    return Response.json({success:true},{status:200,headers})
  }catch(error){return Response.json({success:false,error:error instanceof GreenError?error.code:'PROVIDER_EVENT_NOT_SAVED'},{status:error instanceof GreenError?error.status:503,headers})}
  finally{await db?.end().catch(()=>{})}
}
