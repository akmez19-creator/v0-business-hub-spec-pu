import { isHotlinkProtected } from '@/lib/media-url'

/**
 * Storefront twin of mediaSrc().
 *
 * Same rule - only hotlink-protected supplier CDNs get proxied, media we host
 * ourselves (Supabase storage, Vercel Blob) is returned untouched because
 * proxying it would actually BREAK it: those hosts are deliberately not on the
 * proxy's allowlist.
 *
 * The only difference is the destination: mediaSrc() points at the
 * authenticated /api/product-master/video-fetch, which 401s for a customer who
 * is not signed in. Everything public must come through here instead.
 */
export function shopMedia(url: string | null | undefined): string {
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) return url
  if (!isHotlinkProtected(url)) return url
  return `/api/shop/media?src=${encodeURIComponent(url)}`
}
