'use client'

// Admin review queue for warehouse physical counts.
//
// Approving calls approve_stock_count(), which writes counted_qty into
// products.quantity for the whole session atomically. This is the only place
// stock is rewritten, which is why the variance detail is shown up front.
import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ClipboardList,
  Check,
  X,
  Loader2,
  ChevronDown,
  TrendingUp,
  TrendingDown,
  Sparkles,
  AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { approveCount, rejectCount } from '@/lib/stock-count-actions'

interface Session {
  id: string
  count_date: string
  status: string
  notes: string | null
  submitted_at: string | null
  reviewed_at: string | null
  counted_by_name: string
  line_count: number
  total_counted: number
  net_variance: number
  baseline_lines: number
  variance_lines: number
}

interface Line {
  id: string
  count_id: string
  product_id: string
  counted_qty: number
  system_qty: number
  is_baseline: boolean
  variance: number
  products: { name: string } | null
}

const STATUS_STYLES: Record<string, string> = {
  submitted: 'bg-amber-500/15 text-amber-500 border-amber-500/30',
  approved: 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
  rejected: 'bg-rose-500/15 text-rose-500 border-rose-500/30',
}

export function StockCountReview({
  sessions,
  lines,
  canApprove,
}: {
  sessions: Session[]
  lines: Line[]
  canApprove: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [expanded, setExpanded] = useState<string | null>(
    sessions.find((s) => s.status === 'submitted')?.id ?? null,
  )
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [rejectNotes, setRejectNotes] = useState('')

  const linesBySession = useMemo(() => {
    const m = new Map<string, Line[]>()
    for (const l of lines) {
      const arr = m.get(l.count_id) || []
      arr.push(l)
      m.set(l.count_id, arr)
    }
    // Biggest absolute variance first: those are the lines worth checking.
    for (const arr of m.values()) {
      arr.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
    }
    return m
  }, [lines])

  const pending = sessions.filter((s) => s.status === 'submitted')

  async function handleApprove(id: string) {
    setBusyId(id)
    setError(null)
    const res = await approveCount(id)
    setBusyId(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    startTransition(() => router.refresh())
  }

  async function handleReject(id: string) {
    setBusyId(id)
    setError(null)
    const res = await rejectCount(id, rejectNotes || undefined)
    setBusyId(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setRejecting(null)
    setRejectNotes('')
    startTransition(() => router.refresh())
  }

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15">
            <ClipboardList className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight text-foreground">Stock Counts</h1>
            <p className="text-sm text-muted-foreground">
              Warehouse counts awaiting review
            </p>
          </div>
        </div>
        {pending.length > 0 && (
          <span className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-sm font-medium text-amber-500">
            {pending.length} pending
          </span>
        )}
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
          <p className="text-sm text-rose-400">{error}</p>
        </div>
      )}

      {!canApprove && (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            You can review counts here, but only an admin can approve them.
          </p>
        </div>
      )}

      {sessions.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16">
          <ClipboardList className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-medium text-foreground">No stock counts yet</p>
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            When a storekeeper submits a physical count from the warehouse, it will appear here for
            approval.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {sessions.map((s) => {
            const sessionLines = linesBySession.get(s.id) || []
            const isOpen = expanded === s.id
            const busy = busyId === s.id
            return (
              <li key={s.id} className="overflow-hidden rounded-xl border border-border bg-card">
                <button
                  onClick={() => setExpanded(isOpen ? null : s.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">
                        {new Date(s.count_date).toLocaleDateString('en-GB', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </p>
                      <span
                        className={cn(
                          'rounded-md border px-2 py-0.5 text-[10px] font-medium capitalize',
                          STATUS_STYLES[s.status] || 'border-border bg-muted text-muted-foreground',
                        )}
                      >
                        {s.status}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {s.counted_by_name} · {s.line_count} products ·{' '}
                      {Number(s.total_counted).toLocaleString()} units
                    </p>
                  </div>

                  <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
                    {Number(s.baseline_lines) > 0 && (
                      <span className="flex items-center gap-1 rounded-md border border-sky-500/25 bg-sky-500/10 px-2 py-1 text-[10px] font-medium text-sky-400">
                        <Sparkles className="h-3 w-3" /> {s.baseline_lines} first
                      </span>
                    )}
                    {Number(s.variance_lines) > 0 && (
                      <span
                        className={cn(
                          'flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium',
                          Number(s.net_variance) >= 0
                            ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400'
                            : 'border-rose-500/25 bg-rose-500/10 text-rose-400',
                        )}
                      >
                        {Number(s.net_variance) >= 0 ? (
                          <TrendingUp className="h-3 w-3" />
                        ) : (
                          <TrendingDown className="h-3 w-3" />
                        )}
                        {Number(s.net_variance) > 0 ? '+' : ''}
                        {Number(s.net_variance)}
                      </span>
                    )}
                  </div>

                  <ChevronDown
                    className={cn(
                      'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                      isOpen && 'rotate-180',
                    )}
                  />
                </button>

                {isOpen && (
                  <div className="border-t border-border">
                    {s.notes && (
                      <p className="border-b border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                        Agent note: {s.notes}
                      </p>
                    )}

                    <div className="max-h-80 overflow-y-auto">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-card">
                          <tr className="border-b border-border text-left">
                            <th className="px-4 py-2 text-xs font-medium text-muted-foreground">
                              Product
                            </th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                              System
                            </th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                              Counted
                            </th>
                            <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">
                              Variance
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {sessionLines.map((l) => (
                            <tr key={l.id} className="border-b border-border/50 last:border-0">
                              <td className="px-4 py-2 text-foreground">
                                {l.products?.name || 'Unknown product'}
                              </td>
                              <td className="px-3 py-2 text-right text-muted-foreground">
                                {l.is_baseline ? '—' : l.system_qty}
                              </td>
                              <td className="px-3 py-2 text-right font-medium text-foreground">
                                {l.counted_qty.toLocaleString()}
                              </td>
                              <td className="px-4 py-2 text-right">
                                {l.is_baseline ? (
                                  <span className="text-xs text-sky-400">First count</span>
                                ) : l.variance === 0 ? (
                                  <span className="text-xs text-muted-foreground">—</span>
                                ) : (
                                  <span
                                    className={cn(
                                      'text-xs font-medium',
                                      l.variance > 0 ? 'text-emerald-400' : 'text-rose-400',
                                    )}
                                  >
                                    {l.variance > 0 ? '+' : ''}
                                    {l.variance}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {s.status === 'submitted' && canApprove && (
                      <div className="flex flex-col gap-2 border-t border-border p-4">
                        {rejecting === s.id ? (
                          <>
                            <label
                              htmlFor={`reject-${s.id}`}
                              className="text-xs font-medium text-muted-foreground"
                            >
                              Why is this count being rejected?
                            </label>
                            <textarea
                              id={`reject-${s.id}`}
                              value={rejectNotes}
                              onChange={(e) => setRejectNotes(e.target.value)}
                              rows={2}
                              placeholder="Reason for the agent..."
                              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setRejecting(null)
                                  setRejectNotes('')
                                }}
                                className="flex-1 rounded-lg border border-border py-2 text-sm font-medium text-foreground hover:bg-muted/50"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => handleReject(s.id)}
                                disabled={busy}
                                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-500/90 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
                              >
                                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                                Confirm reject
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <button
                              onClick={() => setRejecting(s.id)}
                              disabled={busy || isPending}
                              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border py-2.5 text-sm font-medium text-foreground hover:bg-muted/50 disabled:opacity-50"
                            >
                              <X className="h-4 w-4" />
                              Reject
                            </button>
                            <button
                              onClick={() => handleApprove(s.id)}
                              disabled={busy || isPending}
                              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                            >
                              {busy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Check className="h-4 w-4" />
                              )}
                              Approve &amp; update stock
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
