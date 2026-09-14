'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRightLeft, Check, ChevronDown, Clock3, ExternalLink, History, Loader2, MessageSquareText, Pause, Play, RefreshCw, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  createRecoveryClient, formatRecoveryDate, observationTime, RECOVERY_BUSINESSES,
  type RecoverySnapshot, type ResponseSurface,
} from './whatsapp-recovery-client'

const STATE_LABELS: Record<RecoverySnapshot['status']['state'], string> = {
  not_checked: 'Not checked', queued: 'Waiting for the worker', leased: 'Checking WhatsApp',
  partial: 'Partial history copied', failed: 'Needs attention', paused: 'Recovery paused',
}
const SURFACES: { value: ResponseSurface; title: string; description: string }[] = [
  { value: 'business_suite', title: 'Business Suite', description: 'Your team replies in Meta.' },
  { value: 'akmez_manual', title: 'Akmez', description: 'Your team replies manually in Akmez.' },
]
const REASON_LABELS: Record<string, string> = {
  connection_lost: 'The worker stopped responding. Reconnect it, then request another history check.',
  not_connected: 'No recovery worker is connected for this number.',
  identity_mismatch: 'The connected WhatsApp account does not match this business number.',
  chat_not_found: 'The worker could not find your own test contact in this business account.',
  paused: 'Recovery is paused for this test conversation.',
  control_changed: 'The recovery settings changed. A previous check was stopped.',
  coverage_not_verified: 'The received copies are available below. Complete history has not been verified.',
  source_unavailable: 'WhatsApp Web could not be read. Open the correct business account and try again.',
  identity_unconfirmed: 'The worker could not confirm the business number and your test contact.',
  capture_incomplete: 'The worker could not capture a usable set of messages. Review the test conversation and retry.',
}

