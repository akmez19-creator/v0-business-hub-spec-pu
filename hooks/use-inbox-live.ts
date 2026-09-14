'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type InboxLiveChannel = 'messenger' | 'whatsapp'
export type InboxLiveStatus = 'subscribed' | 'not-connected'
type Client = ReturnType<typeof createClient>
const CHANNELS: InboxLiveChannel[] = ['messenger', 'whatsapp']

/** Injectable lifecycle for focused reconnect/cleanup tests; contains no message data. */
export function connectInboxLive(client: Client, options: {
  onInvalidate: (channels: InboxLiveChannel[]) => void
  onStatus: (status: InboxLiveStatus) => void
  onEventReceived?: (receivedAt: number) => void
  debounceMs?: number
}) {
  let disposed = false
  let generation = 0
  let readinessSequence = 0
  let socketReady = false
  let configurationReady = false
  let debounce: ReturnType<typeof setTimeout> | undefined
  let retry: ReturnType<typeof setTimeout> | undefined
  let channel: ReturnType<Client['channel']> | undefined
  const pending = new Set<InboxLiveChannel>()
  const status = () => { if (!disposed) options.onStatus(socketReady && configurationReady ? 'subscribed' : 'not-connected') }
  const invalidate = (channels: InboxLiveChannel[] = CHANNELS) => {
    if (disposed) return
    channels.forEach(value => pending.add(value))
    if (debounce !== undefined) return
    debounce = setTimeout(() => {
      debounce = undefined
      const changed = [...pending]
      pending.clear()
      if (!disposed && changed.length) options.onInvalidate(changed)
    }, options.debounceMs ?? 300)
  }
  const scheduleRecovery = (token: number) => {
    if (disposed || token !== generation || retry !== undefined) return
    retry = setTimeout(() => {
      retry = undefined
      if (disposed || token !== generation) return
      if (socketReady) void checkReady(token)
      else void reconnect()
    }, 15_000)
  }
  const checkReady = async (token: number) => {
    const sequence = ++readinessSequence
    try {
      // Socket SUBSCRIBED alone does not prove publication, trigger or RLS readiness.
      const [readiness, rows] = await Promise.all([
        client.rpc('inbox_live_ready'),
        client.from('inbox_live_events').select('channel,version,updated_at'),
      ])
      if (disposed || token !== generation || sequence !== readinessSequence) return
      configurationReady = !readiness.error && readiness.data === true && !rows.error &&
        CHANNELS.every(value => rows.data?.some(row => row.channel === value))
      if (!configurationReady) scheduleRecovery(token)
      else if (socketReady && retry !== undefined) { clearTimeout(retry); retry = undefined }
      status()
    } catch {
      if (disposed || token !== generation || sequence !== readinessSequence) return
      configurationReady = false
      status()
      scheduleRecovery(token)
    }
  }
  const reconnect = async () => {
    const token = ++generation
    socketReady = false
    configurationReady = false
    status()
    if (retry !== undefined) { clearTimeout(retry); retry = undefined }
    const oldChannel = channel
    channel = undefined
    if (oldChannel) void client.removeChannel(oldChannel)
    try {
      const { data, error } = await client.auth.getSession()
      if (disposed || token !== generation) return
      if (error) { scheduleRecovery(token); return }
      // A signed-out client waits for an auth event instead of polling for a token.
      if (!data.session?.access_token) return
      await client.realtime.setAuth(data.session.access_token)
      if (disposed || token !== generation) return
      channel = client.channel('inbox-live-' + Math.random().toString(36).slice(2))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'inbox_live_events' }, (payload) => {
          if (disposed || token !== generation) return
          const changed = payload.new?.channel
          if (changed === 'messenger' || changed === 'whatsapp') {
            // Receipt time proves an actual event, not a successful health check.
            // This contains no customer data and may update while the view is hidden.
            options.onEventReceived?.(Date.now())
            invalidate([changed])
          }
        })
        .subscribe((state) => {
          if (disposed || token !== generation) return
          socketReady = state === 'SUBSCRIBED'
          if (socketReady) {
            if (retry !== undefined) { clearTimeout(retry); retry = undefined }
            invalidate() // Reconcile anything missed before subscription/reconnection.
            void checkReady(token)
          } else {
            configurationReady = false
            if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
              scheduleRecovery(token)
            }
          }
          status()
        })
      void checkReady(token)
    } catch {
      if (!disposed && token === generation) { configurationReady = false; status(); scheduleRecovery(token) }
    }
  }
  const recover = () => {
    if (disposed) return
    invalidate()
    if (!socketReady) void reconnect()
    else void checkReady(generation)
  }
  // Avoid doing additional auth operations inside Supabase's auth callback.
  const auth = client.auth.onAuthStateChange(() => { queueMicrotask(() => { if (!disposed) void reconnect() }) })
  void reconnect()
  return {
    recover,
    disconnect() {
      disposed = true
      generation += 1
      if (debounce !== undefined) clearTimeout(debounce)
      if (retry !== undefined) clearTimeout(retry)
      pending.clear()
      auth.data.subscription.unsubscribe()
      if (channel) void client.removeChannel(channel)
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
