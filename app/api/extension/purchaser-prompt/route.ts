import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

/** Roles allowed to retune how the assistant negotiates with suppliers. */
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
    .select('purchaser_prompt, updated_at')
    .eq('id', 1)
    .maybeSingle()
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({
    success: true,
    prompt: data?.purchaser_prompt || '',
    updatedAt: data?.updated_at || null,
  })
}

export async function PUT(request: NextRequest) {
  const auth = await requireEditor()
  if ('error' in auth) {
    return NextResponse.json({ success: false, error: auth.error }, { status: auth.status })
  }

  const body = await request.json()
  const prompt = String(body.prompt ?? '').trim()
  if (prompt.length < 20) {
    return NextResponse.json(
      { success: false, error: 'The instruction is too short to be useful.' },
      { status: 400 },
    )
  }
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
      purchaser_prompt: prompt,
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
