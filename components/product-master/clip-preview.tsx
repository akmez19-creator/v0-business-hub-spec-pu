'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Volume2 } from 'lucide-react'

/**
 * Shortest time a clip is allowed to stay on screen once it starts playing.
 *
 * A clip that appears and vanishes faster than this is impossible to tell
 * apart from the one before it, which defeats the point of previewing at all.
 * Any request to stop is deferred until this has elapsed.
 */
export const MIN_PREVIEW_MS = 3000

type ClipPreviewProps = {
  id: string
  src: string
  poster?: string
  title: string
  /** Whether the rotation currently grants this tile a playback slot */
  active: boolean
  /** Reports in/out of viewport so the parent only rotates what can be seen */
  onVisibility: (id: string, visible: boolean) => void
  /** Open the full, audible player */
  onOpen: () => void
}

export function ClipPreview({ id, src, poster, title, active, onVisibility, onOpen }: ClipPreviewProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [hovered, setHovered] = useState(false)
  // The <video> is only attached once something actually wants it, so a grid
  // of 40 listings does not open 40 connections to the CDN on first paint.
  const [mounted, setMounted] = useState(false)
  const [firstFrame, setFirstFrame] = useState(false)
  const startedAt = useRef(0)
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(([entry]) => onVisibility(id, entry.isIntersecting), {
      // A tile half off the bottom edge should not win a slot ahead of one
      // the user is actually looking at
      threshold: 0.4,
    })
    io.observe(el)
    return () => {
      io.disconnect()
      onVisibility(id, false)
    }
  }, [id, onVisibility])

  // Hover always wins a slot: pointing at a clip is the clearest possible
  // signal that this is the one being compared right now.
  const want = active || hovered

  useEffect(() => {
    if (stopTimer.current) {
      clearTimeout(stopTimer.current)
      stopTimer.current = null
    }

    if (want) {
      setMounted(true)
      if (!startedAt.current) startedAt.current = Date.now()
      // autoPlay covers the very first mount; this covers every later turn
      videoRef.current?.play().catch(() => {})
      return
    }

    if (!startedAt.current) return

    // Hold the clip for the remainder of its minimum before yielding.
    const remaining = Math.max(0, MIN_PREVIEW_MS - (Date.now() - startedAt.current))
    stopTimer.current = setTimeout(() => {
      const v = videoRef.current
      if (v) {
        v.pause()
        // Rewind so the next turn starts from the top rather than resuming
        // somewhere in the middle, which reads as a different clip entirely
        v.currentTime = 0
      }
      startedAt.current = 0
      stopTimer.current = null
    }, remaining)

    return () => {
      if (stopTimer.current) {
        clearTimeout(stopTimer.current)
        stopTimer.current = null
      }
    }
  }, [want, mounted])

  useEffect(
    () => () => {
      if (stopTimer.current) clearTimeout(stopTimer.current)
    },
    [],
  )

  const open = useCallback(() => onOpen(), [onOpen])

  return (
    <div
      ref={wrapRef}
      className="absolute inset-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* The still stays underneath until a real frame is decoded, so a slow
          clip shows the product rather than a black hole in the grid. */}
      {poster && (
        <img
          src={poster || '/placeholder.svg'}
          alt={title}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
        />
      )}

      {mounted && (
        <video
          ref={videoRef}
          src={src}
          poster={poster}
          muted
          loop
          autoPlay
          playsInline
          preload="metadata"
          onPlaying={() => setFirstFrame(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            firstFrame ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}

      <button
        type="button"
        onClick={open}
        aria-label={`Play ${title} with sound`}
        className="group absolute inset-0 flex items-end justify-end p-1.5 transition-colors hover:bg-black/20"
      >
        <span className="inline-flex items-center gap-1 rounded-full bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
          <Volume2 className="h-3 w-3" />
          Sound
        </span>
      </button>

      {/* Marks which tiles are live without covering the picture the way a
          centred play button did */}
      {want && firstFrame && (
        <span className="pointer-events-none absolute right-1.5 top-1.5 flex h-2 w-2 rounded-full bg-amber-500 shadow-[0_0_0_2px_rgba(0,0,0,0.6)]" />
      )}
    </div>
  )
}
