import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkCoverage } from '@/lib/messenger/coverage'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MIN_HOURS = 1
const MAX_HOURS = 72

/** On-demand comparison of Meta's active threads against the messages we hold. */
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' }
  try {
    const auth = await createClient()
    const { data: { user } } = await auth.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401, headers })

    const requested = Number(new URL(request.url).searchParams.get('hours') ?? 24)
    const hours = Number.isFinite(requested) ? Math.min(MAX_HOURS, Math.max(MIN_HOURS, Math.round(requested))) : 24
    const report = await checkCoverage(hours)
    return NextResponse.json({ success: true, ...report }, { headers })
  } catch {
    return NextResponse.json({ success: false, error: 'The coverage check could not run. Please retry.' }, { status: 503, headers })
  }
}
