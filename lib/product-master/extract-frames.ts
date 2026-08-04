/**
 * Grabs a few still frames out of a video in the browser, without downloading
 * the whole file.
 *
 * This works because clips are served through our own `video-fetch?inline=1`
 * proxy, which matters twice over:
 *   1. Same-origin, so drawing the video to a canvas does not taint it. A
 *      cross-origin CDN URL would make every `toDataURL` throw a SecurityError.
 *   2. The proxy forwards Range headers, so seeking to 12s fetches only the
 *      bytes around 12s instead of streaming the file from the start.
 *
 * ffmpeg.wasm is already a dependency and could do this too, but it is a ~30MB
 * download and an entire transcode pipeline for what is really five seeks and
 * five canvas draws.
 */

/** Fractions of the clip to sample - evenly spread, avoiding the very first
 *  and last moments which are usually a logo sting or an outro card. */
const SAMPLE_POINTS = [0.1, 0.3, 0.5, 0.7, 0.9]

/** Downscale target. 384px is plenty for "which product is this?" and keeps
 *  each frame at roughly 258 image tokens. */
const MAX_EDGE = 384

/** Give up on a stalled seek rather than hanging a scan forever. */
const SEEK_TIMEOUT_MS = 8000
const METADATA_TIMEOUT_MS = 12000

function waitForEvent(el: HTMLVideoElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false
    const cleanup = () => {
      el.removeEventListener(event, onOk)
      el.removeEventListener('error', onErr)
      clearTimeout(timer)
    }
    const onOk = () => {
      if (done) return
      done = true
      cleanup()
      resolve()
    }
    const onErr = () => {
      if (done) return
      done = true
      cleanup()
      reject(new Error(`Video failed while waiting for "${event}"`))
    }
    const timer = setTimeout(() => {
      if (done) return
      done = true
      cleanup()
      reject(new Error(`Timed out waiting for "${event}"`))
    }, timeoutMs)
    el.addEventListener(event, onOk, { once: true })
    el.addEventListener('error', onErr, { once: true })
  })
}

export interface ExtractOptions {
  /** Duration from search metadata, used when the file does not report one. */
  durationHint?: number
  /** Abort early when the caller no longer needs the result. */
  signal?: AbortSignal
}

/**
 * Capture evenly spaced JPEG frames as base64 data URLs.
 *
 * Returns whatever it managed to grab: a clip that stalls on the fourth seek
 * still yields three usable frames, which is enough to judge relevance. Throws
 * only when it cannot get a single frame.
 */
export async function extractFrames(
  videoUrl: string,
  { durationHint, signal }: ExtractOptions = {},
): Promise<string[]> {
  const video = document.createElement('video')
  video.src = videoUrl
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  // Never attach to the DOM - this is a headless decode, not a preview.
  video.style.display = 'none'

  const release = () => {
    try {
      video.pause()
      video.removeAttribute('src')
      video.load()
    } catch {
      // element is being discarded anyway
    }
  }

  try {
    await waitForEvent(video, 'loadedmetadata', METADATA_TIMEOUT_MS)
    if (signal?.aborted) return []

    // Live/streamed sources report Infinity; fall back to the search metadata.
    let duration = video.duration
    if (!Number.isFinite(duration) || duration <= 0) duration = durationHint ?? 0
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Could not determine this clip\u2019s duration')
    }

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is unavailable in this browser')

    const w = video.videoWidth || 0
    const h = video.videoHeight || 0
    if (w > 0 && h > 0) {
      const scale = Math.min(1, MAX_EDGE / Math.max(w, h))
      canvas.width = Math.round(w * scale)
      canvas.height = Math.round(h * scale)
    } else {
      canvas.width = MAX_EDGE
      canvas.height = MAX_EDGE
    }

    const frames: string[] = []
    for (const point of SAMPLE_POINTS) {
      if (signal?.aborted) break
      // Clamp just inside the end: seeking exactly to duration often lands past
      // the last decodable frame and never fires `seeked`.
      const target = Math.min(duration * point, Math.max(0, duration - 0.1))
      try {
        video.currentTime = target
        await waitForEvent(video, 'seeked', SEEK_TIMEOUT_MS)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        frames.push(canvas.toDataURL('image/jpeg', 0.6))
      } catch {
        // Skip this point; a partial set of frames is still worth scoring.
        continue
      }
    }

    if (!frames.length) throw new Error('No frames could be read from this clip')
    return frames
  } finally {
    release()
  }
}
