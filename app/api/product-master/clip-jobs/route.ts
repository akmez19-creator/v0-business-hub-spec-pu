import { NextResponse, after } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { hostAllowed, resolveAny, UA } from '@/lib/product-master/video-resolve'
import { readMp4Meta } from '@/lib/product-master/mp4-meta'
import {
  BATCH,
  MAX_BYTES,
  type ClipJob,
  claimJob,
  failJob,
  finishJob,
  requeueStale,
} from '@/lib/product-master/clip-jobs'

/**
 * Background clip downloads.
 *
 * Clicking "use" in the Studio used to run the entire download inside the
 * browser tab. The Studio is mounted conditionally, so closing the dialog
 * unmounted it, discarded the pending list and cancelled the fetch - the work
 * was abandoned, not backgrounded. Now the click only writes a job row and
 * returns; this route does the downloading.
 *
 * Execution rides on `after()`: the response goes out first, then the work runs
 * in the same invocation. No queue service and no cron - a stalled job is
 * revived by the next poll, including the one that fires when the dialog is
 * simply reopened.
 */
export const maxDuration = 60

const BUCKET = 'reels'

/** Clip rows record how the clip was FOUND, matching what the browser wrote. */
const clipSourceFor = (jobSource: string) => (jobSource === 'link' ? 'link' : 'search')

function safeFileName(title: string, source: string) {
  const base = String(title || 'video')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .slice(0, 40)
  return `${source === 'link' ? 'link' : source}-${base || 'video'}.mp4`.replace(/\s+/g, '-')
}

/**
 * Find a fresh, downloadable stream url for a job.
 *
 * Order matters. TikTok and Facebook hand out signed CDN links that expire
 * within minutes, so a job retried later MUST re-resolve from the stable page
 * url - reusing the stored one is how a retry would fail forever. Marketplace
 * (1688) listing urls are plain CDN paths that cannot be re-resolved without
 * another paid TMAPI search, so there the stored url is the only option.
 */
async function streamUrlFor(job: ClipJob): Promise<string> {
  const canReResolve = job.source === 'tiktok' || job.source === 'facebook' || job.source === 'youtube'
  if (canReResolve && job.source_url) {
    try {
      const fresh = await resolveAny(job.source_url)
      if (fresh.videoUrl) return fresh.videoUrl
    } catch (e) {
      // Fall through to the stored url: it may still be inside its window, and
      // a resolver outage should not fail a job that could have succeeded.
      console.log('[v0] clip-jobs re-resolve failed', job.id, e instanceof Error ? e.message : e)
    }
  }
  if (job.stream_url) return job.stream_url
  if (job.source === 'link' && job.source_url) {
    const resolved = await resolveAny(job.source_url)
    return resolved.videoUrl
  }
  throw new Error('No downloadable stream for this clip')
}

/**
 * Write the clip row, cleaning up the uploaded object if the row cannot be
 * written. Mirrors the dedupe handling in the clips route: source_id is the
 * origin platform's own id, so the same clip found again must not become a
 * second library row.
 */
async function insertClip(
  admin: any,
  job: ClipJob,
  path: string,
  fileUrl: string,
  meta: { duration: number; width: number; height: number },
  sizeBytes: number,
  name: string,
): Promise<string> {
  const { data, error } = await admin
    .from('product_clips')
    .insert({
      product_id: job.product_id,
      product_name: job.product_name || '',
      name,
      file_url: fileUrl,
      storage_path: path,
      duration: meta.duration,
      width: meta.width,
      height: meta.height,
      size_bytes: sizeBytes,
      source: clipSourceFor(job.source),
      source_id: job.source_id,
      source_url: job.source_url,
    })
    .select('id')
    .single()

  if (!error && data?.id) return data.id as string

  // Lost a dedupe race - another save of the same clip won. Adopt its row and
  // drop the file we just uploaded so the bucket does not keep a twin.
  if (error && (error as any).code === '23505' && job.source_id) {
    const { data: winner } = await admin
      .from('product_clips')
      .select('id')
      .eq('source_id', job.source_id)
      .limit(1)
    await admin.storage.from(BUCKET).remove([path])
    if (winner?.length) return winner[0].id as string
  }

  // Never leave an object nobody has a row for.
  await admin.storage.from(BUCKET).remove([path])
  throw new Error(error?.message || 'Could not save this clip')
}

async function processJob(admin: any, job: ClipJob) {
  // Already in the library from an earlier save? Link and stop - re-downloading
  // is the exact waste the source_id dedupe exists to prevent.
  if (job.source_id) {
    const { data: existing } = await admin
      .from('product_clips')
      .select('id')
      .eq('source_id', job.source_id)
      .limit(1)
    if (existing?.length) {
      await finishJob(admin, job.id, existing[0].id)
      return
    }
  }

  const src = await streamUrlFor(job)
  if (!hostAllowed(src)) throw new Error('Host not allowed')

  const res = await fetch(src, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`Download failed (${res.status}) - the video link may have expired`)

  // Trust the header when it is there, but re-check the real buffer after: some
  // CDN nodes answer without a content-length at all.
  const declared = Number(res.headers.get('content-length') || 0)
  if (declared && declared > MAX_BYTES) throw new Error('Video is too large to save')

  const buffer = await res.arrayBuffer()
  if (buffer.byteLength > MAX_BYTES) throw new Error('Video is too large to save')
  if (buffer.byteLength < 10_000) throw new Error('Downloaded file looks empty - try again')

  const meta = readMp4Meta(buffer)
  const name = safeFileName(job.title, job.source)
  const path = `clips/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${name}`

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    // The bucket only accepts video/mp4 and a CDN response can arrive with no
    // content type at all, so never pass a blank one through.
    .upload(path, buffer, { contentType: 'video/mp4' })
  if (uploadError) throw new Error(`Clip upload failed: ${uploadError.message}`)

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path)
  const clipId = await insertClip(admin, job, path, pub.publicUrl, meta, buffer.byteLength, name)
  await finishJob(admin, job.id, clipId)
}

