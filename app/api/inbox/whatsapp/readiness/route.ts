import { requireWhatsAppInboxUser, WhatsAppScopeError } from '@/lib/whatsapp/number-scope'
import { getDraftReadiness } from '@/lib/whatsapp/draft-readiness'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }

/** Read-only: what the AI can read in this thread. Never sends and never marks anything read. */
export async function GET(request: Request) {
  try {
    await requireWhatsAppInboxUser()
    const query = new URL(request.url).searchParams
    if ([...query.keys()].some(key => !['phoneNumberId', 'waId'].includes(key))) throw new WhatsAppScopeError('Invalid query.', 400)
    const scope = { phoneNumberId: query.get('phoneNumberId') ?? '', waId: query.get('waId') ?? '' }
    return Response.json({ success: true, scope, readiness: await getDraftReadiness(scope) }, { headers })
  } catch (error) {
    const scoped = error instanceof WhatsAppScopeError
    return Response.json({ success: false, error: scoped ? 'INBOX_ACCESS_UNAVAILABLE' : 'READINESS_UNAVAILABLE' },
      { status: scoped ? error.status : 503, headers })
  }
}
