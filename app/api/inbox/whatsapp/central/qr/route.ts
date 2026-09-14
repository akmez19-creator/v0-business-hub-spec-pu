import {requireRecoveryUser} from '@/lib/whatsapp/web-recovery-auth'
import {scopeOf} from '@/lib/whatsapp/web-recovery-contract'
import {recoveryFailure} from '@/lib/whatsapp/web-recovery-http'
import {centralFail,centralUuid} from '@/lib/whatsapp/central-recovery-contract'
import {centralRecoveryStore} from '@/lib/whatsapp/central-recovery-store'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(request:Request) {
  const headers={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; sandbox"}
  try {const actor=await requireRecoveryUser(request,'cookie'),p=new URL(request.url).searchParams,scope=scopeOf({phoneNumberId:p.get('phoneNumberId'),waId:p.get('waId')}),id=p.get('sessionId'),nonce=p.get('nonce'),generation=Number(p.get('generation'))
    if(!centralUuid(id)||!centralUuid(nonce)||!Number.isSafeInteger(generation)||generation<1)centralFail(404,'QR_UNAVAILABLE','The connection code is unavailable.')
    const bytes=await centralRecoveryStore.qr(actor,scope,id!,generation,nonce!)
    return new Response(new Uint8Array(bytes),{headers:{...headers,'Content-Type':'image/png'}})
  }catch(error){return recoveryFailure(error,headers)}
}
