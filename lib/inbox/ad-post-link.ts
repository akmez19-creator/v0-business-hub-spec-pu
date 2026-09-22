import { createAdminClient } from '@/lib/supabase/server'
import { getManageablePages } from '@/lib/facebook/pages'

/** The public post (usually a Reel) an ad boosts, in the shape the AI prompt needs. */
export type AdPostLink = {
  adId: string
  adName: string | null
  permalinkUrl: string
  /** Post caption, trimmed to what a short product description needs. */
  message: string | null
  mediaType: string | null
}

const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000
const GRAPH = 'https://graph.facebook.com/v21.0'

/**
 * Resolve the ad a customer clicked to the post it boosts and that post's
 * permalink + caption. `page_post_ads` already maps ad -> post; the link and
 * caption are fetched once with the PAGE token (the user token gets
 * "Unsupported get request" on page posts) and cached on the same row.
 * Returns null when the ad is unknown or the post is not public.
 */
export async function getAdPostLink(adId: string | null | undefined): Promise<AdPostLink | null> {
  if (!adId) return null
  const supabase = createAdminClient()
  const { data: row } = await supabase
    .from('page_post_ads')
    .select('page_id, post_id, ad_name, permalink_url, post_message, media_type, post_fetched_at')
    .eq('ad_id', adId)
    .maybeSingle()
  if (!row?.post_id) return null

  const fresh = row.post_fetched_at && Date.now() - new Date(row.post_fetched_at).getTime() < REFRESH_AFTER_MS
  if (row.permalink_url && fresh) {
    return { adId, adName: row.ad_name, permalinkUrl: row.permalink_url, message: row.post_message, mediaType: row.media_type }
  }

  const userToken = process.env.FACEBOOK_ACCESS_TOKEN
  const pages = userToken ? await getManageablePages(userToken).catch(() => []) : []
  const token = pages.find(p => p.id === row.page_id)?.access_token
  if (!token) return row.permalink_url ? cached(adId, row) : null

  try {
    const res = await fetch(
      `${GRAPH}/${row.post_id}?fields=permalink_url,message,attachments{media_type}&access_token=${token}`,
      { cache: 'no-store' },
    )
    const json = (await res.json()) as {
      permalink_url?: string
      message?: string
      attachments?: { data?: Array<{ media_type?: string }> }
      error?: { message: string }
    }
    if (!res.ok || !json.permalink_url) return row.permalink_url ? cached(adId, row) : null

    const mediaType = json.attachments?.data?.[0]?.media_type ?? null
    const message = json.message?.trim().slice(0, 600) || null
    await supabase
      .from('page_post_ads')
      .update({ permalink_url: json.permalink_url, post_message: message, media_type: mediaType, post_fetched_at: new Date().toISOString() })
      .eq('ad_id', adId)
    return { adId, adName: row.ad_name, permalinkUrl: json.permalink_url, message, mediaType }
  } catch {
    return row.permalink_url ? cached(adId, row) : null
  }
}

function cached(adId: string, row: { ad_name: string | null; permalink_url: string | null; post_message: string | null; media_type: string | null }): AdPostLink {
  return { adId, adName: row.ad_name, permalinkUrl: row.permalink_url as string, message: row.post_message, mediaType: row.media_type }
}
