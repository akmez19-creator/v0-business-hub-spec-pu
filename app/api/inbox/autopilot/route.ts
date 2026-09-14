import { AUTOPILOT_BUSINESSES, AutopilotError, businessOf, scopeIdentity, type BusinessKey, type AutopilotScope, type ConfigPatch } from '@/lib/inbox-autopilot/contract'
import { autopilotStore } from '@/lib/inbox-autopilot/runtime'
import { apiError,apiOk,requireAutopilotAdmin,smallJson } from '@/lib/inbox-autopilot/http'
import { autopilotStatus } from '@/lib/inbox-autopilot/status'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=60

export async function GET(request:Request) {
  try {await requireAutopilotAdmin(request);return apiOk(await autopilotStatus())} catch(error){return apiError(error)}
}
export async function PATCH(request:Request) {
  try {
    const actor=await requireAutopilotAdmin(request),body=await smallJson(request)
    businessOf(body.businessKey);const key=body.businessKey as BusinessKey
    if (body.action==='pause') await autopilotStore.pauseConfig(actor,key)
    else if (body.action==='takeover') {
      const b=AUTOPILOT_BUSINESSES[key]
      if (!['messenger','whatsapp'].includes(String(body.channel)) || typeof body.customerId!=='string' || typeof body.paused!=='boolean') throw new AutopilotError('invalid_takeover')
      const scope:AutopilotScope=body.channel==='messenger'?{businessKey:key,channel:'messenger',pageId:b.pageId,psid:body.customerId}
        :{businessKey:key,channel:'whatsapp',phoneNumberId:b.phoneNumberId,waId:body.customerId}
      scopeIdentity(scope);await autopilotStore.setManualTakeover(actor,scope,body.paused)
    } else {
      if (body.action!==undefined || !Number.isSafeInteger(body.expectedVersion) || Number(body.expectedVersion)<1) throw new AutopilotError('invalid_version')
      if (body.enabled===true && (process.env.VERCEL_ENV!=='production' || !process.env.CRON_SECRET || !process.env.OPENAI_API_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY)) throw new AutopilotError('production_worker_required',503)
      const {businessKey,expectedVersion,...patch}=body
      await autopilotStore.updateConfig(actor,key,Number(expectedVersion),patch as ConfigPatch)
    }
    return apiOk(await autopilotStatus())
  } catch(error){return apiError(error)}
}
