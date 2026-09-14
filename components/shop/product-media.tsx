'use client'

import { shopMedia } from '@/lib/shop/media'
import { ImageIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

/**
 * A product's picture, upgrading itself to its video while on screen.
 *
 * Supplier cover frames are often a logo intro or a packaging shot, so the clip
 * shows the actual object far better. Playback is in-view only via
 * IntersectionObserver - autoplaying every card in an 800-product grid would
 * saturate the proxy and the client's data.
 *
 * Both the poster and the video go through shopMedia(): these URLs are mostly
 * alicdn / video.taobao.com, which 403 a browser directly. Seeking past the
 * intro relies on the proxy forwarding Range and answering 206.
 */
export function ProductMedia({
  image,
  video,
  alt,
  className = '',
  /** Skip straight into the clip, past logo intros. */
  startAt = 2.5,
  sizes = '(max-width: 768px) 50vw, 25vw',
  priority = false,
}: {
  image: string
  video?: string | null
  alt: string
  className?: string
  startAt?: number
  sizes?: string
  priority?: boolean
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [active, setActive] = useState(false)
  const [failed, setFailed] = useState(false)
  // Only true once the clip has actually PAINTED a frame. A video can play
  // happily (currentTime advancing, no error event) while decoding no picture
  // at all when the device lacks the codec - videoWidth stays 0. Fading the
  // photo out on `active` alone turns those cards into blank boxes, so the
  // photo is only hidden once there is really something to show instead.
  const [painting, setPainting] = useState(false)
  const [imgFailed, setImgFailed] = useState(false)

  useEffect(() => {
    if (!video || !wrapRef.current) return
    const el = wrapRef.current
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setActive(e.isIntersecting && e.intersectionRatio > 0.35)
      },
      { threshold: [0, 0.35, 0.75] },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [video])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (active) {
      // Seeking silently no-ops if the source can't serve a byte range, so a
      // failed seek must not stop playback - let it run from the start.
      try {
        if (Number.isFinite(v.duration) && v.duration > startAt + 1) v.currentTime = startAt
      } catch {
        /* not seekable yet */
      }
      void v.play().catch(() => {
        /* autoplay refused - the poster stays, which is fine */
      })
    } else {
      v.pause()
      // Going off screen drops the source, so the next pass must re-prove it
      // can paint before the photo is hidden again.
      setPainting(false)
    }
  }, [active, startAt])

  const showVideo = Boolean(video) && !failed
  // A dead photo URL must degrade to the icon, not a broken-image glyph. Many
  // of these are supplier CDN links that can start 403-ing without warning.
  const showImage = Boolean(image) && !imgFailed

  return (
    <div ref={wrapRef} className={`relative overflow-hidden bg-muted ${className}`}>
      {showImage ? (
        // Plain <img>, not next/image: these are hundreds of remote supplier
        // hosts behind our own proxy, and the optimiser would add a second
        // round trip per photo for no gain on already-small CDN thumbnails.
        <img
          src={shopMedia(image) || '/placeholder.svg'}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          sizes={sizes}
          onError={() => setImgFailed(true)}
          className={`h-full w-full object-cover transition-opacity duration-500 ${
            showVideo && active && painting ? 'opacity-0' : 'opacity-100'
          }`}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          <ImageIcon className="h-8 w-8" aria-hidden="true" />
          <span className="sr-only">No photo available</span>
        </div>
      )}

      {showVideo && (
        <video
          ref={videoRef}
          src={active ? shopMedia(video!) : undefined}
          muted
          loop
          playsInline
          preload="none"
          aria-label={`${alt} video`}
          onError={() => setFailed(true)}
          // videoWidth is the only honest signal that a picture exists: a
          // codec the device can't decode still fires timeupdate and never
          // fires error. Checked on each tick because the first decoded frame
          // can arrive after playback formally starts.
          onTimeUpdate={(e) => {
            if (!painting && e.currentTarget.videoWidth > 0) setPainting(true)
          }}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-500 ${
            active && painting ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </div>
  )
}
