import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

/**
 * Editor for extension_settings.ai_reply_prompt - the business context and tone
 * the customer-facing reply assistant follows. It is already read by BOTH
 * /api/inbox/ai-assist (the dashboard "Draft with AI") and
 * /api/extension/ai-reply (the Chrome extension button); this route only adds a
 * way to edit it. Both consumers keep their own guardrails: the assistant is
 * always given the live product catalogue and never invents prices or dates, so
 * anything typed here steers wording and policy, not the numbers.
 *
 * The fully automated WhatsApp Autopilot deliberately does NOT read this - it
 * renders fixed approved templates - so editing this cannot change what an
 * unattended reply says.
 */
const ALLOWED = ['admin', 'manager']

async function requireEditor() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not signed in', status: 401 as const }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || !ALLOWED.includes(profile.role)) {
    return { error: 'Not allowed', status: 403 as const }
  }
  return { supabase, user }
}

export async function GET() {
  const auth = await requireEditor()
  if ('error' in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }
  const { data, error } = await auth.supabase
    .from('extension_settings')
    .select('ai_reply_prompt, updated_at')
    .eq('id', 1)
    .maybeSingle()
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({
    success: true,
    prompt: data?.ai_reply_prompt || '',
    updatedAt: data?.updated_at || null,
  })
}

export async function PUT(request: NextRequest) {
  const auth = await requireEditor()
  if ('error' in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const body = await request.json()
  // An empty string is valid: it clears the business context and lets the
  // assistant fall back to its built-in instructions.
  const prompt = String(body.prompt ?? '').trim()
  if (prompt.length > 6000) {
    return NextResponse.json(
      { success: false, error: 'The instruction is too long (6000 characters max).' },
      { status: 400 },
    )
  }

  // select() so a policy that silently matches zero rows is reported as a
  // failure rather than a save that appears to work and changes nothing.
  const { data, error } = await auth.supabase
    .from('extension_settings')
    .update({
      ai_reply_prompt: prompt,
      updated_at: new Date().toISOString(),
      updated_by: auth.user.id,
    })
    .eq('id', 1)
    .select('id')
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  if (!data?.length) {
    return NextResponse.json(
      { success: false, error: 'Nothing was saved - the settings row was not writable.' },
      { status: 500 },
    )
  }
  return NextResponse.json({ success: true })
}