/**
 * One worker pass: revive anything stranded, then take a small batch.
 *
 * The batch is deliberately small. Real clips average ~4MB, so three fit
 * comfortably inside the 60s ceiling; anything left over is picked up by the
 * next pass, which the panel's own polling triggers every few seconds.
 */
async function runQueue() {
  const admin = createAdminClient()
  try {
    await requeueStale(admin)

    const { data: queued, error } = await admin
      .from('clip_jobs')
      .select('*')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(BATCH)
    if (error) {
      console.log('[v0] clip-jobs queue read failed', error.message)
      return
    }

    for (const job of (queued || []) as ClipJob[]) {
      // Whoever flips 'queued' -> 'running' owns it. Without this two
      // overlapping passes would download the same clip twice.
      if (!(await claimJob(admin, job.id))) continue
      try {
        await processJob(admin, job)
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Download failed'
        console.log('[v0] clip-jobs job failed', job.id, message)
        await failJob(admin, job, message)
      }
    }
  } catch (e) {
    console.log('[v0] clip-jobs runQueue crashed', e instanceof Error ? e.message : e)
  }
}

type IncomingJob = {
  title?: string
  thumbUrl?: string | null
  source?: string
  sourceId?: string | null
  sourceUrl?: string | null
  streamUrl?: string | null
}

// POST { productId, productName, jobs: [...] } -> queue downloads
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await request.json()
    const incoming: IncomingJob[] = Array.isArray(body?.jobs) ? body.jobs : [body?.job].filter(Boolean)
    if (incoming.length === 0) {
      return NextResponse.json({ success: false, error: 'No jobs given' }, { status: 400 })
    }

    const admin = createAdminClient()
    const created: ClipJob[] = []

    for (const j of incoming) {
      const source = String(j.source || 'link')
      if (!j.streamUrl && !j.sourceUrl) continue // nothing to download from

      const row = {
        product_id: body?.productId || null,
        product_name: body?.productName || '',
        title: String(j.title || 'Video').slice(0, 200),
        thumb_url: j.thumbUrl || null,
        source,
        source_id: j.sourceId || null,
        source_url: j.sourceUrl || null,
        stream_url: j.streamUrl || null,
        created_by: user.id,
      }

      const { data, error } = await admin.from('clip_jobs').insert(row).select('*').single()

      if (error) {
        // The partial unique index refused a second LIVE job for this clip -
        // a double click, or "Use all" run twice. Hand back the job already
        // working on it so the panel shows one tile instead of an error.
        if ((error as any).code === '23505' && row.source_id) {
          const { data: live } = await admin
            .from('clip_jobs')
            .select('*')
            .eq('source_id', row.source_id)
            .in('status', ['queued', 'running'])
            .limit(1)
          if (live?.length) {
            created.push(live[0] as ClipJob)
            continue
          }
        }
        console.log('[v0] clip-jobs insert failed', error.message)
        continue
      }
      created.push(data as ClipJob)
    }

    if (created.length === 0) {
      return NextResponse.json({ success: false, error: 'Could not queue these clips' }, { status: 500 })
    }

    // Response first, download after - in the same invocation.
    after(() => runQueue())
    return NextResponse.json({ success: true, jobs: created })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Could not queue clips' },
      { status: 500 },
    )
  }
}

/**
 * GET ?productId= | ?productName= -> this product's jobs.
 *
 * Returns live jobs (queued/running), failures still worth showing, and
 * completions from the last 15 minutes with their clip row attached, so a
 * dialog that is open when a job lands can drop the clip straight into the
 * feed. Older completions are already covered by the restore-on-open fetch.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const productId = searchParams.get('productId')
    const productName = searchParams.get('productName')

    const admin = createAdminClient()
    const recent = new Date(Date.now() - 15 * 60 * 1000).toISOString()

    let query = admin
      .from('clip_jobs')
      .select('*, clip:product_clips(*)')
      .or(`status.in.(queued,running,failed),finished_at.gte.${recent}`)
      .order('created_at', { ascending: true })
      .limit(60)

    // Older clips predate products carrying an id, so the name is the fallback
    // - the same rule the clips route uses.
    if (productId) query = query.eq('product_id', productId)
    else if (productName) query = query.eq('product_name', productName)

    const { data, error } = await query
    // A failed read must never render as "nothing is happening": report it.
    if (error) throw error

    // Reopening the dialog is also a chance to revive anything stranded.
    after(() => runQueue())
    return NextResponse.json({ success: true, jobs: data ?? [] })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Could not load clip jobs' },
      { status: 500 },
    )
  }
}

// DELETE ?id= -> dismiss a job the user has seen and acknowledged
export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })

    const admin = createAdminClient()
    const { error } = await admin.from('clip_jobs').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Could not dismiss job' },
      { status: 500 },
    )
  }
}
