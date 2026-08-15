/**
 * Supplier media (1688/Taobao) cannot be loaded directly by a browser.
 *
 * Alibaba's CDN checks the Referer and answers 403 to any request coming from
 * a page that is not theirs, so <img src="https://cbu01.alicdn.com/..."> shows
 * a broken icon even though the URL is valid and our own server fetches it
 * happily. The fix is to fetch it server-side instead.
 *
 * The authenticated proxy at /api/product-master/video-fetch already does this
 * (it allowlists the alicdn/taobao hosts and forwards Range for video), so this
 * helper reuses it rather than adding a second proxy with its own allowlist.
 */

/**
 * Hosts that refuse to serve media to a browser on someone else's page. Every
 * entry here must also be allowlisted by the proxy route, or we would rewrite
 * a working URL into a 403.
 */
const HOTLINK_PROTECTED = [
  'alicdn.com',
  'aliexpress-media.com',
  'taobaocdn.com',
  'video.taobao.com',
  'tbcdn.cn',
  'byteimg.com',
  'slatic.net',
  'lazcdn.com',
  'susercontent.com',
  'shopeemobile.com',
  'dhresource.com',
  'media-amazon.com',
  'ssl-images-amazon.com',
]

export function isHotlinkProtected(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    // Subdomains only, deliberately: the proxy's allowlist is anchored on a
    // leading dot, so rewriting a bare apex host would swap a CDN 403 for a
    // proxy 403 and gain nothing. These CDNs only ever serve from subdomains.
    return HOTLINK_PROTECTED.some(d => host.endsWith(`.${d}`))
  } catch {
    return false
  }
}

/**
 * Turn a stored media URL into one the browser can actually load.
 *
 * Only hotlink-protected supplier CDNs are routed through the proxy. Media we
 * host ourselves (Supabase storage, Vercel Blob) is returned untouched - it
 * loads fine directly, and proxying it would in fact break it, since those
 * hosts are deliberately not on the proxy's allowlist.
 */
export function mediaSrc(url: string | null | undefined): string {
  if (!url) return ''
  // Relative paths, data: and blob: URLs are already loadable as-is.
  if (!/^https?:\/\//i.test(url)) return url
  if (!isHotlinkProtected(url)) return url
  return `/api/product-master/video-fetch?inline=1&src=${encodeURIComponent(url)}`
}
