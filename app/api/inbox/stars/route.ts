import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { loadStars, setStar, clearStar, normaliseStarNote } from '@/lib/inbox/thread-stars'
import { recordAgentActivity } from '@/lib/agent-activity'

export const dynamic = 'force-dynamic'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function GET() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const stars = await loadStars(createAdminClient())
  return NextResponse.json({ stars: Object.fromEntries(stars) })
}

export async function POST(request: Request) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null)
  const threadKey = typeof body?.threadKey === 'string' ? body.threadKey.trim() : ''
  if (!threadKey) return NextResponse.json({ error: 'threadKey required' }, { status: 400 })

  const db = createAdminClient()

  if (body?.remove === true) {
    const res = await clearStar(db, threadKey)
    if (res.error) return NextResponse.json({ error: res.error }, { status: 500 })
    void recordAgentActivity({ userId: user.id, kind: 'inbox_unstar', threadKey })
    return NextResponse.json({ ok: true })
  }

  const note = normaliseStarNote(body?.note)
  if (!note) {
    return NextResponse.json(
      { error: 'Explain the issue in a full sentence (at least 12 characters) before starring.' },
      { status: 400 },
    )
  }
  const res = await setStar(db, threadKey, note, user.id)
  if (res.error) return NextResponse.json({ error: res.error }, { status: 500 })
  void recordAgentActivity({ userId: user.id, kind: 'inbox_star', threadKey, detail: note })
  const stars = await loadStars(db)
  return NextResponse.json({ ok: true, star: stars.get(threadKey) ?? null })
}
