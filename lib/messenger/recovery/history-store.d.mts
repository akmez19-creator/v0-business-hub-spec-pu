import type { Client } from 'pg'
export class PgHistoryStore {
  constructor(client: Client, options?: { dryRun?: boolean; clock?: () => number; leaseMs?: number; recentCycleMs?: number; reconcileRecentActivity?: boolean })
}
