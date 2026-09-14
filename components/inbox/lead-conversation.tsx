'use client'

/**
 * The middle column: one conversation, whichever channel it arrived on.
 *
 * AI assistance is an explicit action. The agent reviews the suggested draft
 * and presses Send; edits made while assistance runs always take precedence.
 */

import { useEffect, useRef, useState } from 'react'
import { whatsappReplyUnavailable } from '@/lib/inbox/whatsapp-identity'
import { LeadAttachment } from './lead-attachment'
import type { CommentItem } from './comments-channel'
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
import { GreenMessageCopies } from './green-message-copies'
import type { GreenContextStatus } from './green-copies-client'

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

/** Display only: sending permissions and message tags stay server-side. */
export function messengerReplyWindow(messages: Pick<LeadMessage, 'createdAt' | 'fromBusiness'>[], now: number): 'open' | 'closed' | 'unverified' {
  let latestIncoming: number | null = null
  for (const message of messages) {
    if (message.fromBusiness || !message.createdAt) continue
    const at = Date.parse(message.createdAt)
    if (Number.isFinite(at) && (latestIncoming === null || at > latestIncoming)) latestIncoming = at
  }
  return latestIncoming === null ? 'unverified' : now - latestIncoming >= 24 * 60 * 60 * 1000 ? 'closed' : 'open'
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
  sendError,
  onDismissSendError,
  aiPending,
  aiError,
  aiHasRun,
  onRegenerate,
  error,
  onRefresh,
  updating,
  draftOrigin,
  comment,
  visible,
  aiBlockedReason,
  onGreenContextChange,
}: {
  thread: UnifiedThread
  messages: (LeadMessage & { status?: string | null; receiptOnly?: boolean })[]
  loading: boolean
  rateLimited: boolean
  draft: string
  onDraftChange: (v: string) => void
  onSend: () => void
  sending: boolean
  sendError?: string | null
  onDismissSendError?: () => void
  aiPending: boolean
  aiError: string | null
  aiHasRun: boolean
  onRegenerate: () => void
  error: string | null
  onRefresh: () => void
  updating: boolean
  draftOrigin: 'manual' | 'ai' | 'order'
  comment?: CommentItem
  visible: boolean
  aiBlockedReason?: string | null
  onGreenContextChange?: (value: GreenContextStatus | null) => void
}) {
  const endRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const previousThread = useRef(thread.key)
  const [newMessages, setNewMessages] = useState(false)
  const lastMessageId = messages.at(-1)?.id
  const lastCommentReplyId = comment?.replies.at(-1)?.id
  const previousActivity = useRef<string | undefined>(undefined)

  // Land on the newest message, which is what the agent needs to answer.
  useEffect(() => {
    if (!visible) return
    const changed = previousThread.current !== thread.key
    const activity = lastMessageId ?? lastCommentReplyId
    const newActivity = activity !== previousActivity.current
    previousThread.current = thread.key
    previousActivity.current = activity
    if (changed || nearBottom.current) {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      nearBottom.current = true
      setNewMessages(false)
    } else if (newActivity) setNewMessages(true)
  }, [thread.key, messages.length, lastMessageId, lastCommentReplyId, visible])

  const Icon = CHANNEL_ICON[thread.channel]
  const isComment = thread.channel === 'comment'
  const replyUnavailable = thread.channel === 'whatsapp'
    ? whatsappReplyUnavailable({ waId: thread.recipientId ?? '', phoneNumberId: thread.phoneNumberId, canSend: thread.canSend }) : null
  const replyWindow = thread.channel === 'messenger' ? messengerReplyWindow(messages, Date.now()) : thread.outsideWindow ? 'closed' : 'open'

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <h2 className="truncate font-semibold">{thread.name}</h2>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {CHANNEL_LABEL[thread.channel]} · {thread.source}
            {thread.channel === 'messenger' && messages.length > 0 ? (
              <span className="tabular-nums"> · {messages.length} messages loaded</span>
            ) : thread.channel !== 'messenger' && thread.messageCount > 1 ? (
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
              <span className="truncate" title={thread.productSource === 'comment' ? undefined : 'Historical ad attribution. Check the latest request and photos before choosing an order product.'}>
                {thread.productSource === 'comment' ? 'Commented on' : 'Earlier ad'}: {thread.product}
              </span>
            </p>
          ) : null}
        </div>
        {replyWindow !== 'open' ? (
          <Badge variant="outline" title={thread.channel === 'messenger' ? 'Based on loaded messages from the customer' : undefined} className="shrink-0 gap-1.5 border-amber-500/40 text-amber-500">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            {replyWindow === 'unverified' ? 'Reply window unverified' : '24h window closed'}
          </Badge>
        ) : null}
      </header>

      {error ? <div role="status" className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs"><span className="flex-1">{error} Loaded history has been kept.</span><Button size="sm" variant="ghost" onClick={onRefresh}>Retry</Button></div> : null}
      <div ref={scrollRef} onScroll={(event) => { const el = event.currentTarget; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96; if (nearBottom.current) setNewMessages(false) }} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        {isComment ? (
          // A comment has no thread to load: show the comment itself so the
          // agent is answering something visible, not an empty pane.
          <div className="mx-auto w-full max-w-[900px]">
            {comment?.postMessage ? <div className="mb-3 rounded-lg border p-3 text-xs"><p className="mb-1 font-medium">Post context</p><p className="whitespace-pre-wrap text-muted-foreground">{comment.postMessage}</p></div> : null}
            {comment?.permalink || comment?.postPermalink ? <a href={comment.permalink || comment.postPermalink} target="_blank" rel="noopener noreferrer" className="mb-3 inline-block text-xs underline">Open on Facebook</a> : null}
            <div className="rounded-xl bg-muted p-4">
              <p className="whitespace-pre-wrap break-words text-pretty text-sm leading-relaxed">{thread.snippet}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {comment?.createdTime || thread.updatedAt ? format(new Date(comment?.createdTime || thread.updatedAt!), 'd MMM HH:mm') : ''}
              </p>
            </div>
            {comment?.replies.map((reply) => <div key={reply.id} className={'mt-3 max-w-[90%] rounded-xl p-3 text-sm ' + (reply.fromPage ? 'ml-auto bg-primary text-primary-foreground' : 'bg-muted')}><p className="mb-1 text-[11px] opacity-70">{reply.from?.name || (reply.fromPage ? thread.source : 'Facebook user')}</p><p className="whitespace-pre-wrap break-words">{reply.message}</p></div>)}
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
        ) : loading && messages.length === 0 ? (
          <div className="mx-auto flex w-full max-w-[900px] flex-col gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-2/3" />
            ))}
          </div>
        ) : rateLimited && messages.length === 0 ? (
          // A throttle is transient and says nothing about the token. Never
          // suggest regenerating it - that swaps a permanent token for one
          // that expires in about two hours.
          <div className="mx-auto max-w-[900px] rounded-lg border border-blue-500/30 bg-blue-500/10 p-4">
            <p className="text-sm font-medium">History not available right now</p>
            <p className="mt-1 text-sm text-muted-foreground text-pretty">
              Facebook has limited a history request. Please retry after a short wait.
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
                  {m.text.trim() ? <p className="whitespace-pre-wrap break-words text-pretty text-sm leading-relaxed">{m.text}</p> : !m.attachments.length ? <p className="text-xs italic opacity-70">{m.receiptOnly ? 'Delivery status only · message content is unavailable.' : 'Message content is unavailable.'}</p> : null}
                  {m.attachments.map((attachment, index) => <LeadAttachment key={`${m.id}:${index}:${attachment.url}`} {...attachment} />)}
                  <span className="text-[11px] opacity-60 tabular-nums">
                    {m.createdAt ? format(new Date(m.createdAt), 'd MMM HH:mm') : ''}
                    {m.fromBusiness && m.status ? ` · ${m.status}` : ''}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {thread.channel === 'whatsapp' && thread.phoneNumberId && thread.recipientId && onGreenContextChange && <GreenMessageCopies
          key={`${thread.phoneNumberId}:${thread.recipientId}`} scope={{ phoneNumberId: thread.phoneNumberId, waId: thread.recipientId }}
          businessName={thread.source} visible={visible} onContextChange={onGreenContextChange} />}
        <div ref={endRef} />
      </div>

      {newMessages ? <button className="shrink-0 bg-primary/10 px-4 py-2 text-xs font-medium text-primary" onClick={() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; nearBottom.current = true; setNewMessages(false) }}>New messages · jump to latest</button> : null}

      <div className="flex shrink-0 flex-col gap-2 border-t border-border p-3">
        {sendError ? (
          <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium">Send needs attention</p>
              {onDismissSendError ? <Button type="button" variant="ghost" size="sm" onClick={onDismissSendError} className="h-auto shrink-0 px-2 py-0.5 text-xs" aria-label="Dismiss send notice">Dismiss</Button> : null}
            </div>
            <p className="mt-1 break-words">{sendError}</p>
            <p className="mt-1 text-xs text-muted-foreground">Your draft is kept. Check the conversation before sending again.</p>
          </div>
        ) : null}
        {aiBlockedReason && <p role="status" className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">{aiBlockedReason}</p>}
        {replyUnavailable ? <p role="status" className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">{replyUnavailable}</p> : null}
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {aiPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Drafting a reply...
              </>
            ) : aiError ? (
              <span className="text-amber-500">{aiError}</span>
            ) : draft && draftOrigin === 'ai' ? (
              <>
                <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                AI draft — edit before sending
              </>
            ) : (
              updating ? 'Checking for new messages…' : 'Write a reply'
            )}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={onRegenerate}
            disabled={aiPending || Boolean(aiBlockedReason)}
            aria-label={aiHasRun ? 'Redraft reply and order with AI' : 'Draft reply and order with AI'}
            title="Suggest a reply and fill untouched order fields. Nothing is sent or ordered automatically."
            className="h-7 gap-1.5 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${aiPending ? 'animate-spin' : ''}`} aria-hidden="true" />
            {aiPending ? 'Working…' : aiError ? 'Retry AI assistance' : aiHasRun ? 'Redraft with AI' : 'Draft with AI'}
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
              if (!replyUnavailable) onSend()
            }
          }}
          placeholder={isComment ? 'Reply publicly to this comment...' : 'Write a reply...'}
          rows={3}
          className="resize-none"
          aria-label="Reply message"
        />

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {replyUnavailable ? thread.source : `Replying as ${thread.source} · Enter to send`}
          </p>
          <Button onClick={onSend} disabled={!draft.trim() || sending || Boolean(replyUnavailable)} size="sm">
            <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {sending ? 'Sending...' : 'Send'}
          </Button>
        </div>
      </div>
    </section>
  )
}
