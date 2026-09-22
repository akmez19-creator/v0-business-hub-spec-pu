'use client'

import { useEffect, useRef, useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { formatDistanceToNow } from 'date-fns'
import { Clock, ExternalLink, History, Megaphone, Phone, RefreshCw, Search, Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { ChannelUnavailable } from './channel-unavailable'
import { whatsappAcceptedWarning } from './inbox-behavior'
import { whatsappConversationKey, whatsappIdentity, whatsappReplyUnavailable, whatsappTranscriptKey } from '@/lib/inbox/whatsapp-identity'
import { matchesPhone, searchText, searchWords } from '@/lib/inbox/unified'

type Contact = {
  waId: string
  phoneNumberId?: string | null
  businessName?: string | null
  pageId?: string | null
  canSend?: boolean
  unreadStateKnown?: boolean
  profileName: string | null
  displayPhone: string | null
  lastMessageAt: string | null
  lastSnippet: string | null
  unreadCount: number
  outsideWindow: boolean
  /** First-touch ad attribution; null when the customer messaged organically. */
  firstAdId: string | null
  /** Real ad name. Preferred over firstAdHeadline, which is just the page name. */
  firstAdName: string | null
  firstAdHeadline: string | null
  firstAdSourceUrl: string | null
  firstAdAt: string | null
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

type SyncResponse = {
  success: boolean
  summary?: string
  requested?: number
  results?: { id: string; displayPhone: string; verifiedName: string; requested: boolean; detail: string }[]
  error?: string
}

/** Reject failures so SWR retains saved data, with a bound on a stalled read. */
async function fetcher(url: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45_000)
  try {
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
    const body = await response.json().catch(() => null)
    if (!response.ok || !body || body.success === false) {
      throw new Error(body?.error || (response.status === 401
        ? 'Please sign in again to load WhatsApp.'
        : 'WhatsApp could not load. Please try again.'))
    }
    return body
  } catch (error) {
    if (controller.signal.aborted) throw new Error('WhatsApp took too long to respond. Please try again.')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function mergeWhatsAppData(meta?: ListResponse, list?: ListResponse): ListResponse | undefined {
  if (!meta && !list) return undefined
  return {
    success: Boolean((list ?? meta)?.success),
    contacts: list?.contacts ?? meta?.contacts,
    capability: meta?.capability ?? null,
    numbers: meta?.numbers,
    canSend: meta?.canSend,
    hasVerifyToken: meta?.hasVerifyToken ?? list?.hasVerifyToken,
    signatureVerified: meta?.signatureVerified ?? list?.signatureVerified,
    webhookPath: meta?.webhookPath ?? list?.webhookPath,
    error: list?.error ?? meta?.error,
  }
}

function whatsappMessageBody(message: WaMessage): string | null {
  // A legacy status placeholder is not evidence of the sending app.
  return message.type === 'external' && message.body === 'Replied from another app' ? null : message.body
}

type WhatsAppDraft = { text: string; version: number }
function completeWhatsAppDraft(draft: WhatsAppDraft, submittedVersion: number): WhatsAppDraft {
  return draft.version === submittedVersion ? { text: '', version: draft.version + 1 } : draft
}

const relative = (iso: string | null) => {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  return t ? formatDistanceToNow(t, { addSuffix: true }) : ''
}

export function WhatsAppChannel({
  origin,
  initialWaId = null,
  initialPhoneNumberId = null,
}: {
  origin: string
  /** Thread to open on mount, set when arriving from the unified inbox. */
  initialWaId?: string | null
  initialPhoneNumberId?: string | null
}) {
  const [selected, setSelected] = useState<Contact | null>(null)
  const [query, setQuery] = useState('')
  /**
   * Business-Suite-style ad filter. 'all' shows everything, 'ads' shows only
   * ad-sourced threads, and any other value is a specific ad id so a campaign
   * can be reviewed on its own.
   */
  const [adFilter, setAdFilter] = useState<'all' | 'ads' | string>('all')
  const [drafts, setDrafts] = useState<Record<string, WhatsAppDraft>>({})
  const selectedKey = selected ? whatsappConversationKey(selected) : null
  const draftState = selectedKey ? drafts[selectedKey] : undefined
  const draft = draftState?.text ?? ''
  const selectedId = useRef<string | null>(null)
  selectedId.current = selectedKey
  const replyUnavailable = selected ? whatsappReplyUnavailable(selected) : null
  const sendingRef = useRef(false)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<SyncResponse | null>(null)
  const { mutate: mutateCache } = useSWRConfig()
  const { toast } = useToast()

  // Two requests against one route, deliberately.
  //
  // `?meta=1` triggers ~6 Graph calls (business + WABA + phone-number
  // discovery, debug_token) to learn which numbers can send. Those answers
  // change about monthly, but polling them every 30s burned over a thousand
  // API calls a day against the app's rate limit. So capability is fetched
  // once per page load and never refreshed on a timer, while the contact
  // list - which is pure Postgres and free - keeps polling.
  const { data: meta, error: metaError, mutate: mutateMeta, isValidating: checkingMeta } = useSWR<ListResponse>('/api/inbox/whatsapp?meta=1', fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    shouldRetryOnError: false,
    refreshInterval: 0,
  })

  const { data: list, error: listError, isLoading, mutate, isValidating } = useSWR<ListResponse>('/api/inbox/whatsapp', fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  })

  // Capability fields come from the meta request only, contacts from the
  // polling one. Spreading `list` over `meta` wholesale would overwrite
  // capability with the undefined keys the contacts response omits.
  const data = mergeWhatsAppData(meta, list)

  // Refresh metadata only for the same sender/customer pair. A legacy customer-only
  // deep link cannot choose a business number on the agent's behalf.
  useEffect(() => {
    if (selected) {
      const match = list?.contacts?.find((contact) => whatsappConversationKey(contact) === whatsappConversationKey(selected))
      if (match && match !== selected) setSelected(match)
      return
    }
    if (!initialWaId || !initialPhoneNumberId) return
    const match = (list?.contacts ?? []).find((c) => c.waId === initialWaId && c.phoneNumberId === initialPhoneNumberId)
    if (match) setSelected(match)
  }, [initialWaId, initialPhoneNumberId, list, selected])

  const { data: thread, error: threadError, isLoading: threadLoading, mutate: mutateThread } = useSWR<{ success: boolean; messages?: WaMessage[] }>(
    selected ? whatsappTranscriptKey(selected) : null,
    fetcher,
    { refreshInterval: 20_000, keepPreviousData: false },
  )

  const retryLoad = () => Promise.allSettled([mutateMeta(), mutate()])
  const loadError = metaError || listError
  // Show a failed first load before the loading guard; cached data stays usable.
  if ((!meta || !data?.contacts) && loadError) {
    return (
      <div className="flex flex-1 items-start p-6">
        <div role="alert" className="w-full rounded-lg border border-destructive/40 bg-destructive/5 p-6">
          <p className="font-medium">Could not load WhatsApp setup</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{loadError instanceof Error ? loadError.message : 'Please try again.'}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={retryLoad} disabled={checkingMeta || isValidating}>
            {checkingMeta || isValidating ? 'Retrying...' : 'Try again'}
          </Button>
        </div>
      </div>
    )
  }

  // Wait for capability as well as contacts: judging "scope missing" before
  // the meta request lands would flash the unavailable screen on every load.
  if ((!data?.contacts && isLoading) || !meta) {
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
            : 'The webhook verify token is not configured in this project. Review the existing Meta connection before changing its setup.'
        }
        missing={data?.capability?.missing ?? []}
        steps={[
          'Set WHATSAPP_VERIFY_TOKEN in the project settings to any random string you choose.',
          `In the Meta app dashboard open WhatsApp > Configuration, set the callback URL to ${origin}${data?.webhookPath ?? '/api/webhooks/whatsapp'} and paste the same verify token.`,
          'Subscribe to the "messages" webhook field, then click Verify and save.',
          'Repeat the subscription for each WhatsApp Business Account you want in this inbox — they are configured per account, not per app.',
        ]}
      >
        {loadError ? <p role="alert" className="text-sm text-amber-500">Setup could not refresh. Showing the last saved connection details.</p> : null}
        <Button variant="outline" size="sm" onClick={retryLoad} disabled={checkingMeta || isValidating}>
          {checkingMeta || isValidating ? 'Checking...' : 'Check connection again'}
        </Button>
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
          <Button variant="outline" size="sm" className="mt-4" onClick={retryLoad}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  const all = data.contacts ?? []
  const words = searchWords(query)

  // Distinct ads present in the inbox, most leads first, so the busiest
  // campaigns are the easiest to jump to.
  const adCounts = new Map<string, { name: string; count: number }>()
  for (const c of all) {
    if (!c.firstAdId) continue
    const entry = adCounts.get(c.firstAdId) ?? {
      name: c.firstAdName ?? c.firstAdHeadline ?? c.firstAdId,
      count: 0,
    }
    entry.count += 1
    adCounts.set(c.firstAdId, entry)
  }
  const ads = [...adCounts.entries()].sort((a, b) => b[1].count - a[1].count)
  const adSourced = all.filter((c) => c.firstAdId).length

  const contacts = all.filter((c) => {
    if (adFilter === 'ads' && !c.firstAdId) return false
    if (adFilter !== 'all' && adFilter !== 'ads' && c.firstAdId !== adFilter) return false
    if (!words.length) return true
    // Searching the ad name too, so typing a product finds everyone who
    // clicked that ad - not just people whose message mentioned it.
    const haystack = searchText(
      c.profileName, c.waId, c.displayPhone, c.businessName, c.lastSnippet, c.firstAdName, c.firstAdId,
    )
    const digits = c.waId.replace(/\D/g, '')
    return words.every((w) => haystack.includes(w) || matchesPhone(w, digits))
  })

  // Ask Meta to sync past conversations for every reachable number. Only
  // Coexistence numbers can ever succeed, so the per-number answers matter
  // more than the overall result - they say exactly why each one can or
  // cannot be recovered.
  const syncHistory = async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/inbox/whatsapp/sync', { method: 'POST' })
      const json = (await res.json()) as SyncResponse
      setSyncResult(json)
      if (json.requested) await mutate()
    } catch (e) {
      setSyncResult({ success: false, error: e instanceof Error ? e.message : 'Sync failed' })
    } finally {
      setSyncing(false)
    }
  }

  const send = async () => {
    if (!selected || !draft.trim() || sendingRef.current) return
    const unavailable = whatsappReplyUnavailable(selected)
    if (unavailable) { setSendError(unavailable); return }
    const identity = whatsappIdentity(selected)!
    const recipient = whatsappConversationKey(identity)
    const replyUrl = whatsappTranscriptKey(identity)!
    const submittedDraft = draft
    const submittedVersion = draftState?.version ?? 0
    sendingRef.current = true
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch('/api/inbox/whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...identity, message: submittedDraft.trim() }),
      })
      const json = (await res.json()) as { success: boolean; error?: string; savedLocally?: boolean; warning?: string }
      if (!json.success) throw new Error(json.error ?? 'Send failed')
      setDrafts((current) => current[recipient]
        ? { ...current, [recipient]: completeWhatsAppDraft(current[recipient], submittedVersion) }
        : current)
      const warning = whatsappAcceptedWarning(json)
      if (warning) toast({ title: 'Sent to WhatsApp', description: warning })
      // A cache refresh failure cannot turn an accepted send into a resend prompt.
      await Promise.allSettled([
        ...(selectedId.current === recipient ? [mutateCache(replyUrl)] : []),
        mutate(),
      ])
    } catch (e) {
      if (selectedId.current === recipient) setSendError(e instanceof Error ? e.message : 'Send failed')
    } finally {
      sendingRef.current = false
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
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={syncHistory}
                disabled={syncing}
                className="h-8 gap-1.5 bg-transparent"
              >
                <History className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} aria-hidden="true" />
                {syncing ? 'Checking...' : 'Sync history'}
              </Button>
              <Button variant="ghost" size="icon" onClick={() => mutate()} aria-label="Refresh" className="h-8 w-8">
                <RefreshCw className={`h-4 w-4 ${isValidating ? 'animate-spin' : ''}`} aria-hidden="true" />
              </Button>
            </div>
          </div>
          {loadError ? (
            <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
              <p>WhatsApp could not refresh. Showing saved conversations and connection details.</p>
              <Button variant="ghost" size="sm" className="mt-2 h-7 px-2" onClick={metaError ? retryLoad : () => mutate()} disabled={checkingMeta || isValidating}>Try again</Button>
            </div>
          ) : null}
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, number or ad..."
              className="pl-9"
              aria-label="Search WhatsApp conversations"
            />
          </div>

          {/* One picker, not a chip per ad: with 30+ ads the chip row grew
              taller than the conversation list it was meant to filter. */}
          {adSourced > 0 ? (
            <Select value={adFilter} onValueChange={setAdFilter}>
              <SelectTrigger aria-label="Filter by ad">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-[320px]">
                <SelectItem value="all">Any source ({all.length})</SelectItem>
                <SelectItem value="ads">Ad replies only ({adSourced})</SelectItem>
                {ads.map(([id, meta]) => (
                  <SelectItem key={id} value={id}>
                    {meta.name} ({meta.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}

          {/* Meta's own verdict per number, not our guess. Most will say the
              history window has closed, which is the honest answer. */}
          {syncResult ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-xs leading-relaxed text-pretty">
                {syncResult.success ? syncResult.summary : (syncResult.error ?? 'Sync failed')}
              </p>
              {syncResult.results?.length ? (
                <ul className="flex flex-col gap-1.5">
                  {syncResult.results.map((r) => (
                    <li key={r.id} className="flex flex-col">
                      <span className="text-xs font-medium">
                        {r.verifiedName} · {r.displayPhone}
                      </span>
                      <span
                        className={`text-xs leading-relaxed text-pretty ${
                          r.requested ? 'text-emerald-500' : 'text-muted-foreground'
                        }`}
                      >
                        {r.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 self-start px-2 text-xs"
                onClick={() => setSyncResult(null)}
              >
                Dismiss
              </Button>
            </div>
          ) : null}
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
                const key = whatsappConversationKey(c)
                const active = selectedKey === key
                return (
                  <li key={key}>
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
                      <span className="truncate text-xs text-muted-foreground">{[c.businessName, c.displayPhone].filter(Boolean).join(' · ') || (c.phoneNumberId ? 'Business number ' + c.phoneNumberId : 'Business number unconfirmed')}</span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {c.unreadStateKnown !== true ? <span className="text-xs text-muted-foreground">Unread status unconfirmed</span> : c.unreadCount > 0 ? (
                          <Badge variant="default" className="h-5 tabular-nums">
                            {c.unreadCount}
                          </Badge>
                        ) : null}
                        {/* Which ad won this customer. Business Suite shows
                            the same thing as a thread label, and it is the
                            difference between a cold number and a known lead. */}
                        {c.firstAdId ? (
                          <Badge variant="outline" className="h-5 max-w-full gap-1 border-primary/40 text-primary">
                            <Megaphone className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span className="block truncate">{c.firstAdName ?? c.firstAdHeadline ?? 'From ad'}</span>
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
              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="truncate font-semibold">{selected.profileName ?? `+${selected.waId}`}</h3>
                <p className="text-xs tabular-nums text-muted-foreground">+{selected.waId}</p>
                <p className="text-xs text-muted-foreground">{[selected.businessName, selected.displayPhone].filter(Boolean).join(' · ') || (selected.phoneNumberId ? 'Business number ' + selected.phoneNumberId : 'Business number unconfirmed')}</p>
                {/* The agent's most useful context: what this person clicked
                    before writing. Without it every lead reads identically. */}
                {selected.firstAdId ? (
                  <p className="flex min-w-0 items-center gap-1.5 text-xs text-primary">
                    <Megaphone className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">
                      {selected.firstAdName ?? selected.firstAdHeadline ?? 'Clicked an ad'}
                      {selected.firstAdAt ? ` · ${relative(selected.firstAdAt)}` : ''}
                    </span>
                  </p>
                ) : null}
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
                {/* The ad this conversation started from, the way Business
                    Suite shows it: what they clicked, plus a way to open the
                    actual creative so an agent can see what was promised. */}
                {selected.firstAdId ? (
                  <div className="flex flex-col gap-1 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                    <p className="text-xs font-medium">
                      This chat started from an ad
                      {selected.firstAdAt ? ` · ${relative(selected.firstAdAt)}` : ''}
                    </p>
                    <p className="text-xs leading-relaxed text-pretty text-muted-foreground">
                      {selected.firstAdName ?? selected.firstAdHeadline ?? 'Click-to-WhatsApp ad'}
                    </p>
                    <div className="flex flex-wrap items-center gap-2">
                      {/* The raw label Business Suite writes on the thread,
                          kept verbatim so the two inboxes can be reconciled. */}
                      <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                        ad_id.{selected.firstAdId}
                      </code>
                      <a
                        href={
                          selected.firstAdSourceUrl ??
                          `https://www.facebook.com/ads/library/?id=${selected.firstAdId}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        View ad
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    </div>
                  </div>
                ) : null}
                {/* Saved history does not establish what happened in another tool. */}
                {messages.length > 0 && messages.every((m) => m.direction === 'in') ? (
                  <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-pretty text-muted-foreground">
                    The saved history currently contains customer messages only. Replies or older content may be missing;
                    check the conversation before replying again.
                  </p>
                ) : null}
                {threadError ? (
                  <div role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
                    <p>This conversation could not refresh. Any saved messages remain visible.</p>
                    <Button variant="ghost" size="sm" className="mt-2 h-7 px-2" onClick={() => mutateThread()}>Try again</Button>
                  </div>
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
                      {whatsappMessageBody(m) ? (
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-pretty">{whatsappMessageBody(m)}</p>
                      ) : m.mediaId ? null : m.type === 'external' || m.type === 'text' ? (
                        <p className="text-sm italic opacity-70">Message content unavailable</p>
                      ) : (
                        <p className="text-sm italic opacity-70">{m.type} message</p>
                      )}
                      <span className="text-[11px] opacity-70">
                        {relative(m.createdAt)}
                        {m.direction === 'out' && m.status ? ` · ${m.status}` : ''}
                      </span>
                    </div>
                  </div>
                ))}
                {messages.length === 0 && !threadError ? (
                  <p role="status" className="p-6 text-center text-sm text-muted-foreground">{threadLoading ? 'Loading conversation...' : 'No messages saved for this conversation'}</p>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-border p-4">
              {replyUnavailable ? <p role="status" className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">{replyUnavailable}</p> : null}
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
                  onChange={(e) => {
                    const text = e.target.value
                    const recipient = whatsappConversationKey(selected)
                    setDrafts((current) => ({ ...current, [recipient]: { text, version: (current[recipient]?.version ?? 0) + 1 } }))
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' || e.shiftKey) return
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return
                    e.preventDefault()
                    if (!replyUnavailable) send()
                  }}
                  placeholder="Type a WhatsApp message..."
                  className="min-h-[44px] resize-none"
                  aria-label="WhatsApp reply"
                />
                <Button onClick={send} disabled={!draft.trim() || sending || Boolean(replyUnavailable)} aria-label="Send WhatsApp message">
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
