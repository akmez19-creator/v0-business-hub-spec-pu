import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getManageablePages } from '@/lib/facebook/pages'

const GRAPH = 'https://graph.facebook.com/v21.0'

/**
 * Did the organic "Send message" button actually land on a published reel?
 *
 * Separate from the publish route on purpose. The wrapping post is unreadable
 * (Graph error #10) until Facebook finishes processing the video - measured at
 * roughly 30 seconds - so verifying inline would either stall publishing or
 * always come back unconfirmed. The client polls this instead, and the success
 * screen upgrades its wording once the button is genuinely confirmed.
 *
 * Returns `attached: null` for "not readable yet, keep asking", distinct from
 * `false` which means the post exists and carries no CTA.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not signed in' }, { status: 401 })

    const url = new URL(request.url)
    const videoId = String(url.searchParams.get('videoId') || '')
    const pageId = String(url.searchParams.get('pageId') || '')
    if (!videoId || !pageId) {
      return NextResponse.json({ success: false, error: 'videoId and pageId are required' }, { status: 400 })
    }

    const token = process.env.FACEBOOK_ACCESS_TOKEN
    if (!token) return NextResponse.json({ success: false, error: 'Facebook is not connected' }, { status: 400 })

    // Use the page token, and only for a page this user can actually manage
    const pages = await getManageablePages(token)
    const page = pages.find((p) => p.id === pageId)
    if (!page) return NextResponse.json({ success: false, error: 'Unknown Page' }, { status: 404 })

    const meta = (await (
      await fetch(`${GRAPH}/${videoId}?fields=post_id&access_token=${page.access_token}`)
    ).json()) as { post_id?: string; error?: unknown }
    if (!meta.post_id) return NextResponse.json({ success: true, attached: null })

    // The CTA lives on the wrapping POST ({page}_{post_id}), never on the video
    // node - `call_to_action` is a nonexisting field there.
    const post = (await (
      await fetch(`${GRAPH}/${pageId}_${meta.post_id}?fields=call_to_action&access_token=${page.access_token}`)
    ).json()) as {
      call_to_action?: { type?: string; value?: { link?: string } }
      error?: { code?: number }
    }

    // Error 10 = still processing. Unknown, not absent.
    if (post.error) return NextResponse.json({ success: true, attached: null })

    // Require the m.me LINK, not merely `type`. Measured on this Page: reels
    // published before this feature existed already read back
    // {"type":"MESSAGE_PAGE","value":{}} - an empty-value Page-level default
    // that Facebook applies at publish time. Testing `type` alone therefore
    // reports "confirmed" for a button we never attached, which is exactly the
    // false positive this endpoint exists to rule out. Our own param always
    // comes back with value.link set (clean A/B: link present with the param,
    // the whole field absent without it).
    const cta = post.call_to_action
    const attached = Boolean(cta?.type === 'MESSAGE_PAGE' && cta?.value?.link)
    return NextResponse.json({
      success: true,
      attached,
      // Distinguishes "no button at all" from "only the Page-level default"
      pageDefaultOnly: Boolean(cta?.type && !cta?.value?.link),
    })
  } catch (e) {
    console.error('cta-status failed:', e)
    return NextResponse.json({ success: false, error: 'Could not check the post' }, { status: 500 })
  }
}
