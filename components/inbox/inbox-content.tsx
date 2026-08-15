'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { formatDistanceToNow } from 'date-fns'
import { Inbox, MessageSquare, RefreshCw, Search } from 'lucide-react'
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
}

type PageRef = { id: string; name: string }

type ListResponse = {
  success: boolean
  needsPermission?: boolean
  reason?: string
  page?: PageRef
  pages?: PageRef[]
  conversations?: Conversation[]
  error?: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const relative = (iso: string) => {
  const t = new Date(iso).getTime()
  if (!t) return ''
  return formatDistanceToNow(t, { addSuffix: true })
}

export function InboxContent() {
  const [selected, setSelected] = useState<Conversation | null>(null)
  const [query, setQuery] = useState('')
  // Which Page's inbox to show. Undefined lets the server pick the Page that
  // was actually granted to the app rather than the alphabetically first one.
  const [pageId, setPageId] = useState<string | undefined>(undefined)

  // Poll so new customer messages appear without a manual refresh. The Graph
  // client caches for 30s, so this costs no extra Facebook quota.
  const { data, isLoading, mutate, isValidating } = useSWR<ListResponse>(
    pageId ? `/api/inbox?pageId=${encodeURIComponent(pageId)}` : '/api/inbox',
    fetcher,
    { refreshInterval: 60_000, revalidateOnFocus: true },
  )

  const activePageId = data?.page?.id
  const pages = data?.pages ?? []

  const switchPage = (id: string) => {
    setSelected(null) // a thread belongs to one Page; clear it on switch
    setPageId(id)
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 p-6">
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
        activePageId={activePageId}
        onSelectPage={switchPage}
      />
    )
  }

  if (!data?.success) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
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
  const q = query.trim().toLowerCase()
  const conversations = q
    ? all.filter(
        (c) => (c.customer?.name ?? '').toLowerCase().includes(q) || c.snippet.toLowerCase().includes(q),
      )
    : all
  const unread = all.reduce((n, c) => n + (c.unreadCount > 0 ? 1 : 0), 0)

  return (
    <div className="flex h-[calc(100vh-9rem)] gap-4 p-6 pt-0">
      {/* Thread list */}
      <div className="flex w-[380px] shrink-0 flex-col rounded-xl border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-4">
          {pages.length > 1 ? (
            <Select value={activePageId} onValueChange={switchPage}>
              <SelectTrigger aria-label="Facebook Page">
                <SelectValue placeholder="Select a Page" />
              </SelectTrigger>
              <SelectContent>
                {pages.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">Conversations</h2>
              {unread > 0 ? (
                <Badge variant="default" className="tabular-nums">
                  {unread} unread
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
              placeholder="Search name or message..."
              className="pl-9"
              aria-label="Search conversations"
            />
          </div>
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
                      <div className="flex items-center gap-1.5">
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
          <InboxThread conversation={selected} pageId={activePageId} onSent={() => mutate()} />
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
