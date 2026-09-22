import 'server-only'
import { createHash } from 'node:crypto'
import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createAdminClient } from '@/lib/supabase/server'
import { getInboxPage } from '@/lib/facebook/messages'
import { withStandbyModel } from '@/lib/ai/standby'
import { attachmentKind } from '@/lib/inbox/attachment-kinds'

/**
 * Lets the AI actually look at what a Messenger customer sent, instead of
 * pausing the draft on every attachment.
 *
 * - photo   -> gpt-4.1 vision (own key, then the same model via AI Gateway)
 * - video   -> Gemini 2.5 Flash, which samples the clip at ~1 frame/second, so
 *              it "watches" the 2-3 key moments an agent would screenshot
 * - reel / post / link share -> the caption Meta delivers with the share
 *              (a customer forwarding OUR reel is naming that reel's product)
 * - sticker -> noted as a sticker, nothing to read
 * - audio / file / anything else -> unreadable, stays with the agent
 *
 * Notes are cached per attachment URL so a redraft never pays twice. CDN links
 * expire (videos within days), so a stale URL is refreshed from Graph with the
 * message id and the page token before giving up.
 */

export type TurnAttachment = { type: string; url: string | null; title?: string | null }

export type AttachmentTurn = {
  from?: string
  text?: string
  /** Messenger message id, needed to refresh an expired CDN link. */
  id?: string
  attachments?: TurnAttachment[]
}

export type AttachmentReadResult = {
  /** Turns with a bracketed note appended for every attachment that was read. */
  turns: AttachmentTurn[]
  /** Attachments in the LATEST customer message the AI could not read (fetch or model failed). */
  latestUnread: number
  /** Attachments of kinds nobody can read (voice notes, files) in the latest customer message. */
  latestUnreadable: number
  /** How many attachments were read by a model this call (for logging/cost). */
  modelReads: number
}

const MAX_IMAGES = 3
const MAX_VIDEOS = 1
const MAX_VIDEO_BYTES = 20 * 1024 * 1024
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const CACHE_TABLE = 'inbox_attachment_notes'

const IMAGE_PROMPT =
  'You are helping a shop agent in Mauritius read a photo a customer sent on Messenger. In at most 45 words, plain text, say: what product or item is shown; any visible text, price, brand or page name; whether it is a screenshot of a social-media ad or product listing, a photo of an item the customer owns (possibly damaged), a payment proof, or something else. Do not greet, do not speculate beyond what is visible.'

const VIDEO_PROMPT =
  'You are helping a shop agent in Mauritius understand a video a customer sent on Messenger. Look at two or three key moments. In at most 60 words, plain text, say: what product or item is shown or demonstrated; any visible text, price, brand or page name; whether it looks like an advertisement/reel or a personal recording (for example showing a fault). Do not greet, do not speculate beyond what is visible.'

const urlKey = (url: string) => createHash('sha256').update(url.split('?')[0]).digest('hex')

const isCustomer = (t: AttachmentTurn) => !(t.from === 'business' || t.from === 'agent' || t.from === 'out')

const kindOf = attachmentKind

async function cachedNotes(keys: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!keys.length) return out
  const db = createAdminClient()
  const { data } = await db.from(CACHE_TABLE).select('url_key, note').in('url_key', keys)
  for (const row of (data ?? []) as { url_key: string; note: string }[]) out.set(row.url_key, row.note)
  return out
}

async function storeNote(key: string, mid: string | null, kind: string, note: string): Promise<void> {
  const db = createAdminClient()
  await db.from(CACHE_TABLE).upsert({ url_key: key, mid, kind, note }, { onConflict: 'url_key' })
}

async function fetchBytes(url: string, maxBytes: number): Promise<{ bytes: Buffer; mediaType: string } | null> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) return null
  const mediaType = (res.headers.get('content-type') || '').split(';')[0].trim()
  if (!/^(image|video)\//.test(mediaType)) return null
  const length = Number(res.headers.get('content-length') || 0)
  if (length > maxBytes) return null
  const bytes = Buffer.from(await res.arrayBuffer())
  if (bytes.length > maxBytes) return null
  return { bytes, mediaType }
}

