import { AutopilotError,businessOf,type BusinessKey } from '@/lib/inbox-autopilot/contract'
import { autopilotStore,runAutopilot } from '@/lib/inbox-autopilot/runtime'
import { apiError,apiOk,requireAutopilotAdmin,smallJson } from '@/lib/inbox-autopilot/http'
import { autopilotStatus } from '@/lib/inbox-autopilot/status'
export const runtime='nodejs'
export const maxDuration=180
export async function POST(request:Request) {
  try {
    const actor=await requireAutopilotAdmin(request);const body=await smallJson(request)
    businessOf(body.businessKey)
    if (typeof body.requestId!=='string' || !/^[0-9a-f-]{36}$/i.test(body.requestId)) throw new AutopilotError('invalid_request_id')
    const config=await autopilotStore.getConfig(body.businessKey as BusinessKey)
    if (!config.enabled) throw new AutopilotError('business_paused',409)
    if (config.version!==body.expectedVersion) throw new AutopilotError('config_changed',409)
    const first=await autopilotStore.claimRun(actor,body.businessKey as BusinessKey,config.version,body.requestId)
    if (first) await runAutopilot(body.businessKey as BusinessKey)
    return apiOk(await autopilotStatus())
  } catch(error){return apiError(error)}
}
