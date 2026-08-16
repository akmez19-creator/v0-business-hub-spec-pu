'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { formatDistanceToNow } from 'date-fns'
import { Clock, Phone, RefreshCw, Search, Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ChannelUnavailable } from './channel-unavailable'

type Contact = {
  waId: string
  profileName: string | null
  displayPhone: string | null
  lastMessageAt: string | null
  lastSnippet: string | null
  unreadCount: number
  outsideWindow: boolean
}

type WaMessage = {
  id: string
  direction: 'in' | 'out'
  type: string
  body: string | null
  mediaId: string | null
  mediaMime: string | null
  status: string | null
  error: string | null
  createdAt: string
}

/**
 * Renders WhatsApp media through the authenticated proxy.
 *
 * The media id is NOT a URL: Cloud API media needs a server-side token
 * exchange, so everything is loaded via /api/inbox/whatsapp/media/[id].
 * Meta deletes media after 30 days, so a failure is expected over time and is
 * reported as expired rather than as a broken attachment.
 */
function WaMedia({ message }: { message: WaMessage }) {
  const [failed, setFailed] = useState(false)
  if (!message.mediaId) return null

  const src = `/api/inbox/whatsapp/media/${message.mediaId}`
  const mime = message.mediaMime ?? ''
  const kind = message.type

  if (failed) {
    return (
      <p className="text-xs opacity-70">
        Attachment unavailable — WhatsApp deletes media about 30 days after it is sent.
      </p>
    )
  }

  if (kind === 'image' || mime.startsWith('image/')) {
    return (
      // Not next/image: this is authenticated, non-optimizable proxied content.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src || '/placeholder.svg'}
        alt={message.body ?? 'Photo sent on WhatsApp'}
        onError={() => setFailed(true)}
        className="max-h-80 w-full rounded-lg object-contain"
      />
    )
  }

  if (kind === 'video' || mime.startsWith('video/')) {
    return (
      <video
        src={src}
        controls
        preload="metadata"
        onError={() => setFailed(true)}
        className="max-h-80 w-full rounded-lg bg-black"
      >
        Your browser cannot play this video.
      </video>
    )
  }

  if (kind === 'audio' || kind === 'voice' || mime.startsWith('audio/')) {
    return <audio src={src} controls preload="metadata" onError={() => setFailed(true)} className="w-64 max-w-full" />
  }

  return (
    <a href={src} target="_blank" rel="noreferrer" className="text-sm underline underline-offset-2">
      {message.body ?? 'Download attachment'}
    </a>
  )
}

type WaNumber = {
  id: string
  displayPhone: string
  verifiedName: string
  businessName: string
  platform: string
  usable: boolean
  subscribedApps: string[]
  oursSubscribed: boolean
}

