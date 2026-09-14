'use client'

import { useEffect, useRef, useState } from 'react'
import { Bot, CheckCircle2, Clock3, Pause, Play, RefreshCw, ShieldCheck, Star, Truck, UserRound, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { autopilotDateBounds, autopilotReason, autopilotSettingsError, autopilotStateLabel, createAutopilotClient,
  type AutopilotBusiness, type AutopilotBusinessKey, type AutopilotJob, type AutopilotSettings, type AutopilotState, type AutopilotStaffTask } from './autopilot-client'
import { openStaffConversation } from './staff-conversation'

const BUSINESS_NAMES: Record<AutopilotBusinessKey, string> = { made_by_moris: 'Made By Moris', destockage: 'Destockage' }
const JOB_LABELS: Record<AutopilotJob['state'], string> = {
  queued: 'Waiting', processing: 'Checking conversation', sending: 'Sending reply', sent: 'Reply sent',
  needs_review: 'Needs staff review', failed: 'Send needs review', unknown: 'Needs staff review', cancelled: 'Cancelled',
}
function needsAgentAttention(job: AutopilotJob) {
  return ['needs_review', 'unknown', 'failed'].includes(job.state) &&
    ['customer_issue', 'exchange_or_change_request'].includes(job.reason?.toLowerCase() ?? '')
}
function displayTime(value: string | null) {
  return value ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Indian/Mauritius', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not yet'
}
type PanelActions = {
  onRefresh: () => void; onDismissError: () => void; onClose?: () => void
  onConfigure: (key: AutopilotBusinessKey, version: number, settings: AutopilotSettings, enabled: boolean) => Promise<boolean>
  onPause: (key: AutopilotBusinessKey) => void; onRun: (key: AutopilotBusinessKey) => void
  onTakeover: (jobId: string, paused: boolean) => void
}

/** Mount only while the inbox panel is open. Polling reads status; it never starts a run. */
export function AutopilotPanel({ onClose }: { onClose?: () => void }) {
  const [state, setState] = useState<AutopilotState>({ snapshot: null, loading: null, error: null, checkedAt: null })
  const client = useRef<ReturnType<typeof createAutopilotClient> | null>(null)
  useEffect(() => {
    const current = createAutopilotClient()
    client.current = current
    const unsubscribe = current.subscribe(() => setState(current.getSnapshot()))
    void current.refresh()
    const refreshVisible = () => { if (document.visibilityState === 'visible') void current.refresh(true) }
    const timer = setInterval(refreshVisible, 20000)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refreshVisible); unsubscribe(); current.dispose(); if (client.current === current) client.current = null }
  }, [])
  return <AutopilotPanelView state={state} onClose={onClose}
    onRefresh={() => { void client.current?.refresh() }} onDismissError={() => client.current?.dismissError()}
    onConfigure={(...args) => client.current?.configure(...args) ?? Promise.resolve(false)}
    onPause={key => { void client.current?.pause(key) }} onRun={key => { void client.current?.run(key) }}
    onTakeover={(jobId, paused) => { void client.current?.takeover(jobId, paused) }} />
}

