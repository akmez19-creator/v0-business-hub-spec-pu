/**
 * Clip download jobs: the record that makes a download survive the tab.
 *
 * See scripts/create-clip-jobs.sql for why this table exists at all. The short
 * version: the download used to run in the browser and the pending tiles lived
 * in one useState, so closing the Studio dialog cancelled the work and lost all
 * trace of it.
 */

/** Max attempts before a job is parked as failed. */
export const MAX_ATTEMPTS = 3

/** A job left 'running' longer than this is assumed to have died mid-flight. */
export const STALE_RUNNING_MS = 3 * 60 * 1000

/** Jobs pulled per worker pass. Sized to fit inside maxDuration=60. */
export const BATCH = 3

/** Refuse anything larger. The biggest real clip in the library is ~19MB. */
export const MAX_BYTES = 100 * 1024 * 1024

export type ClipJobStatus = 'queued' | 'running' | 'done' | 'failed'

export type ClipJob = {
  id: string
  product_id: string | null
  product_name: string
  title: string
  thumb_url: string | null
  source: string
  source_id: string | null
  source_url: string | null
  stream_url: string | null
  status: ClipJobStatus
  attempts: number
  error: string | null
  clip_id: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

/** What the Studio needs to draw a pending tile. */
export type ClipJobTile = Pick<ClipJob, 'id' | 'title' | 'thumb_url' | 'status' | 'error' | 'clip_id'>

/**
 * What a search panel hands over when the user clicks "use".
 *
 * `sourceUrl` is the stable PAGE url and `streamUrl` the CDN link resolved at
 * click time. Both are sent because they serve different purposes: the page url
 * lets the worker resolve a fresh stream on a retry, the stream url is the only
 * option for marketplace listings that cannot be re-resolved for free.
 */
export type QueueClipInput = {
  /** The platform's own id for this result - used to dedupe */
  id: string
  title: string
  thumbUrl?: string | null
  source: '1688' | 'tiktok' | 'facebook' | 'youtube' | 'link' | string
  sourceId?: string | null
  sourceUrl?: string | null
  streamUrl?: string | null
}

/**
 * Take ownership of a queued job.
 *
 * Uses the guarded-write rule from lib/guarded-write.ts: an update that matches
 * no rows comes back with `error === null`, so "no error" is not "it saved".
 * The `.select('id')` is what makes the database say whether this caller won the
 * race - without it two overlapping worker passes would both download the same
 * clip.
 */
export async function claimJob(admin: any, id: string): Promise<boolean> {
  const { data, error } = await admin
    .from('clip_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'queued') // whoever flips it first owns it
    .select('id')

  if (error) {
    console.log('[v0] clip-jobs claim error', id, error.message)
    return false
  }
  return (data || []).length === 1
}

/** Mark a job done and point it at the clip row it produced. */
export async function finishJob(admin: any, id: string, clipId: string | null) {
  await admin
    .from('clip_jobs')
    .update({
      status: 'done',
      clip_id: clipId,
      error: null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', id)
}

/**
 * Record a failure. Goes back to 'queued' while attempts remain so the next
 * worker pass retries it; parked as 'failed' once they are used up.
 */
export async function failJob(admin: any, job: ClipJob, message: string) {
  const attempts = (job.attempts ?? 0) + 1
  const exhausted = attempts >= MAX_ATTEMPTS
  await admin
    .from('clip_jobs')
    .update({
      status: exhausted ? 'failed' : 'queued',
      attempts,
      error: message.slice(0, 500),
      finished_at: exhausted ? new Date().toISOString() : null,
      started_at: null,
    })
    .eq('id', job.id)
}

/**
 * Hand jobs that died mid-download back to the queue.
 *
 * This is what makes the system self-healing without a cron: an invocation that
 * hit the 60s ceiling, or a deploy that cut one off, leaves a row stuck on
 * 'running'. Any later pass - including the one triggered by simply reopening
 * the dialog - picks it up.
 */
export async function requeueStale(admin: any) {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS).toISOString()

  const { data, error } = await admin
    .from('clip_jobs')
    .update({ status: 'queued', started_at: null })
    .eq('status', 'running')
    .lt('started_at', cutoff)
    .lt('attempts', MAX_ATTEMPTS)
    .select('id')
  if (error) console.log('[v0] clip-jobs requeue error', error.message)
  else if (data?.length) console.log('[v0] clip-jobs requeued stale', data.length)

  // A job that died mid-download on its LAST attempt is skipped by the requeue
  // above, so without this it would sit on 'running' forever and the feed would
  // show a spinner that can never finish - the very bug this table was built to
  // fix. Park it as failed so the tile explains itself and can be dismissed.
  const { data: given, error: giveUpError } = await admin
    .from('clip_jobs')
    .update({
      status: 'failed',
      started_at: null,
      finished_at: new Date().toISOString(),
      error: 'Download kept being interrupted - try again',
    })
    .eq('status', 'running')
    .lt('started_at', cutoff)
    .gte('attempts', MAX_ATTEMPTS)
    .select('id')
  if (giveUpError) console.log('[v0] clip-jobs give-up error', giveUpError.message)
  else if (given?.length) console.log('[v0] clip-jobs gave up on stale', given.length)
}
