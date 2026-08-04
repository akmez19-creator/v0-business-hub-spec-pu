import { upload } from '@vercel/blob/client'

export interface SavedClipRow {
  id: string
  product_id: string | null
  product_name: string
  name: string
  blob_url: string
  duration: number | string
  width: number
  height: number
  size_bytes: number
  source: string
  created_at: string
}

/**
 * Persists a Reels Studio source clip: the file streams from the browser
 * straight to Blob storage, then a small metadata row is written.
 *
 * The upload deliberately bypasses our own API. Route handlers on Vercel cap
 * request bodies at 4.5MB and HD clips are routinely several times that, so
 * proxying the video through the server would fail once deployed.
 */
export async function saveClipToLibrary(opts: {
  file: File
  productId?: string | null
  productName?: string
  duration: number
  width: number
  height: number
  source?: string
  signal?: AbortSignal
}): Promise<SavedClipRow> {
  const { file, productId, productName, duration, width, height, source = 'upload' } = opts

  // Strip characters that make a blob pathname awkward to work with later
  const safe = file.name.replace(/[^\w.\-]+/g, '-').slice(-80)
  const blob = await upload(`reels-clips/${Date.now()}-${safe}`, file, {
    access: 'public',
    handleUploadUrl: '/api/product-master/clips/upload',
    contentType: file.type || 'video/mp4',
  })

  const res = await fetch('/api/product-master/clips', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      blobUrl: blob.url,
      blobPathname: blob.pathname,
      name: file.name,
      productId: productId || null,
      productName: productName || '',
      duration,
      width,
      height,
      sizeBytes: file.size,
      source,
    }),
    signal: opts.signal,
  })

  const json = await res.json()
  if (!json.success) throw new Error(json.error || 'Could not save this clip')
  return json.clip as SavedClipRow
}

/** Turns a saved blob URL back into a File so ffmpeg can work on it as usual */
export async function fileFromSavedClip(row: SavedClipRow): Promise<File> {
  const res = await fetch(row.blob_url)
  if (!res.ok) throw new Error('Could not load a saved clip')
  const blob = await res.blob()
  return new File([blob], row.name, { type: blob.type || 'video/mp4' })
}
