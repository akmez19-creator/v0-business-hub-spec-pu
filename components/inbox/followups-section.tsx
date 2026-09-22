'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { CheckCircle2, Clock3, MessageSquareReply, Pause, Play, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type BusinessKey = 'made_by_moris' | 'destockage'
type LedgerRow = { id: string; channel: 'messenger' | 'whatsapp'; customer_id: string; step: number; state: string; reason: string | null; draft_text: string | null; due_at: string; sent_at: string | null; created_at: string }
type Business = { businessKey: BusinessKey; enabled: boolean; maxPerHour: number; version: number; maxDaily: number; reservedToday: number; sentToday: number; sentLastHour: number; recent: LedgerRow[] }
type Status = { businesses: Business[]; checkedAt: string }
type Candidate = { scope: { channel: 'messenger' | 'whatsapp'; psid?: string; waId?: string }; customerName: string | null; hasOrder: boolean; lastText: string | null; decision: { action: string; step?: number; reason?: string; dueAt?: string } }

const NAMES: Record<BusinessKey, string> = { made_by_moris: 'Made By Moris', destockage: 'Destockage' }
const STEP_LABELS: Record<number, string> = { 1: '45 min nudge', 2: '3 h check-in', 3: 'Next-morning last word' }
const REASONS: Record<string, string> = {
  order_exists: 'Order already in Deliveries', customer_replied: 'Customer replied', backfill_lower_step: 'Older step skipped (only the latest step is sent)',
  ladder_complete: 'All three steps done', stale_anchor: 'Conversation older than 34 h', messenger_window_closed: 'Messenger 24 h window closed',
  model_needs_staff: 'Writer asked for staff', text_unverified_figure: 'Draft quoted a figure we never said', text_unverified_offer: 'Draft invented an offer',
  text_confirms_order: 'Draft confirmed an order', text_asks_payment: 'Draft asked for payment', text_has_link: 'Draft contained a link', text_too_long: 'Draft too long',
  text_empty: 'Empty draft', provider_outcome_unknown: 'Provider did not confirm - check the thread', quiet_hours: 'Outside 08:00-21:00', not_due: 'Waiting for its time',
}
const fetcher = (url: string) => fetch(url, { credentials: 'same-origin' }).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? 'Request failed'); return j })
const when = (v: string | null) => v ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Indian/Mauritius', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v)) : '-'

