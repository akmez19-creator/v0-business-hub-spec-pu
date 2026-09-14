import 'server-only'
import { connectInboxDatabase } from '@/lib/messenger/pg'
import { PgHistoryStore } from './history-store.mjs'
import { runRecovery } from './history-worker.mjs'

/** Server-owned scope/budgets. No browser or request input selects a Page, target or history mode. */
export async function reconcileRecentMessenger() {
  const client = await connectInboxDatabase()
  try {
    const store = new PgHistoryStore(client, { dryRun: false, recentCycleMs: 300_000, reconcileRecentActivity: true })
    return await runRecovery(store, {
      mode: 'recent', token: process.env.FACEBOOK_ACCESS_TOKEN,
      maxRequests: 20, maxSteps: 18, maxRunMs: 40_000, lookbackMs: 24 * 60 * 60 * 1000,
    })
  } finally { await client.end().catch(() => {}) }
}
