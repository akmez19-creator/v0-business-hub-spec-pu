import 'server-only'
import { createAdminClient } from '@/lib/supabase/server'
import { productFromAdName } from '@/lib/facebook/ad-product-name'
import { getProductMatcher } from '@/lib/products/catalogue'

const GRAPH = 'https://graph.facebook.com/v23.0'

export type MessengerAdRef = {
  adId: string | null
  adName: string | null
  ref: string | null
  source: string | null
  adType: string | null
  firstSeen: string
}

/**
 * Resolve an ad id to its real ad name.
 *
 * Deliberately shares the `whatsapp_ad_names` cache with the WhatsApp channel:
 * an ad id means the same thing on both, and the same campaign frequently runs
 * click-to-Messenger and click-to-WhatsApp variants. Sharing means the second
 * channel to see an ad pays no Graph call at all.
 */
async function resolveAdName(adId: string): Promise<string | null> {
  const db = createAdminClient()
  const { data: hit } = await db
    .from('whatsapp_ad_names')
    .select('ad_name')
    .eq('ad_id', adId)
    .maybeSingle()
  if (hit) return (hit.ad_name as string | null) ?? null

  const token = process.env.FACEBOOK_ACCESS_TOKEN
  if (!token) return null
  try {
    const res = await fetch(`${GRAPH}/${adId}?fields=name,campaign{name},adset{name}&access_token=${token}`)
    const j = (await res.json()) as {
      name?: string
      campaign?: { name?: string }
      adset?: { name?: string }
      error?: unknown
    }
    if (!res.ok || j.error || !j.name) return null
    await db.from('whatsapp_ad_names').upsert(
      {
        ad_id: adId,
        ad_name: j.name,
        campaign_name: j.campaign?.name ?? null,
        adset_name: j.adset?.name ?? null,
      },
      { onConflict: 'ad_id' },
    )
    return j.name
  } catch {
    // Attribution is a nice-to-have; never let it throw into the webhook.
    return null
  }
}

/**
 * Record the ad a Messenger conversation started from.
 *
 * Only the FIRST referral per (page, sender) is kept - `ignoreDuplicates` -
 * because someone who clicks three ads over a month should still be
 * attributed to the ad that originally found them, matching how the
 * WhatsApp side stores `first_ad_id`.
 */
export async function recordAdRef(input: {
  pageId: string
  senderId: string
  adId?: string | null
  ref?: string | null
  source?: string | null
  adType?: string | null
}): Promise<void> {
  const { pageId, senderId, adId } = input
  if (!pageId || !senderId) return
  // A referral with neither an ad id nor a ref carries no attribution.
  if (!adId && !input.ref) return

  const db = createAdminClient()
  const adName = adId ? await resolveAdName(adId) : null

  await db.from('messenger_ad_refs').upsert(
    {
      page_id: pageId,
      sender_id: senderId,
      ad_id: adId ?? null,
      ad_name: adName,
      ref: input.ref ?? null,
      source: input.source ?? null,
      ad_type: input.adType ?? null,
    },
    { onConflict: 'page_id,sender_id', ignoreDuplicates: true },
  )

  // Stamp an already-existing thread immediately. Without this, a referral
  // that lands after the person's last message would sit in this table unused
  // until they happened to write again - the attribution is captured but the
  // inbox keeps showing no product.
  if (!adName) return
  const product = productFromAdName(adName)
  const match = product ? (await getProductMatcher())(product) : null
  await db
    .from('messenger_conversations')
    .update({
      ad_id: adId ?? null,
      ad_name: adName,
      product,
      product_id: match?.productId ?? null,
    })
    .eq('page_id', pageId)
    .eq('psid', senderId)
    .is('ad_id', null) // never overwrite the ad that originally found them
}

/**
 * Look up attribution for a set of Messenger senders in one query, keyed by
 * sender id so the inbox route can attach it without an N+1.
 */
export async function getAdRefs(senderIds: string[]): Promise<Map<string, MessengerAdRef>> {
  const out = new Map<string, MessengerAdRef>()
  if (senderIds.length === 0) return out

  const db = createAdminClient()
  const { data } = await db
    .from('messenger_ad_refs')
    .select('sender_id,ad_id,ad_name,ref,source,ad_type,first_seen')
    .in('sender_id', senderIds)

  for (const row of data ?? []) {
    out.set(row.sender_id as string, {
      adId: (row.ad_id as string | null) ?? null,
      adName: (row.ad_name as string | null) ?? null,
      ref: (row.ref as string | null) ?? null,
      source: (row.source as string | null) ?? null,
      adType: (row.ad_type as string | null) ?? null,
      firstSeen: row.first_seen as string,
    })
  }
  return out
}