/** Meta re-issues CDN links when the message is read back through Graph with the page token. */
async function refreshUrls(pageId: string, mid: string): Promise<string[]> {
  const page = await getInboxPage(pageId)
  if (!page) return []
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${encodeURIComponent(mid)}?fields=attachments&access_token=${encodeURIComponent(page.access_token)}`,
    { signal: AbortSignal.timeout(10_000) },
  )
  if (!res.ok) return []
  const json = (await res.json()) as { attachments?: { data?: Array<{ video_data?: { url?: string }; image_data?: { url?: string }; file_url?: string }> } }
  return (json.attachments?.data ?? [])
    .map((a) => a.video_data?.url || a.image_data?.url || a.file_url || null)
    .filter((u): u is string => Boolean(u))
}

async function describeImage(bytes: Buffer): Promise<string> {
  const { value } = await withStandbyModel(
    (model) =>
      generateText({
        model,
        maxRetries: 0,
        maxOutputTokens: 120,
        abortSignal: AbortSignal.timeout(25_000),
        messages: [{ role: 'user', content: [{ type: 'text', text: IMAGE_PROMPT }, { type: 'image', image: bytes }] }],
      }),
    { allow: ['openai', 'gateway'] },
  )
  return value.text.trim()
}

async function describeVideo(bytes: Buffer, mediaType: string): Promise<string> {
  const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_AI_API_KEY })
  const { text } = await generateText({
    model: google('gemini-2.5-flash'),
    maxRetries: 0,
    maxOutputTokens: 160,
    abortSignal: AbortSignal.timeout(45_000),
    messages: [{ role: 'user', content: [{ type: 'text', text: VIDEO_PROMPT }, { type: 'file', data: bytes, mediaType: mediaType || 'video/mp4' }] }],
  })
  return text.trim()
}

/**
 * Reads the attachments in the most recent customer messages and appends what
 * was seen to each turn's text, so the draft model works from real content.
 * Budget: the last 3 photos and 1 video across the thread; older ones are
 * noted as unseen.
 */
export async function readCustomerAttachments(pageId: string | null, turns: AttachmentTurn[]): Promise<AttachmentReadResult> {
  const out: AttachmentTurn[] = turns.map((t) => ({ ...t }))
  const result: AttachmentReadResult = { turns: out, latestUnread: 0, latestUnreadable: 0, modelReads: 0 }

  const withMedia = out
    .map((t, index) => ({ t, index }))
    .filter(({ t }) => isCustomer(t) && Array.isArray(t.attachments) && t.attachments.length > 0)
  if (!withMedia.length) return result
  const latestIndex = withMedia[withMedia.length - 1].index

  let imagesLeft = MAX_IMAGES
  let videosLeft = MAX_VIDEOS
  const jobs: Array<{ turn: AttachmentTurn; index: number; att: TurnAttachment; kind: ReturnType<typeof kindOf>; key: string | null }> = []
  // Newest first so the budget goes to what the customer just sent.
  for (const { t, index } of [...withMedia].reverse()) {
    for (const att of t.attachments!) {
      const kind = kindOf(att.type)
      const key = att.url ? urlKey(att.url) : null
      jobs.push({ turn: t, index, att, kind, key })
    }
  }

  const cache = await cachedNotes(jobs.map((j) => j.key).filter((k): k is string => Boolean(k)))
  const notesByTurn = new Map<number, string[]>()
  const push = (index: number, note: string) => notesByTurn.set(index, [...(notesByTurn.get(index) ?? []), note])

  for (const job of jobs) {
    const isLatest = job.index === latestIndex
    const title = typeof job.att.title === 'string' ? job.att.title.replace(/\s+/g, ' ').trim().slice(0, 400) : ''
    if (job.kind === 'share') {
      push(job.index, title ? `[shared a ${job.att.type} - its caption reads: "${title}"]` : `[shared a ${job.att.type} with no caption]`)
      continue
    }
    if (job.kind === 'sticker') {
      push(job.index, '[sent a sticker]')
      continue
    }
    if (job.kind === 'unreadable') {
      push(job.index, `[sent a ${job.att.type || 'file'} the AI cannot read]`)
      if (isLatest) result.latestUnreadable++
      continue
    }

    const label = job.kind === 'image' ? 'photo' : 'video'
    const cached = job.key ? cache.get(job.key) : undefined
    if (cached) {
      push(job.index, `[${label} - what it shows: ${cached}]`)
      continue
    }
    const budgetLeft = job.kind === 'image' ? imagesLeft > 0 : videosLeft > 0
    if (!budgetLeft || !job.att.url) {
      push(job.index, `[${label} not reviewed by the AI]`)
      continue
    }

    try {
      const max = job.kind === 'image' ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES
      let media = await fetchBytes(job.att.url, max)
      if (!media && pageId && job.turn.id) {
        for (const fresh of await refreshUrls(pageId, job.turn.id)) {
          media = await fetchBytes(fresh, max)
          if (media) break
        }
      }
      if (!media) throw new Error('media unavailable or too large')
      const note = job.kind === 'image' ? await describeImage(media.bytes) : await describeVideo(media.bytes, media.mediaType)
      if (!note) throw new Error('empty description')
      if (job.kind === 'image') imagesLeft--
      else videosLeft--
      result.modelReads++
      push(job.index, `[${label} - what it shows: ${note}]`)
      if (job.key) storeNote(job.key, job.turn.id ?? null, job.kind, note).catch(() => undefined)
    } catch (error) {
      console.warn('[attachment-reader] could not read attachment', { kind: job.kind, mid: job.turn.id, error: error instanceof Error ? error.message : String(error) })
      push(job.index, `[${label} the AI could not open]`)
      if (isLatest) result.latestUnread++
    }
  }

  for (const [index, notes] of notesByTurn) {
    const base = (out[index].text ?? '').trim()
    // Notes were collected newest-attachment-first within a turn; restore sending order.
    out[index].text = [base, ...notes.reverse()].filter(Boolean).join('\n')
  }
  return result
}
