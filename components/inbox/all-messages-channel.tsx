'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { MessageCircle, Megaphone, Phone, RefreshCw, Search } from 'lucide-react'
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
  adOptions,
  filterThreads,
  fromMessenger,
  fromWhatsApp,
  sortThreads,
  type AdFilter,
  type ChannelFilter,
  type SortKey,
  type UnifiedChannel,
  type UnifiedThread,
} from '@/lib/inbox/unified'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function relative(iso: string | null) {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.round(h / 24)}d`
}

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'recent', label: 'Newest first' },
  { value: 'unread', label: 'Unread first' },
  { value: 'oldest', label: 'Oldest waiting' },
  { value: 'name', label: 'Name A-Z' },
]

export function AllMessagesChannel({
  onOpen,
}: {
  onOpen: (channel: UnifiedChannel, nativeId: string) => void
}) {
  const [query, setQuery] = useState('')
  const [channel, setChannel] = useState<ChannelFilter>('all')
  const [sort, setSort] = useState<SortKey>('recent')
  const [ad, setAd] = useState<AdFilter>('all')
  const [unreadOnly, setUnreadOnly] = useState(false)

  // Same SWR keys the individual channels use, so this view is free: it
  // reuses their cache instead of issuing extra Graph calls.
  const { data: mData, isValidating: mv, mutate: mMutate } = useSWR<{
    conversations?: Parameters<typeof fromMessenger>[0][]
  }>('/api/inbox?pageId=all', fetcher, { refreshInterval: 60_000 })

  const { data: wData, isValidating: wv, mutate: wMutate } = useSWR<{
    contacts?: Parameters<typeof fromWhatsApp>[0][]
  }>('/api/inbox/whatsapp', fetcher, { refreshInterval: 60_000 })

  const all = useMemo(() => {
    const rows: UnifiedThread[] = [
      ...(mData?.conversations ?? []).map(fromMessenger),
      ...(wData?.contacts ?? []).map(fromWhatsApp),
    ]
    return rows
  }, [mData, wData])

  const ads = useMemo(() => adOptions(all), [all])
  const rows = useMemo(
    () => sortThreads(filterThreads(all, { channel, ad, unreadOnly, query }), sort),
    [all, channel, ad, unreadOnly, query, sort],
  )

  const counts = {
    all: all.length,
    messenger: all.filter((r) => r.channel === 'messenger').length,
    whatsapp: all.filter((r) => r.channel === 'whatsapp').length,
  }
  const unread = all.filter((r) => r.unreadCount > 0).length
  const loading = !mData && !wData

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <h2 className="font-semibold">All messages</h2>
            <span className="text-xs text-muted-foreground">
              {rows.length} of {counts.all}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              void mMutate()
              void wMutate()
            }}
            aria-label="Refresh"
            className="h-8 w-8"
          >
            <RefreshCw className={`h-4 w-4 ${mv || wv ? 'animate-spin' : ''}`} aria-hidden="true" />
          </Button>
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
              placeholder="Search name, message, ad or page..."
              className="pl-9"
              aria-label="Search all conversations"
            />
          </div>

          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-[150px]" aria-label="Sort conversations">
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

          {/* One compact picker instead of a chip per ad - with 30+ ads the
              chip row grew taller than the conversation list itself. */}
          {ads.length > 0 ? (
            <Select value={ad} onValueChange={(v) => setAd(v as AdFilter)}>
              <SelectTrigger className="w-[210px]" aria-label="Filter by ad">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-[320px]">
                <SelectItem value="all">Any source</SelectItem>
                <SelectItem value="ads">Ad replies only</SelectItem>
                {ads.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} ({a.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ['all', `All (${counts.all})`],
              ['messenger', `Messenger (${counts.messenger})`],
              ['whatsapp', `WhatsApp (${counts.whatsapp})`],
            ] as [ChannelFilter, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setChannel(id)}
              aria-pressed={channel === id}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                channel === id
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setUnreadOnly((v) => !v)}
            aria-pressed={unreadOnly}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
              unreadOnly
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border text-muted-foreground hover:bg-muted'
            }`}
          >
            Unread ({unread})
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading conversations...</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No conversations match these filters.</p>
        ) : (
          <ul>
            {rows.map((r) => {
              const Icon = r.channel === 'whatsapp' ? Phone : MessageCircle
              return (
                <li key={r.key}>
                  <button
                    type="button"
                    onClick={() => onOpen(r.channel, r.nativeId)}
                    className="flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors hover:bg-muted/60"
                  >
                    <span
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                        r.channel === 'whatsapp'
                          ? 'bg-emerald-500/15 text-emerald-500'
                          : 'bg-blue-500/15 text-blue-500'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="sr-only">{r.channel}</span>
                    </span>

                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{r.name}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {relative(r.updatedAt)}
                        </span>
                      </span>

                      <span className="truncate text-xs text-muted-foreground">
                        {r.snippet || 'No messages yet'}
                      </span>

                      <span className="flex flex-wrap items-center gap-1.5">
                        {r.unreadCount > 0 ? (
                          <Badge className="h-5 px-1.5 text-[11px]">{r.unreadCount}</Badge>
                        ) : null}
                        <span className="text-[11px] text-muted-foreground">{r.source}</span>
                        {r.adName ? (
                          <Badge
                            variant="outline"
                            className="h-5 max-w-[240px] gap-1 px-1.5 text-[11px] font-normal"
                          >
                            <Megaphone className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span className="block w-full truncate text-left">{r.adName}</span>
                          </Badge>
                        ) : null}
                        {r.outsideWindow ? (
                          <span className="text-[11px] text-amber-500">24h window closed</span>
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
