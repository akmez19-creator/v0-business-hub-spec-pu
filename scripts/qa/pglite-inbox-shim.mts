// QA replacement for lib/messenger/pg.ts. The harness publishes its PGlite client on globalThis before any
// production module asks for a connection; `end` is a no-op so per-call `withDb` wrappers do not close it.
type QaDb = { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; end: () => Promise<void> }

export async function connectInboxDatabase(): Promise<QaDb> {
  const db = (globalThis as { __qaInboxDb?: QaDb }).__qaInboxDb
  if (!db) throw new Error('QA PGlite database not initialised before a production module connected')
  return db
}
