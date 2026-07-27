import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// Publish a finished Reels Studio video straight to the Facebook Page.
// GET  -> discover the target Page (name + id) via /me/accounts
// POST -> multipart upload: video + description published to {page}/videos

const GRAPH = 'https://graph.facebook.com/v21.0'

async function getPage(token: string): Promise<{ id: string; name: string; access_token: string } | null> {
  const res = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(token)}`)
  if (!res.ok) return null
  const json = (await res.json()) as { data?: { id: string; name: string; access_token: string }[] }
  return json.data?.[0] ?? null
}

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const token = process.env.FACEBOOK_ACCESS_TOKEN
    if (!token) return NextResponse.json({ success: false, error: 'Facebook token not configured' }, { status: 500 })

    const page = await getPage(token)
    if (!page) {
      return NextResponse.json(
        { success: false, error: 'No Facebook Page found for this token. It needs pages_show_list + pages_manage_posts permissions.' },
        { status: 404 },
      )
    }
    return NextResponse.json({ success: true, page: { id: page.id, name: page.name } })
  } catch (error) {
    console.error('publish page lookup error:', error)
    return NextResponse.json({ success: false, error: 'Failed to look up Facebook Page' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const token = process.env.FACEBOOK_ACCESS_TOKEN
    if (!token) return NextResponse.json({ success: false, error: 'Facebook token not configured' }, { status: 500 })

    const form = await request.formData()
    const video = form.get('video')
    const description = String(form.get('description') || '').slice(0, 6000)
    const productName = String(form.get('productName') || '').slice(0, 200)

    if (!(video instanceof Blob) || video.size === 0) {
      return NextResponse.json({ success: false, error: 'No video provided' }, { status: 400 })
    }
    // Graph API non-resumable upload limit is 1GB; our reels are far below
    if (video.size > 500 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: 'Video too large to publish (max 500MB)' }, { status: 413 })
    }

    const page = await getPage(token)
    if (!page) {
      return NextResponse.json(
        { success: false, error: 'No Facebook Page found for this token. It needs pages_show_list + pages_manage_posts permissions.' },
        { status: 404 },
      )
    }

    // Upload the video to the Page feed with the caption
    const fd = new FormData()
    fd.append('source', video, 'reel.mp4')
    fd.append('description', description)
    fd.append('access_token', page.access_token)
    const upRes = await fetch(`${GRAPH}/${page.id}/videos`, { method: 'POST', body: fd })
    const upJson = (await upRes.json()) as { id?: string; error?: { message?: string } }
    if (!upRes.ok || !upJson.id) {
      console.error('fb video publish failed:', upJson)
      return NextResponse.json(
        { success: false, error: upJson.error?.message || 'Facebook rejected the video upload' },
        { status: 502 },
      )
    }
    const postUrl = `https://www.facebook.com/${page.id}/videos/${upJson.id}`

    // Record the published post in product_posts so it shows in Manage Posts
    // and feeds the AI knowledge centre for this product
    const admin = createAdminClient()
    let productId: string | null = null
    if (productName) {
      const { data: match } = await admin.from('products').select('id').ilike('name', productName).limit(1).maybeSingle()
      productId = match?.id ?? null
    }
    const lines = description.split('\n').filter((l) => l.trim())
    await admin.from('product_posts').insert({
      product_id: productId,
      product_name: productName || 'Reels Studio video',
      post_type: 'fb_video_published',
      tone: 'published',
      language: 'en',
      content: {
        hook: (lines[0] ?? '').slice(0, 500),
        body: lines.slice(1).join('\n').slice(0, 4000),
        cta: '',
        hashtags: '',
        raw: description,
        postUrl,
        videoId: upJson.id,
        pageName: page.name,
      },
      offers_used: [],
      created_by: user.id,
    })

    return NextResponse.json({ success: true, videoId: upJson.id, postUrl, pageName: page.name })
  } catch (error) {
    console.error('publish error:', error)
    return NextResponse.json({ success: false, error: 'Failed to publish video' }, { status: 500 })
  }
}
