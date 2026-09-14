import {NextResponse} from 'next/server'
import {requireRecoveryUser} from '@/lib/whatsapp/web-recovery-auth'
import {parseControl,scopeOf} from '@/lib/whatsapp/web-recovery-contract'
import {recoveryStore} from '@/lib/whatsapp/web-recovery-store'
import {assertRecoveryOrigin,readRecoveryJson,recoveryFailure,recoveryHeaders} from '@/lib/whatsapp/web-recovery-http'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(request:Request) {
  const headers=recoveryHeaders(request)
  try {
    const userId=await requireRecoveryUser(request,'cookie'),p=new URL(request.url).searchParams
    const scope=scopeOf({phoneNumberId:p.get('phoneNumberId'),waId:p.get('waId')})
    return NextResponse.json({success:true,...await recoveryStore.read(userId,scope)},{headers})
  } catch(error) {return recoveryFailure(error,headers)}
}
export async function POST(request:Request) {
  const headers=recoveryHeaders(request)
  try {
    assertRecoveryOrigin(request)
    const userId=await requireRecoveryUser(request,'cookie'),body=parseControl(await readRecoveryJson(request))
    return NextResponse.json({success:true,...await recoveryStore.control(userId,body)},{headers})
  } catch(error) {return recoveryFailure(error,headers)}
}
