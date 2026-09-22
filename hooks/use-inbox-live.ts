'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type InboxLiveChannel = 'messenger' | 'whatsapp'
export type InboxLiveStatus = 'subscribed' | 'not-connected'
type Client = ReturnType<typeof createClient>
const CHANNELS: InboxLiveChannel[] = ['messenger', 'whatsapp']

/**
 * Version polling instead of Realtime `postgres_changes`.
 *
 * Realtime's WAL polling (`realtime.list_changes`) was 54% of all database time on
 * this project (7M calls since February) and starved the Micro instance. Reading the
 * two-row `inbox_live_events` table by primary key every few seconds costs a few
 * microseconds per staff tab and needs no WAL decoding, publication or Realtime RLS.
 *
 * Injectable lifecycle for focused tests; contains no message data.
 */
export function connectInboxLive(client: Client, options: {
  onInvalidate: (channels: InboxLiveChannel[]) => void
  onStatus: (status: InboxLiveStatus) => void
  onEventReceived?: (receivedAt: number) => void
  pollMs?: number
  hiddenPollMs?: number
  isVisible?: () => boolean
}) {
  let disposed = false
  let inFlight = false
  let signedIn = false
  let healthy = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const seen = new Map<InboxLiveChannel, string>()
  const pollMs = options.pollMs ?? 10_000
  const hiddenPollMs = options.hiddenPollMs ?? 60_000
  const visible = options.isVisible ?? (() => typeof document === 'undefined' || document.visibilityState === 'visible')
  const status = () => { if (!disposed) options.onStatus(signedIn && healthy ? 'subscribed' : 'not-connected') }
  const schedule = (delay: number) => {
    if (disposed) return
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => { timer = undefined; void poll() }, delay)
  }
  const poll = async () => {
    if (disposed || inFlight) return
    inFlight = true
    try {
      const { data: auth } = await client.auth.getSession()
      if (disposed) return
      signedIn = !!auth.session?.access_token
      // A signed-out client waits for an auth event instead of polling for a token.
      if (!signedIn) { healthy = false; status(); return }
      const { data, error } = await client.from('inbox_live_events').select('channel,version,updated_at')
      if (disposed) return
      if (error || !data || !CHANNELS.every(value => data.some(row => row.channel === value))) {
        healthy = false
        status()
        schedule(pollMs * 3)
        return
      }
      const changed: InboxLiveChannel[] = []
      for (const row of data) {
        const channel = row.channel as InboxLiveChannel
        if (!CHANNELS.includes(channel)) continue
        const stamp = String(row.version) + ':' + String(row.updated_at)
        const previous = seen.get(channel)
        seen.set(channel, stamp)
        // The first poll only records the baseline; the caller already loaded fresh data.
        if (previous !== undefined && previous !== stamp) changed.push(channel)
      }
      healthy = true
      status()
      if (changed.length) {
        // Receipt time proves an actual event, not a successful health check.
        options.onEventReceived?.(Date.now())
        options.onInvalidate(changed)
      }
      schedule(visible() ? pollMs : hiddenPollMs)
    } catch {
      if (disposed) return
      healthy = false
      status()
      schedule(pollMs * 3)
    } finally {
      inFlight = false
    }
  }
  const recover = () => {
    if (disposed) return
    // Anything missed while hidden/offline is reconciled by the caller's own refetch.
    options.onInvalidate(CHANNELS)
    schedule(0)
  }
  // Avoid doing additional auth operations inside Supabase's auth callback.
  const auth = client.auth.onAuthStateChange(() => { queueMicrotask(() => { if (!disposed) schedule(0) }) })
  status()
  schedule(0)
  return {
    recover,
    disconnect() {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      seen.clear()
      auth.data.subscription.unsubscribe()
    },
  }
}

/** Keep the normal fallback polling whenever isLive is false; retain a slow safety poll when true. */
export function useInboxLive({ active = true, onInvalidate }: {
  active?: boolean
  onInvalidate: (channels: InboxLiveChannel[]) => void
}) {
  const [status, setStatus] = useState<InboxLiveStatus>('not-connected')
  const [lastEventAt, setLastEventAt] = useState<number | null>(null)
  const callback = useRef(onInvalidate)
  useEffect(() => { callback.current = onInvalidate }, [onInvalidate])
  useEffect(() => {
    setStatus('not-connected')
    if (!active) return
    let live: ReturnType<typeof connectInboxLive>
    try {
      live = connectInboxLive(createClient(), { onInvalidate: channels => callback.current(channels),
        onStatus: setStatus, onEventReceived: setLastEventAt })
    } catch { return }
    const focus = () => { if (document.visibilityState === 'visible') live.recover() }
    window.addEventListener('focus', focus)
    window.addEventListener('online', live.recover)
    document.addEventListener('visibilitychange', focus)
    return () => {
      window.removeEventListener('focus', focus)
      window.removeEventListener('online', live.recover)
      document.removeEventListener('visibilitychange', focus)
      live.disconnect()
    }
  }, [active])
  return { status, isLive: active && status === 'subscribed', lastEventAt }
}
