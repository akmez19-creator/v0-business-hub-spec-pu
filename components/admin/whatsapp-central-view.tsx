'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, Check, Clock3, History, Loader2, MessageSquareText, Pause, Plug, RefreshCw, ShieldCheck, Smartphone, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export type CentralConnectionPhase = 'offline' | 'disconnected' | 'starting' | 'qr' | 'connecting' | 'ready' | 'paused' | 'failed' | 'mismatch'
export type CentralObservationView = {
  sourceMessageId: string; direction: 'in' | 'out'; text: string | null; kind: 'text' | 'unsupported'
  sentAt: string | null; displayedSentAt: string | null; unsupportedKind: string | null; firstObservedAt: string
}
export type CentralBusinessView = {
  phoneNumberId: string; name: string; phone: string; phase: CentralConnectionPhase
  workerOnline: boolean; recoveryEnabled: boolean; connectedPhone: string | null; workerExpiresAt: string | null
  qr: { imageSrc: string; expiresAt: string } | null
  explanation: string | null; operation: 'connect' | 'pause' | 'fetch' | null
  canConnect: boolean; canFetch: boolean; fetchState: 'none' | 'queued' | 'capturing' | 'uploaded' | 'paused' | 'failed'
  fetchReason: string | null; lastCopiedAt: string | null; missingReceiptCount: number | null
  observations: CentralObservationView[]; hasMore: boolean
  pairingSetup: { expiresAt: string; sessionId: string } | null
}
export type CentralRecoveryViewProps = {
  businesses: CentralBusinessView[]; selectedBusinessId: string; now: number; loading: boolean
  error: string | null; notice: string | null; checkedAt: string | null
  onSelectBusiness: (id: string) => void; onConnect: (id: string) => void
  onPause: (id: string) => void; onFetch: (id: string) => void; onRefresh: () => void
  onCopyPairing: (id: string) => void; onDismissPairing: (id: string) => void
  onReadSetupCode: (id: string) => string | null
}

const PHASE_LABELS: Record<CentralConnectionPhase, string> = {
  offline: 'Recovery service offline', disconnected: 'Not connected', starting: 'Starting connection',
  qr: 'Scan with the business phone', connecting: 'Confirming your phone', ready: 'Business phone verified',
  paused: 'Recovery paused', failed: 'Connection needs attention', mismatch: 'Wrong business phone',
}
const FETCH_LABELS: Record<CentralBusinessView['fetchState'], string> = {
  none: 'No fetch requested', queued: 'Fetch queued', capturing: 'Fetching your Asla conversation',
  uploaded: 'Copies received · history remains partial', paused: 'Fetch paused', failed: 'Fetch needs attention',
}

