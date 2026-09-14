import 'server-only'
import type { AutopilotDb } from './store'

export const HANDOFF_RELEASE_KEY = 'inbox:autopilot:handoff:v1'
export type HandoffRelease = {
  enabled: true; activatedAt: string; businessCodes: ['MBM', 'DBM']; journalMaxAgeSeconds: 600
}
export function parseHandoffRelease(cursor: unknown, now: number): HandoffRelease | null {
  if (typeof cursor !== 'string' || cursor.length > 1024 || !Number.isFinite(now)) return null
  try {
    const r = JSON.parse(cursor)
    if (!r || r.schema !== 1 || r.enabled !== true || r.journalMaxAgeSeconds !== 600 ||
      JSON.stringify(r.businessCodes) !== '["MBM","DBM"]' || typeof r.activatedAt !== 'string' ||
      !Number.isFinite(Date.parse(r.activatedAt)) || new Date(r.activatedAt).toISOString() !== r.activatedAt ||
      Date.parse(r.activatedAt) > now || Object.keys(r).sort().join(',') !== 'activatedAt,businessCodes,enabled,journalMaxAgeSeconds,schema') return null
    return { enabled: true, activatedAt: r.activatedAt, businessCodes: ['MBM', 'DBM'], journalMaxAgeSeconds: 600 }
  } catch { return null }
}
/** A missing rollout marker keeps all new ingestion hooks dormant. Database
 * failures are not treated as permission to send. No environment secrets here. */
export async function loadHandoffRelease(db: AutopilotDb): Promise<HandoffRelease | null> {
  const row = (await db.query('SELECT cursor,clock_timestamp() AS observed_at FROM public.inbox_sync_state WHERE key=$1', [HANDOFF_RELEASE_KEY])).rows[0]
  return parseHandoffRelease(row?.cursor, row?.observed_at instanceof Date ? row.observed_at.getTime() : Date.parse(row?.observed_at))
}
