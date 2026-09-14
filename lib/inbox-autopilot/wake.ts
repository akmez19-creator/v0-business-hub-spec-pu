import 'server-only'
import { after } from 'next/server'
import { AUTOPILOT_BUSINESSES, type BusinessKey } from './contract'

/** Request-local notification only: callers add verified, committed live inbound events.
 * No transcript or provider credentials cross this boundary. The existing worker
 * rereads ownership, history, pause controls, caps and leased jobs before any send.
 */
export function createAutopilotWake() {
  const businesses = new Set<BusinessKey>()
  let scheduled = false
  return {
    add(channel: 'messenger' | 'whatsapp', owner: string) {
      for (const key of ['made_by_moris', 'destockage'] as const) {
        const business = AUTOPILOT_BUSINESSES[key]
        if ((channel === 'messenger' ? business.pageId : business.phoneNumberId) === owner) businesses.add(key)
      }
    },
    /** Call only after the entire webhook batch has been durably accepted. */
    schedule() {
      if (scheduled || businesses.size === 0 || process.env.VERCEL_ENV !== 'production') return
      scheduled = true
      const keys = [...businesses]
      try {
        after(async () => {
          try {
            const { runAutopilot } = await import('./runtime')
            await Promise.all(keys.map(async key => {
              try { await runAutopilot(key) }
              catch { console.error('[autopilot] Deferred inbox check failed', key) }
            }))
          } catch { console.error('[autopilot] Deferred inbox worker unavailable') }
        })
      } catch {
        // A scheduling failure must not turn a committed provider delivery into
        // an ingestion failure. The scheduled worker can discover it in storage.
        console.error('[autopilot] Deferred inbox check unavailable')
      }
    },
  }
}
