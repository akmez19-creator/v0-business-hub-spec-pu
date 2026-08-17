'use client'

/**
 * The middle column: one conversation, whichever channel it arrived on.
 *
 * The reply box is pre-filled with the AI draft but never sends by itself -
 * the agent edits and presses Send. A draft the agent has touched is never
 * overwritten by a later AI result.
 */

import { useEffect, useRef } from 'react'
import { format } from 'date-fns'
import {
  AlertTriangle,
  Loader2,
  Megaphone,
  MessageCircle,
  MessageSquare,
  Phone,
  RefreshCw,
  Send,
  Sparkles,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import type { LeadMessage } from '@/lib/inbox/lead-actions'
import type { UnifiedChannel, UnifiedThread } from '@/lib/inbox/unified'

const CHANNEL_ICON: Record<UnifiedChannel, typeof Phone> = {
  messenger: MessageCircle,
  whatsapp: Phone,
  comment: MessageSquare,
}

const CHANNEL_LABEL: Record<UnifiedChannel, string> = {
  messenger: 'Messenger',
  whatsapp: 'WhatsApp',
  comment: 'Comment',
}

export function LeadConversation({
  thread,
  messages,
  loading,
  rateLimited,
  draft,
  onDraftChange,
  onSend,
  sending,
  aiPending,
  aiError,
  onRegenerate,
}: {
  thread: UnifiedThread
  messages: LeadMessage[]
  loading: boolean
  rateLimited: boolean
  draft: string
  onDraftChange: (v: string) => void
  onSend: () => void
  sending: boolean
  aiPending: boolean
  aiError: string | null
  onRegenerate: () => void
}) {
  const endRef = useRef<HTMLDivElement>(null)

  // Land on the newest message, which is what the agent needs to answer.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [thread.key, messages.length])

  const Icon = CHANNEL_ICON[thread.channel]
  const isComment = thread.channel === 'comment'

  return (
    <section className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <h2 className="truncate font-semibold">{thread.name}</h2>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {CHANNEL_LABEL[thread.channel]} · {thread.source}
            {thread.messageCount > 1 ? (
              <span className="tabular-nums"> · {thread.messageCount} messages</span>
            ) : null}
          </p>
          {thread.product ? (
            <p className="flex items-center gap-1.5 text-xs text-primary" title={thread.adName ?? undefined}>
              {thread.productSource === 'comment' ? (
                <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <Megaphone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              <span className="truncate">
                {thread.productSource === 'comment' ? 'Commented on' : 'From ad'}: {thread.product}
              </span>
            </p>
          ) : null}
        </div>
        {thread.outsideWindow ? (
          <Badge variant="outline" className="shrink-0 gap-1.5 border-amber-500/40 text-amber-500">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            24h window closed
          </Badge>
        ) : null}
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {isComment ? (
          // A comment has no thread to load: show the comment itself so the
          // agent is answering something visible, not an empty pane.
          <div className="mx-auto w-full max-w-[900px]">
            <div className="rounded-xl bg-muted p-4">
              <p className="text-pretty text-sm leading-relaxed">{thread.snippet}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {thread.updatedAt ? format(new Date(thread.updatedAt), 'd MMM HH:mm') : ''}
              </p>
            </div>
            {/* Meta withholds the author on public comments until Page Public
                Content Access is approved. Say so, rather than showing a
                nameless row that looks like a bug. */}
            {thread.name === 'Facebook user' ? (
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground text-pretty">
                Facebook does not release commenter names to this app, so this person shows as
                &quot;Facebook user&quot;. Replying still works normally.
              </p>
            ) : null}
          </div>
        ) : loading ? (
          <div className="mx-auto flex w-full max-w-[900px] flex-col gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-2/3" />
            ))}
          </div>
        ) : rateLimited ? (
          // A throttle is transient and says nothing about the token. Never
          // suggest regenerating it - that swaps a permanent token for one
          // that expires in about two hours.
          <div className="mx-auto max-w-[900px] rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
            <p className="text-sm font-medium">History not available right now</p>
            <p className="mt-1 text-sm text-muted-foreground text-pretty">
              Facebook is rate limiting the app, so this conversation&apos;s history cannot be
              fetched. It clears on its own, usually within the hour, and your access token is fine
              and does not need regenerating.
            </p>
          </div>
        ) : messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages stored for this conversation.</p>
        ) : (
          <ul className="mx-auto flex w-full max-w-[900px] flex-col gap-3">
            {messages.map((m) => (
              <li key={m.id} className={`flex ${m.fromBusiness ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`flex max-w-[75%] flex-col gap-1 rounded-xl px-4 py-2.5 lg:max-w-[62ch] ${
                    m.fromBusiness ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                  }`}
                >
                  {m.text ? <p className="text-pretty text-sm leading-relaxed">{m.text}</p> : null}
                  {m.attachments.map((a, i) =>
                    a.url ? (
                      <a
                        key={i}
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs underline underline-offset-2 opacity-80"
                      >
                        Attachment ({a.type})
                      </a>
                    ) : null,
                  )}
                  <span className="text-[11px] opacity-60 tabular-nums">
                    {m.createdAt ? format(new Date(m.createdAt), 'd MMM HH:mm') : ''}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div ref={endRef} />
      </div>

      <div className="flex flex-col gap-2 border-t border-border p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {aiPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Drafting a reply...
              </>
            ) : aiError ? (
              <span className="text-amber-500">{aiError}</span>
            ) : draft ? (
              <>
                <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                AI draft — edit before sending
              </>
            ) : (
              'Write a reply'
            )}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRegenerate}
            disabled={aiPending}
            className="h-7 gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${aiPending ? 'animate-spin' : ''}`} aria-hidden="true" />
            Redraft
          </Button>
        </div>

        <Textarea
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter newlines. isComposing (and the 229
            // keyCode Safari reports) guard IME confirmation.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
              e.preventDefault()
              onSend()
            }
          }}
          placeholder={isComment ? 'Reply publicly to this comment...' : 'Write a reply...'}
          rows={3}
          className="resize-none"
          aria-label="Reply message"
        />

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Replying as {thread.source} · Enter to send
          </p>
          <Button onClick={onSend} disabled={!draft.trim() || sending} size="sm">
            <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {sending ? 'Sending...' : 'Send'}
          </Button>
        </div>
      </div>
    </section>
  )
}
