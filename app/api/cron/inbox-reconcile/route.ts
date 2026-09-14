import { cronAuthorization } from '@/lib/messenger/recovery/cron-auth.mjs'
import { reconcileRecentMessenger } from '@/lib/messenger/recovery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const headers = { 'Cache-Control': 'private, no-store' }

export async function GET(request: Request) {
  const authorization = cronAuthorization(request.headers.get('authorization'), process.env.CRON_SECRET)
  if (authorization === 'unconfigured') return Response.json({ success: false, error: 'Cron authentication is not configured' }, { status: 503, headers })
  if (authorization !== 'authorized') return Response.json({ success: false, error: 'Unauthorized' }, { status: 401, headers })
  if (new URL(request.url).search) return Response.json({ success: false, error: 'Parameters are not accepted' }, { status: 400, headers })
  if (!process.env.FACEBOOK_ACCESS_TOKEN) return Response.json({ success: false, error: 'Messenger recovery is not configured' }, { status: 503, headers })
  try {
    const result = await reconcileRecentMessenger()
    const failed = result.errors.length > 0 || result.pages.some(page => page.blocked > 0)
    return Response.json({ success: !failed, result }, { status: failed ? 503 : 200, headers })
  } catch {
    return Response.json({ success: false, error: 'Messenger recovery could not finish; saved progress is retained' }, { status: 503, headers })
  }
}