export function FollowupsSection({ canManage }: { canManage: boolean }) {
  const { data, error, mutate, isLoading } = useSWR<Status>('/api/inbox/autopilot/followups', fetcher, { refreshInterval: 30000, revalidateOnFocus: true })
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const patch = async (businessKey: BusinessKey, body: Record<string, unknown>) => {
    setBusy(businessKey); setNotice(null)
    try {
      const r = await fetch('/api/inbox/autopilot/followups', { method: 'PATCH', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ businessKey, ...body }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error === 'production_worker_required' ? 'Follow-ups can only be switched on in the published app.' : j.error ?? 'Change not saved')
      await mutate(j, { revalidate: false })
    } catch (e) { setNotice(e instanceof Error ? e.message : 'Change not saved') } finally { setBusy(null) }
  }
  return <div className="border-t pt-5" aria-labelledby="autopilot-followups-heading">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h3 id="autopilot-followups-heading" className="flex items-center gap-2 font-semibold"><MessageSquareReply className="size-4 text-primary" aria-hidden="true" />Follow-ups</h3>
      <span className="text-xs text-muted-foreground">Sends when a customer goes quiet after our message</span>
    </div>
    <p className="mb-3 max-w-3xl text-sm text-muted-foreground">Three gentle nudges after our last message: 45 minutes, 3 hours, then the next morning. Stops the moment the customer replies or an order appears in Deliveries. Never quotes a price or offer your team did not already write, never confirms an order, only 08:00-21:00 Mauritius, and shares the daily reply limit above.</p>
    {notice && <p role="alert" className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">{notice}</p>}
    {error && <p role="alert" className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Follow-up status unavailable{error instanceof Error && error.message === 'admin_required' ? ' (administrators only)' : ''}.</p>}
    {isLoading && !data && <p role="status" className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Checking follow-up status…</p>}
    {data && <div className="grid gap-4 xl:grid-cols-2">{data.businesses.map(b => <FollowupBusiness key={b.businessKey} business={b} canManage={canManage} busy={busy === b.businessKey} onPatch={body => patch(b.businessKey, body)} />)}</div>}
  </div>
}

function FollowupBusiness({ business: b, canManage, busy, onPatch }: { business: Business; canManage: boolean; busy: boolean; onPatch: (body: Record<string, unknown>) => Promise<void> }) {
  const [perHour, setPerHour] = useState<number | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const value = perHour ?? b.maxPerHour
  const { data: preview, isLoading: previewLoading } = useSWR<{ candidates: Candidate[] }>(showPreview ? `/api/inbox/autopilot/followups?preview=${b.businessKey}` : null, fetcher)
  const due = preview?.candidates.filter(c => c.decision.action === 'send') ?? []
  return <article aria-labelledby={`followups-${b.businessKey}`} className={`min-w-0 rounded-xl border p-4 ${b.enabled ? 'border-primary/35 bg-primary/[0.03]' : 'bg-muted/20'}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h4 id={`followups-${b.businessKey}`} className="font-semibold">{NAMES[b.businessKey]}</h4><p className="mt-1 text-xs text-muted-foreground">Messenger &amp; WhatsApp · {b.sentLastHour} sent in the last hour · {b.sentToday}/{b.maxDaily} replies today (shared)</p></div>
      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${b.enabled ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>{b.enabled ? 'On' : 'Off'}</span>
    </div>
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <div><label htmlFor={`followups-hour-${b.businessKey}`} className="text-xs font-medium">Max follow-ups per hour</label>
        <Input id={`followups-hour-${b.businessKey}`} className="mt-1 w-28" type="number" min={1} max={200} step={1} inputMode="numeric" value={value} onChange={e => setPerHour(e.target.value === '' ? NaN : Number(e.target.value))} disabled={!canManage || busy} /></div>
      <Button type="button" variant="outline" size="sm" disabled={!canManage || busy || perHour === null || perHour === b.maxPerHour || !Number.isInteger(value) || value < 1 || value > 200} onClick={() => { void onPatch({ maxPerHour: value }).then(() => setPerHour(null)) }}>Save limit</Button>
      {b.enabled
        ? <Button type="button" variant="outline" size="sm" disabled={!canManage || busy} onClick={() => { void onPatch({ enabled: false }) }}><Pause className="mr-1.5 size-3.5" aria-hidden="true" />Turn off follow-ups</Button>
        : <Button type="button" size="sm" disabled={!canManage || busy} onClick={() => { void onPatch({ enabled: true }) }}><Play className="mr-1.5 size-3.5" aria-hidden="true" />Turn on follow-ups</Button>}
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setShowPreview(v => !v)}><Search className="mr-1.5 size-3.5" aria-hidden="true" />{showPreview ? 'Hide' : 'Who would get one now?'}</Button>
    </div>
    {showPreview && <div className="mt-3 rounded-lg border bg-background p-3 text-sm">
      {previewLoading && !preview ? <p role="status" className="text-muted-foreground">Checking quiet conversations…</p>
        : !preview?.candidates.length ? <p className="text-muted-foreground">No conversation is waiting on the customer right now.</p>
        : <><p className="mb-2 text-xs text-muted-foreground">{due.length} due now · {preview.candidates.length - due.length} waiting or stopped. Read-only: nothing is sent from this list.</p>
          <ul className="max-h-64 space-y-1.5 overflow-y-auto">{preview.candidates.map(c => { const id = c.scope.waId ?? c.scope.psid ?? ''; return <li key={c.scope.channel + id} className="flex flex-wrap items-baseline justify-between gap-2 rounded border px-2.5 py-1.5 text-xs">
            <span className="min-w-0"><span className="font-medium text-foreground">{c.customerName ?? id}</span><span className="text-muted-foreground"> · {c.scope.channel === 'whatsapp' ? 'WhatsApp' : 'Messenger'}{c.lastText ? ` · “${c.lastText.slice(0, 70)}${c.lastText.length > 70 ? '…' : ''}”` : ''}</span></span>
            <span className={c.decision.action === 'send' ? 'font-medium text-primary' : 'text-muted-foreground'}>{c.decision.action === 'send' ? `Step ${c.decision.step} due` : c.decision.action === 'wait' ? `Step ${c.decision.step} at ${when(c.decision.dueAt ?? null)}` : REASONS[c.decision.reason ?? ''] ?? c.decision.reason}</span></li> })}</ul></>}
    </div>}
    <div className="mt-4 border-t pt-3">
      <p className="mb-2 text-xs text-muted-foreground">Latest follow-ups · newest first · Mauritius time</p>
      {b.recent.length ? <ol aria-label={`Recent follow-ups for ${NAMES[b.businessKey]}`} className="max-h-72 space-y-1.5 overflow-y-auto">{b.recent.map(r => <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 rounded border px-2.5 py-2 text-xs">
        <span className="flex min-w-0 gap-2">{r.state === 'sent' ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" /> : <Clock3 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
          <span className="min-w-0"><span className="font-medium text-foreground">{r.channel === 'whatsapp' ? `+${r.customer_id}` : `Messenger ${r.customer_id.slice(-6)}`}</span><span className="text-muted-foreground"> · {STEP_LABELS[r.step] ?? `Step ${r.step}`} · {when(r.sent_at ?? r.created_at)}</span>
            {r.state === 'sent' && r.draft_text && <span className="mt-1 block break-words text-muted-foreground">“{r.draft_text}”</span>}</span></span>
        <span className={r.state === 'sent' ? 'text-primary' : r.state === 'unknown' ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}>{r.state === 'sent' ? 'Sent' : r.state === 'unknown' ? 'Unconfirmed' : REASONS[r.reason ?? ''] ?? r.reason ?? r.state}</span></li>)}</ol>
        : <p className="rounded border border-dashed p-3 text-xs text-muted-foreground">No follow-ups yet.</p>}
    </div>
  </article>
}
