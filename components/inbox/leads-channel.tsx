'use client'

/**
 * The Leads workspace - the whole inbox in one screen.
 *
 * Three columns, left to right: who is waiting, what they said, and the order
 * that comes out of it. Messenger, WhatsApp and comments are merged into the
 * one list and filtered by stage, product and campaign, because an agent
 * works a queue of people, not a queue of channels.
 *
 * AI assistance runs only when explicitly requested. It can suggest a reply
 * and fill untouched order fields without sending or creating an order.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { CheckCheck, Inbox, MessageCircle, MessageSquare, Phone, RefreshCw, Search, SlidersHorizontal, Smartphone, Star, ThumbsUp, UserX, PackageCheck } from 'lucide-react'
import { effectiveMark, THREAD_MARK_LABELS, type ThreadMark, type ThreadMarkKind } from '@/lib/inbox/thread-marks'
import type { ThreadStar } from '@/lib/inbox/thread-stars'
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
import { useInboxLive, type InboxLiveChannel } from '@/hooks/use-inbox-live'
import { useInboxPresence, firstName, type InboxViewer } from '@/hooks/use-inbox-presence'
import { Users } from 'lucide-react'
import {
  campaignOptions,
  filterThreads,
  fromComment,
  fromMessenger,
  fromWhatsApp,
  productOptions,
  type ChannelFilter,
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
import { LeadConversation, type CommentModeration } from './lead-conversation'
import { QuickOrderPanel, type QuickOrderController } from './quick-order-panel'
import { containsExchangeTemplate, isOrderConfirmationMessage } from '@/lib/inbox/assist-prompt'
import { applyAssistResult, completeSend, newLeadSession, readInbox, seedOrderFromRecord, seedOrderFromThread, stableThreadKey, stableMessengerTranscriptUrl, type AssistResult, type LeadSession, type OrderOperation } from './inbox-session'
import { STAFF_CONVERSATION_EVENT, staffConversationIdentity, staffConversationThread } from './staff-conversation'
import type { CommentItem } from './comments-channel'
import { clientSilentWithin, inboxInvalidationKeys, isAwaitingCustomer, isWaitingOnUs, latestActivityAt, needsReplyWithin, NEEDS_REPLY_WINDOW_MS, newestConversations, presentTranscript, whatsappAcceptedWarning, type PresentedLeadMessage, type QueueView } from './inbox-behavior'
import { whatsappDraftBlock, whatsappDraftNotice, type DraftContextStatus } from './draft-readiness-client'
import { isReadableAttachmentType } from '@/lib/inbox/attachment-kinds'

const fetcher = readInbox
const listPolling = { refreshInterval: 8_000, revalidateOnFocus: true, revalidateOnReconnect: true, refreshWhenHidden: false, refreshWhenOffline: false }

const QUEUE_VIEWS: { value: QueueView; label: string }[] = [
  { value: 'needs-reply-24h', label: 'Needs reply · last 24h' },
  { value: 'client-silent-24h', label: 'No reply from client · last 24h' },
  { value: 'all', label: 'All conversations' },
  { value: 'needs-action', label: 'Needs reply · any age' },
  { value: 'client-silent', label: 'No reply from client · any age' },
  { value: 'closed', label: 'Closed · confirmed, not interested, ok/thanks' },
  { value: 'unread', label: 'Unread · last 24h' },
]

/** Compact "waited 3h" label for the needs-reply queue. */
function waitedFor(updatedAt: string | null, now: number): string {
  const at = updatedAt ? Date.parse(updatedAt) : Number.NaN
  if (!Number.isFinite(at)) return ''
  const minutes = Math.max(0, Math.round((now - at) / 60_000))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return hours < 48 ? `${hours}h ${String(minutes % 60).padStart(2, '0')}` : `${Math.floor(hours / 24)} days`
}

/** Comments sit in the same queue as chats: a comment on an ad is a lead
 *  waiting for a reply, answered privately into the commenter's inbox. */
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

/** API Page names win; incomplete comment metadata must never erase them. */
export function mergePageOptions(references: { id: string; name?: string | null }[], threads: { pageId: string | null; source: string }[]): { id: string; name: string }[] {
  const pages = new Map<string, { id: string; name: string }>()
  for (const reference of references) {
    if (!reference.id) continue
    const name = reference.name?.trim() ?? ''
    if (!pages.has(reference.id) || (!pages.get(reference.id)!.name && name)) pages.set(reference.id, { id: reference.id, name })
  }
  for (const thread of threads) {
    if (!thread.pageId) continue
    const name = thread.source.trim()
    if (!pages.has(thread.pageId) || (!pages.get(thread.pageId)!.name && name)) pages.set(thread.pageId, { id: thread.pageId, name })
  }
  return [...pages.values()].map((page) => ({ ...page, name: page.name || 'Facebook Page ' + page.id }))
}

