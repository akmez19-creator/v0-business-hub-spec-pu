'use client'

/**
 * The Leads workspace - the whole inbox in one screen.
 *
 * Three columns, left to right: who is waiting, what they said, and the order
 * that comes out of it. Messenger, WhatsApp and comments are merged into the
 * one list and filtered by stage, product and campaign, because an agent
 * works a queue of people, not a queue of channels.
 *
 * Opening a lead asks the AI once for BOTH the reply draft and the order
 * fields, so a conversation that already contains a name, a number and a
 * locality arrives as a filled-in form instead of a re-reading exercise.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { Inbox, MessageCircle, MessageSquare, Phone, RefreshCw, Search } from 'lucide-react'
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
import { useToast } from '@/hooks/use-toast'
import {
  campaignOptions,
  filterThreads,
  fromComment,
  fromMessenger,
  fromWhatsApp,
  productOptions,
  sortThreads,
  stageCounts,
  type ChannelFilter,
  type SortKey,
  type UnifiedChannel,
  type UnifiedThread,
} from '@/lib/inbox/unified'
import {
  normaliseMessages,
  sendLeadReply,
  toTurns,
  transcriptUrl,
  type LeadMessage,
} from '@/lib/inbox/lead-actions'
import { STAGE_LABELS, STAGE_ORDER, type LeadStage } from '@/lib/inbox/stage'
import { LeadConversation } from './lead-conversation'
import { EMPTY_ORDER, QuickOrderPanel, type OrderDraft } from './quick-order-panel'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'triage', label: 'Needs action' },
  { value: 'recent', label: 'Most recent' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'unread', label: 'Unread first' },
  { value: 'name', label: 'Name A-Z' },
]

const CHANNELS: { value: ChannelFilter; label: string; icon: typeof Phone }[] = [
  { value: 'all', label: 'All', icon: Inbox },
  { value: 'messenger', label: 'Messenger', icon: MessageCircle },
  { value: 'whatsapp', label: 'WhatsApp', icon: Phone },
  { value: 'comment', label: 'Comments', icon: MessageSquare },
]

const CHANNEL_ICON: Record<UnifiedChannel, typeof Phone> = {
  messenger: MessageCircle,
  whatsapp: Phone,
  comment: MessageSquare,
}

/** Stage pill colours. Awaiting is the only one that shouts. */
const STAGE_STYLE: Record<LeadStage, string> = {
  awaiting: 'border-primary bg-primary text-primary-foreground',
  new: 'border-border bg-muted text-foreground',
  active: 'border-border bg-muted text-foreground',
  dormant: 'border-border bg-transparent text-muted-foreground',
}

type AssistResponse = {
  success: boolean
  error?: string
  reply?: string
  readyToOrder?: boolean
  order?: {
    customerName: string
    contact1: string
    contact2: string
    region: string
    productId: string | null
    qty: number
    notes: string
    deliveryDate: string
  }
  unmatched?: { product: string | null; locality: string | null } | null
}