export function centralDate(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not recorded'
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Indian/Mauritius', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}
export function safeQrImage(value: string, expiresAt: string, now: number, phoneNumberId: string): boolean {
  if (!value.startsWith('/api/inbox/whatsapp/central/qr?') || value.length > 2048 ||
    !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now) return false
  try {
    const url = new URL(value, 'https://www.akmez.tech')
    return url.origin === 'https://www.akmez.tech' && url.pathname === '/api/inbox/whatsapp/central/qr' &&
      url.searchParams.get('phoneNumberId') === phoneNumberId && url.searchParams.get('waId') === '23052583671' &&
      !!url.searchParams.get('sessionId') && /^\d+$/.test(url.searchParams.get('generation') ?? '') && !!url.searchParams.get('nonce')
  } catch { return false }
}

function PairingCode({ business, now }: { business: CentralBusinessView; now: number }) {
  const [imageFailed, setImageFailed] = useState(false)
  const qr = business.qr
  if (!qr || !safeQrImage(qr.imageSrc, qr.expiresAt, now, business.phoneNumberId) || imageFailed) {
    return <div className="central-qr-placeholder rounded-xl border bg-muted/30 p-5 text-center"><Smartphone className="mx-auto size-8 text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-sm font-medium">{qr && Date.parse(qr.expiresAt) <= now ? 'This code expired' : imageFailed ? 'The code could not be displayed' : 'Waiting for a fresh pairing code'}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">A code appears here only when the connected service supplies a valid, current code for this business.</p></div>
  }
  return <div className="rounded-xl border bg-muted/30 p-5"><div className="mx-auto w-fit rounded-xl bg-white p-3"><Image src={qr.imageSrc} alt={`Scan to connect ${business.name}`} width={224} height={224} unoptimized onError={() => setImageFailed(true)} className="block h-auto max-w-full" /></div><p className="mt-3 text-center text-xs leading-5 text-muted-foreground">Expires in {Math.max(0, Math.ceil((Date.parse(qr.expiresAt) - now) / 1000))} seconds. Scan from this business phone’s Linked devices screen.</p></div>
}

function ManualSetupCode({ business, now, readCode }: { business: CentralBusinessView; now: number; readCode: (id: string) => string | null }) {
  const inputId = useId()
  const field = useRef<HTMLInputElement>(null)
  const [code, setCode] = useState<string | null>(null)
  const [masked, setMasked] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const expiresAt = business.pairingSetup?.expiresAt
  const valid = !!expiresAt && Date.parse(expiresAt) > now

  useEffect(() => {
    if (!expiresAt) return
    const timeout = setTimeout(() => { setCode(null); setMasked(true) }, Math.max(0, Date.parse(expiresAt) - Date.now()))
    return () => clearTimeout(timeout)
  }, [expiresAt])

  const currentCode = () => {
    const current = readCode(business.phoneNumberId)
    if (!current || current !== code) { setCode(null); setMasked(true); setUnavailable(true); return null }
    return current
  }
  if (!valid) return null
  return <div className="mt-3 space-y-3">
    <Button type="button" variant="outline" size="sm" aria-expanded={!!code} aria-controls={`${inputId}-panel`} onClick={() => {
      if (code) { setCode(null); setMasked(true); setUnavailable(false); return }
      const current = readCode(business.phoneNumberId)
      setCode(current); setMasked(true); setUnavailable(!current)
    }}>{code ? 'Close setup code' : 'Show setup code'}</Button>
    {unavailable && <p role="status" className="text-xs leading-5 text-muted-foreground">This setup code is no longer available. Refresh the connection before trying again.</p>}
    {code && <div id={`${inputId}-panel`} className="space-y-3 rounded-lg border bg-background p-3">
      <label htmlFor={inputId} className="block text-xs font-medium">Private setup code · {business.name}</label>
      <input ref={field} id={inputId} type={masked ? 'password' : 'text'} value={code} readOnly autoComplete="off" spellCheck={false}
        aria-describedby={`${inputId}-help`} data-lpignore="true" data-1p-ignore="true"
        className="block min-w-0 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        onFocus={() => { currentCode() }} />
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" size="sm" onClick={() => { if (currentCode()) setMasked(value => !value) }}>{masked ? 'Show text' : 'Mask text'}</Button>
        <Button type="button" variant="outline" size="sm" disabled={masked} onClick={() => {
          if (currentCode()) { field.current?.focus(); field.current?.select() }
        }}>Select code</Button>
      </div>
      <p id={`${inputId}-help`} className="text-xs leading-5 text-muted-foreground">If the Copy button does not work, choose Show text, then Select code. Copy the selected text and paste it into the matching business in the local connection service. Keep this code private.</p>
    </div>}
  </div>
}

export function WhatsAppCentralView({ businesses, selectedBusinessId, now, loading, error, notice, checkedAt, onSelectBusiness, onConnect, onPause, onFetch, onRefresh, onCopyPairing, onDismissPairing, onReadSetupCode }: CentralRecoveryViewProps) {
  const selected = businesses.find(item => item.phoneNumberId === selectedBusinessId) ?? businesses[0]
  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-10">
    <header className="flex flex-col gap-5"><Link href="/dashboard/inbox" className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden="true" />Back to inbox</Link><div className="flex flex-wrap items-start justify-between gap-4"><div className="space-y-2"><p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Akmez · Conversation continuity</p><h1 className="text-3xl font-semibold tracking-tight">WhatsApp connections</h1><p className="max-w-2xl text-sm leading-6 text-muted-foreground">Connect each business phone here and recover available replies into Akmez.</p></div><span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-300"><ShieldCheck className="size-4" aria-hidden="true" />Own Asla contact first</span></div></header>
    {error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}
    {notice && <p role="status" className="rounded-xl border bg-muted/40 px-4 py-3 text-sm">{notice}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Two separate business connections. Pair each code with its matching phone.</p><Button type="button" variant="outline" size="sm" disabled={loading} onClick={onRefresh}><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh connections</Button></div>
    <div className="grid items-start gap-6 sm:grid-cols-2">
      {businesses.map(business => <Card key={business.phoneNumberId} className="gap-5 p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{business.name}</h2><p className="mt-1 text-sm text-muted-foreground">{business.phone}</p></div>{business.phase === 'ready' ? <Check className="size-5 text-primary" aria-hidden="true" /> : business.workerOnline ? <Smartphone className="size-5 text-muted-foreground" aria-hidden="true" /> : <WifiOff className="size-5 text-muted-foreground" aria-hidden="true" />}</div>
        <div className={`rounded-xl border p-4 ${business.phase === 'mismatch' || business.phase === 'failed' ? 'border-destructive/30 bg-destructive/5' : business.phase === 'ready' ? 'border-primary/25 bg-primary/5' : 'bg-muted/30'}`}><p className="text-sm font-semibold" aria-live="polite">{PHASE_LABELS[business.phase]}</p>{business.explanation && <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">{business.explanation}</p>}{business.connectedPhone && <p className="mt-2 text-xs leading-5 text-muted-foreground">Observed phone: {business.connectedPhone}</p>}</div>
        {business.phase === 'qr' && <PairingCode key={business.qr?.imageSrc ?? 'waiting'} business={business} now={now} />}
        {business.pairingSetup && Date.parse(business.pairingSetup.expiresAt) > now && <section className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4"><h3 className="text-sm font-semibold">Connect the central recovery service</h3><p className="mt-2 text-xs leading-5 text-muted-foreground">Copy this private setup code and paste it into the Akmez connection service on this PC, with {business.name} selected. Then return here for the phone pairing code. The setup code expires in {Math.max(0, Math.ceil((Date.parse(business.pairingSetup.expiresAt) - now) / 60_000))} minutes.</p><div className="mt-3 flex flex-wrap gap-3"><Button type="button" variant="outline" size="sm" onClick={() => onCopyPairing(business.phoneNumberId)}>Copy one-time setup code</Button><Button type="button" variant="outline" size="sm" onClick={() => onDismissPairing(business.phoneNumberId)}>Dismiss setup code</Button></div><ManualSetupCode key={business.pairingSetup.sessionId} business={business} now={now} readCode={onReadSetupCode} /></section>}
        {business.phase === 'disconnected' && <div className="rounded-xl border bg-muted/30 p-4 text-sm leading-6 text-muted-foreground">Press Connect. When the service is available, your pairing code will appear inside this card.</div>}
        <div className="flex flex-wrap gap-3"><Button type="button" disabled={!business.canConnect || !!business.operation} onClick={() => onConnect(business.phoneNumberId)}>{business.operation === 'connect' || business.phase === 'starting' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plug className="size-4" aria-hidden="true" />}{business.operation === 'connect' ? 'Connecting…' : business.phase === 'ready' ? 'Connected' : 'Connect business phone'}</Button><Button type="button" variant="outline" disabled={business.operation === 'pause'} onClick={() => onPause(business.phoneNumberId)}>{business.operation === 'pause' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Pause className="size-4" aria-hidden="true" />}{business.operation === 'pause' ? 'Pausing…' : 'Pause recovery'}</Button></div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><span className="text-xs text-muted-foreground">Recovery {business.recoveryEnabled ? 'enabled' : 'Off'} · {business.workerOnline ? 'service online' : 'service unavailable'}</span><button type="button" onClick={() => onSelectBusiness(business.phoneNumberId)} className="text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{business.phoneNumberId === selected?.phoneNumberId ? 'Viewing history' : 'View history'}</button></div>
        {business.workerExpiresAt && <p className="text-xs leading-5 text-muted-foreground">Service authorization expires {centralDate(business.workerExpiresAt)} Mauritius. Reconnect when it expires.</p>}
      </Card>)}
    </div>

    {selected && <Card className="gap-0 overflow-hidden">
      <div className="space-y-4 border-b p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">{selected.name}</p><h2 className="mt-2 flex items-center gap-2 text-lg font-semibold"><MessageSquareText className="size-5 text-primary" aria-hidden="true" />Asla / Akmez · +230 5258 3671</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Fetch available history for your own test contact. No replies or orders are sent.</p></div><Button type="button" disabled={!selected.canFetch || !!selected.operation} onClick={() => onFetch(selected.phoneNumberId)}>{selected.operation === 'fetch' || ['queued', 'capturing'].includes(selected.fetchState) ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <History className="size-4" aria-hidden="true" />}{selected.operation === 'fetch' ? 'Requesting history…' : ['queued', 'capturing'].includes(selected.fetchState) ? 'History fetch in progress' : 'Fetch Asla history'}</Button></div>
        <p className="rounded-lg bg-muted/50 px-3 py-2.5 text-sm font-medium" aria-live="polite">{FETCH_LABELS[selected.fetchState]}</p>{selected.fetchReason && <p className="text-sm leading-6 text-muted-foreground">{selected.fetchReason}</p>}
        <div className="flex flex-wrap gap-6 text-sm"><p><span className="text-muted-foreground">Copies shown </span><strong className="tabular-nums">{selected.observations.length}{selected.hasMore ? '+' : ''}</strong></p><p><span className="text-muted-foreground">Missing original texts </span><strong className="tabular-nums">{selected.missingReceiptCount ?? 'Not checked'}</strong></p><p><span className="text-muted-foreground">Last received </span>{centralDate(selected.lastCopiedAt)}</p></div>
      </div>
      {selected.observations.length === 0 ? <div className="p-8 text-center sm:p-12"><History className="mx-auto size-8 text-muted-foreground" aria-hidden="true" /><p className="mt-4 font-medium">No recovered copies for this business yet</p><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">Connect the matching business phone, then fetch the available Asla history. Original inbox messages remain separate.</p></div> : <ol className="space-y-5 p-5 sm:p-6" aria-label={`${selected.name} recovered messages`}>{selected.observations.map(item => <li key={item.sourceMessageId} className={`flex ${item.direction === 'out' ? 'justify-end' : 'justify-start'}`}><article className={`w-full max-w-2xl rounded-2xl border p-4 ${item.direction === 'out' ? 'border-primary/25 bg-primary/5' : 'bg-muted/30'}`}><div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs"><strong>{item.direction === 'out' ? selected.name : 'Asla / Akmez'}</strong><span className="text-muted-foreground">Recovered WhatsApp copy</span></div><p className="whitespace-pre-wrap break-words text-sm leading-6">{item.kind === 'text' && item.text ? item.text : `Content unavailable${item.unsupportedKind ? ` · ${item.unsupportedKind}` : ''}`}</p><p className="mt-3 text-xs leading-5 text-muted-foreground">{item.sentAt ? `${centralDate(item.sentAt)} · Mauritius` : item.displayedSentAt ? `${item.displayedSentAt} · displayed time; exact date unverified` : 'Original send time unavailable'}</p><details className="mt-2 text-xs text-muted-foreground"><summary className="w-fit cursor-pointer">Copy details</summary><p className="mt-2 break-all">Source reference: {item.sourceMessageId}</p><p>First observed: {centralDate(item.firstObservedAt)} Mauritius</p></details></article></li>)}</ol>}
      <div className="border-t p-5 sm:p-6"><p className="text-xs leading-5 text-muted-foreground">History remains partial unless independently verified. Copies are listed by when they were first saved, not original send time. A recovered copy does not identify which blank Cloud receipt it belongs to. {selected.hasMore ? 'Only the latest 100 copies are shown here. ' : ''}This recovery page does not send replies or create orders.</p></div>
    </Card>}
    <p className="flex flex-wrap items-center gap-2 text-xs leading-5 text-muted-foreground"><Clock3 className="size-3.5" aria-hidden="true" />Connection status checked {centralDate(checkedAt)}. Dates shown in Mauritius time.</p>
  </div>
}
