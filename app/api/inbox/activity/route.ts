import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { recordAgentActivity } from '@/lib/agent-activity'

export const dynamic = 'force-dynamic'

/** The client pings this when an agent opens a lead - a footprint, not a send. */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null)
  const threadKey = typeof body?.threadKey === 'string' ? body.threadKey.slice(0, 200) : null
  const channel = ['messenger', 'whatsapp', 'comment'].includes(body?.channel) ? body.channel : null
  void recordAgentActivity({ userId: user.id, kind: 'inbox_open', threadKey, channel })
  return NextResponse.json({ ok: true })
}
