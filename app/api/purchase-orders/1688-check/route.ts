import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireBuyer } from '@/lib/local-purchasing/auth'
import { processResearchCommand, ResearchError } from '@/lib/purchase-orders/1688-check-service'
import { boundedBytes } from '@/lib/purchase-orders/1688-provider'
import { enqueueResearch, loadResearchQueue, queueMutation } from '@/lib/purchase-orders/1688-queue'
import { dispatchResearch } from '@/lib/purchase-orders/1688-dispatch'

export const maxDuration = 60
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store' }
const control = z.object({ operation: z.enum(['stop-batch', 'retry-dispatch']), runId: z.string().uuid(), requestKey: z.string().uuid() }).strict()
function failure(cause: unknown) {
  const message = cause instanceof Error ? cause.message : ''
  if (message === 'Not signed in' || message === 'Not allowed') return NextResponse.json({ success: false, error: message === 'Not signed in' ? 'Sign in to view or manage research.' : 'Only purchasing buyers can manage research.', reason: 'auth' }, { status: message === 'Not signed in' ? 401 : 403, headers })
  if (cause instanceof z.ZodError) return NextResponse.json({ success: false, error: 'Supply valid saved rows and revision identifiers.', reason: 'validation' }, { status: 400, headers })
  if (cause instanceof ResearchError) return NextResponse.json({ success: false, error: cause.message, reason: cause.reason, check: cause.check }, { status: cause.status, headers })
  return NextResponse.json({ success: false, error: 'Research state could not be loaded or saved. Reload before retrying; no automatic paid retry was started.', reason: 'storage' }, { status: 503, headers })
}
export async function GET() {
  try {
    const { db } = await requireBuyer()
    return NextResponse.json({ success: true, ...await loadResearchQueue(db) }, { headers })
  } catch (cause) { return failure(cause) }
}
export async function POST(request: Request) {
  try {
    const { db, userId } = await requireBuyer()
    if (request.headers.get('sec-fetch-site') === 'cross-site' || !request.headers.get('content-type')?.includes('application/json')) return NextResponse.json({ success: false, error: 'Invalid research request' }, { status: 400, headers })
    let input: Record<string, unknown>
    try { input = JSON.parse((await boundedBytes(new Response(request.body), 100_000)).toString('utf8')) }
    catch { return NextResponse.json({ success: false, error: 'Research request is invalid or too large' }, { status: 400, headers }) }
    if (input.operation === 'enqueue') {
      const run = await enqueueResearch(db, userId, input)
      await dispatchResearch(db, userId, run)
      return NextResponse.json({ success: true, runId: run.id }, { status: 202, headers })
    }
    if (input.operation === 'stop-batch' || input.operation === 'retry-dispatch') {
      const command = control.parse(input)
      const result = await queueMutation(db, userId, command.operation === 'stop-batch' ? 'stop' : 'redispatch', command.runId, {}, command.requestKey)
      if (command.operation === 'retry-dispatch' && result.run) await dispatchResearch(db, userId, result.run)
      return NextResponse.json({ success: true }, { headers })
    }
    if (input.operation === 'confirm-target') return NextResponse.json(await processResearchCommand(db, userId, input), { headers })
    return NextResponse.json({ success: false, error: 'Research runs through the shared background queue. Reload this page before submitting.', reason: 'validation' }, { status: 400, headers })
  } catch (cause) { return failure(cause) }
}
