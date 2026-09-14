import { requireWhatsAppInboxUser,WhatsAppScopeError } from '@/lib/whatsapp/number-scope'
import { GreenError } from '@/lib/whatsapp-green/contract'
import { readGreenConversation } from '@/lib/whatsapp-green/store'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}
export async function GET(request:Request){
  try{
    await requireWhatsAppInboxUser()
    const query=new URL(request.url).searchParams
    if([...query.keys()].some(k=>!['phoneNumberId','waId','cursor'].includes(k)))throw new GreenError('INVALID_QUERY')
    return Response.json(await readGreenConversation({phoneNumberId:query.get('phoneNumberId')??'',waId:query.get('waId')??''},query.get('cursor')??undefined),{headers})
  }catch(error){return Response.json({success:false,error:error instanceof GreenError?error.code:error instanceof WhatsAppScopeError?'INBOX_ACCESS_UNAVAILABLE':'PROVIDER_HISTORY_UNAVAILABLE'},{status:error instanceof GreenError||error instanceof WhatsAppScopeError?error.status:503,headers})}
}
