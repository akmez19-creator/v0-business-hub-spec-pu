import { createClient } from '@/lib/supabase/client'

export interface SavedClipRow {
  id: string
  product_id: string | null
  product_name: string
  name: string
  file_url: string
  storage_path: string | null
  duration: number | string
  width: number
  height: number
  size_bytes: number
  source: string
  /** Stable id from the origin platform, used to detect re-saves */
  source_id: string | null
  /** Original page/download URL the clip came from */
  source_url: string | null
  created_at: string
}

/** Bucket already used by the publish and ad panels - restricted to video/mp4 */
const BUCKET = 'reels'

/**
 * Persists a Reels Studio source clip: the file goes from the browser straight
 * to Supabase Storage, then a small metadata row is written.
 *
 * The upload deliberately bypasses our own API. Route handlers on Vercel cap
 * request bodies at 4.5MB and HD clips are routinely several times that, so
 * proxying the video through the server would 413 once deployed.
 */
export async function saveClipToLibrary(opts: {
  file: File
  productId?: string | null
  productName?: string
  duration: number
  width: number
  height: number
  source?: string
  /** Stable id from the origin platform, so the same clip is not saved twice */
  sourceId?: string | null
  /** Original page/download URL */
  sourceUrl?: string | null
  signal?: AbortSignal
}): Promise<SavedClipRow> {
  const {
    file,
    productId,
    productName,
    duration,
    width,
    height,
    source = 'upload',
    sourceId = null,
    sourceUrl = null,
  } = opts

  // Strip characters that make an object path awkward to work with later
  const safe = file.name.replace(/[^\w.\-]+/g, '-').slice(-80)
  const path = `clips/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`

  const supabase = createClient()
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    // The bucket only accepts video/mp4, and a File from a download can
    // arrive with an empty type, so never pass through a blank content type
    .upload(path, file, { contentType: file.type || 'video/mp4' })
  if (uploadError) {
    // The bucket is restricted to mp4, so a dragged-in .mov or .webm fails
    // here. Say so plainly instead of surfacing the raw storage error.
    const mimeRejected = /mime|content type/i.test(uploadError.message)
    throw new Error(
      mimeRejected
        ? 'Only MP4 clips can be saved to your library - this one stays in the feed for now'
        : `Clip upload failed: ${uploadError.message}`,
    )
  }

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)

  const res = await fetch('/api/product-master/clips', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileUrl: pub.publicUrl,
      storagePath: path,
      name: file.name,
      productId: productId || null,
      productName: productName || '',
      duration,
      width,
      height,
      sizeBytes: file.size,
      source,
      sourceId,
      sourceUrl,
    }),
    signal: opts.signal,
  })

  const json = await res.json()
  if (!json.success) {
    // Don't leave an orphaned file behind if the row could not be written
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {})
    throw new Error(json.error || 'Could not save this clip')
  }
  return json.clip as SavedClipRow
}

/** Turns a stored clip back into a File so ffmpeg can work on it as usual */
export async function fileFromSavedClip(row: SavedClipRow): Promise<File> {
  const res = await fetch(row.file_url)
  if (!res.ok) throw new Error('Could not load a saved clip')
  const blob = await res.blob()
  return new File([blob], row.name, { type: blob.type || 'video/mp4' })
}
