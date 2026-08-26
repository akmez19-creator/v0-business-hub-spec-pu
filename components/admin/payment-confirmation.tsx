'use client'

import { useState, useTransition } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Upload, CheckCircle2, AlertTriangle, HelpCircle, FileClock,
  Search, Loader2, ImageIcon, RotateCcw,
} from 'lucide-react'
import {
  uploadStatement, getConfirmations, confirmTransfer, unconfirmTransfer,
  type ConfirmationView, type UploadSummary,
} from '@/lib/payment-confirmation-actions'

type Check = ConfirmationView['checks'][number]

const money = (n: number) =>
  `Rs ${n.toLocaleString('en-MU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })

/**
 * Every status carries its own explanation. "Not found" and "no statement yet"
 * look identical on screen unless they are deliberately kept apart, and reading
 * one as the other turns an un-uploaded day into missing money.
 */
const STATUS = {
  confirmed: {
    label: 'Received', icon: CheckCircle2,
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  },
  amount_differs: {
    label: 'Amount differs', icon: AlertTriangle,
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  },
  not_found: {
    label: 'Not in statement', icon: AlertTriangle,
    className: 'border-destructive/30 bg-destructive/10 text-destructive',
  },
  no_statement: {
    label: 'Not checked yet', icon: FileClock,
    className: 'border-muted-foreground/30 bg-muted text-muted-foreground',
  },
  no_reference: {
    label: 'No reference saved', icon: HelpCircle,
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  },
} as const

export function PaymentConfirmation({
  initialView, initialError, dateFrom, dateTo,
}: {
  initialView: ConfirmationView | null
  initialError: string | null
  dateFrom: string
  dateTo: string
}) {
  const [view, setView] = useState(initialView)
  const [error, setError] = useState(initialError)
  const [from, setFrom] = useState(dateFrom)
  const [to, setTo] = useState(dateTo)
  const [summary, setSummary] = useState<UploadSummary | null>(null)
  const [search, setSearch] = useState('')
  const [pending, startTransition] = useTransition()
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const reload = (f = from, t = to) => {
    startTransition(async () => {
      const res = await getConfirmations(f, t)
      if ('view' in res) { setView(res.view); setError(null) } else setError(res.error)
    })
  }

  const onFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      startTransition(async () => {
        const res = await uploadStatement(String(reader.result))
        // Narrow on the success key, not on res.error - checking the error
        // field alone does not tell TypeScript which arm of the union this is.
        if (!('summary' in res)) { setError(res.error); return }
        setSummary(res.summary)
        setError(null)
        reload()
      })
    }
    reader.readAsText(file)
  }

  const act = (key: string, fn: () => Promise<{ error: string | null }>) => {
    setBusyKey(key)
    startTransition(async () => {
      const res = await fn()
      setBusyKey(null)
      if (res.error) setError(res.error)
      else reload()
    })
  }

  const s = view?.stats ?? {}
  const needsAttention = (s.amount_differs ?? 0) + (s.not_found ?? 0) + (s.no_reference ?? 0)

  const visible = (view?.checks ?? []).filter(c => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return c.transfer.contractor_name.toLowerCase().includes(q)
      || (c.transfer.reference ?? '').toLowerCase().includes(q)
      || (c.bank?.bank_ref ?? '').toLowerCase().includes(q)
  })

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Payment Confirmation</h1>
        <p className="max-w-3xl text-sm text-muted-foreground text-pretty">
          Every transfer your team sent to the bank, and whether the money actually arrived.
          Upload the bank statement as evidence: each transfer is looked up by its reference and
          confirmed only when the amount agrees too.
        </p>
      </header>

      {error && (
        <Card className="border-destructive/40 bg-destructive/10">
          <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <div className="flex items-center gap-2 font-medium">
            <Upload className="h-4 w-4" /> Bank statement
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex min-w-64 flex-1 flex-col gap-1.5">
              <Label htmlFor="csv">Statement file (CSV)</Label>
              <Input id="csv" type="file" accept=".csv,text/csv" disabled={pending}
                onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="from">Transfers from</Label>
              <Input id="from" type="date" value={from} onChange={e => setFrom(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="to">To</Label>
              <Input id="to" type="date" value={to} onChange={e => setTo(e.target.value)} />
            </div>
            <Button variant="secondary" disabled={pending} onClick={() => reload()}>
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Load period
            </Button>
          </div>

          {summary && (
            <p className="text-sm text-muted-foreground">
              Read {summary.parsed} statement rows: {summary.inserted} new,{' '}
              {summary.alreadySeen} already seen
              {summary.duplicatesInFile > 0 && `, ${summary.duplicatesInFile} repeated inside the file`}
              {summary.errors.length > 0 && `, ${summary.errors.length} unreadable`}.
              {' '}Re-uploading an overlapping period is safe.
            </p>
          )}
        </CardContent>
      </Card>

      {view && view.checks.length === 0 ? (
        /*
          No transfers is NOT the same as everything being settled. Saying
          "all confirmed" over an empty list would bless money that was never
          even recorded.
        */
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <FileClock className="h-6 w-6 text-muted-foreground" />
            <p className="font-medium">No transfers recorded between {from} and {to}</p>
            <p className="max-w-prose text-sm text-muted-foreground text-pretty">
              Nothing has been checked, and nothing is wrong. Transfers appear here once a
              contractor sends their collected juice to the bank and uploads the receipt.
            </p>
          </CardContent>
        </Card>
      ) : view ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Transfers in period" value={String(s.transfers ?? 0)} />
            <Stat label="Money received" value={money(s.confirmed_value ?? 0)}
              hint={`${s.confirmed ?? 0} confirmed`} tone="good" />
            <Stat label="Needs attention" value={String(needsAttention)}
              tone={needsAttention > 0 ? 'warn' : undefined}
              hint={needsAttention > 0 ? money(s.unconfirmed_value ?? 0) : 'Nothing outstanding'} />
            <Stat label="Not checked yet" value={String(s.no_statement ?? 0)}
              hint={(s.no_statement ?? 0) > 0 ? 'Statement not uploaded' : 'All days covered'} />
          </div>

          {view.daysAwaitingStatement.length > 0 && (
            <Card className="border-muted-foreground/30 bg-muted/40">
              <CardContent className="flex items-start gap-3 p-4 text-sm">
                <FileClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="text-muted-foreground text-pretty">
                  No statement has been uploaded covering{' '}
                  <span className="font-medium text-foreground">
                    {view.daysAwaitingStatement.join(', ')}
                  </span>. Those transfers are not missing - they simply have not been checked yet.
                </p>
              </CardContent>
            </Card>
          )}

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search contractor or reference"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          <div className="flex flex-col gap-3">
            {visible.length === 0 && (
              <Card className="border-dashed">
                <CardContent className="p-8 text-center text-sm text-muted-foreground">
                  No transfers match &quot;{search}&quot;.
                </CardContent>
              </Card>
            )}
            {visible.map(c => (
              <TransferCard key={c.transfer.key} check={c} busy={busyKey === c.transfer.key}
                disabled={pending}
                onConfirm={() => act(c.transfer.key, () => confirmTransfer({
                  transferKey: c.transfer.key,
                  bankTransactionId: c.bank!.id,
                  contractorId: c.transfer.contractor_id,
                  transferredAt: c.transfer.transferred_at,
                  expectedAmount: c.transfer.expected_amount,
                  bankAmount: c.bankAmount ?? 0,
                  matchType: c.refMatch === 'amount_only' ? 'amount_only' : (c.refMatch ?? 'manual'),
                  auto: c.auto,
                  note: c.note,
                }))}
                onUndo={() => act(c.transfer.key, () => unconfirmTransfer(c.transfer.key))} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

function Stat({ label, value, hint, tone }: {
  label: string; value: string; hint?: string; tone?: 'good' | 'warn'
}) {
  const toneClass = tone === 'good' ? 'text-emerald-400'
    : tone === 'warn' ? 'text-amber-400' : 'text-foreground'
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 p-4">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={`text-xl font-semibold tabular-nums ${toneClass}`}>{value}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </CardContent>
    </Card>
  )
}

function TransferCard({ check, busy, disabled, onConfirm, onUndo }: {
  check: Check
  busy: boolean
  disabled: boolean
  onConfirm: () => void
  onUndo: () => void
}) {
  const { transfer: t, status, bank } = check
  const meta = STATUS[status]
  const Icon = meta.icon

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{t.contractor_name}</span>
              <Badge variant="outline" className={meta.className}>
                <Icon className="mr-1 h-3 w-3" />{meta.label}
              </Badge>
              {check.savedConfirmation && (
                <Badge variant="outline" className="text-muted-foreground">Signed off</Badge>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              Sent {dateTime(t.transferred_at)} · {t.order_count} order{t.order_count === 1 ? '' : 's'}
              {t.first_day !== t.last_day ? ` · ${t.first_day} to ${t.last_day}` : ` · ${t.first_day}`}
            </span>
          </div>
          <div className="text-right">
            <div className="text-lg font-semibold tabular-nums">{money(t.expected_amount)}</div>
            <div className="text-xs text-muted-foreground">expected</div>
          </div>
        </div>

        <div className="grid gap-3 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-2">
          <Field label="Reference on the receipt"
            value={t.reference ?? 'None saved'}
            muted={!t.reference} />
          <Field label="Reference in the bank"
            value={bank?.bank_ref ?? 'Not found'}
            muted={!bank} />
          <Field label="Bank credited"
            value={check.bankAmount === null ? '-' : money(check.bankAmount)} />
          <Field label="Difference"
            value={check.difference === 0 ? 'None' : money(check.difference)}
            tone={check.difference === 0 ? undefined : 'warn'} />
        </div>

        {check.note && (
          <p className="text-sm text-muted-foreground text-pretty">{check.note}</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          {t.screenshot_url ? (
            <a href={t.screenshot_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
              <ImageIcon className="h-3.5 w-3.5" /> View receipt
            </a>
          ) : <span />}

          <div className="flex gap-2">
            {check.savedConfirmation ? (
              <Button size="sm" variant="ghost" disabled={disabled || busy} onClick={onUndo}>
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
                Undo sign-off
              </Button>
            ) : bank ? (
              <Button size="sm" disabled={disabled || busy} onClick={onConfirm}>
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                {status === 'confirmed' ? 'Sign off' : 'Accept anyway'}
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function Field({ label, value, muted, tone }: {
  label: string; value: string; muted?: boolean; tone?: 'warn'
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`font-mono text-sm ${
        tone === 'warn' ? 'text-amber-400' : muted ? 'text-muted-foreground' : 'text-foreground'
      }`}>{value}</span>
    </div>
  )
}
