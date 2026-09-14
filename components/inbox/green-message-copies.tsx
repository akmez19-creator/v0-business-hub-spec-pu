'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { createGreenCopiesClient, greenContextStatus, GREEN_REASON_LABELS, validGreenScope,
  type GreenScope, type GreenCopiesState, type GreenContextStatus } from './green-copies-client'

function displayDate(value: string | null) {
  if (!value) return 'Unavailable'
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Indian/Mauritius', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function GreenMessageCopies({ scope, businessName, visible, onContextChange }: {
  scope: GreenScope; businessName: string; visible: boolean; onContextChange: (value: GreenContextStatus | null) => void
}) {
  const [state, setState] = useState<GreenCopiesState>({ scope, snapshot: null, loading: null, error: null, checkedAt: null, cancelled: false })
  const client = useRef<ReturnType<typeof createGreenCopiesClient> | null>(null)
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  useEffect(() => {
    const current = createGreenCopiesClient({ phoneNumberId: scope.phoneNumberId, waId: scope.waId })
    client.current = current
    const update = () => { const next = current.getSnapshot(); setState(next); onContextChange(greenContextStatus(next)) }
    const unsubscribe = current.subscribe(update)
    update()
    if (visibleRef.current && validGreenScope(scope)) void current.refresh()
    const timer = setInterval(() => {
      if (visibleRef.current && document.visibilityState === 'visible' && !current.getSnapshot().loading) void current.refresh()
    }, 30000)
    return () => { clearInterval(timer); unsubscribe(); current.dispose(); if (client.current === current) client.current = null; onContextChange(null) }
  }, [scope.phoneNumberId, scope.waId, onContextChange])
  useEffect(() => {
    if (!visible) client.current?.cancel()
    else if (client.current?.getSnapshot().cancelled) void client.current.refresh()
  }, [visible])

  return <GreenMessageCopiesView scope={scope} businessName={businessName} visible={visible} state={state}
    onRefresh={() => { void client.current?.refresh() }} onCancel={() => client.current?.cancel()}
    onLoadOlder={() => { void client.current?.loadOlder() }} />
}

