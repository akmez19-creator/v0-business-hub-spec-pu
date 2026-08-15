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
  status: string | null
  error: string | null
  createdAt: string
}

type ListResponse = {
  success: boolean
  configured?: boolean
  canSend?: boolean
  capability?: { available: boolean; missing: string[]; reason?: string } | null
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
  const notConfigured = !data?.configured

  // Two independent failures with different fixes: the token can lack the
  // scope, and the deployment can lack a phone number / webhook. Saying
  // "WhatsApp unavailable" for both would send the user to fix the wrong one.
  if (scopeMissing || notConfigured) {
    return (
      <ChannelUnavailable
        title={scopeMissing ? 'WhatsApp needs Cloud API access' : 'WhatsApp is not connected yet'}
        description={
          scopeMissing
            ? data?.capability?.reason
            : 'The token looks usable, but this deployment has no WhatsApp phone number configured, so no messages can arrive or be sent.'
        }
        missing={data?.capability?.missing ?? []}
        steps={[
          'Confirm the number is on the WhatsApp Cloud API, not the WhatsApp Business phone app — the phone app has no API access at all, and migrating a number removes it from that app.',
          'In Meta Business Settings, open WhatsApp Accounts and copy the Phone number ID.',
          'Set WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN (any random string you choose) and FACEBOOK_APP_SECRET in the project settings.',
          `Add the webhook URL ${origin}/api/webhooks/whatsapp in the app's WhatsApp configuration, using the same verify token, and subscribe to the "messages" field.`,
          'Regenerate FACEBOOK_ACCESS_TOKEN with whatsapp_business_messaging, keeping every existing scope including ads_management.',
        ]}
      >
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
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      // Cap on MEASURE as well as percentage: 70% of a wide
                      // pane is a 1400px line nobody can read.
                      className={`flex max-w-[70%] flex-col gap-1 rounded-xl px-4 py-2.5 lg:max-w-[68ch] ${
                        m.direction === 'out' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                      }`}
                    >
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-pretty">
                        {m.body ?? `[${m.type}]`}
                      </p>
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
