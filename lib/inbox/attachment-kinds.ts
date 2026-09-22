/**
 * Which Messenger attachment types the AI can read on its own. Shared by the
 * client (decides whether to pause the draft) and the server reader (decides
 * how to read each one), so the two can never disagree.
 */
export type AttachmentKind = 'image' | 'video' | 'share' | 'sticker' | 'unreadable'

const SHARE_TYPES = new Set(['reel', 'fallback', 'post', 'share', 'template'])

export function attachmentKind(type: string | null | undefined): AttachmentKind {
  const t = (type || '').toLowerCase()
  if (t === 'image' || t.startsWith('image/')) return 'image'
  if (t === 'video' || t.startsWith('video/')) return 'video'
  if (t === 'sticker') return 'sticker'
  if (SHARE_TYPES.has(t)) return 'share'
  return 'unreadable'
}

/** Photos, videos, shared reels/posts and stickers; voice notes and files are not. */
export function isReadableAttachmentType(type: string | null | undefined): boolean {
  return attachmentKind(type) !== 'unreadable'
}
