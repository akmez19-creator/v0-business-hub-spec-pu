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
import { StarDialog } from './star-dialog'
import { MediaPicker, type ComposerAttachment } from './media-picker'
import type { CommentItem } from './comments-channel'
import { format } from 'date-fns'
import {
  AlertTriangle,
  CheckCheck,
  ChevronDown,
  Loader2,
  PackageCheck,
  ThumbsUp,
  UserX,
  Smartphone,
  Megaphone,
  MessageCircle,
  MessageSquare,
  Phone,
  RefreshCw,
  Send,
  Sparkles,
  X,
  MoreHorizontal,
  Star,
  EyeOff,
  Eye,
  Trash2,
  Ban,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { THREAD_MARK_DESCRIPTIONS, THREAD_MARK_KINDS, THREAD_MARK_LABELS, type ThreadMarkKind } from '@/lib/inbox/thread-marks'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

export type CommentModeration = 'hide' | 'unhide' | 'delete' | 'block'
import type { LeadMessage } from '@/lib/inbox/lead-actions'
import type { UnifiedChannel, UnifiedThread } from '@/lib/inbox/unified'
import { DraftReadinessWatch } from './draft-readiness-watch'
import type { DraftContextStatus } from './draft-readiness-client'

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

function MarkIcon({ kind, className }: { kind: ThreadMarkKind; className?: string }) {
  const Icon = kind === 'confirmed' ? PackageCheck : kind === 'not-interested' ? UserX : CheckCheck
  return <Icon className={className} aria-hidden="true" />
}

const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/g

/** Shared pins arrive as a maps link; make any URL in a bubble tappable. */
function linkify(text: string) {
  const parts = text.split(URL_PATTERN)
  if (parts.length === 1) return text
  return parts.map((part, index) =>
    index % 2 === 1
      ? <a key={index} href={part} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 break-all">{part.startsWith('https://maps.google.com/') ? 'Open in Google Maps' : part}</a>
      : part,
  )
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
  aiNotice = null,
  aiHasRun,
  onRegenerate,
  error,
  onRefresh,
  updating,
  onMark,
  onStar,
  onModerateComment,
  draftOrigin,
  comment,
  visible,
  aiBlockedReason,
  readabilityNotice = null,
  onGreenContextChange,
  sendCreatesOrder,
  sendUpdatesOrder,
  attachment,
  onAttach,
  onRemoveAttachment,
  mediaProductId,
}: {
  thread: UnifiedThread
  /** Staged photo/video that goes out with the draft as its caption. */
  attachment?: ComposerAttachment | null
  onAttach?: (attachment: ComposerAttachment) => void
  onRemoveAttachment?: () => void
  /** Product the picker opens on: the Quick order product, else the ad's. */
  mediaProductId?: string | null
  /** The draft is an order confirmation, so Send will record the Quick Order first. */
  sendCreatesOrder?: boolean
  /** What this send changes on an order that already exists, e.g. "Delivery date, Locality". */
  sendUpdatesOrder?: string | null
  messages: (LeadMessage & { status?: string | null; receiptOnly?: boolean; fromCopy?: boolean })[]
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
  aiNotice?: string | null
  aiHasRun: boolean
  onRegenerate: () => void
  error: string | null
  onRefresh: () => void
  updating: boolean
  /** Sets or clears the agent's outcome on this chat. Absent for read-only hosts. */
  onMark?: (kind: ThreadMarkKind | null) => void
  /** null removes the star; a string is the mandatory explanation. Resolves true when saved. */
  onStar?: (note: string | null) => Promise<boolean>
  /** Hide, delete or ban on a comment thread. Absent for read-only hosts. */
  onModerateComment?: (action: CommentModeration) => Promise<void> | void
  draftOrigin: 'manual' | 'ai' | 'order'
  comment?: CommentItem
  visible: boolean
  aiBlockedReason?: string | null
  /** Present only when the block is one the agent may waive (photos they have looked at). */
  /** What the AI could not read in this thread. Shown beside the finished draft; never blocks it. */
  readabilityNotice?: string | null
  onGreenContextChange?: (value: DraftContextStatus | null) => void
}) {
  const endRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const nearBottom = useRef(true)
  const previousThread = useRef(thread.key)
  const [newMessages, setNewMessages] = useState(false)
  const [confirmModeration, setConfirmModeration] = useState<'delete' | 'block' | null>(null)
  const [moderating, setModerating] = useState(false)
  const [starOpen, setStarOpen] = useState(false)
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
          {thread.mark ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MarkIcon kind={thread.mark.kind} className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{THREAD_MARK_LABELS[thread.mark.kind]} · {format(new Date(thread.mark.at), 'd MMM HH:mm')}{thread.mark.by ? ` by ${thread.mark.by}` : ''} · reopens if the customer writes again</span>
            </p>
          ) : thread.closingAck ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ThumbsUp className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">Closed by the client: their last message only acknowledges your reply</span>
            </p>
          ) : thread.done ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">Marked Done in Meta Business Suite · {format(new Date(thread.done.at), 'd MMM HH:mm')} · reopens if the customer writes again</span>
            </p>
          ) : thread.answeredByPhone ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Smartphone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">Last reply was sent from the phone (seen by GREEN-API), not through this inbox</span>
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {replyWindow !== 'open' ? (
            <Badge variant="outline" title={thread.channel === 'messenger' ? 'Based on loaded messages from the customer' : undefined} className="shrink-0 gap-1.5 border-amber-500/40 text-amber-500">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              {replyWindow === 'unverified' ? 'Reply window unverified' : '24h window closed'}
            </Badge>
          ) : null}
          {onStar ? (
            <Button
              size="sm"
              variant="outline"
              className={`h-7 gap-1.5 text-xs ${thread.star ? 'border-amber-500/50 text-amber-500 hover:text-amber-500' : ''}`}
              onClick={() => setStarOpen(true)}
              title={thread.star ? `Starred by ${thread.star.starredByName ?? 'a teammate'}: ${thread.star.note}` : 'Flag this conversation for the team with an explanation'}
            >
              <Star className={`h-3.5 w-3.5 ${thread.star ? 'fill-current' : ''}`} aria-hidden="true" />
              {thread.star ? 'Starred' : 'Star'}
            </Button>
          ) : null}
          {onMark ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant={thread.mark ? 'secondary' : 'outline'} className="h-7 gap-1.5 text-xs">
                  {thread.mark ? <MarkIcon kind={thread.mark.kind} className="h-3.5 w-3.5" /> : null}
                  {thread.mark ? THREAD_MARK_LABELS[thread.mark.kind] : 'Mark as'}
                  <ChevronDown className="h-3 w-3 opacity-60" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-xs text-muted-foreground">{isComment ? 'Takes this comment out of Needs reply until they comment again' : 'Takes this chat out of Needs reply until the customer writes again'}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {THREAD_MARK_KINDS.map((kind) => (
                  <DropdownMenuItem key={kind} onSelect={() => onMark(kind)} className="flex-col items-start gap-0.5" aria-checked={thread.mark?.kind === kind} role="menuitemradio">
                    <span className="flex items-center gap-2 text-sm"><MarkIcon kind={kind} className="h-3.5 w-3.5" />{THREAD_MARK_LABELS[kind]}{thread.mark?.kind === kind ? <span className="text-xs text-muted-foreground">· current</span> : null}</span>
                    <span className="text-xs text-muted-foreground">{THREAD_MARK_DESCRIPTIONS[kind]}</span>
                  </DropdownMenuItem>
                ))}
                {thread.mark ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onMark(null)}>Remove mark</DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {isComment && onModerateComment ? (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 w-7 p-0" aria-label="Comment actions" disabled={moderating}>
                    <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel className="text-xs text-muted-foreground">Moderate on Facebook</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {comment?.hidden ? (
                    <DropdownMenuItem onSelect={() => { setModerating(true); void Promise.resolve(onModerateComment('unhide')).finally(() => setModerating(false)) }} className="gap-2">
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />Unhide comment
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => { setModerating(true); void Promise.resolve(onModerateComment('hide')).finally(() => setModerating(false)) }} className="flex-col items-start gap-0.5">
                      <span className="flex items-center gap-2"><EyeOff className="h-3.5 w-3.5" aria-hidden="true" />Hide comment</span>
                      <span className="text-xs text-muted-foreground">Only they and their friends still see it</span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => setConfirmModeration('delete')} className="flex-col items-start gap-0.5">
                    <span className="flex items-center gap-2"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Delete comment</span>
                    <span className="text-xs text-muted-foreground">Removed from the post for everyone</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setConfirmModeration('block')} className="flex-col items-start gap-0.5 text-destructive focus:text-destructive">
                    <span className="flex items-center gap-2"><Ban className="h-3.5 w-3.5" aria-hidden="true" />Ban {thread.name} from the Page</span>
                    <span className="text-xs text-muted-foreground">Hides all their comments; they can no longer comment or message the Page</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <AlertDialog open={confirmModeration !== null} onOpenChange={(open) => { if (!open) setConfirmModeration(null) }}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{confirmModeration === 'block' ? `Ban ${thread.name} from ${thread.source}?` : 'Delete this comment?'}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {confirmModeration === 'block'
                        ? 'All their comments on the Page are hidden and they can no longer comment on posts or message the Page. This is the same as "Ban from Page" in Business Suite and can be undone there.'
                        : 'The comment is removed from the post on Facebook for everyone. This cannot be undone.'}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={moderating}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={moderating}
                      className={confirmModeration === 'block' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
                      onClick={(event) => {
                        event.preventDefault()
                        const action = confirmModeration
                        if (!action) return
                        setModerating(true)
                        void Promise.resolve(onModerateComment(action)).finally(() => { setModerating(false); setConfirmModeration(null) })
                      }}
                    >
                      {moderating ? 'Working...' : confirmModeration === 'block' ? 'Ban from Page' : 'Delete comment'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : null}
        </div>
      </header>

      {onStar ? (
        <StarDialog
          open={starOpen}
          onOpenChange={setStarOpen}
          existing={thread.star ?? null}
          customerName={thread.name}
          onSave={onStar}
        />
      ) : null}

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
                  {m.text.trim() ? <p className="whitespace-pre-wrap break-words text-pretty text-sm leading-relaxed">{linkify(m.text)}</p> : !m.attachments.length ? <p className="text-xs italic opacity-70">{m.receiptOnly ? 'Delivery status only · message content is unavailable.' : m.unavailable ? 'Unavailable from WhatsApp · a reaction, deleted or view-once message. Nothing to read.' : 'Message content is unavailable.'}</p> : null}
                  {m.attachments.map((attachment, index) => <LeadAttachment key={`${m.id}:${index}:${attachment.url}`} {...attachment} />)}
                  <span className="text-[11px] opacity-60 tabular-nums">
                    {m.createdAt ? format(new Date(m.createdAt), 'd MMM HH:mm') : ''}
                    {m.fromBusiness && m.status ? ` · ${m.status}` : ''}
                    {m.fromCopy ? ' · from WhatsApp history' : ''}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {thread.channel === 'whatsapp' && thread.phoneNumberId && thread.recipientId && onGreenContextChange && <DraftReadinessWatch
          key={`${thread.phoneNumberId}:${thread.recipientId}`} scope={{ phoneNumberId: thread.phoneNumberId, waId: thread.recipientId }}
          visible={visible} onContextChange={onGreenContextChange} />}
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
        {aiBlockedReason ? (
          <p role="status" className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">{aiBlockedReason}</p>
        ) : null}
        {/* The draft is already written; this only says what the AI could not
            read, so the agent checks it before sending. It never blocks. */}
        {readabilityNotice ? (
          <p role="status" className="flex items-start gap-1.5 rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
            <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1">{readabilityNotice}</span>
          </p>
        ) : null}
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
                {aiNotice ? <span className="text-amber-500"> · {aiNotice}</span> : null}
              </>
            ) : (
              updating ? 'Checking for new messages…' : 'Write a reply'
            )}
          </p>
          <div className="flex items-center gap-1.5">
            {!isComment && onAttach ? (
              <MediaPicker
                productId={mediaProductId ?? thread.productId ?? null}
                adId={thread.adId ?? null}
                disabled={sending || Boolean(replyUnavailable) || Boolean(attachment)}
                onAttach={onAttach}
                onInsertLink={(url) => onDraftChange(draft.trim() ? `${draft.trimEnd()}\n${url}` : url)}
              />
            ) : null}
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
        </div>

        {attachment ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-1.5 pr-2">
            {attachment.kind === 'image' ? (
              <img src={attachment.url} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
            ) : (
              <video src={attachment.url} muted playsInline preload="metadata" className="h-12 w-12 shrink-0 rounded bg-black object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{attachment.kind === 'image' ? 'Photo' : 'Video'} · {attachment.label}</p>
              <p className="text-xs text-muted-foreground">{thread.channel === 'messenger' ? 'Sent first, then your text as a message' : 'Your text is sent as the caption'}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={onRemoveAttachment} disabled={sending} className="h-7 px-2 text-xs" aria-label="Remove the attachment">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        ) : null}

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
          placeholder={isComment ? 'Reply privately to their inbox (a "check your inbox" note is posted under the comment)...' : 'Write a reply...'}
          rows={3}
          className="resize-none"
          aria-label="Reply message"
        />

        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {replyUnavailable ? thread.source
              : sendCreatesOrder ? 'Confirmation: the order is created from Quick order, then sent'
              : sendUpdatesOrder ? `${sendUpdatesOrder} on the open order, then sent`
              : `Replying as ${thread.source} · Enter to send`}
          </p>
          <Button onClick={onSend} disabled={(!draft.trim() && !attachment) || sending || Boolean(replyUnavailable)} size="sm">
            <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {sending ? (sendCreatesOrder ? 'Creating order...' : sendUpdatesOrder ? 'Updating order...' : 'Sending...')
              : sendCreatesOrder ? 'Create order & send'
              : sendUpdatesOrder ? 'Update order & send'
              : attachment ? (attachment.kind === 'image' ? 'Send photo' : 'Send video') : 'Send'}
          </Button>
        </div>
      </div>
    </section>
  )
}