type ListResponse = {
  success: boolean
  canSend?: boolean
  capability?: { available: boolean; missing: string[]; reason?: string } | null
  numbers?: WaNumber[]
  signatureVerified?: boolean
  hasVerifyToken?: boolean
  contacts?: Contact[]
  webhookPath?: string
  error?: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const relative = (iso: string | null) => {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  return t ? formatDistanceToNow(t, { addSuffix: true }) : ''
}

export function WhatsAppChannel({ origin }: { origin: string }) {
  const [selected, setSelected] = useState<Contact | null>(null)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const { data, isLoading, mutate, isValidating } = useSWR<ListResponse>('/api/inbox/whatsapp', fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  })

  const { data: thread, mutate: mutateThread } = useSWR<{ success: boolean; messages?: WaMessage[] }>(
    selected ? `/api/inbox/whatsapp?waId=${encodeURIComponent(selected.waId)}` : null,
    fetcher,
    { refreshInterval: 20_000 },
  )

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-6">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    )
  }

  const scopeMissing = data?.capability && !data.capability.available
  const numbers = data?.numbers ?? []
  const usableNumbers = numbers.filter((n) => n.usable)
  // The webhook is what makes messages arrive at all; the scope only governs
  // sending. Report them apart so the fix points at the right thing.
  const webhookReady = Boolean(data?.hasVerifyToken)

  if (scopeMissing || !webhookReady) {
    return (
      <ChannelUnavailable
        title={scopeMissing ? 'WhatsApp needs Cloud API access' : 'Connect the WhatsApp webhook'}
        description={
          scopeMissing
            ? data?.capability?.reason
            : `The token can reach ${usableNumbers.length} Cloud API number${usableNumbers.length === 1 ? '' : 's'}, but no webhook is receiving messages yet, so nothing can arrive.`
        }
        missing={data?.capability?.missing ?? []}
        steps={[
          'Set WHATSAPP_VERIFY_TOKEN in the project settings to any random string you choose.',
          `In the Meta app dashboard open WhatsApp > Configuration, set the callback URL to ${origin}/api/webhooks/whatsapp and paste the same verify token.`,
          'Subscribe to the "messages" webhook field, then click Verify and save.',
          'Repeat the subscription for each WhatsApp Business Account you want in this inbox — they are configured per account, not per app.',
        ]}
      >
        {usableNumbers.length > 0 ? (
          <div className="rounded-lg border border-border bg-muted/40 p-4">
            <p className="text-sm font-medium">
              {usableNumbers.length} number{usableNumbers.length === 1 ? '' : 's'} ready on the Cloud API
            </p>
            <ul className="mt-3 flex flex-col gap-2">
              {usableNumbers.map((n) => (
                <li key={n.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-muted-foreground">
                    {n.verifiedName} · {n.displayPhone}
                  </span>
                  {/* Routing truth, not a guess: a number can be live in
                      another tool and still deliver nothing here. */}
                  <span
                    className={
                      n.oursSubscribed
                        ? 'shrink-0 text-xs font-medium text-emerald-500'
                        : 'shrink-0 text-xs text-muted-foreground'
                    }
                  >
                    {n.oursSubscribed
                      ? 'delivering here'
                      : n.subscribedApps.length > 0
                        ? `goes to ${n.subscribedApps.join(', ')}`
                        : 'not delivering here'}
                  </span>
                </li>
              ))}
            </ul>
            {numbers.length > usableNumbers.length ? (
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                {numbers.length - usableNumbers.length} other number
                {numbers.length - usableNumbers.length === 1 ? ' is' : 's are'} not on the Cloud API and cannot be
                used here.
              </p>
            ) : null}
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground text-pretty">
              Subscribing this app is additive: WhatsApp delivers each message to every subscribed app, so an
              existing inbox such as respond.io keeps receiving exactly as it does now.
            </p>
          </div>
        ) : null}
        <div className="rounded-lg border border-border bg-muted/40 p-4">
          <p className="text-sm font-medium">Why WhatsApp starts empty</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground text-pretty">
            Unlike Messenger, the WhatsApp Cloud API has no endpoint for listing past conversations. Messages are
            delivered only by webhook, so this inbox fills from the moment it is connected and cannot show history
            from before then.
          </p>
        </div>
      </ChannelUnavailable>
    )
  }

  if (!data?.success) {
    return (
      <div className="flex flex-1 items-start p-6">
        <div className="w-full rounded-lg border border-destructive/40 bg-destructive/5 p-6">
          <p className="font-medium">Could not load WhatsApp</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{data?.error ?? 'Unknown error'}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => mutate()}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  const all = data.contacts ?? []
  const q = query.trim().toLowerCase()
  const contacts = q
    ? all.filter(
        (c) =>
          (c.profileName ?? '').toLowerCase().includes(q) ||
          c.waId.includes(q) ||
          (c.lastSnippet ?? '').toLowerCase().includes(q),
      )
    : all

  const send = async () => {
    if (!selected || !draft.trim()) return
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch('/api/inbox/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ waId: selected.waId, message: draft.trim() }),
      })
      const json = (await res.json()) as { success: boolean; error?: string }
      if (!json.success) throw new Error(json.error ?? 'Send failed')
      setDraft('')
      await Promise.all([mutateThread(), mutate()])
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  const messages = thread?.messages ?? []

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <div className="flex w-[380px] shrink-0 flex-col rounded-xl border border-border bg-card xl:w-[26vw] xl:max-w-[520px]">
        <div className="flex flex-col gap-3 border-b border-border p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">WhatsApp</h2>
            <Button variant="ghost" size="icon" onClick={() => mutate()} aria-label="Refresh" className="h-8 w-8">
              <RefreshCw className={`h-4 w-4 ${isValidating ? 'animate-spin' : ''}`} aria-hidden="true" />
            </Button>
          </div>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or number..."
              className="pl-9"
              aria-label="Search WhatsApp conversations"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {contacts.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-8 text-center">
              <Phone className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium">No messages yet</p>
              <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
                {all.length === 0
                  ? 'WhatsApp has no history API, so this list fills as new messages arrive at the webhook — it cannot show conversations from before it was connected.'
                  : 'Nothing matches that search'}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col">
              {contacts.map((c) => {
                const active = selected?.waId === c.waId
                return (
                  <li key={c.waId}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(c)
                        setSendError(null)
                      }}
                      aria-current={active ? 'true' : undefined}
                      className={`flex w-full flex-col gap-1 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-muted/50 ${
                        active ? 'bg-muted' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{c.profileName ?? `+${c.waId}`}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{relative(c.lastMessageAt)}</span>
                      </div>
                      <span className="truncate text-sm text-muted-foreground">{c.lastSnippet ?? 'No preview'}</span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {c.unreadCount > 0 ? (
                          <Badge variant="default" className="h-5 tabular-nums">
                            {c.unreadCount}
                          </Badge>
                        ) : null}
                        {c.outsideWindow ? (
                          <Badge variant="outline" className="h-5 border-amber-500/40 text-amber-500">
                            24h window closed
                          </Badge>
                        ) : null}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-border bg-card">
        {selected ? (
          <>
            <div className="flex items-center justify-between gap-4 border-b border-border p-4">
              <div className="flex min-w-0 flex-col">
                <h3 className="truncate font-semibold">{selected.profileName ?? `+${selected.waId}`}</h3>
                <p className="text-xs tabular-nums text-muted-foreground">+{selected.waId}</p>
              </div>
              {selected.outsideWindow ? (
                <Badge variant="outline" className="shrink-0 gap-1 border-amber-500/40 text-amber-500">
                  <Clock className="h-3 w-3" aria-hidden="true" />
                  24h window closed
                </Badge>
              ) : null}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <div className="flex flex-col gap-3">
                {/* Meta only delivers INBOUND messages to us: replies an agent
                    sent from Business Suite, respond.io or the phone app are
                    never mirrored back. A thread of purely inbound messages
                    therefore looks unanswered even when it was handled, so say
                    so - otherwise someone replies to the same customer twice. */}
                {messages.length > 0 && messages.every((m) => m.direction === 'in') ? (
                  <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-pretty text-muted-foreground">
                    Only messages from the customer are shown. Replies sent from Business Suite, respond.io or the
                    WhatsApp Business app aren&apos;t visible here, so this conversation may already have been answered.
                    Reply below to keep the full thread in this inbox.
                  </p>
                ) : null}
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      // Cap on MEASURE as well as percentage: 70% of a wide
                      // pane is a 1400px line nobody can read.
                      className={`flex max-w-[70%] flex-col gap-1 rounded-xl px-4 py-2.5 lg:max-w-[68ch] ${
                        m.direction === 'out' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                      }`}
                    >
                      {m.mediaId ? <WaMedia message={m} /> : null}
                      {/* Media often arrives with no caption, so an empty
                          paragraph would add a blank line under the player. */}
                      {m.body ? (
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-pretty">{m.body}</p>
                      ) : m.mediaId ? null : (
                        <p className="text-sm italic opacity-70">{m.type} message</p>
                      )}
                      <span className="text-[11px] opacity-70">
                        {relative(m.createdAt)}
                        {m.direction === 'out' && m.status ? ` · ${m.status}` : ''}
                      </span>
                    </div>
                  </div>
                ))}
                {messages.length === 0 ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">No messages in this conversation</p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-border p-4">
              {sendError ? <p className="text-sm text-destructive">{sendError}</p> : null}
              {selected.outsideWindow ? (
                <p className="text-xs leading-relaxed text-amber-500">
                  More than 24 hours have passed since this customer last wrote. WhatsApp will reject a free-form
                  reply — only an approved message template can be sent.
                </p>
              ) : null}
              <div className="flex items-end gap-2">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' || e.shiftKey) return
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return
                    e.preventDefault()
                    send()
                  }}
                  placeholder="Type a WhatsApp message..."
                  className="min-h-[44px] resize-none"
                  aria-label="WhatsApp reply"
                />
                <Button onClick={send} disabled={!draft.trim() || sending} aria-label="Send WhatsApp message">
                  <Send className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <Phone className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <p className="text-muted-foreground">Select a conversation to read and reply</p>
          </div>
        )}
      </div>
    </div>
  )
}
