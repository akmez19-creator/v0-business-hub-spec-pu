import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { THREAD_MARK_KINDS, type ThreadMarkKind } from '@/lib/inbox/thread-marks'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

  const { data, error } = await supabase
    .from('inbox_thread_marks')
    .select('thread_key, kind, marked_at, marked_by')
    .order('marked_at', { ascending: false })
    .limit(5000)
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })

  return NextResponse.json(
    { success: true, marks: (data ?? []).map((row) => ({ key: row.thread_key, kind: row.kind as ThreadMarkKind, at: row.marked_at, by: row.marked_by })) },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

  const body = (await request.json().catch(() => null)) as { key?: unknown; kind?: unknown } | null
  const key = typeof body?.key === 'string' ? body.key.trim() : ''
  if (!key || key.length > 200) return NextResponse.json({ success: false, error: 'Missing thread key' }, { status: 400 })

  if (body?.kind === null) {
    const { error } = await supabase.from('inbox_thread_marks').delete().eq('thread_key', key)
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, mark: null })
  }

  const kind = body?.kind
  if (typeof kind !== 'string' || !(THREAD_MARK_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ success: false, error: 'Unknown mark' }, { status: 400 })
  }
  const at = new Date().toISOString()
  const { error } = await supabase
    .from('inbox_thread_marks')
    .upsert({ thread_key: key, kind, marked_at: at, marked_by: user.email ?? user.id }, { onConflict: 'thread_key' })
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, mark: { key, kind, at } })
}
