import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { connectInboxDatabase } from '@/lib/messenger/pg'
import { configuredGreenBindings } from '@/lib/whatsapp-green/config'
import { PgGreenStore } from '@/lib/whatsapp-green/store'
import { reconcileGreenBinding } from '@/lib/whatsapp-green/reconciliation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120
const digest = (value: string) => createHash('sha256').update(value).digest()

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  const authorization = request.headers.get('authorization')
  if (!secret || secret.length < 16 || !authorization || authorization.length > 4096 ||
      !timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`))) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const bindings = configuredGreenBindings().filter(binding => binding.enabled)
    const results = await Promise.all(bindings.map(async binding => {
      const db = await connectInboxDatabase()
      try { return await reconcileGreenBinding(binding, new PgGreenStore(db), { signal: request.signal }) }
      finally { await db.end().catch(() => {}) }
    }))
    const failed = results.some(result => result.state === 'failed')
    return NextResponse.json({ success: !failed, mode: 'observation', autoReplyEnabled: false, results }, {
      status: failed ? 503 : 200, headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json({ success: false, error: 'GREEN_RECONCILIATION_UNAVAILABLE' }, { status: 503 })
  }
}
