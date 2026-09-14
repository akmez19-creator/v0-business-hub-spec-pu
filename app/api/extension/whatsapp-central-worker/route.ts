import {NextResponse} from 'next/server'
import {recoveryFailure} from '@/lib/whatsapp/web-recovery-http'
import {centralFail,parseCentralWorker,readCentralJson} from '@/lib/whatsapp/central-recovery-contract'
import {centralRecoveryStore} from '@/lib/whatsapp/central-recovery-store'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:Request) {
  const headers={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','X-Content-Type-Options':'nosniff'}
  try {
    // App-owned service only. No browser-cookie authentication or cross-origin website transport.
    if(request.headers.has('origin'))centralFail(403,'SERVICE_ONLY','This endpoint is for the paired central service.')
    const body=parseCentralWorker(await readCentralJson(request));return NextResponse.json(await centralRecoveryStore.worker(body,request.headers.get('authorization')),{headers})
  }catch(error){return recoveryFailure(error,headers)}
}
