'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

/**
 * Who else has which lead open right now. Two agents (or an agent and the
 * admin) answering the same customer at once is the failure this prevents:
 * the customer gets two replies, or two orders. Built on Supabase Realtime
 * Presence - nothing is written to a table; a tab that closes or loses its
 * connection drops out of the roster on its own.
 */
export type InboxViewer = { id: string; name: string }
export type PresenceEntry = { userId: string; name: string; threadKey: string | null; since: number }

const CHANNEL = 'inbox-presence'

export function useInboxPresence(viewer: InboxViewer | null, threadKey: string | null) {
  const [roster, setRoster] = useState<PresenceEntry[]>([])
  const channelRef = useRef<RealtimeChannel | null>(null)
  const sinceRef = useRef<{ key: string | null; at: number }>({ key: null, at: Date.now() })

  useEffect(() => {
    if (!viewer) return
    const client = createClient()
    const channel = client.channel(CHANNEL, { config: { presence: { key: viewer.id } } })
    channelRef.current = channel
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<PresenceEntry>()
        const entries: PresenceEntry[] = []
        for (const key of Object.keys(state)) {
          // Several tabs of one user share a key; the newest one speaks for them.
          const newest = [...state[key]].sort((a, b) => b.since - a.since)[0]
          if (newest) entries.push(newest)
        }
        setRoster(entries)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void channel.track({ userId: viewer.id, name: viewer.name, threadKey: sinceRef.current.key, since: sinceRef.current.at } satisfies PresenceEntry)
        }
      })
    return () => {
      channelRef.current = null
      void client.removeChannel(channel)
    }
  }, [viewer?.id, viewer?.name]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!viewer) return
    if (sinceRef.current.key !== threadKey) sinceRef.current = { key: threadKey, at: Date.now() }
    const channel = channelRef.current
    if (!channel || channel.state !== 'joined') return
    void channel.track({ userId: viewer.id, name: viewer.name, threadKey, since: sinceRef.current.at } satisfies PresenceEntry)
  }, [threadKey, viewer])

  // Everyone but me, grouped by the lead they have open.
  const byThread = useMemo(() => {
    const map = new Map<string, PresenceEntry[]>()
    for (const entry of roster) {
      if (!entry.threadKey || entry.userId === viewer?.id) continue
      const list = map.get(entry.threadKey) ?? []
      list.push(entry)
      map.set(entry.threadKey, list)
    }
    return map
  }, [roster, viewer?.id])

  const online = useMemo(() => roster.filter((e) => e.userId !== viewer?.id).length, [roster, viewer?.id])

  return { byThread, online }
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}
