/**
 * Who owns an Instagram ad post.
 *
 * Deliberately free of Graph and database imports so it can be exercised
 * directly by scripts/check-instagram-comments.ts - the rest of the channel
 * pulls in `server-only` through the product catalogue.
 */

export type AdMedia = {
  adId: string
  adName: string
  permalink?: string
  /**
   * The Instagram account that published the ad, from the creative's
   * `instagram_user_id`. Null when Meta does not say.
   */
  igUserId: string | null
}

/**
 * The ad posts published by one Instagram account.
 *
 * Every Page token can read every ad account, so the ad account a creative
 * came from says nothing about whose post it is - only the publisher does.
 * Without this filter each linked account scanned all of them and the same
 * comment arrived once per account (measured 22 Sep: 32 rows for 16 comments).
 *
 * An ad whose publisher is unknown belongs to NOBODY, never to everybody:
 * replying requires the Page that owns the account, so guessing would send
 * from a Page Meta will reject.
 */
export function ownedBy(media: Map<string, AdMedia>, igId: string): [string, AdMedia][] {
  if (!igId) return []
  return [...media.entries()].filter(([, ad]) => Boolean(ad.igUserId) && ad.igUserId === igId)
}
