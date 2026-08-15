'use client'

import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { mediaSrc } from '@/lib/media-url'

/**
 * A product photo that actually shows up.
 *
 * Two things it handles that a bare <img> does not:
 *  - supplier CDNs (1688/Taobao) 403 browser requests, so those URLs are routed
 *    through the authenticated proxy and fetched server-side instead;
 *  - when a photo genuinely cannot load, it falls back to a muted icon rather
 *    than the browser's broken-image glyph, which reads as "the app is broken"
 *    when the real meaning is "no photo yet".
 */
export function ProductThumb({
  src,
  alt = '',
  className,
  iconClassName,
}: {
  src: string | null | undefined
  alt?: string
  className?: string
  iconClassName?: string
}) {
  // Remember WHICH url failed, not merely that one did: rows get recycled as
  // the table re-sorts or paginates, and a plain boolean would leave a later
  // product stuck showing the previous row's fallback.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const resolved = mediaSrc(src)

  if (!resolved || failedSrc === resolved) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded bg-muted text-muted-foreground',
          className,
        )}
        // Decorative: the product name is always rendered next to it.
        aria-hidden="true"
      >
        <ImageOff className={cn('h-3.5 w-3.5', iconClassName)} />
      </div>
    )
  }

  return (
    <img
      src={resolved}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailedSrc(resolved)}
      className={cn('object-cover', className)}
    />
  )
}
