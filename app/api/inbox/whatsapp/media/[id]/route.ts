import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { whatsappToken } from '@/lib/whatsapp/store'

/**
 * Streams WhatsApp media (video, image, audio, documents) to the browser.
 *
 * A proxy is unavoidable here. Cloud API media is a two-step fetch:
 *   1. GET /{media-id}          -> a temporary lookaside.fbsbx.com URL
 *   2. GET that URL WITH the access token in an Authorization header
 *
 * That URL expires in ~5 minutes and 401s without the header, so it can never
 * be handed to a <video src>. Proxying also keeps the access token server-side,
 * which is the same rule the rest of the inbox follows for page tokens.
 *
 * Range requests are forwarded so video scrubbing works - without that the
 * browser must download the whole file before it can seek.
 */

export const dynamic = 'force-dynamic'

const GRAPH = 'https://graph.facebook.com/v21.0'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
  }

  // Media ids are numeric; reject anything else rather than passing user input
  // straight into a Graph URL.
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ success: false, error: 'Invalid media id' }, { status: 400 })
  }

  const token = whatsappToken()
  if (!token) {
    return NextResponse.json({ success: false, error: 'WhatsApp is not configured' }, { status: 400 })
  }

  try {
    // Step 1: resolve the temporary download URL.
    const lookupRes = await fetch(`${GRAPH}/${id}?access_token=${encodeURIComponent(token)}`)
    const lookup = (await lookupRes.json().catch(() => ({}))) as {
      url?: string
      mime_type?: string
      error?: { message?: string }
    }
    if (!lookupRes.ok || !lookup.url) {
      const message = lookup.error?.message ?? 'Media not found'
      console.log('[v0] whatsapp media lookup failed', id, message)
      // Meta deletes media after 30 days, which is a normal outcome rather
      // than a fault, so this is reported as "gone" not "broken".
      return NextResponse.json({ success: false, error: message }, { status: 404 })
    }

    // Step 2: fetch the bytes. The token MUST travel as a header here.
    const range = request.headers.get('range')
    const upstream = await fetch(lookup.url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(range ? { Range: range } : {}),
      },
    })
    if (!upstream.ok || !upstream.body) {
      console.log('[v0] whatsapp media fetch failed', id, upstream.status)
      return NextResponse.json({ success: false, error: 'Could not download media' }, { status: 502 })
    }

    const headers = new Headers()
    headers.set('Content-Type', upstream.headers.get('content-type') ?? lookup.mime_type ?? 'application/octet-stream')
    headers.set('Accept-Ranges', 'bytes')
    // Media is immutable once sent, so let the browser keep it. Private: it is
    // customer content behind auth and must not sit in a shared cache.
    headers.set('Cache-Control', 'private, max-age=3600')
    for (const h of ['content-length', 'content-range']) {
      const v = upstream.headers.get(h)
      if (v) headers.set(h, v)
    }

    return new NextResponse(upstream.body, { status: upstream.status, headers })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Media proxy failed'
    console.log('[v0] whatsapp media proxy error', id, message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
