import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

/** The stored messages of one captured 1688 conversation, oldest first. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const { data: thread, error: threadErr } = await db
    .from('supplier_threads')
    .select('id, supplier_name, chat_handle, platform, history_complete, last_captured_at')
    .eq('id', id)
    .single()

  if (threadErr || !thread) {
    return NextResponse.json({ success: false, error: 'Conversation not found.' }, { status: 404 })
  }

  const { data: messages, error: msgErr } = await db
    .from('supplier_messages')
    .select('id, from_side, body, seq, captured_at')
    .eq('thread_id', id)
    .order('seq', { ascending: true })

  if (msgErr) {
    return NextResponse.json({ success: false, error: msgErr.message }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    thread: {
      id: thread.id,
      supplier: thread.supplier_name,
      handle: thread.chat_handle,
      platform: thread.platform,
      complete: thread.history_complete,
      lastCaptured: thread.last_captured_at,
    },
    messages: (messages || []).map(m => ({
      id: m.id,
      from: m.from_side as 'me' | 'them',
      body: m.body,
    })),
  })
}