export function WhatsAppRecoveryPilot() {
  const [client] = useState(() => createRecoveryClient())
  const state = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot)
  const data = state.data
  const busy = state.loading || state.saving
  const business = RECOVERY_BUSINESSES.find(item => item.phoneNumberId === state.phoneNumberId)!

  useEffect(() => {
    client.activate()
    void client.refresh()
    return () => client.dispose()
  }, [client])

  useEffect(() => {
    if (!data?.control.enabled || !['queued', 'leased'].includes(data.status.state)) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void client.refresh()
    }, 15_000)
    return () => window.clearInterval(timer)
  }, [client, data?.control.enabled, data?.status.state])

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-10">
      <header className="flex flex-col gap-5">
        <Link href="/dashboard/inbox" className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to inbox
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Akmez · Conversation continuity</p>
            <h1 className="text-3xl font-semibold tracking-tight">WhatsApp recovery</h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">Choose where your team replies and inspect the history copied from WhatsApp Web.</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-300">
            <ShieldCheck className="size-4" aria-hidden="true" /> Own-contact pilot
          </span>
        </div>
      </header>

      <Card className="gap-0 overflow-hidden border-primary/20">
        <div className="grid gap-5 bg-primary/5 p-5 sm:grid-cols-2 sm:p-6">
          <div className="space-y-2">
            <label htmlFor="recovery-business" className="text-sm font-medium">Business WhatsApp number</label>
            <div className="relative">
              <select id="recovery-business" value={state.phoneNumberId} onChange={event => { void client.selectBusiness(event.target.value) }}
                disabled={state.saving} className="h-11 w-full appearance-none rounded-lg border border-input bg-background px-3 pr-10 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                {RECOVERY_BUSINESSES.map(item => <option key={item.phoneNumberId} value={item.phoneNumberId}>{item.name} · {item.phone}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-3.5 size-4 text-muted-foreground" aria-hidden="true" />
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Test conversation</p>
            <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border bg-background px-3 py-2">
              <span className="font-medium">Asla / Akmez</span><span className="text-sm text-muted-foreground">+230 5258 3671</span>
            </div>
          </div>
        </div>
        <p className="border-t px-5 py-3 text-xs leading-5 text-muted-foreground sm:px-6">This pilot is limited to your own contact. Copied history stays separate from the original inbox records. Customer automation is off.</p>
      </Card>

      {state.error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{state.error}</div>}
      {state.notice && <p role="status" className="rounded-xl border bg-muted/40 px-4 py-3 text-sm">{state.notice}</p>}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]">
        <div className="space-y-6">
          <Card className="gap-5 p-5 sm:p-6">
            <div className="flex items-center gap-3"><ArrowRightLeft className="size-5 text-primary" aria-hidden="true" /><h2 className="text-lg font-semibold">Where your team replies</h2></div>
            <div role="group" aria-label="Reply workspace preference" className="grid gap-3 sm:grid-cols-2">
              {SURFACES.map(surface => {
                const selected = data?.control.responseSurface === surface.value
                return <button key={surface.value} type="button" aria-pressed={selected} disabled={!data || busy}
                  onClick={() => { if (data && !selected) void client.configure(data.control.enabled, surface.value) }}
                  className={`flex min-h-24 items-start justify-between gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${selected ? 'border-primary/60 bg-primary/10' : 'border-border hover:bg-muted/50'}`}>
                  <span><span className="block font-semibold">{surface.title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{surface.description}</span></span>
                  {selected && <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />}
                </button>
              })}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">This saves your workflow preference in Akmez. It does not transfer control of the number, disable Business Suite, or send a message.</p>
          </Card>

          <Card className="gap-5 p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="text-lg font-semibold">History recovery</h2><p className="mt-1 text-sm text-muted-foreground">Only {business.name} → your Asla conversation.</p></div>
              <span className={`rounded-full border px-3 py-1 text-xs font-medium ${data?.control.enabled ? 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300' : 'bg-muted text-muted-foreground'}`}>{data ? data.control.enabled ? 'Enabled for test' : 'Off' : 'Checking settings'}</span>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant={data?.control.enabled ? 'outline' : 'default'} disabled={!data || busy}
                onClick={() => { if (data) void client.configure(!data.control.enabled, data.control.responseSurface) }}>
                {state.saving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : data?.control.enabled ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
                {data?.control.enabled ? 'Pause recovery' : 'Enable test recovery'}
              </Button>
              <Button type="button" variant="outline" disabled={!data?.control.enabled || busy || data?.status.state === 'leased'} onClick={() => { void client.enqueue() }}>
                <History className="size-4" aria-hidden="true" /> Request history check
              </Button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">An enabled request needs a connected recovery worker to inspect WhatsApp Web. Opening this page alone does not copy a conversation. Pausing stops further recovery work for this test conversation.</p>
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm leading-6">
              <p className="font-medium">History completeness is not confirmed</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">A copied reply can be read here, but it does not prove every message was recovered or identify which original receipt it belongs to. Automatic replies and orders remain off.</p>
            </div>
          </Card>
        </div>

        <Card className="gap-5 p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Connection activity</h2>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { void client.refresh() }} aria-label="Refresh recovery status">
              <RefreshCw className={`size-4 ${state.loading ? 'animate-spin' : ''}`} aria-hidden="true" /><span>Refresh</span>
            </Button>
          </div>
          <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-sm font-medium" aria-live="polite">{data ? STATE_LABELS[data.status.state] : state.loading ? 'Loading this conversation…' : 'Status unavailable'}</p>
          {data?.status.reason && <p className="break-words text-sm leading-6 text-muted-foreground">{REASON_LABELS[data.status.reason] ?? data.status.reason}</p>}
          <dl className="space-y-4 text-sm">
            <div className="flex items-start justify-between gap-4"><dt className="text-muted-foreground">Missing original reply texts</dt><dd className="font-semibold tabular-nums">{data?.status.unresolvedReceiptCount ?? 'Not checked'}</dd></div>
            <div className="flex items-start justify-between gap-4"><dt className="text-muted-foreground">Copies shown here</dt><dd className="font-semibold tabular-nums">{data ? `${data.observations.length}${data.hasMore ? '+' : ''}` : '—'}</dd></div>
            <div className="space-y-1"><dt className="text-muted-foreground">Last check attempted</dt><dd>{formatRecoveryDate(data?.status.lastAttemptAt)}</dd></div>
            <div className="space-y-1"><dt className="text-muted-foreground">Last copy received</dt><dd>{formatRecoveryDate(data?.status.lastCopiedAt)}</dd></div>
          </dl>
          <div className="border-t pt-4 text-xs leading-5 text-muted-foreground">
            <p className="flex items-center gap-2"><Clock3 className="size-3.5" aria-hidden="true" /> Times shown in Mauritius time.</p>
            <p className="mt-2">{state.loadedAt ? `Status refreshed ${formatRecoveryDate(state.loadedAt)}.` : 'Refresh to load the latest status.'} {data?.control.enabled && ['queued', 'leased'].includes(data.status.state) ? 'Updates every 15 seconds while this page is visible and a check is pending.' : ''}</p>
          </div>
          <Button asChild variant="outline"><a href="https://web.whatsapp.com/" target="_blank" rel="noopener noreferrer"><ExternalLink className="size-4" aria-hidden="true" /> Open WhatsApp Web</a></Button>
        </Card>
      </div>

      <Card className="gap-0 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b p-5 sm:p-6">
          <div><h2 className="flex items-center gap-2 text-lg font-semibold"><MessageSquareText className="size-5 text-primary" aria-hidden="true" /> Copied conversation</h2><p className="mt-2 text-sm text-muted-foreground">Text observed in WhatsApp Web. Newest copies appear first; this may differ from when each message was sent.</p></div>
          <span className="rounded-full border px-3 py-1 text-xs text-muted-foreground">Partial history</span>
        </div>
        {!data || data.observations.length === 0 ? (
          <div className="p-8 text-center sm:p-12"><History className="mx-auto size-8 text-muted-foreground" aria-hidden="true" /><p className="mt-4 font-medium">{state.loading && !data ? 'Loading copied history…' : !data ? 'History is not loaded' : 'No copied messages yet'}</p><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{data ? 'Enable recovery and request a check. New copies will appear here after the worker inspects your test conversation.' : 'Use Refresh to load this business and test contact.'}</p></div>
        ) : (
          <ol className="space-y-5 p-5 sm:p-6" aria-label="Copied WhatsApp messages">
            {data.observations.map(item => (
              <li key={item.sourceMessageId} className={`flex ${item.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                <article className={`w-full max-w-2xl rounded-2xl border p-4 ${item.direction === 'out' ? 'border-primary/25 bg-primary/5' : 'bg-muted/30'}`}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-semibold">{item.direction === 'out' ? business.name : 'Asla / Akmez'}</span><span className="text-muted-foreground">WhatsApp Web copy</span></div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6">{item.kind === 'text' && item.text ? item.text : `Content unavailable${item.unsupportedKind ? ` · ${item.unsupportedKind}` : ''}`}</p>
                  <p className="mt-3 text-xs leading-5 text-muted-foreground">{observationTime(item)}</p>
                  <details className="mt-2 text-xs text-muted-foreground"><summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Copy details</summary><dl className="mt-2 space-y-1 break-all"><div><dt className="inline font-medium">First observed: </dt><dd className="inline">{formatRecoveryDate(item.firstObservedAt)} Mauritius</dd></div><div><dt className="inline font-medium">WhatsApp Web reference: </dt><dd className="inline">{item.sourceMessageId}</dd></div></dl></details>
                </article>
              </li>
            ))}
          </ol>
        )}
        {data?.hasMore && <p className="border-t px-5 py-4 text-sm text-muted-foreground sm:px-6">Showing the latest 100 copied observations. Earlier copies may exist; this view does not confirm complete history.</p>}
      </Card>
    </div>
  )
}