export function LeadsChannel({ active = true, viewer = null }: { active?: boolean; viewer?: InboxViewer | null }) {
  const [query, setQuery] = useState('')
  const [queueView, setQueueView] = useState<QueueView>('needs-reply-24h')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [channel, setChannel] = useState<ChannelFilter>('all')
  const [product, setProduct] = useState<string>('all')
  const [campaign, setCampaign] = useState<string>('all')
  const [liveOnly, setLiveOnly] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [greenContext, setGreenContext] = useState<DraftContextStatus | null>(null)
  const onGreenContextChange = useCallback((value: DraftContextStatus | null) => { setGreenContext(value) }, [])

  const [page, setPage] = useState('all')
  const [mobilePane, setMobilePane] = useState<'queue' | 'conversation' | 'order'>('queue')
  const [prefetchTick, setPrefetchTick] = useState(0)
  const [desktop, setDesktop] = useState(false)
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const desktopQuery = window.matchMedia('(min-width: 1024px)')
    const wideQuery = window.matchMedia('(min-width: 1536px)')
    const update = () => { setDesktop(desktopQuery.matches); setWide(wideQuery.matches) }
    update()
    desktopQuery.addEventListener('change', update)
    wideQuery.addEventListener('change', update)
    return () => { desktopQuery.removeEventListener('change', update); wideQuery.removeEventListener('change', update) }
  }, [])
  const [sessions, setSessions] = useState<Record<string, LeadSession>>({})
  const [sendErrors, setSendErrors] = useState<Record<string, string>>({})
  const clearSendError = useCallback((key: string) => {
    setSendErrors((previous) => {
      if (!(key in previous)) return previous
      const next = { ...previous }
      delete next[key]
      return next
    })
  }, [])
  const [lastChecked, setLastChecked] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const syncInFlight = useRef(false)
  const selectedSnapshot = useRef<UnifiedThread | null>(null)
  const assistSequence = useRef(0)
  const sendsInFlight = useRef(new Set<string>())
  const { mutate: mutateCache } = useSWRConfig()
  const { toast } = useToast()
  const updateSession = useCallback((key: string, update: (value: LeadSession) => LeadSession) => {
    setSessions((previous) => {
      const before = previous[key] ?? newLeadSession()
      const after = update(before)
      return after === before ? previous : { ...previous, [key]: after }
    })
  }, [])
  const prefillOrder = useCallback((fields: Parameters<typeof seedOrderFromRecord>[1]) => {
    const key = selectedSnapshot.current?.key
    if (key) updateSession(key, (state) => seedOrderFromRecord(state, fields))
  }, [updateSession])

  const updateOrderOperation = useCallback((update: (value: OrderOperation) => OrderOperation) => {
    if (selectedKey) updateSession(selectedKey, (state) => {
      const next = update(state.orderOperation)
      return next === state.orderOperation ? state : { ...state, orderOperation: next }
    })
  }, [selectedKey, updateSession])
  const session = selectedKey ? sessions[selectedKey] ?? newLeadSession() : newLeadSession()
  const { draft, order, assisting, assistError, assistNotice, unmatched, sending } = session
  const messengerListKey = '/api/inbox?pageId=' + encodeURIComponent(page)
  const activeTranscript = useRef<string | null>(null)
  const invalidateLive = useCallback((channels: InboxLiveChannel[]) => {
    if (!active || document.visibilityState !== 'visible') return
    void Promise.allSettled(inboxInvalidationKeys(channels, messengerListKey, activeTranscript.current).map((key) => mutateCache(key)))
  }, [active, messengerListKey, mutateCache])
  const { isLive, lastEventAt } = useInboxLive({ active, onInvalidate: invalidateLive })
  const backgroundPolling = { ...listPolling, refreshInterval: active ? 8_000 : 0,
    revalidateOnFocus: active, revalidateOnReconnect: active, isPaused: () => !active }
  const messagePolling = { ...backgroundPolling, refreshInterval: active ? (isLive ? 30_000 : 8_000) : 0 }

  // Same SWR keys the rest of the app uses, so this view rides their cache
  // instead of issuing extra Graph calls.
  const { data: mData, error: mError, isLoading: ml, isValidating: mv, mutate: mMutate } = useSWR<{
    conversations?: Parameters<typeof fromMessenger>[0][]
    rateLimited?: boolean
    syncError?: string
    doneSyncError?: string
    pages?: { id: string; name: string }[]
  }>(messengerListKey, fetcher, messagePolling)

  const { data: wData, error: wError, isLoading: wl, isValidating: wv, mutate: wMutate } = useSWR<{
    contacts?: Parameters<typeof fromWhatsApp>[0][]
    additionalCopiesUnavailable?: boolean
  }>('/api/inbox/whatsapp', fetcher, messagePolling)

  const { data: cData, error: cError, isLoading: cl, isValidating: cv, mutate: cMutate } = useSWR<{
    comments?: CommentItem[]
    rateLimited?: boolean
    syncError?: string
    pages?: { id: string; name: string }[]
  }>('/api/inbox/comments?pageId=all', fetcher, backgroundPolling)

  // Agent-set outcomes (order confirmed / not interested / no reply needed).
  const { data: marksData, mutate: marksMutate } = useSWR<{ marks?: ThreadMark[] }>('/api/inbox/marks', fetcher, backgroundPolling)
  const marksByKey = useMemo(() => new Map((marksData?.marks ?? []).map((m) => [m.key, m])), [marksData])
  const { data: starsData, mutate: starsMutate } = useSWR<{ stars?: Record<string, ThreadStar> }>('/api/inbox/stars', fetcher, backgroundPolling)
  const starsByKey = useMemo(() => starsData?.stars ?? {}, [starsData])
  const starredCount = useMemo(() => Object.keys(starsByKey).length, [starsByKey])

  // Footprint for attendance: an agent opening a lead is work even when no
  // message follows. Posted once per thread per selection, never awaited.
  useEffect(() => {
    if (!selectedKey) return
    const thread = all.find((r) => r.key === selectedKey)
    void fetch('/api/inbox/activity', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ threadKey: selectedKey, channel: thread?.channel ?? null }),
      keepalive: true,
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the key change matters
  }, [selectedKey])

  // Cached data remains useful when an upstream synchronization is throttled.
  const throttled = Boolean(mData?.rateLimited || cData?.rateLimited)

  const all = useMemo<UnifiedThread[]>(
    () => [
      ...(mData?.conversations ?? []).map(fromMessenger).map((thread) => ({ ...thread, key: stableThreadKey(thread) })),
      ...(wData?.contacts ?? []).map(fromWhatsApp),
      // The page's own comments are not leads.
      // A hidden comment was moderated, not left unanswered.
      ...(cData?.comments ?? []).filter((c) => !c.fromPage).map((comment) => fromComment({ ...comment, authorName: comment.from?.name, needsReply: comment.needsReply && !comment.hidden,
        createdTime: latestActivityAt([comment.createdTime, ...comment.replies.map((reply) => reply.createdTime)]) })),
    ].map((thread) => {
      const mark = effectiveMark(marksByKey.get(thread.key), thread.updatedAt)
      const star = starsByKey[thread.key] ?? null
      return mark || star ? { ...thread, ...(mark ? { mark } : {}), ...(star ? { star } : {}) } : thread
    }),
    [mData, wData, cData, marksByKey, starsByKey],
  )

  const setStar = useCallback(async (key: string, note: string | null): Promise<boolean> => {
    const res = await fetch('/api/inbox/stars', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(note === null ? { threadKey: key, remove: true } : { threadKey: key, note }),
    })
    const json = await res.json().catch(() => ({})) as { error?: string }
    if (!res.ok) {
      toast({ title: note === null ? 'Could not remove the star' : 'Could not star this conversation', description: json.error ?? 'Try again.', variant: 'destructive' })
      return false
    }
    void starsMutate()
    toast({ title: note === null ? 'Star removed' : 'Starred - it now sits in the Starred list for the team' })
    return true
  }, [starsMutate, toast])

  const setMark = useCallback(async (key: string, kind: ThreadMarkKind | null) => {
    const previous = marksData
    void marksMutate(
      (current) => ({ marks: [...(current?.marks ?? []).filter((m) => m.key !== key), ...(kind ? [{ key, kind, at: new Date().toISOString() }] : [])] }),
      { revalidate: false },
    )
    const res = await fetch('/api/inbox/marks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, kind }) })
    if (!res.ok) {
      void marksMutate(previous, { revalidate: true })
      toast({ title: 'Could not save the mark', description: 'The conversation keeps its previous state.', variant: 'destructive' })
      return
    }
    void marksMutate()
  }, [marksData, marksMutate, toast])

  const moderateComment = useCallback(async (thread: UnifiedThread, action: CommentModeration) => {
    const res = await fetch('/api/inbox/comments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, commentId: thread.nativeId, pageId: thread.pageId }),
    })
    const json = await res.json().catch(() => ({})) as { success?: boolean; error?: string }
    if (!res.ok || !json.success) {
      toast({ title: action === 'block' ? 'Could not ban this person' : action === 'delete' ? 'Could not delete the comment' : 'Could not update the comment', description: json.error ?? 'Facebook did not accept the change.', variant: 'destructive' })
      return
    }
    toast({
      title: action === 'block' ? `${thread.name} is banned from ${thread.source}` : action === 'delete' ? 'Comment deleted on Facebook' : action === 'hide' ? 'Comment hidden' : 'Comment visible again',
      description: action === 'block' ? 'Their comments are hidden and they can no longer comment or message the Page.' : undefined,
    })
    if (action === 'delete' || action === 'block') setSelectedKey(null)
    void mutateCache('/api/inbox/comments?pageId=all')
  }, [toast])

  useEffect(() => {
    const openStaffThread = (event: Event) => {
      const identity = staffConversationIdentity((event as CustomEvent<unknown>).detail)
      if (!identity) return
      const thread = staffConversationThread(identity, all)
      selectedSnapshot.current = thread
      setSelectedKey(thread.key)
      setMobilePane('conversation')
      setPage('all'); setChannel('all'); setProduct('all'); setCampaign('all'); setQuery(''); setLiveOnly(false); setQueueView('all')
    }
    window.addEventListener(STAFF_CONVERSATION_EVENT, openStaffThread)
    return () => window.removeEventListener(STAFF_CONVERSATION_EVENT, openStaffThread)
  }, [all])

  /**
   * Options come from the selected channel, not from everything.
   *
   * Built from `all`, the dropdown offered Messenger-only products while
   * WhatsApp was selected, so choosing one emptied the list - the filter read
   * as broken when it was really offering choices that could never match.
   */
  const pages = useMemo(() => mergePageOptions([
    ...(mData?.pages ?? []), ...(cData?.pages ?? []),
  ], all), [mData?.pages, cData?.pages, all])
  const pageScoped = useMemo(() => page === 'all' ? all : all.filter((row) => row.pageId === page), [all, page])
  const inChannel = useMemo(
    () => (channel === 'all' ? pageScoped : pageScoped.filter((t) => t.channel === channel)),
    [pageScoped, channel],
  )
  const products = useMemo(() => productOptions(inChannel), [inChannel])
  const campaigns = useMemo(() => campaignOptions(inChannel), [inChannel])
  const rows = useMemo(
    () =>
      newestConversations(
        filterThreads(pageScoped, {
          channel: channel,
          ad: 'all',
          unreadOnly: false,
          query,
          // Queue views can narrow attention without changing newest-first order.
          product,
          campaign,
          liveOnly,
        }),
        queueView,
      ),
    [pageScoped, channel, query, product, campaign, liveOnly, queueView],
  )

  // A product picked on one channel usually does not exist on the next, and a
  // filter naming something absent hides every lead with no way to tell why.
  useEffect(() => {
    if (product !== 'all' && !products.some((p) => p.key === product)) setProduct('all')
    if (campaign !== 'all' && !campaigns.some((c) => c.id === campaign)) setCampaign('all')
  }, [products, campaigns, product, campaign])

  const selected = useMemo(
    () => all.find((r) => r.key === selectedKey) ?? (selectedSnapshot.current?.key === selectedKey ? selectedSnapshot.current : null),
    [all, selectedKey],
  )

  useEffect(() => { if (selected) selectedSnapshot.current = selected }, [selected])

  // Who else is on which lead. Announced only while the inbox is the active
  // surface so a tab parked on the setup panel does not look like an agent
  // sitting on a customer.
  const presence = useInboxPresence(viewer, active && selected ? selected.key : null)
  const othersHere = selected ? presence.byThread.get(selected.key) ?? [] : []

  // Pre-fill the order with the WhatsApp number and the ad's product as soon as
  // a lead is opened. seedOrderFromThread only fills empty, untouched fields and
  // never marks them touched, so the AI draft and the agent still override it.
  useEffect(() => {
    if (selected) updateSession(selected.key, (state) => seedOrderFromThread(state, selected))
  }, [selected, updateSession])

  // Transcript for the open lead. Comments have no thread, so the URL is null
  // and SWR simply does not fetch.
  const transcriptKey = selected ? stableMessengerTranscriptUrl(selected) ?? transcriptUrl(selected) : null
  const conversationVisible = active && Boolean(selected) && (mobilePane === 'conversation' || (mobilePane === 'queue' && desktop) || (mobilePane === 'order' && wide))
  const visibleTranscriptKey = conversationVisible ? transcriptKey : null
  useEffect(() => { activeTranscript.current = visibleTranscriptKey }, [visibleTranscriptKey])
  const { data: tData, error: tError, isLoading: tLoading, isValidating: tv, mutate: tMutate } = useSWR<{
    messages?: unknown[]
    hasMore?: boolean
    rateLimited?: boolean
    syncError?: string
  }>(visibleTranscriptKey, fetcher, { ...backgroundPolling, keepPreviousData: false, refreshInterval: active ? (isLive ? 30_000 : 4_000) : 0 })
  const transcriptSnapshots = useRef<Record<string, NonNullable<typeof tData>>>({})
  useEffect(() => {
    if (selectedKey && tData) transcriptSnapshots.current[selectedKey] = tData
  }, [selectedKey, tData])
  const transcriptData = tData ?? (selectedKey ? transcriptSnapshots.current[selectedKey] : undefined)

  const messages = useMemo<PresentedLeadMessage[]>(
    () => {
      if (!selected) return []
      const normalized = normaliseMessages(selected, transcriptData)
      if (selected.channel !== 'whatsapp') return presentTranscript(normalized)
      const raw = (transcriptData?.messages ?? []) as { id: string; type?: string; status?: string | null }[]
      return presentTranscript(normalized, raw)
    },
    [selected, transcriptData],
  )
  const latestCustomerMessage = messages.findLast((message) => !message.fromBusiness)
  // Photos, videos and shared reels are read by the AI itself before drafting
  // (lib/inbox/attachment-reader); only voice notes/files, or media the server
  // failed to open, stay invisible to it.
  const attachmentsUnread = selected ? Boolean(sessions[selected.key]?.attachmentsUnread) : false
  const unreadableKinds = latestCustomerMessage?.attachments.filter((a) => !isReadableAttachmentType(a.type)) ?? []
  const unreadCustomerAttachment = selected?.channel === 'messenger' && (unreadableKinds.length > 0 || attachmentsUnread)
  const draftInput = selected?.channel === 'whatsapp' ? {
    scope: { phoneNumberId: selected.phoneNumberId ?? '', waId: selected.recipientId ?? '' }, messages,
    loading: tLoading, error: !!tError || !!transcriptData?.syncError, hasMore: transcriptData?.hasMore, readiness: greenContext,
  } : null
  // Drafting only waits for states that clear on their own. Content the AI
  // cannot read no longer pauses it: the agent could never fix that by looking,
  // so the draft is written and the gap is reported instead.
  const aiBlockedReason = draftInput ? whatsappDraftBlock(draftInput) : null
  const readabilityNotice = aiBlockedReason ? null : unreadCustomerAttachment
    ? unreadableKinds.length > 0
      ? `The latest customer message is a ${unreadableKinds[0].type === 'audio' ? 'voice note' : 'file'} the AI cannot read - open it yourself before sending.`
      : 'The AI could not open the customer\u2019s latest photo or video (link expired or reader unavailable) - look at it before sending.'
    : draftInput ? whatsappDraftNotice(draftInput) : null

  // Queue metadata changes invalidate the open transcript as well.
  useEffect(() => { if (visibleTranscriptKey) void mutateCache(visibleTranscriptKey) }, [visibleTranscriptKey, selected?.updatedAt, selected?.messageCount, mutateCache])

  const runAssist = useCallback(async (thread: UnifiedThread, msgs: LeadMessage[], force: boolean) => {
    if (aiBlockedReason) {
      updateSession(thread.key, (state) => ({ ...state, assistError: aiBlockedReason }))
      return
    }
    const turns = toTurns(thread, msgs)
    if (!turns.length) {
      updateSession(thread.key, (state) => ({ ...state, assistError: 'No readable message text is available for AI assistance.' }))
      return
    }
    const request = ++assistSequence.current
    const version = sessions[thread.key]?.draftVersion ?? 0
    const contextVersion = thread.channel === 'whatsapp' ? greenContext?.readiness?.contextVersion : undefined
    updateSession(thread.key, (state) => ({ ...state, assisting: true, assisted: true, assistRequest: request, assistError: null }))
    try {
      const res = await fetch('/api/inbox/ai-assist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(thread.channel === 'whatsapp'
          // The WhatsApp profile name is the customer's own; a thread with no
          // profile falls back to the wa id, which is a phone, not a name.
          ? { channel: 'whatsapp', phoneNumberId: thread.phoneNumberId, waId: thread.recipientId, expectedContextVersion: contextVersion,
            customerName: thread.name && thread.name !== thread.recipientId && !/^\+?\d[\d\s]*$/.test(thread.name) ? thread.name : '',
            pageName: thread.source, productHint: thread.product, adName: thread.adName, adId: thread.adId,
            business: sessions[thread.key]?.orderOperation.business || null,
            // Unreadable content never withholds a draft any more (the agent is
            // told about it instead), so the server's review gate is always waived.
            attachmentsReviewed: true }
          : { messages: turns, customerName: thread.name === 'Facebook user' ? '' : thread.name,
            pageName: thread.source, pageId: thread.pageId ?? null, channel: thread.channel, productHint: thread.product, adName: thread.adName, adId: thread.adId,
            business: sessions[thread.key]?.orderOperation.business || null,
            attachmentsReviewed: true }),
      })
      const json = await res.json()
      // The server is the authority on staleness: it checks contextVersion when the
      // draft starts and re-reads the transcript fingerprint when the model finishes,
      // answering CONTEXT_CHANGED if a message really arrived. Re-checking here against
      // the copies poller discarded good drafts, because context_version also ticks on
      // receipts and journal polls and `pending` is true during every 30s refresh.
      updateSession(thread.key, (state) => applyAssistResult(state, request, version, force, json))
    } catch (error) {
      updateSession(thread.key, (state) => applyAssistResult(state, request, version, force,
        { success: false, error: error instanceof Error ? error.message : 'Could not draft a reply' }))
    }
  }, [sessions, updateSession, aiBlockedReason, greenContext])



  // Opening a lead drafts the reply by itself, so the agent reads and sends. It
  // waits for two things the draft depends on: the transcript, and the ad the
  // customer clicked. A row can carry the ad id before the list has cached the
  // ad's product; drafting in that gap let the model pick a product of its own
  // (Roshni, 16 Sep). The server also resolves the product from the ad id, so
  // the wait is bounded - after 6s the draft goes ahead with what is known.
  // Once per thread per session, never over a draft the agent already has or
  // typed into, and only when the customer spoke last.
  const autoDraftAttempted = useRef<Set<string>>(new Set())
  const adPending = Boolean(selected?.adId && !selected.product && selected.productSource !== 'comment')
  useEffect(() => {
    if (!selected || !conversationVisible || tLoading || !transcriptData) return
    const session = sessions[selected.key]
    if (autoDraftAttempted.current.has(selected.key) || session?.assisted || session?.assisting || session?.draft || session?.draftTouched) return
    if (aiBlockedReason || !latestCustomerMessage || !messages.length || messages[messages.length - 1].fromBusiness) return
    const key = selected.key
    const fire = () => {
      if (autoDraftAttempted.current.has(key)) return
      autoDraftAttempted.current.add(key)
      void runAssist(selected, messages, false)
    }
    if (!adPending) { fire(); return }
    const timer = window.setTimeout(fire, 6_000)
    return () => window.clearTimeout(timer)
  }, [selected, conversationVisible, tLoading, transcriptData, sessions, aiBlockedReason, latestCustomerMessage, messages, adPending, runAssist])

  // Every lead still waiting on us (24h window) is drafted in the background, so
  // the agent finds the reply ready when they click. One thread at a time, newest
  // first, with a pause between - the OpenAI key is 30k tokens/minute. A thread
  // is drafted once per customer turn (key + updatedAt); one whose ad product has
  // not been resolved yet is left for the next pass, and one whose newest
  // customer message the AI cannot read (voice note, file) is skipped for good -
  // that block needs the agent's eyes. A failed pre-draft leaves the session
  // untouched, so opening the thread still runs the normal draft with its banner.
  const prefetched = useRef<Map<string, string>>(new Map())
  const prefetchBusy = useRef(false)
  const sessionsRef = useRef(sessions)
  useEffect(() => { sessionsRef.current = sessions }, [sessions])
  useEffect(() => {
    if (!active || prefetchBusy.current) return
    const now = Date.now()
    const queue = newestConversations(pageScoped.filter((row) => row.channel !== 'comment' && row.key !== selected?.key && needsReplyWithin(row, NEEDS_REPLY_WINDOW_MS, now)), 'needs-reply-24h', now).slice(0, 8)
    const next = queue.find((row) => {
      if (prefetched.current.get(row.key) === (row.updatedAt ?? '')) return false
      if (row.adId && !row.product && row.productSource !== 'comment') return false
      const s = sessionsRef.current[row.key]
      return !(s?.draft || s?.assisted || s?.assisting || s?.draftTouched)
    })
    if (!next) return
    prefetchBusy.current = true
    prefetched.current.set(next.key, next.updatedAt ?? '')
    const thread = next
    const run = async () => {
      let turns: ReturnType<typeof toTurns> = []
      if (thread.channel === 'messenger') {
        const url = stableMessengerTranscriptUrl(thread) ?? transcriptUrl(thread)
        if (!url) return
        const payload = await fetcher(url) as { messages?: unknown[] } | undefined
        const msgs = normaliseMessages(thread, payload)
        const newest = msgs.findLast((m) => !m.fromBusiness)
        if (!newest || msgs[msgs.length - 1]?.fromBusiness) return
        // A voice note or file no longer skips the thread: the draft is built from
        // the readable turns, and the composer says what the AI could not open.
        // If nothing readable is left, the empty-turns guard below still stops it.
        turns = toTurns(thread, msgs)
        if (!turns.length) return
      }
      const request = ++assistSequence.current
      const before = sessionsRef.current[thread.key]
      const version = before?.draftVersion ?? 0
      updateSession(thread.key, (state) => ({ ...state, assisting: true, assisted: true, assistRequest: request, assistError: null }))
      const res = await fetch('/api/inbox/ai-assist', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(thread.channel === 'whatsapp'
          ? { channel: 'whatsapp', phoneNumberId: thread.phoneNumberId, waId: thread.recipientId,
            customerName: thread.name && thread.name !== thread.recipientId && !/^\+?\d[\d\s]*$/.test(thread.name) ? thread.name : '',
            pageName: thread.source, productHint: thread.product, adName: thread.adName, adId: thread.adId,
            business: before?.orderOperation.business || null }
          : { messages: turns, customerName: thread.name === 'Facebook user' ? '' : thread.name,
            pageName: thread.source, pageId: thread.pageId ?? null, channel: thread.channel, productHint: thread.product, adName: thread.adName, adId: thread.adId,
            business: before?.orderOperation.business || null }),
      })
      const json = await res.json() as AssistResult
      if (json.success) updateSession(thread.key, (state) => applyAssistResult(state, request, version, false, json))
      else updateSession(thread.key, (state) => state.assistRequest === request ? { ...state, assisting: false, assisted: false, assistError: null } : state)
    }
    run()
      .catch(() => updateSession(thread.key, (state) => state.assisting ? { ...state, assisting: false, assisted: false, assistError: null } : state))
      .finally(() => { window.setTimeout(() => { prefetchBusy.current = false; setPrefetchTick((t) => t + 1) }, 1_500) })
  }, [active, pageScoped, selected?.key, sessions, updateSession, prefetchTick])

  const orderController = useRef<QuickOrderController | null>(null)
  /** "Delivery date, Locality" when this send also changes the open order. */
  const [orderUpdateLabels, setOrderUpdateLabels] = useState('')
  const send = async () => {
    const attachment = session.attachment
    if (!selected || sendsInFlight.current.has(selected.key) || (!draft.trim() && !attachment)) return
    const thread = selected
    const text = draft
    const version = session.draftVersion
    sendsInFlight.current.add(thread.key)
    clearSendError(thread.key)
    updateSession(thread.key, (state) => ({ ...state, sending: true }))
    try {
      // A confirmation promises a delivery, so the order is recorded FIRST from
      // the Quick Order form; if the form is incomplete or the save fails, the
      // message stays in the box and the agent sees why. Sessions that already
      // created an order skip straight to sending.
      const quickOrder = orderController.current
      // The same promise applies to an order that ALREADY exists: if this reply
      // moves the day, the address, the quantity or the item, that change is
      // written to the open order before the customer is told about it. Only
      // what the message actually states is applied (order-amendment.ts).
      if (quickOrder?.pendingAmendments.length) {
        const amended = await quickOrder.applyAmendments()
        if (!amended.ok) {
          throw new Error(`Order not changed, message not sent. ${amended.error ?? ''}`.trim())
        }
      }
      // An exchange confirmation promises the rider the same way, so the exchange
      // row is recorded first too (Rs 0, faulty unit collected).
      if ((isOrderConfirmationMessage(text) || containsExchangeTemplate(text)) && quickOrder && !quickOrder.created) {
        // An order without a phone cannot be delivered or called back; the
        // agent gets the customer's number first, then confirms.
        if (!session.order.contact1.replace(/\D/g, '').length) {
          throw new Error('Order not created, confirmation not sent. Ask the customer for a contact number first and enter it in Quick order.')
        }
        const outcome = await quickOrder.submit()
        if (!outcome.ok) {
          throw new Error(`Order not created, confirmation not sent. ${outcome.error ?? ''}`.trim())
        }
      }
      const result: Awaited<ReturnType<typeof sendLeadReply>> & { savedLocally?: boolean; warning?: string; viaPrivateReply?: boolean } = await sendLeadReply(thread, text, attachment ? { url: attachment.url, kind: attachment.kind, mime: attachment.mime } : null)
      if (!result.success) throw new Error(result.error ?? 'The server could not confirm this send.')
      updateSession(thread.key, (state) => completeSend(state, text, version))
      const url = stableMessengerTranscriptUrl(thread) ?? transcriptUrl(thread)
      if (url && activeTranscript.current === url) void mutateCache(url)
      void mutateCache(thread.channel === 'messenger' ? messengerListKey : thread.channel === 'whatsapp' ? '/api/inbox/whatsapp' : '/api/inbox/comments?pageId=all')
      if (result.usedHumanAgentTag) toast({ title: 'Sent outside the 24h window', description: 'Delivered using the human agent tag.' })
      if (result.viaPrivateReply) toast({ title: 'Sent as a private reply to their comment', description: result.warning ?? 'Meta allows one per comment; you can write again once the customer answers.' })
      const warning = thread.channel === 'whatsapp' ? whatsappAcceptedWarning(result) : null
      if (warning) toast({ title: 'Sent to WhatsApp', description: warning })
    } catch (error) {
      setSendErrors((previous) => ({ ...previous, [thread.key]: error instanceof Error && error.message ? error.message : 'The send response could not be confirmed.' }))
    } finally {
      sendsInFlight.current.delete(thread.key)
      updateSession(thread.key, (state) => ({ ...state, sending: false }))
    }
  }

  const refresh = async () => {
    const results = await Promise.allSettled([mMutate(), wMutate(), cMutate(), ...(visibleTranscriptKey ? [tMutate()] : [])])
    if (results.every((result) => result.status === 'fulfilled')) setLastChecked(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
  }
  const syncFacebook = async () => {
    if (syncInFlight.current) return
    syncInFlight.current = true
    setSyncing(true)
    setSyncError(null)
    const selectedHistoryUrl = selected?.channel === 'messenger' && visibleTranscriptKey ? visibleTranscriptKey + '&refresh=1' : null
    try {
      // Only this explicit action asks Facebook to backfill history.
      const urls = [messengerListKey + '&refresh=1', '/api/inbox/comments?pageId=all&refresh=1']
      const results = await Promise.allSettled(urls.map((url) => readInbox(url)))
      // List sync discovers Graph conversation IDs for webhook-only threads.
      // Hydrate the captured customer only after that discovery has finished.
      if (selectedHistoryUrl) {
        try { results.push({ status: 'fulfilled', value: await readInbox(selectedHistoryUrl) }) }
        catch (error) { results.push({ status: 'rejected', reason: error }) }
      }
      const warnings = results.flatMap((result) => result.status === 'rejected'
        ? [result.reason instanceof Error ? result.reason.message : 'Facebook synchronization failed']
        : result.value.syncError ? [String(result.value.syncError)] : [])
      if (warnings.length) setSyncError(Array.from(new Set(warnings)).join(' '))
      await refresh()
    } finally {
      syncInFlight.current = false
      setSyncing(false)
    }
  }
  useEffect(() => {
    if (!mv && !wv && !cv && (mData || wData || cData) && !mError && !wError && !cError)
      setLastChecked(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
  }, [mv, wv, cv, mData, wData, cData, mError, wError, cError])
  const errors = [mError && 'Messenger', wError && 'WhatsApp', cError && 'Comments', wData?.additionalCopiesUnavailable && 'additional WhatsApp copies'].filter(Boolean)

  const loading = (ml || wl || cl) && !mData && !wData && !cData
  const refreshing = mv || wv || cv || tv
  const awaiting = rows.filter(isWaitingOnUs).length
  // Counted over the whole scope, so the pill stays true whichever view is open.
  const now = Date.now()
  const needsReply24h = pageScoped.filter((r) => needsReplyWithin(r, NEEDS_REPLY_WINDOW_MS, now)).length
  const clientSilent24h = pageScoped.filter((r) => clientSilentWithin(r, NEEDS_REPLY_WINDOW_MS, now)).length
  const activeFilters = [channel !== 'all', product !== 'all', campaign !== 'all', liveOnly, page !== 'all'].filter(Boolean).length

  return (
    <div className="flex h-full min-h-0 w-full flex-1 overflow-hidden rounded-xl border border-border bg-card">
      {/* Column 1: the queue. */}
      <div className={`${selected && mobilePane !== 'queue' ? 'hidden lg:flex' : 'flex'} w-full min-h-0 shrink-0 flex-col overflow-hidden border-r border-border lg:w-[320px] xl:w-[350px]`}>
        <div className="flex min-w-0 flex-col gap-2 border-b border-border p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <h2 className="font-semibold">Leads</h2>
              <span className="text-xs text-muted-foreground tabular-nums">
                {rows.length} shown · {awaiting} waiting
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant={filtersOpen ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setFiltersOpen((value) => !value)}
                aria-expanded={filtersOpen}
                aria-controls="leads-filters"
                className="h-8 gap-1.5 px-2 text-xs"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                Filters{activeFilters ? ` · ${activeFilters}` : ''}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => { void refresh() }}
                disabled={refreshing}
                aria-label="Refresh leads"
                className="h-8 w-8"
              >
                <RefreshCw
                  className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
              </Button>
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground" role="status">
            {errors.length ? 'Retrying ' + errors.join(', ') + ' · keeping loaded conversations' : lastChecked ? (isLive ? 'Messenger & WhatsApp live · checked ' : 'Updates automatically · checked ') + lastChecked : 'Connecting to your inbox…'}
          </p>
          {syncError || mData?.syncError || cData?.syncError ? <p role="status" className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">Facebook updates are delayed; showing saved conversations. Retry sync later. {syncError || mData?.syncError || cData?.syncError}</p> : null}
          {mData?.doneSyncError ? <p role="status" className="text-[11px] text-amber-600 dark:text-amber-400">{mData.doneSyncError} Chats closed in Business Suite may still show as waiting.</p> : null}

          {/* The three questions an agent asks all day, one tap each. */}
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-4" role="group" aria-label="Queue">
            <button
              type="button"
              onClick={() => setQueueView('needs-reply-24h')}
              aria-pressed={queueView === 'needs-reply-24h'}
              className={`flex min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${queueView === 'needs-reply-24h' ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted'}`}
            >
              <span className="truncate">Needs reply · 24h</span>
              <span className="shrink-0 tabular-nums">{needsReply24h}</span>
            </button>
            <button
              type="button"
              onClick={() => setQueueView('client-silent-24h')}
              aria-pressed={queueView === 'client-silent-24h'}
              title="You replied in the last 24 hours and the client has not written back"
              className={`flex min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${queueView === 'client-silent-24h' ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted'}`}
            >
              <span className="truncate">No reply · 24h</span>
              <span className="shrink-0 tabular-nums">{clientSilent24h}</span>
            </button>
            <button
              type="button"
              onClick={() => setQueueView('all')}
              aria-pressed={queueView === 'all'}
              className={`flex min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${queueView === 'all' ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted'}`}
            >
              <span className="truncate">All</span>
              <span className="shrink-0 tabular-nums">{pageScoped.length}</span>
            </button>
            <button
              type="button"
              onClick={() => setQueueView('starred')}
              aria-pressed={queueView === 'starred'}
              title="Conversations a teammate flagged with a written explanation of the problem"
              className={`flex min-w-0 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${queueView === 'starred' ? 'border-amber-500 bg-amber-500 text-black' : starredCount ? 'border-amber-500/40 text-amber-500 hover:bg-amber-500/10' : 'border-border text-muted-foreground hover:bg-muted'}`}
            >
              <Star className={`h-3 w-3 shrink-0 ${queueView === 'starred' || starredCount ? 'fill-current' : ''}`} aria-hidden="true" />
              <span className="truncate">Starred</span>
              <span className="shrink-0 tabular-nums">{starredCount}</span>
            </button>
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
              className="h-9 pl-9"
              aria-label="Search leads"
            />
          </div>

          <div id="leads-filters" className={filtersOpen ? 'flex min-w-0 flex-col gap-2' : 'hidden'}>
          {lastEventAt !== null ? <p className="text-[11px] text-muted-foreground">
            Live update received <time dateTime={new Date(lastEventAt).toISOString()}>{new Date(lastEventAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
          </p> : null}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">Missing older messages?</span>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { void syncFacebook() }} disabled={syncing}>{syncing ? 'Syncing Facebook…' : 'Sync Facebook'}</Button>
          </div>
          <Select value={page} onValueChange={setPage}>
            <SelectTrigger className="h-8 w-full min-w-0 text-xs" aria-label="Filter inbox by Facebook Page"><SelectValue className="min-w-0 flex-1 truncate text-left" style={{ display: 'block' }} /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Pages & WhatsApp</SelectItem>
              {pages.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {page !== 'all' ? <div className="rounded-md border border-border bg-muted/30 p-2 text-xs">
            <p className="text-muted-foreground">Includes Messenger, comments and WhatsApp linked to this Page. Other WhatsApp numbers stay under All Pages.</p>
            <Button type="button" variant="link" size="sm" className="mt-1 h-auto px-0 py-1 text-xs" onClick={() => { setPage('all'); setChannel('whatsapp') }}>All WhatsApp numbers</Button>
          </div> : null}

          {/* Channel filter replaces the old per-channel tabs: same reach, but
              the queue stays in one place. */}
          <div className="grid min-w-0 grid-cols-4 gap-1">
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
                  className={`flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md border px-1.5 py-1.5 text-xs transition-colors ${
                    on
                      ? 'border-border bg-muted text-foreground'
                      : 'border-transparent text-muted-foreground hover:bg-muted/60'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 truncate">{c.label}</span>
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
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

          <div className="grid min-w-0 grid-cols-2 gap-2">
            <Select value={queueView} onValueChange={(v) => setQueueView(v as QueueView)}>
              <SelectTrigger className="col-span-2 h-8 w-full min-w-0 text-xs" aria-label="Filter queue">
                <SelectValue className="min-w-0 flex-1 truncate text-left" style={{ display: 'block' }} />
              </SelectTrigger>
              <SelectContent>
                {QUEUE_VIEWS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {products.length > 0 ? (
              <Select value={product} onValueChange={setProduct}>
                <SelectTrigger className={'h-8 w-full min-w-0 text-xs ' + (campaigns.length ? '' : 'col-span-2')} aria-label="Filter by product">
                  <SelectValue className="min-w-0 flex-1 truncate text-left" style={{ display: 'block' }} />
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
                <SelectTrigger className={'h-8 w-full min-w-0 text-xs ' + (products.length ? '' : 'col-span-2')} aria-label="Filter by campaign">
                  <SelectValue className="min-w-0 flex-1 truncate text-left" style={{ display: 'block' }} />
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
        </div>

        {/* Partial outage: name what is missing rather than under-reporting. */}
        {(mData?.conversations?.length ?? 0) >= 200 ? <p className="border-b px-4 py-2 text-[11px] leading-relaxed text-muted-foreground">Showing the latest 200 Messenger conversations plus every thread where the customer spoke last in the past 7 days. Older, answered threads load through search.</p> : null}
        {throttled ? (
          <p className="border-b border-sky-500/20 bg-sky-500/10 px-4 py-2 text-xs leading-relaxed text-pretty">
            Facebook has limited an update request. Available conversations are still shown;
            some new activity may take longer to arrive.
          </p>
        ) : null}

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading leads...</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm leading-relaxed text-muted-foreground text-pretty">
              {errors.length ? 'Some conversations could not load. Refresh to retry.'
                : query.trim() ? `No loaded conversation matches "${query.trim()}"${queueView !== 'all' ? ' in this queue - try the All view' : ''}. Names are matched word by word; a phone number can be typed with or without spaces.`
                : channel === 'comment' && queueView === 'needs-reply-24h' ? 'Every comment from the last 24 hours has a reply.'
                : channel === 'comment' && queueView === 'client-silent-24h' ? 'No comment you replied to in the last 24 hours is still waiting on the commenter.'
                : channel === 'comment' ? 'No comments match these filters.'
                : queueView === 'needs-reply-24h' ? 'Everyone who wrote in the last 24 hours has been answered, closed in Business Suite, or replied to from the phone.'
                : queueView === 'client-silent-24h' ? 'Every client you replied to in the last 24 hours has written back.'
                : queueView === 'unread' ? 'Nothing unread from the last 24 hours. Older unread conversations are in "Needs reply · any age".'
                : 'No leads match these filters.'}
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
                      onClick={() => { selectedSnapshot.current = r; setSelectedKey(r.key); setMobilePane('conversation') }}
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
                          {presence.byThread.get(r.key)?.length ? (
                            <Badge variant="outline" className="h-5 shrink-0 gap-1 border-amber-500/60 text-amber-600 dark:text-amber-400" title={`${presence.byThread.get(r.key)!.map((e) => e.name).join(', ')} ${presence.byThread.get(r.key)!.length > 1 ? 'have' : 'has'} this lead open right now`}>
                              <Users className="h-3 w-3" aria-hidden="true" />
                              {presence.byThread.get(r.key)!.map((e) => firstName(e.name)).join(', ')}
                            </Badge>
                          ) : null}
                          {r.star ? (
                            <Badge variant="outline" className="h-5 shrink-0 gap-1 border-amber-500/50 text-amber-500" title={`${r.star.note}\n\nStarred by ${r.star.starredByName ?? 'a teammate'} · ${new Date(r.star.starredAt).toLocaleString()}`}>
                              <Star className="h-3 w-3 fill-current" aria-hidden="true" />
                              {r.star.starredByName ? r.star.starredByName.split(' ')[0] : 'Starred'}
                            </Badge>
                          ) : null}
                          {isWaitingOnUs(r) ? (
                            <Badge variant="default" className="h-5 shrink-0 tabular-nums">
                              {queueView === 'needs-reply-24h' ? `Waiting ${waitedFor(r.updatedAt, now)}` : 'Waiting'}
                            </Badge>
                          ) : queueView.startsWith('client-silent') && isAwaitingCustomer(r) ? (
                            <Badge variant="outline" className="h-5 shrink-0 tabular-nums" title={r.answeredByPhone ? 'Your last reply was sent from the phone' : 'You replied last'}>
                              {`Silent ${waitedFor(r.updatedAt, now)}`}
                            </Badge>
                          ) : r.mark ? (
                            <Badge variant="secondary" className="h-5 shrink-0 gap-1" title={`${THREAD_MARK_LABELS[r.mark.kind]} · marked ${new Date(r.mark.at).toLocaleString()}${r.mark.by ? ` by ${r.mark.by}` : ''}`}>
                              {r.mark.kind === 'confirmed' ? <PackageCheck className="h-3 w-3" aria-hidden="true" /> : r.mark.kind === 'not-interested' ? <UserX className="h-3 w-3" aria-hidden="true" /> : <CheckCheck className="h-3 w-3" aria-hidden="true" />}
                              {THREAD_MARK_LABELS[r.mark.kind]}
                            </Badge>
                          ) : r.closingAck ? (
                            <Badge variant="secondary" className="h-5 shrink-0 gap-1" title="The customer's last message only acknowledges your reply (ok / thanks / emoji), so nobody is waiting">
                              <ThumbsUp className="h-3 w-3" aria-hidden="true" />Closed by client
                            </Badge>
                          ) : r.done ? (
                            <Badge variant="secondary" className="h-5 shrink-0 gap-1" title={`Marked Done in Meta Business Suite · ${new Date(r.done.at).toLocaleString()}`}>
                              <CheckCheck className="h-3 w-3" aria-hidden="true" />Done
                            </Badge>
                          ) : r.answeredByPhone ? (
                            <Badge variant="secondary" className="h-5 shrink-0 gap-1" title="The phone (GREEN-API) saw an outgoing reply after the customer's last message">
                              <Smartphone className="h-3 w-3" aria-hidden="true" />Answered on phone
                            </Badge>
                          ) : null}
                        </span>

                        <span className="block truncate text-xs text-muted-foreground">
                          {r.snippet || 'No message preview'}
                        </span>

                        <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          <span className="truncate">{r.source}</span>
                          {r.channel === 'whatsapp' && r.unreadStateKnown !== true ? <span>Unread status unconfirmed</span> : null}
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
        <div className={'flex min-h-0 min-w-0 flex-1 flex-col ' + (mobilePane === 'queue' ? 'hidden lg:flex' : '')}>
          <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
            <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setMobilePane('queue')}>Back to leads</Button>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{selected.source}</span>
            {othersHere.length ? (
              <span role="status" className="flex min-w-0 shrink items-center gap-1.5 rounded-md border border-amber-500/60 bg-amber-500/10 px-2 py-1 text-xs text-amber-700 dark:text-amber-300">
                <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {othersHere.map((e) => e.name).join(', ')} {othersHere.length > 1 ? 'are' : 'is'} on this lead too (since {new Date(Math.min(...othersHere.map((e) => e.since))).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}) - check before you send
                </span>
              </span>
            ) : null}
            <Button variant={mobilePane === 'order' ? 'secondary' : 'outline'} size="sm" onClick={() => setMobilePane((value) => value === 'order' ? 'conversation' : 'order')}>
              {mobilePane === 'order' ? 'Conversation' : 'Quick order'}
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className={'min-h-0 min-w-0 flex-1 ' + (mobilePane === 'order' ? 'hidden 2xl:flex' : 'flex')}>
              <LeadConversation key={selected.key} thread={selected} messages={messages} visible={conversationVisible}
                comment={selected.channel === 'comment' ? cData?.comments?.find((comment) => comment.id === selected.nativeId) : undefined}
                loading={Boolean(transcriptKey) && tLoading} rateLimited={Boolean(tData?.rateLimited)}
                error={tError?.message ?? transcriptData?.syncError ?? null} onRefresh={() => { void tMutate() }} updating={tv}
                draft={draft} draftOrigin={session.draftOrigin}
                onDraftChange={(value) => updateSession(selected.key, (state) => ({ ...state, draft: value, draftTouched: true, draftVersion: state.draftVersion + 1, draftOrigin: 'manual' }))}
                onSend={send} sending={sending} sendError={sendErrors[selected.key] ?? null}
                attachment={session.attachment} mediaProductId={session.order.productId ?? selected.productId ?? null}
                onAttach={(attachment) => updateSession(selected.key, (state) => ({ ...state, attachment }))}
                onRemoveAttachment={() => updateSession(selected.key, (state) => ({ ...state, attachment: null }))}
              sendCreatesOrder={!session.orderOperation.created && (isOrderConfirmationMessage(draft) || containsExchangeTemplate(draft)) && session.order.contact1.replace(/\D/g, '').length > 0}
              sendUpdatesOrder={orderUpdateLabels || null}
              onDismissSendError={() => clearSendError(selected.key)} aiPending={assisting} aiError={assistError} aiNotice={assistNotice}
                onMark={(kind) => { void setMark(selected.key, kind) }}
                onStar={(note) => setStar(selected.key, note)}
                onModerateComment={selected.channel === 'comment' ? (action) => moderateComment(selected, action) : undefined}
                aiHasRun={session.assisted}
                aiBlockedReason={aiBlockedReason} readabilityNotice={readabilityNotice} onGreenContextChange={onGreenContextChange}
                onRegenerate={() => runAssist(selected, messages, true)} />
            </div>
            <div className={'h-full min-h-0 shrink-0 ' + (mobilePane === 'order' ? 'flex w-full 2xl:w-[340px]' : 'hidden 2xl:flex 2xl:w-[340px]')}>
              <QuickOrderPanel thread={selected} draft={order} controller={orderController}
                messageText={draft}
                onAmendmentsChange={setOrderUpdateLabels}
                operation={session.orderOperation}
                onOperationChange={updateOrderOperation}
                onChange={(next, field) => updateSession(selected.key, (state) => ({ ...state, order: next,
                  orderTouched: { ...state.orderTouched, [field]: true } }))}
                aiPending={assisting} unmatched={unmatched} onPrefill={prefillOrder}
                onOrderCreated={({ proformaLink }) => updateSession(selected.key, (state) => proformaLink && !state.draft.trim()
                  ? { ...state, draft: 'Here is your order confirmation: ' + proformaLink, draftTouched: true, draftVersion: state.draftVersion + 1, draftOrigin: 'order' } : state)} />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-8">
          <p className="max-w-[38ch] text-center text-sm leading-relaxed text-muted-foreground text-pretty">
            Pick a lead to read the conversation and raise an order. AI reply and order assistance
            is available when you choose it.
          </p>
        </div>
      )}
    </div>
  )
}
