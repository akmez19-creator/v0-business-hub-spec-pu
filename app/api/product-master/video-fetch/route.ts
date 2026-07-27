import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const maxDuration = 60

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

type Resolved = {
  videoUrl: string
  title: string
  cover: string | null
  source: 'tiktok' | 'facebook' | 'youtube'
  quality: 'hd' | 'sd'
}

// ---- TikTok: tikwm returns the watermark-free video (hdplay = full HD) ----
async function resolveTikTok(url: string): Promise<Resolved> {
  const res = await fetch('https://www.tikwm.com/api/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: `url=${encodeURIComponent(url)}&hd=1`,
  })
  if (!res.ok) throw new Error('TikTok resolver unreachable')
  const json = (await res.json()) as {
    code: number
    msg?: string
    data?: { hdplay?: string; play?: string; title?: string; cover?: string }
  }
  if (json.code !== 0 || !json.data) throw new Error(json.msg || 'TikTok video not found')
  const raw = json.data.hdplay || json.data.play
  if (!raw) throw new Error('No downloadable stream for this TikTok')
  const videoUrl = raw.startsWith('http') ? raw : `https://www.tikwm.com${raw}`
  return {
    videoUrl,
    title: (json.data.title || 'tiktok-video').slice(0, 120),
    cover: json.data.cover || null,
    source: 'tiktok',
    quality: json.data.hdplay ? 'hd' : 'sd',
  }
}

// ---- Facebook: the public embed player exposes hd_src/sd_src without
// login. Works for videos, reels and fb.watch links. For post permalinks
// (pageId_postId) we resolve the video id via the Graph API first. ----
async function scrapeFbEmbed(href: string): Promise<Resolved | null> {
  const embed = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(href)}&show_text=false`
  const res = await fetch(embed, { headers: { 'User-Agent': UA } })
  if (!res.ok) return null
  const html = await res.text()
  const pick = (key: string) => {
    const m = html.match(new RegExp(`"${key}":"((?:[^"\\\\]|\\\\.)*)"`))
    if (!m) return null
    try {
      return JSON.parse(`"${m[1]}"`) as string
    } catch {
      return null
    }
  }
  const hd = pick('browser_native_hd_url') || pick('playable_url_quality_hd') || pick('hd_src')
  const sd = pick('browser_native_sd_url') || pick('playable_url') || pick('sd_src')
  const videoUrl = hd || sd
  if (!videoUrl) return null
  const title = pick('video_title') || 'facebook-video'
  return { videoUrl, title: title.slice(0, 120), cover: null, source: 'facebook', quality: hd ? 'hd' : 'sd' }
}

async function resolveFacebook(url: string): Promise<Resolved> {
  // Direct attempt with the given link
  const direct = await scrapeFbEmbed(url)
  if (direct) return direct

  // fb.watch and share links redirect - follow and retry with the final URL
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' })
    if (res.url && res.url !== url) {
      const followed = await scrapeFbEmbed(res.url)
      if (followed) return followed
    }
  } catch {
    // ignore, try Graph fallback below
  }

  // Post permalink (pageId_postId) - resolve the ad creative's video id via
  // the Graph API, then embed watch?v=<video_id>
  const storyMatch = url.match(/facebook\.com\/(\d{6,}_\d{6,})/)
  const token = process.env.FACEBOOK_ACCESS_TOKEN
  if (storyMatch && token) {
    const idsToTry: string[] = []
    const storyRes = await fetch(
      `https://graph.facebook.com/v21.0/${storyMatch[1]}?fields=id&access_token=${encodeURIComponent(token)}`,
    )
    if (storyRes.ok) idsToTry.push(storyMatch[1].split('_')[1])
    for (const vid of idsToTry) {
      const viaId = await scrapeFbEmbed(`https://www.facebook.com/watch/?v=${vid}`)
      if (viaId) return viaId
    }
  }

  throw new Error(
    'Could not extract this Facebook video. Make sure the video is public (ad/page videos work best).',
  )
}

// ---- YouTube: blocked for datacenter IPs by YouTube itself; best-effort
// via ytdl-core, with an honest error when YouTube refuses. ----
async function resolveYouTube(url: string): Promise<Resolved> {
  try {
    const ytdl = (await import('@distube/ytdl-core')).default
    const info = await ytdl.getInfo(url)
    const format = ytdl.chooseFormat(info.formats, {
      quality: 'highest',
      filter: (f) => Boolean(f.hasVideo && f.hasAudio),
    })
    if (!format?.url) throw new Error('no format')
    return {
      videoUrl: format.url,
      title: (info.videoDetails.title || 'youtube-video').slice(0, 120),
      cover: info.videoDetails.thumbnails?.at(-1)?.url || null,
      source: 'youtube',
      quality: (format.qualityLabel || '').includes('720') || (format.qualityLabel || '').includes('1080') ? 'hd' : 'sd',
    }
  } catch {
    throw new Error(
      'YouTube blocks server downloads right now. Download it with your usual site and upload the file here - TikTok and Facebook links work directly.',
    )
  }
}

// POST { url } -> resolve platform and return direct stream metadata
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await request.json()
    const url = String(body?.url || '').trim()
    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json({ success: false, error: 'Paste a valid video link' }, { status: 400 })
    }

    let resolved: Resolved
    if (/tiktok\.com|vt\.tiktok/i.test(url)) resolved = await resolveTikTok(url)
    else if (/facebook\.com|fb\.watch|fb\.me/i.test(url)) resolved = await resolveFacebook(url)
    else if (/youtube\.com|youtu\.be/i.test(url)) resolved = await resolveYouTube(url)
    else {
      return NextResponse.json(
        { success: false, error: 'Unsupported link. Use TikTok, Facebook or YouTube.' },
        { status: 400 },
      )
    }

    return NextResponse.json({ success: true, ...resolved })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Could not fetch this video'
    console.error('video-fetch POST error:', msg)
    return NextResponse.json({ success: false, error: msg }, { status: 502 })
  }
}

// GET ?src=<resolved cdn url>&filename=x.mp4 -> proxy-stream the file so the
// browser can save it despite CDN CORS. Host-allowlisted to prevent abuse.
const ALLOWED_HOSTS =
  /(\.fbcdn\.net|\.tiktokcdn[^/]*\.com|tikwm\.com|\.googlevideo\.com|\.akamaized\.net)$/i

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const src = searchParams.get('src') || ''
    const filename = (searchParams.get('filename') || 'video.mp4').replace(/[^\w.\- ]+/g, '_').slice(0, 100)

    let host: string
    try {
      host = new URL(src).hostname
    } catch {
      return NextResponse.json({ success: false, error: 'Bad src' }, { status: 400 })
    }
    if (!ALLOWED_HOSTS.test(host)) {
      return NextResponse.json({ success: false, error: 'Host not allowed' }, { status: 403 })
    }

    const upstream = await fetch(src, { headers: { 'User-Agent': UA } })
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ success: false, error: `Upstream error ${upstream.status}` }, { status: 502 })
    }

    const headers = new Headers({
      'Content-Type': upstream.headers.get('content-type') || 'video/mp4',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    })
    const len = upstream.headers.get('content-length')
    if (len) headers.set('Content-Length', len)

    return new Response(upstream.body, { headers })
  } catch (error) {
    console.error('video-fetch GET error:', error)
    return NextResponse.json({ success: false, error: 'Proxy failed' }, { status: 500 })
  }
}
