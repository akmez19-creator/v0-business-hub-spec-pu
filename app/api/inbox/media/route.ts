import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAdPostLink } from '@/lib/inbox/ad-post-link'
import { listProductMedia, stageProductMedia, stageUpload } from '@/lib/inbox/outbound-media'

/**
 * Media the agent can attach to a reply.
 *
 * GET  ?productId=  -> the product's stored photos and clips
 * GET  ?adId=       -> the ad's post link (Facebook CDN video links expire and
 *                      Meta refuses re-hosting its own media, so the post is
 *                      shared as a link, never as a file)
 * POST multipart    -> stage an upload from the agent's device
 * POST json         -> stage one of the product's photos/clips for sending
 */

export const dynamic = 'force-dynamic'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function GET(request: Request) {
  if (!(await requireUser())) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
  const params = new URL(request.url).searchParams
  try {
    const productId = params.get('productId')
    if (productId) {
      const media = await listProductMedia(productId)
      return NextResponse.json({ success: true, ...media })
    }
    const adId = params.get('adId')
    if (adId) {
      const post = await getAdPostLink(adId)
      return NextResponse.json({ success: true, post })
    }
    return NextResponse.json({ success: false, error: 'productId or adId is required' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'Could not load media' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  if (!(await requireUser())) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
  try {
    const contentType = request.headers.get('content-type') ?? ''
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData()
      const file = form.get('file')
      if (!(file instanceof File)) return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 })
      return NextResponse.json({ success: true, media: await stageUpload(file) })
    }
    const body = (await request.json()) as { productId?: string; url?: string }
    if (!body.productId || !body.url) return NextResponse.json({ success: false, error: 'productId and url are required' }, { status: 400 })
    return NextResponse.json({ success: true, media: await stageProductMedia(body.productId, body.url) })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not prepare media'
    console.log('[inbox] media staging failed:', message)
    return NextResponse.json({ success: false, error: message }, { status: 400 })
  }
}