export function LeadsChannel() {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('triage')
  const [channel, setChannel] = useState<ChannelFilter>('all')
  const [product, setProduct] = useState<string>('all')
  const [campaign, setCampaign] = useState<string>('all')
  const [liveOnly, setLiveOnly] = useState(false)
  // Default to the work: dormant threads are a remarketing list, not a daily
  // to-do, so they stay out until asked for.
  const [stages, setStages] = useState<Set<LeadStage>>(new Set(['awaiting', 'new']))
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [order, setOrder] = useState<OrderDraft>(EMPTY_ORDER)
  const [assisting, setAssisting] = useState(false)
  const [assistError, setAssistError] = useState<string | null>(null)
  const [unmatched, setUnmatched] = useState<AssistResponse['unmatched']>(null)
  /** Set once the agent types, so a late AI result never eats their words. */
  const draftTouched = useRef(false)
  const { toast } = useToast()

  // Same SWR keys the rest of the app uses, so this view rides their cache
  // instead of issuing extra Graph calls.
  const { data: mData, isValidating: mv, mutate: mMutate } = useSWR<{
    conversations?: Parameters<typeof fromMessenger>[0][]
    rateLimited?: boolean
  }>('/api/inbox?pageId=all', fetcher, { refreshInterval: 60_000 })

  const { data: wData, isValidating: wv, mutate: wMutate } = useSWR<{
    contacts?: Parameters<typeof fromWhatsApp>[0][]
  }>('/api/inbox/whatsapp', fetcher, { refreshInterval: 60_000 })

  const { data: cData, isValidating: cv, mutate: cMutate } = useSWR<{
    comments?: (Parameters<typeof fromComment>[0] & { fromPage?: boolean })[]
    rateLimited?: boolean
  }>('/api/inbox/comments?pageId=all', fetcher, { refreshInterval: 120_000 })

  // Messenger and comments both come from Graph, so they throttle together.
  // WhatsApp reads from Supabase and keeps working.
  const throttled = Boolean(mData?.rateLimited || cData?.rateLimited)

  const all = useMemo<UnifiedThread[]>(
    () => [
      ...(mData?.conversations ?? []).map(fromMessenger),
      ...(wData?.contacts ?? []).map(fromWhatsApp),
      // The page's own comments are not leads.
      ...(cData?.comments ?? []).filter((c) => !c.fromPage).map(fromComment),
    ],
    [mData, wData, cData],
  )

  const products = useMemo(() => productOptions(all), [all])
  const campaigns = useMemo(() => campaignOptions(all), [all])
  const counts = useMemo(() => stageCounts(all), [all])

  const rows = useMemo(
    () =>
      sortThreads(
        filterThreads(all, {
          channel,
          ad: 'all',
          unreadOnly: false,
          query,
          stages,
          product,
          campaign,
          liveOnly,
        }),
        sort,
      ),
    [all, channel, query, stages, product, campaign, liveOnly, sort],
  )

  const selected = useMemo(
    () => all.find((r) => r.key === selectedKey) ?? null,
    [all, selectedKey],
  )

  // Transcript for the open lead. Comments have no thread, so the URL is null
  // and SWR simply does not fetch.
  const transcriptKey = selected ? transcriptUrl(selected) : null
  const { data: tData, isLoading: tLoading, mutate: tMutate } = useSWR<{
    messages?: unknown[]
    rateLimited?: boolean
  }>(transcriptKey, fetcher)

  const messages = useMemo<LeadMessage[]>(
    () => (selected ? normaliseMessages(selected, tData) : []),
    [selected, tData],
  )

  /**
   * Ask the model for the reply and the order fields in one call.
   *
   * Runs on the transcript we already have on screen, so it costs no extra
   * Graph quota, and it never sends or saves anything on its own.
   */
  const runAssist = useCallback(
    async (thread: UnifiedThread, msgs: LeadMessage[], force: boolean) => {
      const turns = toTurns(thread, msgs)
      if (!turns.length) return
      setAssisting(true)
      setAssistError(null)
      try {
        const res = await fetch('/api/inbox/ai-assist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: turns,
            customerName: thread.name,
            pageName: thread.source,
            channel: thread.channel,
            productHint: thread.product,
            adName: thread.adName,
          }),
        })
        const json = (await res.json()) as AssistResponse
        if (!json.success) {
          setAssistError(json.error ?? 'Could not draft a reply')
          return
        }
        // A redraft is an explicit request, so it overwrites. An automatic
        // one defers to anything the agent has already typed.
        if (force || !draftTouched.current) {
          setDraft(json.reply ?? '')
          draftTouched.current = false
        }
        setUnmatched(json.unmatched ?? null)
        if (json.order) {
          setOrder((prev) => ({
            // Never clobber a field the agent has already corrected.
            customerName: prev.customerName || json.order!.customerName,
            contact1: prev.contact1 || json.order!.contact1,
            contact2: prev.contact2 || json.order!.contact2,
            region: prev.region || json.order!.region,
            productId: prev.productId ?? json.order!.productId,
            qty: prev.qty > 1 ? prev.qty : json.order!.qty,
            notes: prev.notes || json.order!.notes,
            deliveryDate: prev.deliveryDate || json.order!.deliveryDate,
          }))
        }
      } catch (e) {
        setAssistError(e instanceof Error ? e.message : 'Could not draft a reply')
      } finally {
        setAssisting(false)
      }
    },
    [],
  )

  // Opening a different lead resets everything the previous one produced -
  // a stale draft or a half-filled order on the wrong customer is worse than
  // an empty one.
  useEffect(() => {
    setDraft('')
    setOrder(EMPTY_ORDER)
    setUnmatched(null)
    setAssistError(null)
    draftTouched.current = false
  }, [selectedKey])

  // Draft as soon as there is something to read. Keyed on the thread so it
  // fires once per lead, not on every poll.
  const assistedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!selected) return
    if (assistedFor.current === selected.key) return
    const hasContent = selected.channel === 'comment' ? Boolean(selected.snippet) : messages.length > 0
    if (!hasContent) return
    assistedFor.current = selected.key
    void runAssist(selected, messages, false)
  }, [selected, messages, runAssist])

  const send = async () => {
    if (!selected || sending || !draft.trim()) return
    setSending(true)
    try {
      const result = await sendLeadReply(selected, draft)
      if (!result.success) {
        toast({
          title: 'Message not sent',
          description: result.error ?? 'Unknown error',
          variant: 'destructive',
        })
        return
      }
      setDraft('')
      draftTouched.current = false
      void tMutate()
      // The thread has moved out of "awaiting" now, so refresh its list.
      if (selected.channel === 'messenger') void mMutate()
      else if (selected.channel === 'whatsapp') void wMutate()
      else void cMutate()
      if (result.usedHumanAgentTag) {
        toast({
          title: 'Sent outside the 24h window',
          description: 'Delivered using the human agent tag.',
        })
      }
    } finally {
      setSending(false)
    }
  }

  function toggleStage(stage: LeadStage) {
    setStages((prev) => {
      const next = new Set(prev)
      if (next.has(stage)) next.delete(stage)
      else next.add(stage)
      return next
    })
  }

  const loading = !mData && !wData && !cData
  const refreshing = mv || wv || cv
  const awaiting = all.filter((r) => r.stage === 'awaiting').length

  return (
    <div className="flex h-full flex-1 overflow-hidden rounded-xl border border-border bg-card">
      {/* Column 1: the queue. */}
      <div className="flex w-[380px] shrink-0 flex-col overflow-hidden border-r border-border">
        <div className="flex flex-col gap-3 border-b border-border p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <h2 className="font-semibold">Leads</h2>
              <span className="text-xs text-muted-foreground tabular-nums">
                {rows.length} shown · {awaiting} waiting
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                void mMutate()
                void wMutate()
                void cMutate()
              }}
              aria-label="Refresh leads"
              className="h-8 w-8"
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
            </Button>
          </div>

          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, message, product..."
              className="pl-9"
              aria-label="Search leads"
            />
          </div>

          {/* Channel filter replaces the old per-channel tabs: same reach, but
              the queue stays in one place. */}
          <div className="flex items-center gap-1">
            {CHANNELS.map((c) => {
              const Icon = c.icon
              const on = channel === c.value
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setChannel(c.value)}
                  aria-pressed={on}
                  title={c.label}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                    on
                      ? 'border-border bg-muted text-foreground'
                      : 'border-transparent text-muted-foreground hover:bg-muted/60'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="truncate">{c.label}</span>
                </button>
              )
            })}
          </div>

          {/* Stage triage: answers "who is waiting on me" before anything else. */}
          <div className="flex flex-wrap items-center gap-1.5">
            {STAGE_ORDER.map((stage) => (
              <button
                key={stage}
                type="button"
                onClick={() => toggleStage(stage)}
                aria-pressed={stages.has(stage)}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  stages.has(stage)
                    ? STAGE_STYLE[stage]
                    : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {STAGE_LABELS[stage]} ({counts[stage]})
              </button>
            ))}
            <button
              type="button"
              onClick={() => setLiveOnly((v) => !v)}
              aria-pressed={liveOnly}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                liveOnly
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              Live ads
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="h-8 flex-1 text-xs" aria-label="Sort leads">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {products.length > 0 ? (
              <Select value={product} onValueChange={setProduct}>
                <SelectTrigger className="h-8 flex-1 text-xs" aria-label="Filter by product">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-[320px]">
                  <SelectItem value="all">Any product</SelectItem>
                  {products.map((p) => (
                    <SelectItem key={p.key} value={p.key}>
                      {p.name} ({p.count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}

            {campaigns.length > 0 ? (
              <Select value={campaign} onValueChange={setCampaign}>
                <SelectTrigger className="h-8 flex-1 text-xs" aria-label="Filter by campaign">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-[320px]">
                  <SelectItem value="all">Any campaign</SelectItem>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.active ? '● ' : ''}
                      {c.name} ({c.count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        </div>

        {/* Partial outage: name what is missing rather than under-reporting. */}
        {throttled ? (
          <p className="border-b border-sky-500/20 bg-sky-500/10 px-4 py-2 text-xs leading-relaxed text-pretty">
            Facebook is rate limiting this app, so Messenger and comment leads are missing right
            now. WhatsApp is unaffected. This clears on its own, usually within the hour — your
            access token is fine and does not need regenerating.
          </p>
        ) : null}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading leads...</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No leads match these filters. Try enabling more stages above.
            </p>
          ) : (
            <ul>
              {rows.map((r) => {
                const Icon = CHANNEL_ICON[r.channel]
                const active = r.key === selectedKey
                return (
                  <li key={r.key}>
                    <button
                      type="button"
                      onClick={() => setSelectedKey(r.key)}
                      aria-current={active ? 'true' : undefined}
                      className={`flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors ${
                        active ? 'bg-muted' : 'hover:bg-muted/60'
                      }`}
                    >
                      <Icon
                        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="flex items-center gap-2">
                          <span className="block flex-1 truncate text-left text-sm font-medium">
                            {r.name}
                          </span>
                          {r.stage === 'awaiting' ? (
                            <Badge variant="default" className="h-5 shrink-0">
                              Waiting
                            </Badge>
                          ) : null}
                        </span>

                        <span className="block truncate text-xs text-muted-foreground">
                          {r.snippet || 'No message preview'}
                        </span>

                        <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          <span className="truncate">{r.source}</span>
                          {r.product ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="truncate font-medium text-foreground">
                                {r.product}
                              </span>
                            </>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Columns 2 and 3: the open lead. */}
      {selected ? (
        <>
          <LeadConversation
            thread={selected}
            messages={messages}
            loading={Boolean(transcriptKey) && tLoading}
            rateLimited={Boolean(tData?.rateLimited)}
            draft={draft}
            onDraftChange={(v) => {
              draftTouched.current = true
              setDraft(v)
            }}
            onSend={send}
            sending={sending}
            aiPending={assisting}
            aiError={assistError}
            onRegenerate={() => selected && runAssist(selected, messages, true)}
          />
          <QuickOrderPanel
            thread={selected}
            draft={order}
            onChange={setOrder}
            aiPending={assisting}
            unmatched={unmatched}
            onOrderCreated={({ proformaLink }) => {
              // Offer the proforma as the next message instead of making the
              // agent switch tabs to fetch a link they just generated.
              if (proformaLink && !draft.trim()) {
                setDraft(`Here is your order confirmation: ${proformaLink}`)
                draftTouched.current = true
              }
            }}
          />
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="max-w-[38ch] text-center text-sm leading-relaxed text-muted-foreground text-pretty">
            Pick a lead to read the conversation, get a suggested reply, and raise the order without
            leaving this screen.
          </p>
        </div>
      )}
    </div>
  )
}
