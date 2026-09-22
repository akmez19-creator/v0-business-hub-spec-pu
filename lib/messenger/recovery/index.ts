import 'server-only'
import { connectInboxDatabase } from '@/lib/messenger/pg'
import { PgHistoryStore } from './history-store.mjs'
import { runRecovery } from './history-worker.mjs'

/** Server-owned scope/budgets. No browser or request input selects a Page, target or history mode. */
export async function reconcileRecentMessenger() {
  const client = await connectInboxDatabase()
  try {
    // recentCycleMs matches the 60s cron schedule: a thread already complete is not re-read
    // within the same minute, so the budget goes to threads that have never been read.
    const store = new PgHistoryStore(client, { dryRun: false, recentCycleMs: 60_000, reconcileRecentActivity: true })
    return await runRecovery(store, {
      mode: 'recent', token: process.env.FACEBOOK_ACCESS_TOKEN,
      maxRequests: 45, maxSteps: 40, maxRunMs: 45_000, lookbackMs: 24 * 60 * 60 * 1000,
    })
  } finally { await client.end().catch(() => {}) }
}
