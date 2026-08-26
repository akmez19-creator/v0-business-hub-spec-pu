'use client'

/**
 * Writes that refuse to fail quietly.
 *
 * THE BUG THIS EXISTS FOR
 * The storekeeper works on a phone that sleeps between scans. While it sleeps
 * the Supabase session can expire. When he wakes it and taps a product:
 *
 *   await supabase.from('deliveries').update({ stock_out: true }).in('id', ids)
 *
 * ...returns HTTP 204 with `error === null` and writes NOTHING. Verified
 * against the live table: 0 rows changed, no error raised. RLS does not reject
 * the statement, it just matches no rows - so "no error" is not "it saved".
 *
 * The UI had already ticked optimistically, so he carried on down the list.
 * Every later tap failed the same silent way. The moment anything triggered a
 * reload he was bounced to login, and because the page re-seeds its ticks from
 * `stock_out` in the database, all of his work was simply gone.
 *
 * THE RULE
 * Never trust `error === null` on an update. Ask the write which rows it
 * touched (`.select('id')`) and treat "fewer rows than expected" as a failure.
 */

export type WriteOutcome =
  | { ok: true; rows: number }
  | { ok: false; reason: 'auth' | 'partial' | 'error'; message: string; rows: number }

/**
 * Runs an update over `ids` and confirms the database really changed them.
 *
 * `expected` defaults to every id passed in: a stock_out toggle addresses rows
 * by primary key, so anything less than all of them means the write was
 * rejected rather than merely a no-op.
 */
export async function guardedUpdate(
  supabase: any,
  table: string,
  ids: string[],
  patch: Record<string, unknown>,
): Promise<WriteOutcome> {
  if (ids.length === 0) return { ok: true, rows: 0 }

  const { data, error } = await supabase
    .from(table)
    .update(patch)
    .in('id', ids)
    .select('id') // the whole point: make the server tell us what it touched

  if (error) {
    // 401/403 mean the session died; everything else is a genuine fault.
    const status = String((error as any).code ?? '')
    const authish = status === '401' || status === '403' ||
      /jwt|token|expired|not authenticated/i.test(error.message || '')
    return {
      ok: false,
      reason: authish ? 'auth' : 'error',
      message: error.message || 'Write failed',
      rows: 0,
    }
  }

  const rows = (data || []).length
  if (rows < ids.length) {
    // The silent case. No error, but the rows did not change - almost always an
    // expired session, occasionally a policy that no longer matches.
    return {
      ok: false,
      reason: rows === 0 ? 'auth' : 'partial',
      message:
        rows === 0
          ? 'Your session has expired, so nothing was saved.'
          : `Only ${rows} of ${ids.length} rows saved.`,
      rows,
    }
  }

  return { ok: true, rows }
}

/**
 * Is the session still good?
 *
 * `getUser()` goes to the auth server rather than reading the stored token, so
 * it reflects a session that expired while the device was asleep. Called when
 * the phone wakes, before the storekeeper taps anything.
 */
export async function sessionIsAlive(supabase: any): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getUser()
    return !error && !!data?.user
  } catch {
    return false
  }
}
