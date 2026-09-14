'use client'

import { useState } from 'react'

/** Private WhatsApp URLs already point to our authenticated media proxy. */
export function LeadAttachment({ type, url }: { type: string; url: string | null }) {
  const [failed, setFailed] = useState(false)
  const safe = Boolean(url && (/^https?:\/\//i.test(url) || /^\/api\/inbox\//.test(url)))
  if (!safe || failed) return <p className="text-xs opacity-70">Attachment unavailable ({type || 'file'}).</p>
  const src = url!
  const kind = type.toLowerCase()
  if (kind === 'image' || kind.startsWith('image/')) return (
    <a href={src} target="_blank" rel="noopener noreferrer" aria-label="Open image attachment">
      {/* Authenticated content must not go through the public image optimizer. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} loading="lazy" alt="Message attachment" onError={() => setFailed(true)} className="max-h-64 max-w-full rounded-lg object-contain" />
    </a>
  )
  if (kind === 'video' || kind.startsWith('video/')) return <video src={src} controls preload="metadata" onError={() => setFailed(true)} className="max-h-64 max-w-full rounded-lg" />
  if (kind === 'audio' || kind === 'voice' || kind.startsWith('audio/')) return <audio src={src} controls preload="none" onError={() => setFailed(true)} className="max-w-full" />
  return <a href={src} target="_blank" rel="noopener noreferrer" className="break-all text-xs underline underline-offset-2">Open attachment ({type || 'file'})</a>
}