export function GreenMessageCopiesView({ scope, businessName, visible, state, onRefresh, onCancel, onLoadOlder }: {
  scope: GreenScope; businessName: string; visible: boolean; state: GreenCopiesState
  onRefresh: () => void; onCancel: () => void; onLoadOlder: () => void
}) {
  const currentScope = state.scope.phoneNumberId === scope.phoneNumberId && state.scope.waId === scope.waId
  const snapshot = currentScope ? state.snapshot : null
  const loading = currentScope ? state.loading : null
  const contentReviewOnly = snapshot?.binding.state === 'needs_attention' &&
    (snapshot.binding.lastError === null || snapshot.binding.lastError === 'QUARANTINED_EVENTS')
  const label = !snapshot ? state.error ? 'Copy status unavailable' : 'Waiting for a copy check' : !snapshot.binding.configured ? 'Not configured for this business'
    : snapshot.binding.state === 'paused' || !snapshot.binding.enabled ? 'Receiving copies is paused'
    : snapshot.binding.state === 'not_connected' ? 'Business connection is not verified'
    : snapshot.binding.state === 'needs_attention' ? contentReviewOnly ? 'Message copies need review' : 'Connection needs attention' : snapshot.binding.lastEventAt ? 'Receiving additional copies' : 'Waiting for the first additional message'
  return <section aria-label="Additional WhatsApp message copies" className="mx-auto my-5 w-full max-w-[900px] rounded-xl border border-primary/25 bg-primary/5 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="text-sm font-semibold">Additional WhatsApp copies · GREEN-API</h3><p className="mt-1 break-words text-xs text-muted-foreground">{businessName} · +{scope.waId}</p></div><div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={!!loading || !visible || !validGreenScope(scope)} onClick={onRefresh}><RefreshCw className={`mr-1.5 size-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh copies</Button>{loading && <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel check</Button>}</div></div>
    <p role="status" className="mt-3 text-xs font-medium">{state.cancelled ? 'Copy check cancelled' : loading ? 'Checking stored copies…' : label}</p>
    <p className="mt-1 text-xs text-muted-foreground">Observation mode · automatic replies and orders are off.</p>
    {state.error && <p role="alert" className="mt-2 text-xs text-amber-700 dark:text-amber-300">{state.error}</p>}
    {snapshot && <><p className="mt-3 text-xs text-muted-foreground">{snapshot.messages.length} copies shown{snapshot.hasMore ? ' · older copies available' : ''} · {snapshot.readiness.unresolvedOriginalCount} original messages still missing content</p>
      <p className="mt-1 text-xs">{snapshot.readiness.canDraft && !loading && !state.error && !state.cancelled ? 'Stored context passed the server’s manual-draft checks. Review every draft before sending.' : 'Manual AI drafts wait for readable stored context. You can still reply manually.'}</p>
      <details className="mt-2 text-xs text-muted-foreground"><summary className="w-fit cursor-pointer">Message coverage details</summary><ul className="mt-2 list-disc space-y-1 pl-4">{[...new Set([...snapshot.readiness.reasons, ...snapshot.readiness.draftReasons])].map(reason => <li key={reason}>{GREEN_REASON_LABELS[reason] ?? 'A message coverage check needs review.'}</li>)}</ul><p className="mt-2">Last provider event received: {displayDate(snapshot.binding.lastEventAt)} Mauritius</p><p>Last background check: {displayDate(snapshot.binding.lastReconcileAt)} Mauritius</p>{snapshot.binding.lastError && <p>{contentReviewOnly ? 'Some stored message copies need review.' : 'The last synchronization check needs attention.'}</p>}<p>Last checked: {displayDate(state.checkedAt)} Mauritius</p></details>
      {snapshot.hasMore && <Button type="button" variant="outline" size="sm" className="mt-3" disabled={!!loading || !visible} onClick={onLoadOlder}>Load older copies</Button>}
      {snapshot.messages.length ? <ol className="mt-4 flex max-h-96 flex-col gap-3 overflow-y-auto pr-1" aria-label="Stored GREEN-API copies">{snapshot.messages.map(message => <li key={JSON.stringify([message.providerInstanceId, message.providerChatId, message.providerMessageId])} className={`max-w-[95%] rounded-lg border bg-background/70 p-3 sm:max-w-[85%] ${message.direction === 'out' ? 'ml-auto' : 'mr-auto'}`}><p className="text-xs font-medium">{message.direction === 'out' ? businessName : 'Customer'} · additional copy{message.edited ? ' · edited' : ''}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{message.kind === 'deleted' ? 'This provider record is deleted.' : message.conflicted ? 'Conflicting message content needs review.' : message.kind === 'unsupported' || !message.text?.trim() ? 'Content requires review in WhatsApp.' : message.text}</p><p className="mt-2 text-[11px] text-muted-foreground">Provider acceptance time: {displayDate(message.providerAcceptedAt)} Mauritius · original send time unverified</p><details className="mt-1 text-[11px] text-muted-foreground"><summary className="w-fit cursor-pointer">Source details</summary><p className="mt-1 break-all">GREEN-API reference: {message.providerMessageId}</p><p>First stored: {displayDate(message.observedAt)} Mauritius</p><p>Match to an original blank message: unverified</p></details></li>)}</ol> : <p className="mt-4 text-sm text-muted-foreground">No additional copies are stored for this business and client yet.</p>}
    </>}
    <p className="mt-3 text-[11px] leading-5 text-muted-foreground">Original inbox messages stay above, including unavailable text. Copies are ordered by when first stored, not original send time. Additional copies do not prove that every message was received. Refresh reads Akmez’s stored copies and does not mark messages read.</p>
  </section>
}
