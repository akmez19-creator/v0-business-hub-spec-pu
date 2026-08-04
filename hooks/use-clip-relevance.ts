'use client'

/**
 * Lazily judges whether each search-result clip actually shows the product.
 *
 * Scanning is driven by an IntersectionObserver rather than run over the whole
 * result set: a search returns ~25 clips, each scan costs a few seeks plus a
 * Gemini call, and you typically care about the first handful. Cards are
 * scanned as they scroll into view, at most two at a time so the browser is
 * not decoding a dozen videos at once.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { extractFrames } from '@/lib/product-master/extract-frames'
import type { ClipVerdict } from '@/lib/product-master/clip-relevance'

export type ScanState =
  | { status: 'scanning' }
  | { status: 'done'; verdict: ClipVerdict }
  /** Could not be judged (model down, undecodable clip). Never treated as
   *  irrelevant - an infrastructure failure must not hide good footage. */
  | { status: 'error'; message: string }

export interface ClipTarget {
  id: string
  /** Proxied, same-origin video URL. Cards without one cannot be scanned. */
  url: string | null
  durationHint?: number
}

const MAX_CONCURRENT = 2

export function useClipRelevance(productName: string) {
  const [states, setStates] = useState<Record<string, ScanState>>({})

  const queue = useRef<ClipTarget[]>([])
  const active = useRef(0)
  const seen = useRef<Set<string>>(new Set())
  const observer = useRef<IntersectionObserver | null>(null)
  const targets = useRef<Map<Element, ClipTarget>>(new Map())
  // Read inside async work that outlives the render it started in
  const productRef = useRef(productName)
  productRef.current = productName

  // A new product means every existing verdict is answering the wrong
  // question, so drop them and allow re-scanning.
  useEffect(() => {
    seen.current = new Set()
    queue.current = []
    setStates({})

    // Cards already sitting on screen will not fire the observer again on
    // their own, because intersection has not *changed*. Toggling the
    // observation forces a fresh initial callback, so results that were
    // rendered before the search term landed still get scanned.
    if (!productName.trim() || !observer.current) return
    for (const el of targets.current.keys()) {
      observer.current.unobserve(el)
      observer.current.observe(el)
    }
  }, [productName])

  const pump = useCallback(() => {
    while (active.current < MAX_CONCURRENT && queue.current.length) {
      const target = queue.current.shift()
      if (!target?.url) continue
      active.current += 1
      setStates((s) => ({ ...s, [target.id]: { status: 'scanning' } }))
      ;(async () => {
        try {
          const frames = await extractFrames(target.url as string, {
            durationHint: target.durationHint,
          })
          const res = await fetch('/api/product-master/clip-relevance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ frames, productName: productRef.current }),
          })
          const json = await res.json()
          if (!json?.success) throw new Error(json?.error || 'Scan failed')
          setStates((s) => ({
            ...s,
            [target.id]: {
              status: 'done',
              verdict: {
                relevance: json.relevance,
                showsProduct: json.showsProduct,
                reason: json.reason,
              },
            },
          }))
        } catch (error) {
          setStates((s) => ({
            ...s,
            [target.id]: {
              status: 'error',
              message: error instanceof Error ? error.message : 'Scan failed',
            },
          }))
        } finally {
          active.current -= 1
          pump()
        }
      })()
    }
  }, [])

  /** Returns whether the clip was actually accepted for scanning. */
  const enqueue = useCallback(
    (target: ClipTarget): boolean => {
      if (!target.url || seen.current.has(target.id)) return false
      // The product name can still be empty on the render where cards first
      // mount (the search term lands a tick later). Report failure so the
      // caller keeps watching instead of discarding the clip forever.
      if (!productRef.current.trim()) return false
      seen.current.add(target.id)
      queue.current.push(target)
      pump()
      return true
    },
    [pump],
  )

  useEffect(() => {
    observer.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const target = targets.current.get(entry.target)
          // Only stop watching once the clip was actually accepted.
          // Unobserving on a rejected enqueue is what silently killed every
          // scan when the product name had not landed yet.
          if (target && enqueue(target)) {
            observer.current?.unobserve(entry.target)
          }
        }
      },
      // Start slightly before the card is on screen so the badge is usually
      // settled by the time it is actually looked at.
      { rootMargin: '200px' },
    )
    return () => observer.current?.disconnect()
  }, [enqueue])

  /** Ref callback for a result card. */
  const watch = useCallback(
    (target: ClipTarget) => (el: HTMLElement | null) => {
      if (!el) return
      if (!target.url) return
      // Drop any element previously registered for this same clip so the map
      // does not accumulate detached nodes as the grid re-renders.
      for (const [known, t] of targets.current) {
        if (t.id === target.id && known !== el) {
          targets.current.delete(known)
          observer.current?.unobserve(known)
        }
      }
      targets.current.set(el, target)
      observer.current?.observe(el)
    },
    [],
  )

  return { states, watch }
}
