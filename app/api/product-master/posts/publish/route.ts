import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getManageablePages } from '@/lib/facebook/pages'
import { rankPagesByUse } from '@/lib/facebook/page-usage'

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
    // Most-used Page first. Every consumer of this list defaults to pages[0],
    // and alphabetical order made that "Alf Trading Ltd" (6 posts ever) rather
    // than "Made By Moris" (1132). `posts` travels with each Page so the UI can
    // show WHY the order is what it is - an unexplained non-alphabetical list
    // reads as randomly sorted.
    const ranked = await rankPagesByUse(pages)
    return NextResponse.json({
      success: true,
      pages: ranked.map((p) => ({ id: p.id, name: p.name, posts: p.posts })),
    })
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
    const body = (await request.json()) as {
      videoUrl?: string
      description?: string
      productName?: string
      pageId?: string
      messengerCta?: boolean
    }
    const videoUrl = String(body.videoUrl || '')
    const description = String(body.description || '').slice(0, 6000)
    const productName = String(body.productName || '').slice(0, 200)
    const pageId = String(body.pageId || '')
    // Defaults ON: every caption already says "Order now via inbox", so the
    // button is what that sentence is asking for. Explicit `false` opts out.
    const messengerCta = body.messengerCta !== false

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
    // Publish to the chosen page. The fallback matters: an alphabetical
    // pages[0] would put an unattended post on a Page with 6 posts in its
    // entire history, so fall back to the Page we actually post to most.
    const asked = pageId ? pages.find((p) => p.id === pageId) : undefined
    const page = asked ?? (await rankPagesByUse(pages))[0]

    // Publish to the Page feed - Facebook downloads the video from the URL.
    // Uses the PAGE token (separate rate limit from the app token) and
    // retries with backoff on throttling so posting survives quota pressure.
    const RATE_LIMIT_CODES = new Set([4, 17, 32, 613])
    const waits = [3000, 12000, 40000]
    let upJson: { id?: string; error?: { message?: string; code?: number } } = {}
    for (let attempt = 0; ; attempt++) {
      const fd = new FormData()
      fd.append('file_url', videoUrl)
      fd.append('description', description)
      // The organic "Send message" button. Verified against the live Graph API
      // with an A/B control: with this param the wrapping post reads back
      // call_to_action MESSAGE_PAGE, without it the field is absent.
      //
      // Do NOT look for call_to_action on the VIDEO node to check this - it is
      // a nonexisting field there, which is what made me wrongly conclude that
      // organic Messenger buttons were impossible. It lives on the post.
      if (messengerCta) {
        fd.append(
          'call_to_action',
          JSON.stringify({ type: 'MESSAGE_PAGE', value: { link: `https://m.me/${page.id}` } }),
        )
      }
      fd.append('access_token', page.access_token)
      const upRes = await fetch(`${GRAPH}/${page.id}/videos`, { method: 'POST', body: fd })
      upJson = (await upRes.json().catch(() => ({}))) as typeof upJson
      if (upRes.ok && upJson.id) break
      const code = upJson.error?.code
      if (attempt < waits.length && code !== undefined && RATE_LIMIT_CODES.has(code)) {
        await new Promise((r) => setTimeout(r, waits[attempt]))
        continue
      }
      console.error('fb video publish failed:', upJson)
      return NextResponse.json(
        { success: false, error: upJson.error?.message || 'Facebook rejected the video upload' },
        { status: 502 },
      )
    }
    const postUrl = `https://www.facebook.com/${page.id}/videos/${upJson.id}`

    // The button is NOT verified here. Measured against the live API: the
    // wrapping post returns error #10 ("object does not exist") until Facebook
    // finishes processing the video, which took ~30s - so an inline check would
    // either block publishing for half a minute or always report "unconfirmed".
    // The client polls /posts/cta-status after the success screen appears.

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
      // Whether we ASKED for the button, not whether it is confirmed present
      messengerCtaRequested: messengerCta,
      boostPostId: `${page.id}_${upJson.id}`,
    })
  } catch (error) {
    console.error('publish error:', error)
    return NextResponse.json({ success: false, error: 'Failed to publish video' }, { status: 500 })
  }
}
