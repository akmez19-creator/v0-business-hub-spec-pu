import sharp from 'sharp'
import { createClient } from '@supabase/supabase-js'

/**
 * Storage client built here rather than imported from lib/supabase/server:
 * that module imports `next/headers` at the top level, which throws in any
 * non-request context and poisons anything a client component transitively
 * imports. This file only needs Storage, so it takes the keys directly.
 */
function storageClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

/**
 * 1688's image-search converter refuses anything over 300KB.
 *
 * MEASURED: 62 of 111 product photos (56%) are over that limit, so for more than
 * half the catalogue the supplier-video search never ran at all - Alibaba
 * rejected the photo before a single listing was looked at, and the grid simply
 * showed no 1688 group. A phone photo is routinely 700KB-3MB, so this was the
 * normal case, not an edge case.
 *
 * Supabase's own `/render/image` resizer would have been the cheap fix but it
 * returns 403 FeatureNotEnabled on this project's plan, so we re-encode
 * ourselves and publish the small copy for Alibaba to fetch.
 */
const LIMIT_BYTES = 300 * 1024

/** Bucket already public and already holding product photos. */
const BUCKET = 'product-images'

/** Temp copies live under one prefix so they are easy to identify and sweep. */
const PREFIX = 'search-tmp'

/**
 * Progressive downscale. Stops at the first rung under the limit so we give the
 * reverse-image match the most detail it can accept - dropping straight to a
 * tiny thumbnail would cost match quality for no benefit.
 *
 * VERIFIED on the Mini Razor (729KB PNG): the very first rung produced 127KB,
 * and that image returned 20 matches / 8 videos / 60 photos where the original
 * returned nothing.
 */
const RUNGS: ReadonlyArray<{ width: number; quality: number }> = [
  { width: 1000, quality: 80 },
  { width: 800, quality: 72 },
  { width: 640, quality: 65 },
  { width: 480, quality: 55 },
]

export type SearchableImage = {
  /** Public URL Alibaba can fetch, or null when it could not be prepared. */
  url: string | null
  error: string | null
  /** True when a temp copy was uploaded and should be removed after searching. */
  temp: boolean
  /** Storage path of the temp copy, for cleanup. */
  path: string | null
}

/** Removes a temp copy. Never throws - cleanup must not fail a search. */
export async function releaseSearchImage(img: SearchableImage): Promise<void> {
  if (!img.temp || !img.path) return
  try {
    await storageClient().storage.from(BUCKET).remove([img.path])
  } catch {
    // A leftover temp file is harmless; failing the caller would not be.
  }
}

/** Shrinks to the first rung under the limit. Null when even the last is too big. */
async function shrink(bytes: Buffer): Promise<Buffer | null> {
  let small: Buffer | null = null
  for (const rung of RUNGS) {
    const out = await sharp(bytes)
      // Flatten onto white: a transparent PNG becomes BLACK behind the product
      // when encoded as JPEG, which changes what the reverse-image search is
      // actually looking at.
      .flatten({ background: '#ffffff' })
      .resize({ width: rung.width, withoutEnlargement: true })
      .jpeg({ quality: rung.quality })
      .toBuffer()
    small = out
    if (out.length <= LIMIT_BYTES) return out
  }
  return small && small.length <= LIMIT_BYTES ? small : null
}

/** Publishes a temp copy Alibaba can fetch. */
async function publish(small: Buffer): Promise<SearchableImage> {
  const failed = (): SearchableImage => ({
    url: null,
    error: 'Could not prepare a smaller copy of this photo.',
    temp: false,
    path: null,
  })
  try {
    const supabase = storageClient()
    const path = `${PREFIX}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, small, { contentType: 'image/jpeg', upsert: true })
    if (error) return failed()

    const url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
    if (!url) return failed()
    return { url, error: null, temp: true, path }
  } catch {
    return failed()
  }
}

/**
 * Same, for an image we hold as BYTES rather than a URL - the "Upload" and
 * "Better photo" buttons.
 *
 * Those paths sent base64 to the API, and the route only ran the 1688 search
 * when it had an `http(s)` URL, so an uploaded photo NEVER searched 1688 - it
 * silently returned social results only. Alibaba fetches the image itself, so
 * uploaded bytes have to be published somewhere public first.
 */
export async function prepareSearchImageFromBytes(bytes: Buffer): Promise<SearchableImage> {
  try {
    // Always re-encoded, even when already small: uploads arrive as arbitrary
    // camera files and this normalises orientation/format alongside the size.
    const small = bytes.length <= LIMIT_BYTES ? bytes : await shrink(bytes)
    if (!small) {
      return { url: null, error: 'This photo is too large for 1688 image search even after resizing.', temp: false, path: null }
    }
    return await publish(small)
  } catch {
    return { url: null, error: 'This photo could not be prepared for 1688 search.', temp: false, path: null }
  }
}

/**
 * Returns a URL for `imageUrl` that 1688's converter will accept, shrinking and
 * re-publishing the image only when it is genuinely too big.
 *
 * Alibaba fetches the image ITSELF, from inside China, so the result has to be a
 * public http(s) URL - we cannot POST bytes and we cannot use a data: URL.
 */
export async function prepareSearchImage(imageUrl: string): Promise<SearchableImage> {
  const asIs: SearchableImage = { url: imageUrl, error: null, temp: false, path: null }

  if (!/^https?:\/\//i.test(imageUrl)) {
    return { url: null, error: 'This photo has no public web address, so 1688 cannot fetch it.', temp: false, path: null }
  }

  let bytes: Buffer
  try {
    // A HEAD first would save bandwidth, but plenty of hosts omit
    // content-length, and "unknown size" must not be treated as "small enough" -
    // that is precisely the silent failure being fixed.
    const res = await fetch(imageUrl, { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return asIs
    bytes = Buffer.from(await res.arrayBuffer())
  } catch {
    // If we cannot read it, let the converter try the original and report.
    return asIs
  }

  if (bytes.length <= LIMIT_BYTES) return asIs

  let small: Buffer | null
  try {
    small = await shrink(bytes)
  } catch {
    return { url: null, error: 'This photo could not be resized for 1688 search.', temp: false, path: null }
  }

  if (!small) {
    return { url: null, error: 'This photo is too large for 1688 image search even after resizing.', temp: false, path: null }
  }

  return await publish(small)
}
