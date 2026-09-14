import { apiError,apiOk,cronAuthorized } from '@/lib/inbox-autopilot/http'
import { AutopilotError } from '@/lib/inbox-autopilot/contract'
import { runAutopilot } from '@/lib/inbox-autopilot/runtime'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=180
export async function GET(request:Request) {
  if (!cronAuthorized(request)) return apiError(new AutopilotError('unauthorized',401))
  try {await runAutopilot();return apiOk({checked:true})} catch(error){return apiError(error)}
}
