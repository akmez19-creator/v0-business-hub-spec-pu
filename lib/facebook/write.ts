// Shared Facebook WRITE helper.
//
// This retry/backoff logic was worked out the hard way in
// app/api/facebook-ads/duplicate/route.ts. Extracted so the ad-test harness and
// the post->boost scheduler reuse the exact same behaviour instead of growing
// their own slightly-different copies that drift apart over time.

export interface FbError {
  message?: string
  code?: number
  error_subcode?: number
  error_user_title?: string
  error_user_msg?: string
}

export type FbJson = Record<string, unknown> & { error?: FbError }

// Facebook throttling codes (#4 app-level, #17 user-level, #32 page-level,
// #613 custom, 8000x ads-specific). Writes retry through these with backoff so
// a batch never dies halfway because the hourly window was momentarily full.
export const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004])

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function fbPostJson(
  url: string,
  payload: Record<string, unknown>,
  waits: number[] = [2000, 8000, 30000],
): Promise<{ ok: boolean; json: FbJson }> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const json = (await res.json().catch(() => ({}))) as FbJson
    if (res.ok && !json.error) return { ok: true, json }
    const code = json.error?.code
    if (attempt < waits.length && code !== undefined && RATE_LIMIT_CODES.has(code)) {
      await sleep(waits[attempt])
      continue
    }
    return { ok: false, json }
  }
}

/**
 * Turn a Facebook error into something a human can act on.
 *
 * The development-mode case is the important one: Facebook reports it as
 * several unrelated-sounding errors ("Post has no media", "Page post can't be
 * used", "Invalid destination type") depending on where validation trips, and
 * none of them hint at the actual cause.
 */
export function fbDetail(err: FbError | undefined): string {
  if (
    err?.error_subcode === 1885183 ||
    err?.error_subcode === 1487472 ||
    /development mode/i.test(err?.error_user_msg || '')
  ) {
    return (
      'This post was published by your Meta app while it is in Development Mode, so Facebook refuses to run ads on it. ' +
      'Fix: open developers.facebook.com > your app > switch the app from Development to Live mode. ' +
      'Posts published after the switch will be boostable.'
    )
  }
  return [err?.error_user_title, err?.error_user_msg].filter(Boolean).join(': ') || err?.message || ''
}
