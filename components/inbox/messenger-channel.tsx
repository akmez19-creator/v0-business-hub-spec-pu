'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { formatDistanceToNow } from 'date-fns'
import { Inbox, Megaphone, MessageSquare, RefreshCw, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { InboxSetup } from './inbox-setup'
import { InboxThread } from './inbox-thread'

export type Conversation = {
  id: string
  snippet: string
  updatedTime: string
  unreadCount: number
  messageCount: number
  customer: { id: string; name?: string } | null
  outsideWindow: boolean
  pageId: string
  pageName: string
  /** From the page webhook (messenger_ad_refs); null on pre-webhook threads. */
  adId?: string | null
  adName?: string | null
}

type PageRef = { id: string; name: string }

type PageStat = {
  id: string
  name: string
  unread: number | null
  conversations: number
  error?: string
}

type ListResponse = {
  success: boolean
  needsPermission?: boolean
  reason?: string
  scope?: string
  page?: PageRef
  pages?: PageRef[]
  pageStats?: PageStat[]
  conversations?: Conversation[]
  error?: string
}

/** Sentinel for the merged, all-Pages view. */
const ALL = 'all'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const relative = (iso: string) => {
  const t = new Date(iso).getTime()
  if (!t) return ''
  return formatDistanceToNow(t, { addSuffix: true })
}

export function MessengerChannel({
  initialConversationId = null,
}: {
  /** Thread to open on mount, set when arriving from the unified inbox. */
  initialConversationId?: string | null
} = {}) {
  const [selected, setSelected] = useState<Conversation | null>(null)
  const [query, setQuery] = useState('')
  /** 'all' | 'ads' | a specific ad id. */
  const [adFilter, setAdFilter] = useState<string>('all')
  // Default to every Page merged and sorted by recency, so the newest customer
  // message is on top no matter which business it came to.
  const [scope, setScope] = useState<string>(ALL)

  // Poll so new customer messages appear without a manual refresh. The Graph
  // client caches for 30s, so this costs no extra Facebook quota.
  const { data, isLoading, mutate, isValidating } = useSWR<ListResponse>(
    `/api/inbox?pageId=${encodeURIComponent(scope)}`,
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true },
  )

  // Open the thread the unified inbox asked for, once conversations load.
  // Guarded on `selected` so it never overrides a later manual click.
  useEffect(() => {
    if (!initialConversationId || selected) return
    const match = (data?.conversations ?? []).find((c) => c.id === initialConversationId)
    if (match) setSelected(match)
  }, [initialConversationId, data, selected])

  const pages = data?.pages ?? []
  const pageStats = data?.pageStats ?? []
  const statById = new Map(pageStats.map((s) => [s.id, s]))
  const combined = scope === ALL
  const failedPages = pageStats.filter((s) => s.error)
  const totalUnread = pageStats.reduce((n, s) => n + (s.unread ?? 0), 0)

  const switchScope = (next: string) => {
    setSelected(null) // a thread belongs to one Page; clear it on switch
    setScope(next)
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    )
  }

  if (data?.needsPermission) {
    return (
      <InboxSetup
        pageName={data.page?.name}
        reason={data.reason}
        pages={pages}
        activePageId={combined ? undefined : scope}
        onSelectPage={switchScope}
      />
    )
  }

  if (!data?.success) {
    return (
      <div className="flex flex-1 items-start">
        <div className="w-full rounded-lg border border-destructive/40 bg-destructive/5 p-6">
          <p className="font-medium">Could not load the inbox</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{data?.error ?? 'Unknown error'}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => mutate()}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  const all = data.conversations ?? []

  // Distinct ads seen in this list, for the filter dropdown.
  const adCounts = new Map<string, { name: string; count: number }>()
  for (const c of all) {
    if (!c.adId) continue
    const prev = adCounts.get(c.adId)
    adCounts.set(c.adId, { name: c.adName ?? c.adId, count: (prev?.count ?? 0) + 1 })
  }
  const ads = [...adCounts.entries()].sort((a, b) => b[1].count - a[1].count)
  const adSourced = all.reduce((n, c) => n + (c.adId ? 1 : 0), 0)

  const q = query.trim().toLowerCase()
  const conversations = all.filter((c) => {
    if (adFilter === 'ads' && !c.adId) return false
    if (adFilter !== 'all' && adFilter !== 'ads' && c.adId !== adFilter) return false
    if (!q) return true
    return (
      (c.customer?.name ?? '').toLowerCase().includes(q) ||
      c.snippet.toLowerCase().includes(q) ||
      (c.adName ?? '').toLowerCase().includes(q) ||
      (c.adId ?? '').includes(q) ||
      // In the merged view the Page name is a useful filter of its own.
      (combined && c.pageName.toLowerCase().includes(q))
    )
  })
  // Count CHATS needing a reply, not raw messages: the dropdown already shows
  // message totals, and two different numbers both labelled "unread" side by
  // side read as a bug.
  const unreadChats = all.reduce((n, c) => n + (c.unreadCount > 0 ? 1 : 0), 0)

  return (
    // The workspace shell owns height and padding so every channel aligns.
    <div className="flex min-h-0 flex-1 gap-4">
      {/* Thread list */}
      {/* Fixed 380px left a cramped list beside a near-empty thread pane on a
          2870px screen. Scale the list with the viewport, capped so it cannot
          swallow the thread. */}
      <div className="flex w-[380px] shrink-0 flex-col rounded-xl border border-border bg-card xl:w-[26vw] xl:max-w-[520px]">
        <div className="flex flex-col gap-3 border-b border-border p-4">
          {pages.length > 1 ? (
            <Select value={scope} onValueChange={switchScope}>
              <SelectTrigger aria-label="Facebook Page">
                <SelectValue placeholder="Select a Page" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All pages{totalUnread > 0 ? ` (${totalUnread} unread)` : ''}</SelectItem>
                {pages.map((p) => {
                  const stat = statById.get(p.id)
                  // Unread counts come free from the combined fetch, so the
                  // dropdown shows where messages are piling up without
                  // switching Page to find out.
                  const suffix =
                    stat?.error != null ? ' (unavailable)' : stat?.unread ? ` (${stat.unread})` : ''
                  return (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {suffix}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          ) : null}
          {/* Only shown once attribution exists, so pre-webhook inboxes are
              not given a filter that can only ever return nothing. */}
          {adSourced > 0 ? (
            <Select value={adFilter} onValueChange={setAdFilter}>
              <SelectTrigger aria-label="Filter by ad">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-[320px]">
                <SelectItem value="all">Any source ({all.length})</SelectItem>
                <SelectItem value="ads">Ad clicks only ({adSourced})</SelectItem>
                {ads.map(([id, meta]) => (
                  <SelectItem key={id} value={id}>
                    {meta.name} ({meta.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">{combined ? 'All conversations' : 'Conversations'}</h2>
              {unreadChats > 0 ? (
                <Badge variant="default" className="tabular-nums">
                  {unreadChats} to reply
                </Badge>
              ) : null}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => mutate()}
              aria-label="Refresh conversations"
              className="h-8 w-8"
            >
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
              placeholder="Search name, message or ad..."
              className="pl-9"
              aria-label="Search conversations"
            />
          </div>
          {failedPages.length > 0 ? (
            // A partial failure must be visible: silently showing 5 of 6
            // Pages looks identical to a quiet day.
            <p className="text-xs leading-relaxed text-amber-500">
              Could not load {failedPages.map((p) => p.name).join(', ')}. Other pages are up to date.
            </p>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <Inbox className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                {all.length === 0 ? 'No conversations yet' : 'Nothing matches that search'}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col">
              {conversations.map((c) => {
                const active = selected?.id === c.id
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(c)}
                      aria-current={active ? 'true' : undefined}
                      className={`flex w-full flex-col gap-1 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-muted/50 ${
                        active ? 'bg-muted' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{c.customer?.name ?? 'Unknown customer'}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{relative(c.updatedTime)}</span>
                      </div>
                      <span className="truncate text-sm text-muted-foreground">{c.snippet || 'No preview'}</span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {combined ? (
                          <Badge variant="secondary" className="h-5 max-w-full font-normal">
                            {/* Badge centres its text, so a bare truncate
                                would clip both ends of a long Page name. */}
                            <span className="block w-full truncate text-left">{c.pageName}</span>
                          </Badge>
                        ) : null}
                        {c.adName ? (
                          <Badge
                            variant="outline"
                            className="h-5 max-w-full gap-1 border-primary/40 font-normal text-primary"
                            title={`${c.adName} · ad_id.${c.adId}`}
                          >
                            <Megaphone className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span className="block w-full truncate text-left">{c.adName}</span>
                          </Badge>
                        ) : null}
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

      {/* Thread */}
      <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-border bg-card">
        {selected ? (
          <InboxThread
            key={selected.id}
            conversation={selected}
            // The Page comes from the conversation, never from the current
            // selection - in the merged view they are usually different.
            pageId={selected.pageId}
            showPageName={combined}
            onSent={() => mutate()}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <MessageSquare className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <p className="text-muted-foreground">Select a conversation to read and reply</p>
          </div>
        )}
      </div>
    </div>
  )
}
