'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Inbox, MessageCircle, MessageSquareText, Phone, Target } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { AllMessagesChannel } from './all-messages-channel'
import { LeadsChannel } from './leads-channel'
import { MessengerChannel } from './messenger-channel'
import { CommentsChannel } from './comments-channel'
import { WhatsAppChannel } from './whatsapp-channel'

type ChannelId = 'leads' | 'all' | 'messenger' | 'comments' | 'whatsapp'

type CapabilityState = { id: string; label: string; available: boolean; missing: string[]; reason?: string }

type CapabilitiesResponse = {
  success: boolean
  scopes?: string[]
  expiresAt?: number | null
  channels?: Record<ChannelId, CapabilityState>
  whatsappConfigured?: boolean
  error?: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const CHANNELS: { id: ChannelId; label: string; icon: typeof MessageCircle; hint: string }[] = [
  { id: 'leads', label: 'Leads', icon: Target, hint: 'By stage, product, ad' },
  { id: 'all', label: 'All messages', icon: Inbox, hint: 'Messenger + WhatsApp' },
  { id: 'messenger', label: 'Messenger', icon: MessageCircle, hint: 'Page inbox' },
  { id: 'comments', label: 'Comments', icon: MessageSquareText, hint: 'Post replies' },
  { id: 'whatsapp', label: 'WhatsApp', icon: Phone, hint: 'Cloud API' },
]

export function InboxWorkspace({ origin }: { origin: string }) {
  const [active, setActive] = useState<ChannelId>('leads')
  /** Thread to preselect after jumping out of the unified list. */
  const [jumpTo, setJumpTo] = useState<{ channel: 'messenger' | 'whatsapp'; id: string } | null>(
    null,
  )

  const { data: caps } = useSWR<CapabilitiesResponse>('/api/inbox/capabilities', fetcher, {
    refreshInterval: 5 * 60_000,
  })

  // Counts share SWR keys with the channels themselves, so switching tabs is
  // instant and the rail costs no extra Graph calls. A channel whose scope is
  // missing short-circuits server-side before any Page fetch, so an
  // unavailable channel is effectively free to poll.
  const { data: messenger } = useSWR<{
    conversations?: { unreadCount: number; lastFromCustomer?: boolean }[]
  }>('/api/inbox?pageId=all', fetcher, { refreshInterval: 60_000 })
  const { data: comments } = useSWR<{ comments?: { needsReply: boolean }[] }>(
    '/api/inbox/comments?pageId=all',
    fetcher,
    { refreshInterval: 90_000 },
  )
  const { data: whatsapp } = useSWR<{ contacts?: { unreadCount: number }[] }>('/api/inbox/whatsapp', fetcher, {
    refreshInterval: 60_000,
  })

  const messengerUnread = (messenger?.conversations ?? []).filter((c) => c.unreadCount > 0).length
  const whatsappUnread = (whatsapp?.contacts ?? []).filter((c) => c.unreadCount > 0).length

  const counts: Record<ChannelId, number> = {
    // Leads badges what is actually waiting on a human, across every channel:
    // customers who spoke last, plus comments nobody has answered.
    leads:
      (messenger?.conversations ?? []).filter((c) => c.lastFromCustomer).length +
      (comments?.comments ?? []).filter((c) => c.needsReply).length,
    // "All" counts the two message channels only - comments are a different
    // surface and already have their own badge.
    all: messengerUnread + whatsappUnread,
    messenger: (messenger?.conversations ?? []).filter((c) => c.unreadCount > 0).length,
    comments: (comments?.comments ?? []).filter((c) => c.needsReply).length,
    whatsapp: (whatsapp?.contacts ?? []).filter((c) => c.unreadCount > 0).length,
  }

  return (
    <div className="flex h-[calc(100vh-9rem)] gap-4 p-6 pt-0">
      {/* Channel rail */}
      <nav aria-label="Inbox channels" className="flex w-[220px] shrink-0 flex-col gap-1">
        {CHANNELS.map((c) => {
          const Icon = c.icon
          const isActive = active === c.id
          const state = caps?.channels?.[c.id]
          // Only claim a channel is unavailable once capabilities have loaded;
          // "unknown" must not render as "broken".
          const unavailable = state ? !state.available : false
          const count = counts[c.id]

          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setActive(c.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                isActive
                  ? 'border-border bg-card text-foreground'
                  : 'border-transparent text-muted-foreground hover:bg-card/60 hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-medium">{c.label}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {unavailable ? 'Needs permission' : c.hint}
                </span>
              </span>
              {count > 0 ? (
                <Badge variant="default" className="h-5 shrink-0 tabular-nums">
                  {count}
                </Badge>
              ) : unavailable ? (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                  aria-label="Needs permission"
                />
              ) : null}
            </button>
          )
        })}

        {caps?.expiresAt === 0 ? (
          <p className="mt-auto px-3 text-xs leading-relaxed text-muted-foreground">
            Access token does not expire
          </p>
        ) : null}
      </nav>

      {/* Active channel. Each channel owns its own list + detail panes. */}
      {active === 'leads' ? (
        <LeadsChannel
          onOpen={(channel, nativeId) => {
            if (channel === 'comment') {
              setActive('comments')
              return
            }
            setJumpTo({ channel, id: nativeId })
            setActive(channel)
          }}
        />
      ) : null}
      {active === 'all' ? (
        <AllMessagesChannel
          onOpen={(channel, nativeId) => {
            // Hand off to the owning channel, which has the reply box and the
            // channel-specific rules (24h window, media proxy, page token).
            // The comments tab is keyed 'comments' but a lead's channel is the
            // singular 'comment', so map it rather than leaving a dead click.
            if (channel === 'comment') {
              setActive('comments')
              return
            }
            setJumpTo({ channel, id: nativeId })
            setActive(channel)
          }}
        />
      ) : null}
      {active === 'messenger' ? (
        <MessengerChannel initialConversationId={jumpTo?.channel === 'messenger' ? jumpTo.id : null} />
      ) : null}
      {active === 'comments' ? <CommentsChannel /> : null}
      {active === 'whatsapp' ? (
        <WhatsAppChannel
          origin={origin}
          initialWaId={jumpTo?.channel === 'whatsapp' ? jumpTo.id : null}
        />
      ) : null}
    </div>
  )
}