export function AutopilotPanelView({ state, now = new Date(), ...actions }: PanelActions & { state: AutopilotState; now?: Date }) {
  const { snapshot, loading, error } = state
  return <section aria-labelledby="autopilot-heading" className="mb-5 overflow-hidden rounded-2xl border border-primary/25 bg-background shadow-sm">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b bg-primary/5 px-5 py-4">
      <div className="flex min-w-0 gap-3"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary"><Bot className="size-5" aria-hidden="true" /></div>
        <div><h2 id="autopilot-heading" className="text-lg font-semibold">Autopilot</h2><p className="mt-0.5 text-sm text-muted-foreground">Replies automatically; orders require staff confirmation.</p></div></div>
      <div className="flex gap-1"><Button type="button" variant="outline" size="sm" disabled={!!loading} onClick={actions.onRefresh}><RefreshCw className={`mr-1.5 size-3.5 ${loading?.kind === 'refresh' ? 'animate-spin' : ''}`} aria-hidden="true" />Refresh status</Button>
        {actions.onClose && <Button type="button" variant="ghost" size="icon" aria-label="Close Autopilot" onClick={actions.onClose}><X className="size-4" aria-hidden="true" /></Button>}</div>
    </header>
    <div className="space-y-5 p-4 sm:p-5">
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">Handles eligible unanswered messages from the last 24 hours and new messages. Pause before your team replies here or in Business Suite.</p>
      <p className="text-xs text-muted-foreground">A reply already being sent may still finish after Pause.</p>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><ShieldCheck className="size-3.5" aria-hidden="true" />Missing history goes to staff review</span><span className="flex items-center gap-1.5"><Truck className="size-3.5" aria-hidden="true" />Free delivery</span><span className="flex items-center gap-1.5"><UserRound className="size-3.5" aria-hidden="true" />Staff confirm every order</span></div>
      {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"><p className="min-w-0 flex-1">{error}</p><Button type="button" variant="ghost" size="sm" onClick={actions.onDismissError}>Dismiss notice</Button></div>}
      {!snapshot ? <p role="status" className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">{error ? 'Status unavailable. Refresh before changing Autopilot.' : 'Checking Autopilot status…'}</p> : <>
        {!snapshot.permissions.canManage && <p className="rounded-lg bg-muted p-3 text-sm">You can view activity. An authorised administrator manages Autopilot.</p>}
        <div className="grid gap-4 xl:grid-cols-2">{snapshot.businesses.map(business => <BusinessCard key={business.key} business={business} now={now} canManage={snapshot.permissions.canManage} pending={loading} hasError={!!error} {...actions} />)}</div>
        <div className="border-t pt-5" aria-labelledby="autopilot-staff-heading">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 id="autopilot-staff-heading" className="flex items-center gap-2 font-semibold"><Star className="size-4 fill-current text-amber-600" aria-hidden="true" />Staff review</h3><span className="text-xs text-muted-foreground">Oldest first · stays here until reviewed</span></div>
          <p className="mb-3 text-sm text-muted-foreground">These conversations stay with your team, including later customer messages. Review the conversation and any existing order before deliberately resuming Autopilot.</p>
          {snapshot.staffTasks.length?<ol aria-label="Open staff review tasks" className="max-h-[36rem] space-y-3 overflow-y-auto">{snapshot.staffTasks.map(task=><StaffTaskRow key={task.id} task={task} enabled={snapshot.businesses.find(b=>b.key===task.businessKey)?.enabled===true} canManage={snapshot.permissions.canManage&&!error} pending={loading} onTakeover={actions.onTakeover} onOpen={()=>{openStaffConversation(task);actions.onClose?.()}} />)}</ol>:<p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No open staff review tasks.</p>}
          {snapshot.staffTasksHasMore&&<p className="mt-2 text-xs text-muted-foreground">Showing the oldest 25 tasks. Further tasks appear as these are reviewed.</p>}
        </div>
        <div className="border-t pt-5"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Latest activity</h3><p className="text-xs text-muted-foreground">Newest first · Mauritius time</p></div>
          {snapshot.jobs.some(needsAgentAttention) && <p aria-label="Agent attention in latest activity" className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-800 dark:text-amber-200"><Star className="size-4 shrink-0 fill-current" aria-hidden="true" />Needs attention in Akmez · {snapshot.jobs.filter(needsAgentAttention).length}</p>}
          {snapshot.jobs.length ? <ol aria-label="Recent Autopilot activity" className="max-h-96 space-y-2 overflow-y-auto">{snapshot.jobs.map(job => <JobRow key={job.id} job={job} enabled={snapshot.businesses.find(b => b.key === job.businessKey)?.enabled === true} canManage={snapshot.permissions.canManage && !error} pending={loading} onTakeover={actions.onTakeover} />)}</ol>
            : <p className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No recent Autopilot activity. Enabling a business allows eligible conversations to be handled.</p>}
        </div>
      </>}
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">{loading ? loading.kind === 'refresh' ? 'Checking status…' : loading.kind === 'pause' ? 'Confirming pause…' : loading.kind === 'run' ? 'Checking one batch of eligible conversations…' : 'Confirming your change…' : state.checkedAt ? `Last confirmed status: ${displayTime(state.checkedAt)}` : 'No server status confirmed yet.'}</p>
    </div>
  </section>
}

function StaffTaskRow({task,enabled,canManage,pending,onTakeover,onOpen}:{task:AutopilotStaffTask;enabled:boolean;canManage:boolean;pending:AutopilotState['loading'];onTakeover:PanelActions['onTakeover'];onOpen:()=>void}){
  const order=task.kind==='order_ready_for_staff',details=task.evidence
  const [reviewing,setReviewing]=useState(false)
  return <li className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
    <div className="flex flex-wrap justify-between gap-2"><div><p className="break-words font-medium">{task.customerName||details.name||'Customer conversation'}</p><p className="mt-1 text-xs text-muted-foreground">{BUSINESS_NAMES[task.businessKey]} · {task.channel==='whatsapp'?'WhatsApp':'Messenger'} · {displayTime(task.createdAt)}</p></div><span className="text-xs font-semibold text-amber-700 dark:text-amber-300">{order?'Order details to review':task.kind==='customer_issue'?'Customer issue':'Exchange or order change'}</span></div>
    {order&&<><p className="mt-3 text-sm">Details collected. No order has been created or confirmed by Autopilot.</p><dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
      {[['Product',details.productName],['Quantity',details.quantity],['Proposed total',`Rs ${details.amount}`],['Contact',details.phone],['Customer',details.name],['Address',details.location],['Scheduled delivery',task.deliveryDate||'To check']].map(([label,value])=><div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="break-words">{value}</dd></div>)}
      </dl><p className="mt-3 text-xs text-muted-foreground">Check the current product, price, address and any existing order before using Quick order. Ad attribution comes from the conversation; it is not inferred here.</p><details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">Source references</summary><p className="mt-2 break-all">Product ID: {details.productId}</p>{Object.entries(details).filter(([k])=>k.endsWith('MessageId')).map(([k,v])=><p key={k} className="break-all">{k.replace('MessageId','')}: {v}</p>)}</details></>}
    <div className="mt-3 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={onOpen}>Open conversation</Button><Button type="button" size="sm" variant="ghost" disabled={!canManage||!!pending||!enabled} onClick={()=>setReviewing(v=>!v)}>Review and resume</Button></div>
    {reviewing&&<div className="mt-3 rounded-lg border bg-background p-3 text-sm"><p>Resume closes all open staff tasks for this conversation and lets Autopilot handle eligible new messages. It does not create or confirm an order.</p><div className="mt-3 flex gap-2"><Button type="button" size="sm" disabled={!canManage||!!pending||!enabled} onClick={()=>onTakeover('task:'+task.id,false)}>Reviewed — resume Autopilot</Button><Button type="button" size="sm" variant="ghost" onClick={()=>setReviewing(false)}>Keep with staff</Button></div></div>}
  </li>
}

function BusinessCard({ business, canManage, pending, hasError, now, onConfigure, onPause, onRun }: PanelActions & {
  business: AutopilotBusiness; canManage: boolean; pending: AutopilotState['loading']; hasError: boolean; now: Date
}) {
  const [draft, setDraft] = useState<(AutopilotSettings & { version: number }) | null>(null)
  const settings = draft ?? { deliveryDate: business.deliveryDate ?? '', maxDailyReplies: business.maxDailyReplies, version: business.version }
  const changed = !!draft && (settings.deliveryDate !== (business.deliveryDate ?? '') || settings.maxDailyReplies !== business.maxDailyReplies)
  const stale = !!draft && draft.version !== business.version
  const validation = autopilotSettingsError(settings, now), bounds = autopilotDateBounds(now)
  const edit = (next: Partial<AutopilotSettings>) => setDraft({ ...settings, ...next })
  const save = async (enabled: boolean) => { if (await onConfigure(business.key, settings.version, settings, enabled)) setDraft(null) }
  const ownPending = pending?.businessKey === business.key
  const review = ['needs_review', 'failed', 'unknown'].includes(business.state)
  return <article aria-labelledby={`autopilot-${business.key}`} className={`min-w-0 rounded-xl border p-4 ${business.enabled ? 'border-primary/35 bg-primary/[0.03]' : 'bg-muted/20'}`}>
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 id={`autopilot-${business.key}`} className="font-semibold">{BUSINESS_NAMES[business.key]}</h3><p className="mt-1 text-xs text-muted-foreground">Messenger &amp; WhatsApp</p></div>
      <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${business.enabled ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'}`}>{business.enabled ? 'Enabled' : 'Paused'}</span></div>
    {review && <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">Needs staff review{autopilotReason(business.reason) ? ` · ${autopilotReason(business.reason)}` : ''}</p>}
    {!review && business.reason && <p className="mt-3 text-xs text-muted-foreground">{autopilotReason(business.reason)}</p>}
    <div className="mt-4 grid grid-cols-2 gap-3">
      <div><label htmlFor={`autopilot-date-${business.key}`} className="text-xs font-medium">Delivery date</label><Input id={`autopilot-date-${business.key}`} className="mt-1 w-full min-w-0" type="date" min={bounds.min} max={bounds.max} value={settings.deliveryDate} onChange={event => edit({ deliveryDate: event.target.value })} disabled={!canManage || !!pending} aria-describedby={`autopilot-policy-${business.key}`} /></div>
      <div><label htmlFor={`autopilot-limit-${business.key}`} className="text-xs font-medium">Daily reply limit</label><Input id={`autopilot-limit-${business.key}`} className="mt-1" type="number" min={1} max={500} step={1} inputMode="numeric" value={Number.isFinite(settings.maxDailyReplies) ? settings.maxDailyReplies : ''} onChange={event => edit({ maxDailyReplies: event.target.value === '' ? NaN : Number(event.target.value) })} disabled={!canManage || !!pending} aria-describedby={`autopilot-policy-${business.key}`} /></div>
    </div>
    <p id={`autopilot-policy-${business.key}`} className="mt-2 text-xs text-muted-foreground">Delivery is free. Saving settings does not turn on a paused business.</p>
    {stale ? <div role="status" className="mt-3 rounded-lg border border-amber-500/30 p-3 text-xs"><p>These settings changed elsewhere. Review the latest settings before saving.</p><Button type="button" variant="outline" size="sm" className="mt-2" disabled={!!pending} onClick={() => setDraft(null)}>Use latest settings</Button></div>
      : validation && (draft || !business.deliveryDate) && <p className="mt-2 text-xs text-muted-foreground">{validation}</p>}
    <div className="mt-4 flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" disabled={!canManage || !!pending || hasError || !changed || stale || !!validation} onClick={() => { void save(business.enabled) }}>Save settings</Button>
      {!business.enabled && <Button type="button" size="sm" disabled={!canManage || !!pending || hasError || stale || !!validation} onClick={() => { void save(true) }}><Play className="mr-1.5 size-3.5" aria-hidden="true" />Enable {BUSINESS_NAMES[business.key]}</Button>}
      {(business.enabled || ownPending && pending.kind === 'save') && <Button type="button" variant="outline" size="sm" disabled={!canManage || ownPending && pending?.kind === 'pause'} onClick={() => onPause(business.key)}><Pause className="mr-1.5 size-3.5" aria-hidden="true" />{ownPending && pending.kind === 'pause' ? 'Pausing…' : `Pause ${BUSINESS_NAMES[business.key]}`}</Button>}
      {business.enabled && <Button type="button" variant="ghost" size="sm" disabled={!canManage || !!pending || hasError || changed || stale} onClick={() => onRun(business.key)}>Check waiting messages</Button>}
    </div>
    <div className="mt-4 flex flex-wrap justify-between gap-2 border-t pt-3 text-xs text-muted-foreground"><span><strong className="font-medium text-foreground">{business.repliesToday}</strong> / {business.maxDailyReplies} replies today</span><span>Last run: {displayTime(business.lastRunAt)}</span></div>
    {business.reservedToday !== undefined && business.reservedToday > business.repliesToday && <p className="mt-1 text-xs text-muted-foreground">{business.reservedToday - business.repliesToday} replies in progress or awaiting confirmation also count toward today’s limit.</p>}
  </article>
}

function JobRow({ job, enabled, canManage, pending, onTakeover }: { job: AutopilotJob; enabled: boolean; canManage: boolean; pending: AutopilotState['loading']; onTakeover: PanelActions['onTakeover'] }) {
  const handled = autopilotStateLabel(job)
  const review = !handled && ['unknown', 'needs_review', 'failed'].includes(job.state)
  const agentAttention = needsAgentAttention(job)
  const last = job.latestMessage
  return <li className={`flex flex-wrap items-start justify-between gap-3 rounded-lg border px-3 py-3 ${agentAttention ? 'border-amber-500/40 bg-amber-500/5' : ''}`}>
    <div className="flex min-w-0 flex-1 gap-2.5">{agentAttention ? <Star className="mt-0.5 size-4 shrink-0 fill-current text-amber-600 dark:text-amber-300" aria-hidden="true" /> : job.state === 'sent' || handled ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" /> : <Clock3 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
      <div className="min-w-0"><p className="break-words text-sm font-medium">{job.customerName ?? 'Customer conversation'}</p><p className="mt-0.5 text-xs text-muted-foreground">{BUSINESS_NAMES[job.businessKey]}{job.channel ? ` · ${job.channel === 'whatsapp' ? 'WhatsApp' : 'Messenger'}` : ''} · {displayTime(job.updatedAt)}</p>
        {agentAttention && <p className="mt-2 inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-200">Agent attention</p>}
        <p className={`mt-1 text-xs ${review ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}>{handled || JOB_LABELS[job.state]}{job.manualTakeover ? ' · Staff in control' : ''}</p>
        {last && <p className="mt-1.5 break-words text-xs leading-5">
          <span className={`font-semibold ${last.direction === 'in' ? 'text-foreground' : 'text-muted-foreground'}`}>{last.direction === 'in' ? 'Customer' : 'Your team'}</span>
          <span className="text-muted-foreground"> · {displayTime(last.at)} · </span>
          {last.text ? <q className="text-foreground/90">{last.text}</q> : <span className="italic text-muted-foreground">photo, sticker or attachment</span>}
        </p>}
        {job.state === 'unknown' ? <p className="mt-1 text-xs text-muted-foreground">Delivery could not be confirmed. Check the conversation before sending again.</p> : job.reason && <p className="mt-1 text-xs text-muted-foreground">{autopilotReason(job.reason)}</p>}
      </div></div>
    {job.channel && job.customerId && typeof job.manualTakeover === 'boolean' && <Button type="button" variant="outline" size="sm" disabled={!canManage || !!pending || job.manualTakeover && !enabled} onClick={() => onTakeover(job.id, !job.manualTakeover)} aria-label={`${job.manualTakeover ? 'Resume Autopilot for' : 'Take over'} ${job.customerName ?? 'this conversation'} on ${BUSINESS_NAMES[job.businessKey]}`}>{pending?.jobId === job.id ? 'Confirming…' : job.manualTakeover ? 'Resume' : 'Take over'}</Button>}
  </li>
}
