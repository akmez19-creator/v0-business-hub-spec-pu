import type { PgHistoryStore } from './history-store.mjs'
export type RecoveryReport = {
  mode: string; dryRun: boolean; requests: number; attemptedPages: number; committedPages: number;
  inserted: number; enriched: number; unchanged: number; halted: string | null; queuedWorkComplete: boolean;
  errors: { pageId: string; kind: string; code: number | null; retryable: boolean }[];
  pages: { pageId: string; pending: number; complete?: number; blocked: number; capped: number }[];
  [key: string]: unknown;
}
export function runRecovery(store: PgHistoryStore, options?: {
  mode?: 'recent' | 'target' | 'history'; token?: string; maxRequests?: number; maxSteps?: number;
  maxRunMs?: number; lookbackMs?: number; clock?: () => number; artifact?: unknown;
}): Promise<RecoveryReport>
