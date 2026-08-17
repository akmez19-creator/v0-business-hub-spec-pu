'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { MessageCircle, MessageSquare, Phone, RefreshCw, Search } from 'lucide-react'
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
import {
  campaignOptions,
  filterThreads,
  fromComment,
  fromMessenger,
  fromWhatsApp,
  productOptions,
  sortThreads,
  stageCounts,
  type SortKey,
  type UnifiedChannel,
  type UnifiedThread,
} from '@/lib/inbox/unified'
import { STAGE_LABELS, STAGE_ORDER, type LeadStage } from '@/lib/inbox/stage'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'triage', label: 'Needs action' },
  { value: 'recent', label: 'Most recent' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'unread', label: 'Unread first' },
  { value: 'name', label: 'Name A-Z' },
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

export function LeadsChannel({
  onOpen,
}: {
  onOpen: (channel: UnifiedChannel, nativeId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('triage')
  const [product, setProduct] = useState<string>('all')
  const [campaign, setCampaign] = useState<string>('all')
  const [liveOnly, setLiveOnly] = useState(false)
  // Default to the work: the 392 dormant threads are a remarketing list, not
  // a daily to-do, so they stay out until asked for.
  const [stages, setStages] = useState<Set<LeadStage>>(new Set(['awaiting', 'new']))

  // Same SWR keys the channels use, so this view rides their cache instead of
  // issuing extra Graph calls.
  const { data: mData, isValidating: mv, mutate: mMutate } = useSWR<{
    conversations?: Parameters<typeof fromMessenger>[0][]
  }>('/api/inbox?pageId=all', fetcher, { refreshInterval: 60_000 })

  const { data: wData, isValidating: wv, mutate: wMutate } = useSWR<{
    contacts?: Parameters<typeof fromWhatsApp>[0][]
  }>('/api/inbox/whatsapp', fetcher, { refreshInterval: 60_000 })

  const { data: cData, isValidating: cv, mutate: cMutate } = useSWR<{
    comments?: (Parameters<typeof fromComment>[0] & { fromPage?: boolean })[]
  }>('/api/inbox/comments?pageId=all', fetcher, { refreshInterval: 120_000 })

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
          channel: 'all',
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
    [all, query, stages, product, campaign, liveOnly, sort],
  )

  const loading = !mData && !wData && !cData
  const refreshing = mv || wv || cv
  const attributed = all.filter((r) => r.product).length

  function toggleStage(stage: LeadStage) {
    setStages((prev) => {
      const next = new Set(prev)
      if (next.has(stage)) next.delete(stage)
      else next.add(stage)
      return next
    })
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <h2 className="font-semibold">Leads</h2>
            <span className="text-xs text-muted-foreground">
              {rows.length} of {all.length} &middot; {attributed} with a product
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
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          </Button>
        </div>

        {/* Stage triage. The signature control of this view: it answers "who
            is waiting on me" before any other question. */}
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
            Live campaigns only
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, message, product or campaign..."
              className="pl-9"
              aria-label="Search leads"
            />
          </div>

          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-[150px]" aria-label="Sort leads">
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
              <SelectTrigger className="w-[210px]" aria-label="Filter by product">
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
              <SelectTrigger className="w-[210px]" aria-label="Filter by campaign">
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
              return (
                <li key={r.key}>
                  <button
                    type="button"
                    onClick={() => onOpen(r.channel, r.nativeId)}
                    className="flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted/60"
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
                            Awaiting reply
                          </Badge>
                        ) : null}
                        {r.unreadCount > 0 ? (
                          <Badge variant="secondary" className="h-5 shrink-0 tabular-nums">
                            {r.unreadCount}
                          </Badge>
                        ) : null}
                      </span>

                      <span className="block truncate text-xs text-muted-foreground">
                        {r.snippet || 'No message preview'}
                      </span>

                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span className="truncate">{r.source}</span>
                        {r.product ? (
                          <>
                            <span aria-hidden="true">&middot;</span>
                            <span className="truncate font-medium text-foreground">
                              {r.product}
                            </span>
                          </>
                        ) : null}
                        {r.campaignName ? (
                          <>
                            <span aria-hidden="true">&middot;</span>
                            <span className="truncate">
                              {r.campaignActive ? 'Live: ' : 'Paused: '}
                              {r.campaignName}
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
  )
}
