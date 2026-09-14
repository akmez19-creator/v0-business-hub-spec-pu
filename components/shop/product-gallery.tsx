'use client'

import { useState } from 'react'
import { Play } from 'lucide-react'
import { shopMedia } from '@/lib/shop/media'

type Slide = { kind: 'video'; url: string; poster?: string | null } | { kind: 'image'; url: string }

export function ProductGallery({ name, images, videos }: { name: string; images: string[]; videos: string[] }) {
  // Video first: it shows the product in use, which a catalog photo can't.
  const slides: Slide[] = [
    ...videos.map((url) => ({ kind: 'video' as const, url, poster: images[0] ?? null })),
    ...images.map((url) => ({ kind: 'image' as const, url })),
  ]
  const [active, setActive] = useState(0)
  const current = slides[active]

  if (!current) {
    return <div className="aspect-square w-full rounded-[2rem] bg-muted" aria-hidden="true" />
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-square w-full overflow-hidden rounded-[2rem] border border-border bg-muted">
        {current.kind === 'video' ? (
          <video
            key={current.url}
            // Proxied: supplier CDNs reject browser requests by Referer.
            src={shopMedia(current.url)}
            poster={current.poster ? shopMedia(current.poster) : undefined}
            controls
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
          />
        ) : (
          // Plain <img>: next/image would route through the optimiser, which
          // cannot reach these hosts and would 400 on every supplier photo.
          <img
            key={current.url}
            src={shopMedia(current.url) || '/placeholder.svg'}
            alt={name}
            className="h-full w-full object-cover"
          />
        )}
      </div>

      {slides.length > 1 && (
        <div className="shop-rail flex gap-2.5 overflow-x-auto pb-1">
          {slides.map((s, i) => (
            <button
              key={`${s.kind}-${s.url}`}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`View ${s.kind} ${i + 1} of ${slides.length}`}
              aria-current={i === active}
              className={`relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl border-2 transition ${
                i === active ? 'border-primary' : 'border-transparent opacity-65 hover:opacity-100'
              }`}
            >
              <img
                src={
                  shopMedia(s.kind === 'video' ? (s.poster ?? '') : s.url) ||
                  '/placeholder.svg?height=80&width=80'
                }
                alt=""
                className="h-full w-full bg-muted object-cover"
              />
              {s.kind === 'video' && (
                <span className="absolute inset-0 grid place-items-center bg-[var(--shop-ink)]/45">
                  <Play className="h-5 w-5 fill-white text-white" />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
