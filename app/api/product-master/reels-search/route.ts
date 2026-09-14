import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchMetaReels } from '@/lib/product-master/meta-reels'

export const maxDuration = 60

/**
 * Meta (Instagram/Facebook) Reels search.
 *
 * Deliberately a SEPARATE, opt-in endpoint rather than part of the photo
 * search fan-out. Meta allows only ~30 unique hashtags per IG account per
 * rolling 7 days, so running it automatically on every product would exhaust
 * the weekly budget after a handful of searches and then silently return
 * nothing. The Studio calls this only when the user asks for it.
 *
 * It reuses the names/keywords the photo pass already derived, so no second
 * vision call is made.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await request.json()
    const names = (Array.isArray(body?.names) ? body.names : []).map((n: unknown) => String(n)).filter(Boolean)
    const keywords = (Array.isArray(body?.keywords) ? body.keywords : []).map((k: unknown) => String(k)).filter(Boolean)

    if (names.length === 0 && keywords.length === 0) {
      return NextResponse.json({ success: false, error: 'Run a photo search first' }, { status: 400 })
    }

    const { hits, tags, error, examined } = await searchMetaReels(names.slice(0, 8), keywords.slice(0, 12))

    const results = hits.map((h) => ({
      id: `ig-${h.id}`,
      // Captions are the only title Instagram gives us, and they run long
      title: (h.caption.split('\n')[0] || 'Instagram Reel').slice(0, 120),
      // Hashtag media exposes no thumbnail_url (owned media only), so there is
      // no cover to show - the client previews the mp4 itself instead.
      cover: null,
      play: h.mediaUrl,
      duration: 0,
      author: `#${h.tag}`,
      authorId: '',
      pageUrl: h.permalink,
      plays: 0,
      likes: h.likes,
      platform: 'instagram' as const,
      // An mp4 is a one-shot url: it cannot be re-resolved later, because
      // hashtag media is not owned by us and reading it by id is refused.
      // Reels without one can only be watched on Instagram.
      downloadable: Boolean(h.mediaUrl),
    }))

    return NextResponse.json({ success: true, results, tags, examined, error })
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Reels search failed' },
      { status: 500 },
    )
  }
}
