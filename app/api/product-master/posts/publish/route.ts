import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getManageablePages } from '@/lib/facebook/pages'

// Publish a finished Reels Studio video straight to a Facebook Page.
// GET  -> list all Pages the token can manage (name + id). Pages are
//         discovered via /me/accounts PLUS the ad accounts' promote_pages
//         edge, because Facebook hides pages not ticked during app login.
// POST -> JSON { videoUrl, description, pageId }: the browser uploads the
//         video to Supabase Storage first (request bodies through this API
//         are size-capped), then Facebook fetches it via file_url

const GRAPH = 'https://graph.facebook.com/v21.0'

export async function GET() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const token = process.env.FACEBOOK_ACCESS_TOKEN
    if (!token) return NextResponse.json({ success: false, error: 'Facebook token not configured' }, { status: 500 })

    const pages = await getManageablePages(token)
    if (pages.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No Facebook Page found for this token. It needs pages_show_list + pages_manage_posts permissions.' },
        { status: 404 },
      )
    }
    return NextResponse.json({ success: true, pages: pages.map((p) => ({ id: p.id, name: p.name })) })
  } catch (error) {
    console.error('publish page lookup error:', error)
    return NextResponse.json({ success: false, error: 'Failed to look up Facebook Pages' }, { status: 500 })
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

    // The video is uploaded to Supabase Storage by the browser (sending the
    // bytes through this API hits the request body size limit) - we only
    // receive its public URL and hand it to Facebook via file_url
    const body = (await request.json()) as { videoUrl?: string; description?: string; productName?: string; pageId?: string }
    const videoUrl = String(body.videoUrl || '')
    const description = String(body.description || '').slice(0, 6000)
    const productName = String(body.productName || '').slice(0, 200)
    const pageId = String(body.pageId || '')

    // Only accept URLs from our own Supabase Storage reels bucket
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
    if (!videoUrl || !supabaseUrl || !videoUrl.startsWith(`${supabaseUrl}/storage/v1/object/public/reels/`)) {
      return NextResponse.json({ success: false, error: 'No valid video URL provided' }, { status: 400 })
    }

    const pages = await getManageablePages(token)
    if (pages.length === 0) {
      return NextResponse.json(
        { success: false, error: 'No Facebook Page found for this token. It needs pages_show_list + pages_manage_posts permissions.' },
        { status: 404 },
      )
    }
    // Publish to the chosen page; fall back to the first if none was picked
    const page = (pageId && pages.find((p) => p.id === pageId)) || pages[0]

    // Publish to the Page feed - Facebook downloads the video from the URL
    const fd = new FormData()
    fd.append('file_url', videoUrl)
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

    // boostPostId is the object_story_id format the Campaign Creator's boost
    // flow expects (pageId_videoId) - returned so "Boost this post" can hand
    // off straight into campaign duplication without re-finding the post
    return NextResponse.json({
      success: true,
      videoId: upJson.id,
      postUrl,
      pageName: page.name,
      pageId: page.id,
      boostPostId: `${page.id}_${upJson.id}`,
    })
  } catch (error) {
    console.error('publish error:', error)
    return NextResponse.json({ success: false, error: 'Failed to publish video' }, { status: 500 })
  }
}
