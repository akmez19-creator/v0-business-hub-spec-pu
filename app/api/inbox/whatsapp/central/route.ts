import {NextResponse} from 'next/server'
import {requireRecoveryUser} from '@/lib/whatsapp/web-recovery-auth'
import {scopeOf} from '@/lib/whatsapp/web-recovery-contract'
import {assertRecoveryOrigin,recoveryFailure,recoveryHeaders} from '@/lib/whatsapp/web-recovery-http'
import {parseCentralAdmin,readCentralJson} from '@/lib/whatsapp/central-recovery-contract'
import {centralRecoveryStore} from '@/lib/whatsapp/central-recovery-store'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(request:Request) {
  const headers=recoveryHeaders(request)
  try {const actor=await requireRecoveryUser(request,'cookie'),p=new URL(request.url).searchParams;return NextResponse.json(await centralRecoveryStore.read(actor,scopeOf({phoneNumberId:p.get('phoneNumberId'),waId:p.get('waId')})),{headers})}
  catch(error){return recoveryFailure(error,headers)}
}
export async function POST(request:Request) {
  const headers=recoveryHeaders(request)
  try {assertRecoveryOrigin(request);const actor=await requireRecoveryUser(request,'cookie'),body=parseCentralAdmin(await readCentralJson(request));return NextResponse.json(await centralRecoveryStore.control(actor,body),{headers})}
  catch(error){return recoveryFailure(error,headers)}
}
