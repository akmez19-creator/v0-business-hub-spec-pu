import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCapabilities } from '@/lib/facebook/capabilities'
import { hasWhatsAppConfig } from '@/lib/whatsapp/store'

/**
 * What each inbox channel can actually do right now.
 *
 * The workspace calls this once and uses it to decide which tabs are live,
 * so an unavailable channel explains precisely which scope is missing instead
 * of rendering an empty list that looks like a quiet day.
 */
export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const token = process.env.FACEBOOK_ACCESS_TOKEN
    if (!token) {
      return NextResponse.json({
        success: false,
        error: 'FACEBOOK_ACCESS_TOKEN is not set.',
      })
    }

    const caps = await getCapabilities(token)

    // WhatsApp needs a webhook wired up as well as the scope, so report the
    // two independently - "scope granted but no messages will arrive" is a
    // different problem from "scope missing".
    const whatsappConfigured = hasWhatsAppConfig()

    return NextResponse.json({
      success: true,
      valid: caps.valid,
      scopes: caps.scopes,
      expiresAt: caps.expiresAt,
      channels: caps.channels,
      whatsappConfigured,
      ...(caps.error ? { error: caps.error } : {}),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Failed to read capabilities'
    console.log('[v0] capabilities failed:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
