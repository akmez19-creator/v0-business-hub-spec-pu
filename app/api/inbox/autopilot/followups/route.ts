import { AUTOPILOT_BUSINESSES, AutopilotError, businessOf, type BusinessKey } from '@/lib/inbox-autopilot/contract'
import { apiError, apiOk, requireAutopilotAdmin, smallJson } from '@/lib/inbox-autopilot/http'
import { followupConfig, previewFollowups, recentFollowups, setFollowupConfig } from '@/lib/inbox-autopilot/followup-runtime'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const KEYS = Object.keys(AUTOPILOT_BUSINESSES) as BusinessKey[]

async function status() {
  const businesses = await Promise.all(KEYS.map(async key => {
    const [config, recent] = await Promise.all([followupConfig(key), recentFollowups(key, 40)])
    return { ...config, recent }
  }))
  return { businesses, checkedAt: new Date().toISOString() }
}

export async function GET(request: Request) {
  try {
    await requireAutopilotAdmin(request)
    const preview = new URL(request.url).searchParams.get('preview')
    if (preview) { businessOf(preview); return apiOk({ candidates: await previewFollowups(preview as BusinessKey) }) }
    return apiOk(await status())
  } catch (error) { return apiError(error) }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireAutopilotAdmin(request), body = await smallJson(request)
    businessOf(body.businessKey); const key = body.businessKey as BusinessKey
    const patch: { enabled?: boolean; maxPerHour?: number } = {}
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') throw new AutopilotError('invalid_enabled')
      if (body.enabled && (process.env.VERCEL_ENV !== 'production' || !process.env.CRON_SECRET || !process.env.OPENAI_API_KEY)) throw new AutopilotError('production_worker_required', 503)
      patch.enabled = body.enabled
    }
    if (body.maxPerHour !== undefined) {
      if (!Number.isSafeInteger(body.maxPerHour) || Number(body.maxPerHour) < 1 || Number(body.maxPerHour) > 200) throw new AutopilotError('invalid_max_per_hour')
      patch.maxPerHour = Number(body.maxPerHour)
    }
    if (!Object.keys(patch).length) throw new AutopilotError('nothing_to_change')
    await setFollowupConfig(key, patch, actor)
    return apiOk(await status())
  } catch (error) { return apiError(error) }
}
