'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { formatDistanceToNow } from 'date-fns'
import {
  CornerDownRight,
  ExternalLink,
  Eye,
  EyeOff,
  Heart,
  MessageSquareText,
  RefreshCw,
  Search,
  Send,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ChannelUnavailable } from './channel-unavailable'
import { ALL_PAGES, PageScopeSelect } from './page-scope-select'

type Author = { id: string; name?: string }

type Reply = {
  id: string
  message: string
  createdTime: string
  from: Author | null
  fromPage: boolean
}

export type CommentItem = {
  id: string
  message: string
  createdTime: string
  from: Author | null
  likeCount: number
  fromPage: boolean
  needsReply: boolean
  hidden: boolean
  replies: Reply[]
  permalink?: string
  postId: string
  postMessage: string
  postPermalink?: string
  pageId: string
  pageName: string
}

type Stat = { id: string; name: string; needsReply: number | null; total: number; error?: string }

type Response = {
  success: boolean
  needsPermission?: boolean
  reason?: string
  missing?: string[]
  capability?: { missing: string[]; degraded: string[]; reason?: string }
  pages?: { id: string; name: string }[]
  pageStats?: Stat[]
  comments?: CommentItem[]
  error?: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const relative = (iso: string) => {
  const t = new Date(iso).getTime()
  return t ? formatDistanceToNow(t, { addSuffix: true }) : ''
}

type Filter = 'needs-reply' | 'all' | 'hidden'

export function CommentsChannel() {
  const [scope, setScope] = useState<string>(ALL_PAGES)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('needs-reply')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const { data, isLoading, mutate, isValidating } = useSWR<Response>(
    `/api/inbox/comments?pageId=${encodeURIComponent(scope)}`,
    fetcher,
    { refreshInterval: 90_000, revalidateOnFocus: true },
  )

  const switchScope = (next: string) => {
    setSelectedId(null)
    setScope(next)
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-3 p-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    )
  }

  if (data?.needsPermission) {
    return (
      <ChannelUnavailable
        title="Comments need one more permission"
        description={
          data.capability?.reason ??
          data.error ??
          'The access token cannot read comments written by customers.'
        }
        missing={data.capability?.missing ?? data.missing ?? []}
        steps={[
          'Open the Graph API Explorer and select the Ads Manager app.',
          'Add pages_read_user_content (to read comments) and pages_manage_engagement (to hide or delete them).',
          'Click Generate Access Token and approve the new permissions — ticking the boxes alone does not change the live token.',
          'Replace FACEBOOK_ACCESS_TOKEN in the project settings with the new token, keeping every existing scope including ads_management.',
        ]}
      />
    )
  }

  if (!data?.success) {
    return (
      <div className="flex flex-1 items-start p-6">
        <div className="w-full rounded-lg border border-destructive/40 bg-destructive/5 p-6">
          <p className="font-medium">Could not load comments</p>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{data?.error ?? 'Unknown error'}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => mutate()}>
            Try again
          </Button>
        </div>
      </div>
    )
  }

  const all = data.comments ?? []
  const pages = data.pages ?? []
  const stats: Stat[] = data.pageStats ?? []
  const combined = scope === ALL_PAGES
  const failed = stats.filter((s) => s.error)
  const canModerate = !(data.capability?.degraded ?? []).includes('pages_manage_engagement')

  const q = query.trim().toLowerCase()
  const comments = all.filter((c) => {
    if (filter === 'needs-reply' && !c.needsReply) return false
    if (filter === 'hidden' && !c.hidden) return false
    if (!q) return true
    return (
      (c.from?.name ?? '').toLowerCase().includes(q) ||
      c.message.toLowerCase().includes(q) ||
      c.postMessage.toLowerCase().includes(q) ||
      (combined && c.pageName.toLowerCase().includes(q))
    )
  })

  const selected = all.find((c) => c.id === selectedId) ?? null
  const needsReplyCount = all.filter((c) => c.needsReply).length

  const act = async (action: string, comment: CommentItem, message?: string) => {
    setBusy(action)
    setActionError(null)
    try {
      const res = await fetch('/api/inbox/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The Page comes from the comment, never the current selection.
        body: JSON.stringify({ action, commentId: comment.id, pageId: comment.pageId, message }),
      })
      const json = (await res.json()) as { success: boolean; error?: string }
      if (!json.success) throw new Error(json.error ?? 'Action failed')
      if (action === 'reply') setDraft('')
      if (action === 'delete') setSelectedId(null)
      await mutate()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  const filters: { id: Filter; label: string; count?: number }[] = [
    { id: 'needs-reply', label: 'Needs reply', count: needsReplyCount },
    { id: 'all', label: 'All', count: all.length },
    { id: 'hidden', label: 'Hidden' },
  ]

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      {/* List */}
      <div className="flex w-[420px] shrink-0 flex-col rounded-xl border border-border bg-card xl:w-[28vw] xl:max-w-[560px]">
        <div className="flex flex-col gap-3 border-b border-border p-4">
          <PageScopeSelect
            pages={pages}
            stats={stats.map((s) => ({ id: s.id, name: s.name, count: s.needsReply, error: s.error }))}
            value={scope}
            onChange={switchScope}
          />
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Comments</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => mutate()}
              aria-label="Refresh comments"
              className="h-8 w-8"
            >
              <RefreshCw className={`h-4 w-4 ${isValidating ? 'animate-spin' : ''}`} aria-hidden="true" />
            </Button>
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-1">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                aria-pressed={filter === f.id}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                  filter === f.id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {f.label}
                {f.count ? <span className="tabular-nums opacity-70">{f.count}</span> : null}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search comments or posts..."
              className="pl-9"
              aria-label="Search comments"
            />
          </div>

          {failed.length > 0 ? (
            <p className="text-xs leading-relaxed text-amber-500">
              Could not load {failed.map((p) => p.name).join(', ')}. Other pages are up to date.
            </p>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto">
          {comments.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <MessageSquareText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm text-muted-foreground text-pretty">
                {all.length === 0
                  ? 'No comments on recent posts'
                  : filter === 'needs-reply'
                    ? 'Every comment has been answered'
                    : 'Nothing matches that filter'}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col">
              {comments.map((c) => {
                const active = selectedId === c.id
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(c.id)
                        setDraft('')
                        setActionError(null)
                      }}
                      aria-current={active ? 'true' : undefined}
                      className={`flex w-full flex-col gap-1 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-muted/50 ${
                        active ? 'bg-muted' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium">{c.from?.name ?? 'Unknown'}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{relative(c.createdTime)}</span>
                      </div>
                      <span className="line-clamp-2 text-sm leading-relaxed text-muted-foreground text-pretty">
                        {c.message || 'No text'}
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {combined ? (
                          <Badge variant="secondary" className="h-5 max-w-full font-normal">
                            <span className="block w-full truncate text-left">{c.pageName}</span>
                          </Badge>
                        ) : null}
                        {c.needsReply ? (
                          <Badge variant="default" className="h-5">
                            Needs reply
                          </Badge>
                        ) : null}
                        {c.replies.length > 0 ? (
                          <Badge variant="outline" className="h-5 tabular-nums font-normal">
                            {c.replies.length} {c.replies.length === 1 ? 'reply' : 'replies'}
                          </Badge>
                        ) : null}
                        {c.hidden ? (
                          <Badge variant="outline" className="h-5 border-amber-500/40 text-amber-500">
                            Hidden
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

      {/* Detail */}
      <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-border bg-card">
        {selected ? (
          <>
            <div className="flex items-start justify-between gap-4 border-b border-border p-4">
              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="font-semibold">{selected.from?.name ?? 'Unknown'}</h3>
                <p className="text-xs text-muted-foreground">
                  {relative(selected.createdTime)}
                  {combined ? ` · via ${selected.pageName}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {selected.permalink ? (
                  <Button variant="ghost" size="sm" asChild className="h-8">
                    <a href={selected.permalink} target="_blank" rel="noreferrer noopener">
                      Open
                      <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={busy !== null}
                  onClick={() => act('like', selected)}
                  aria-label="Like this comment as the Page"
                >
                  <Heart className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  disabled={busy !== null || !canModerate}
                  onClick={() => act(selected.hidden ? 'unhide' : 'hide', selected)}
                  aria-label={selected.hidden ? 'Unhide this comment' : 'Hide this comment'}
                  title={canModerate ? undefined : 'Requires pages_manage_engagement'}
                >
                  {selected.hidden ? (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  disabled={busy !== null || !canModerate}
                  onClick={() => act('delete', selected)}
                  aria-label="Delete this comment"
                  title={canModerate ? undefined : 'Requires pages_manage_engagement'}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <div className="flex flex-col gap-4 lg:max-w-[80ch]">
                {/* Post context: a comment is meaningless without the post. */}
                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    On this post
                  </p>
                  <p className="line-clamp-3 text-sm leading-relaxed text-pretty">
                    {selected.postMessage || 'No caption'}
                  </p>
                  {selected.postPermalink ? (
                    <a
                      href={selected.postPermalink}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-2 inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
                    >
                      View post
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  ) : null}
                </div>

                <div className="rounded-lg border border-border p-4">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-pretty">
                    {selected.message || 'No text'}
                  </p>
                  {selected.likeCount > 0 ? (
                    <p className="mt-2 text-xs tabular-nums text-muted-foreground">{selected.likeCount} likes</p>
                  ) : null}
                </div>

                {selected.replies.map((r) => (
                  <div key={r.id} className="flex gap-2 pl-6">
                    <CornerDownRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div
                      className={`flex-1 rounded-lg p-3 ${
                        r.fromPage ? 'bg-primary/10 text-foreground' : 'bg-muted'
                      }`}
                    >
                      <p className="text-xs font-medium">
                        {r.from?.name ?? 'Unknown'}
                        {r.fromPage ? ' (you)' : ''}
                        <span className="ml-2 font-normal text-muted-foreground">{relative(r.createdTime)}</span>
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-pretty">{r.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-border p-4">
              {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
              <div className="flex items-end gap-2">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter may confirm CJK composition; never submit mid-compose.
                    if (e.key !== 'Enter' || e.shiftKey) return
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return
                    e.preventDefault()
                    if (draft.trim()) act('reply', selected, draft.trim())
                  }}
                  placeholder={`Reply publicly as ${selected.pageName}...`}
                  className="min-h-[44px] resize-none"
                  aria-label="Reply to this comment"
                />
                <Button
                  onClick={() => act('reply', selected, draft.trim())}
                  disabled={!draft.trim() || busy !== null}
                  aria-label="Send reply"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Replying as {selected.pageName} · this reply is public on the post
              </p>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <MessageSquareText className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
            <p className="text-muted-foreground">Select a comment to read the post and reply</p>
          </div>
        )}
      </div>
    </div>
  )
}
