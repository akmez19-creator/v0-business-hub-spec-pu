import {NextResponse} from 'next/server'
import {requireRecoveryUser} from '@/lib/whatsapp/web-recovery-auth'
import {parseWorker} from '@/lib/whatsapp/web-recovery-contract'
import {recoveryStore} from '@/lib/whatsapp/web-recovery-store'
import {assertRecoveryOrigin,readRecoveryJson,recoveryFailure,recoveryHeaders} from '@/lib/whatsapp/web-recovery-http'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function OPTIONS(request:Request) {
  const headers=recoveryHeaders(request,true)
  try {assertRecoveryOrigin(request,true);return new NextResponse(null,{status:204,headers})}
  catch(error) {return recoveryFailure(error,headers)}
}
export async function GET(request:Request) {
  const headers=recoveryHeaders(request,true)
  try {
    assertRecoveryOrigin(request,true)
    const userId=await requireRecoveryUser(request,'bearer')
    return NextResponse.json({success:true,...await recoveryStore.handshake(userId)},{headers})
  } catch(error) {return recoveryFailure(error,headers)}
}
export async function POST(request:Request) {
  const headers=recoveryHeaders(request,true)
  try {
    assertRecoveryOrigin(request,true)
    const userId=await requireRecoveryUser(request,'bearer'),body=parseWorker(await readRecoveryJson(request))
    return NextResponse.json({success:true,...await recoveryStore.worker(userId,body)},{headers})
  } catch(error) {return recoveryFailure(error,headers)}
}
