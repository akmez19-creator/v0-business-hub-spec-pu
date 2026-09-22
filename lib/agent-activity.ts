import { createAdminClient } from '@/lib/supabase/server'

/**
 * Timestamped footprints of an agent working the inbox. Entry Activity used to
 * see only order rows, so an agent who spent the morning answering customers
 * without raising a sale looked idle. Every recorder here is fire-and-forget:
 * a failed log must never fail the send it describes.
 */
export type AgentActivityKind =
  | 'inbox_reply'
  | 'inbox_open'
  | 'inbox_star'
  | 'inbox_unstar'
  | 'order_change'

export interface AgentActivityEvent {
  userId: string
  kind: AgentActivityKind
  threadKey?: string | null
  channel?: 'messenger' | 'whatsapp' | 'comment' | null
  detail?: string | null
}

export async function recordAgentActivity(event: AgentActivityEvent): Promise<void> {
  try {
    const db = createAdminClient()
    await db.from('agent_activity_events').insert({
      user_id: event.userId,
      kind: event.kind,
      thread_key: event.threadKey ?? null,
      channel: event.channel ?? null,
      detail: event.detail ? event.detail.slice(0, 500) : null,
    })
  } catch (err) {
    console.error('[agent-activity] record failed:', err instanceof Error ? err.message : err)
  }
}

export interface ActivityEventRow {
  user_id: string
  kind: AgentActivityKind
  thread_key: string | null
  channel: string | null
  detail: string | null
  created_at: string
}

export async function loadAgentActivity(
  fromIso: string,
  toIso: string,
  userIds?: string[],
): Promise<ActivityEventRow[]> {
  const db = createAdminClient()
  let q = db
    .from('agent_activity_events')
    .select('user_id, kind, thread_key, channel, detail, created_at')
    .gte('created_at', fromIso)
    .lt('created_at', toIso)
    .order('created_at', { ascending: true })
    .limit(20000)
  if (userIds?.length) q = q.in('user_id', userIds)
  const { data, error } = await q
  if (error) {
    console.error('[agent-activity] load failed:', error.message)
    return []
  }
  return (data ?? []) as ActivityEventRow[]
}
