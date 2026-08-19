'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  GitCompareArrows,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  Undo2,
} from 'lucide-react'

/** Header aliases seen in the COMPILE files. `Qty ` really does have a trailing space. */
const HEADER_MAP: Record<string, string> = {
  rte: 'rte',
  'entry date': 'entry_date',
  'delivery date': 'delivery_date',
  'customer name': 'customer_name',
  customer: 'customer_name',
  'contact #1': 'contact_1',
  'contact 1': 'contact_1',
  contact: 'contact_1',
  'contact #2': 'contact_2',
  'contact 2': 'contact_2',
  region: 'region',
  qty: 'qty',
  quantity: 'qty',
  products: 'products',
  product: 'products',
  amt: 'amount',
  amount: 'amount',
  'payment method': 'payment_method',
  salestype: 'sales_type',
  'sales type': 'sales_type',
  notes: 'notes',
  medium: 'medium',
  rider: 'zone',
  zone: 'zone',
  office: 'office',
  district: 'district',
  index: 'index_no',
  'product check': 'product_check',
}

interface Diff {
  field: string
  from: unknown
  to: unknown
}

interface PreviewResponse {
  month: string
  stats: {
    fileRows: number
    dbRows: number
    inserts: number
    updates: number
    unchanged: number
    flagged: number
    duplicates: number
    dbOnly: number
    skipped: number
    productsUnmatched: number
    matchedByTier: Record<string, number>
    fileAmountTotal: number
  }
  warningCounts: Record<string, number>
  fieldCounts: Record<string, number>
  unmatchedProducts: { name: string; rows: number }[]
  variantMatched: string[]
  samples: {
    inserts: {
      rowNumber: number
      date: string | null
      customer: string | null
      contact: string | null
      product: string | null
      amount: number
      rte: string | null
      productMatch: string
      warnings: string[]
    }[]
    updates: { rowNumber: number; dbId: string; tier: string; customer: string | null; date: string | null; diffs: Diff[] }[]
    flagged: {
      rowNumber: number
      dbId: string
      tier: string
      customer: string | null
      contact: string | null
      date: string | null
      fileProduct: string | null
      dbProduct: string | null
      fileAmount: number
      dbAmount: number | null
      otherDiffs: Diff[]
    }[]
    duplicates: { rowNumber: number; duplicateOf: number; customer: string | null; product: string | null; amount: number; date: string | null }[]
    dbOnly: { id: string; delivery_date: string | null; customer_name: string | null; contact_1: string | null; products: string | null; amount: number | null; hasAssignment: boolean; status: string | null }[]
    skipped: { rowNumber: number; reason: string }[]
  }
}

interface CommitResponse {
  importId: string
  inserted: number
  updated: number
  archived: number
  removed: number
  unchanged: number
  flagged: number
  duplicates: number
  skipped: number
  errors: string[]
}

function normHeader(h: string) {
  return h.trim().toLowerCase().replace(/\s+/g, ' ')
}

function toIsoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10)
  const s = String(v).trim()
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return m[0]
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

export function ReconcileDeliveriesDialog({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const fileInput = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [month, setMonth] = useState('')
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<'pick' | 'review' | 'done'>('pick')
  const [error, setError] = useState<string | null>(null)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [result, setResult] = useState<CommitResponse | null>(null)

  const [insertNew, setInsertNew] = useState(true)
  const [applyUpdates, setApplyUpdates] = useState(true)
  const [removeDbOnly, setRemoveDbOnly] = useState(false)
  const [productLinking, setProductLinking] = useState<'exact' | 'exact+variant' | 'none'>('exact+variant')
  const [skipFields, setSkipFields] = useState<Set<string>>(new Set())

  const reset = useCallback(() => {
    setFile(null)
    setRows([])
    setMonth('')
    setStage('pick')
    setError(null)
    setSessionExpired(false)
    setPreview(null)
    setResult(null)
    setSkipFields(new Set())
    setRemoveDbOnly(false)
    if (fileInput.current) fileInput.current.value = ''
  }, [])

  const parse = useCallback(async (f: File) => {
    setBusy(true)
    setError(null)
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true })
      const sheet = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null })
      if (!raw.length) {
        setError('That sheet has no data rows.')
        return
      }
      const mapped = raw.map((r, i) => {
        const out: Record<string, unknown> = { rowNumber: i + 2 }
        for (const [key, value] of Object.entries(r)) {
          const field = HEADER_MAP[normHeader(key)]
          if (field) out[field] = value
        }
        out.entry_date = toIsoDate(out.entry_date)
        out.delivery_date = toIsoDate(out.delivery_date)
        return out
      })
      setRows(mapped)

      // Default the target month to whichever month the file mostly covers, so
      // reconciliation can never silently compare against the wrong month.
      const tally = new Map<string, number>()
      for (const r of mapped) {
        const d = r.delivery_date as string | null
        if (d) tally.set(d.slice(0, 7), (tally.get(d.slice(0, 7)) ?? 0) + 1)
      }
      const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]
      if (best) setMonth(best[0])
      const stray = [...tally.entries()].filter(([m]) => m !== best?.[0])
      if (stray.length) {
        setError(
          `Note: ${stray.reduce((a, [, n]) => a + n, 0)} row(s) fall outside ${best?.[0]} (${stray
            .map(([m, n]) => `${m}: ${n}`)
            .join(', ')}). Only rows in the target month are reconciled.`,
        )
      }
    } catch (e) {
      setError(`Could not read that file: ${e instanceof Error ? e.message : 'unknown error'}`)
    } finally {
      setBusy(false)
    }
  }, [])

  const call = useCallback(
    async (mode: 'preview' | 'commit') => {
      setBusy(true)
      setError(null)
      setSessionExpired(false)
      try {
        const res = await fetch('/api/deliveries/reconcile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: file?.name ?? 'reconcile.xlsx',
            month,
            rows,
            mode,
            options: {
              insertNew,
              applyUpdates,
              removeDbOnly,
              productLinking,
              fields: preview ? Object.keys(preview.fieldCounts).filter((f) => !skipFields.has(f)) : undefined,
            },
          }),
        })
        // Branch on the STATUS before reading the body: an expired session
        // returns a bare 401 that is indistinguishable from a data error once
        // it has been flattened into a string.
        if (res.status === 401) {
          setSessionExpired(true)
          return
        }
        if (!res.ok) {
          const text = await res.text()
          let msg = text.slice(0, 300)
          try {
            msg = (JSON.parse(text) as { error?: string }).error ?? msg
          } catch {
            /* HTML error page - keep the raw snippet */
          }
          setError(msg)
          return
        }
        const json = await res.json()
        if (mode === 'preview') {
          setPreview(json as PreviewResponse)
          setStage('review')
        } else {
          setResult(json as CommitResponse)
          setStage('done')
          router.refresh()
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Request failed')
      } finally {
        setBusy(false)
      }
    },
    [file, month, rows, insertNew, applyUpdates, removeDbOnly, productLinking, preview, skipFields, router],
  )

  const revert = useCallback(async () => {
    if (!result) return
    setBusy(true)
    try {
      const res = await fetch('/api/deliveries/reconcile/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importId: result.importId }),
      })
      if (res.status === 401) {
        setSessionExpired(true)
        return
      }
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Could not revert')
        return
      }
      setError(null)
      setResult(null)
      setStage('pick')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }, [result, router])

  const netChange = useMemo(() => {
    if (!preview) return 0
    return (insertNew ? preview.stats.inserts : 0) - (removeDbOnly ? preview.stats.dbOnly : 0)
  }, [preview, insertNew, removeDbOnly])

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) reset()
      }}
    >
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="w-[94vw] max-w-[1800px] sm:max-w-[1800px] max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompareArrows className="h-5 w-5" />
            Reconcile a month against the master list
          </DialogTitle>
          <DialogDescription>
            Matches the spreadsheet against deliveries already in the system, then adds only what is new and updates
            only what changed. Rider and contractor assignments, delivery status and any cash already collected are
            never overwritten.
          </DialogDescription>
        </DialogHeader>

        {sessionExpired && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Your session expired, so nothing was changed. Sign in again and reopen this dialog.
            </AlertDescription>
          </Alert>
        )}
        {error && !sessionExpired && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="whitespace-pre-wrap">{error}</AlertDescription>
          </Alert>
        )}

        {stage === 'pick' && (
          <div className="flex flex-col gap-6 py-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="reconcile-file">Master spreadsheet</Label>
              <Input
                id="reconcile-file"
                ref={fileInput}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  setFile(f)
                  if (f) void parse(f)
                }}
              />
              {file && (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4" />
                  {file.name} — {rows.length.toLocaleString()} rows read
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2 max-w-xs">
              <Label htmlFor="reconcile-month">Target month</Label>
              <Input
                id="reconcile-month"
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                placeholder="2026-08"
              />
              <p className="text-xs text-muted-foreground">
                Only deliveries in this month are compared. Detected from the file.
              </p>
            </div>
          </div>
        )}

        {stage === 'review' && preview && (
          <div className="flex-1 min-h-0 flex flex-col gap-4">
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
              <SummaryCard label="To add" value={preview.stats.inserts} tone="add" icon={<Plus className="h-4 w-4" />} />
              <SummaryCard label="To update" value={preview.stats.updates} tone="change" icon={<ArrowRight className="h-4 w-4" />} />
              <SummaryCard label="Already correct" value={preview.stats.unchanged} tone="quiet" icon={<CheckCircle2 className="h-4 w-4" />} />
              <SummaryCard label="Product conflict" value={preview.stats.flagged} tone="warn" icon={<AlertTriangle className="h-4 w-4" />} />
              <SummaryCard label="Duplicate lines" value={preview.stats.duplicates} tone="quiet" icon={<Minus className="h-4 w-4" />} />
              <SummaryCard label="Only in system" value={preview.stats.dbOnly} tone="warn" icon={<AlertTriangle className="h-4 w-4" />} />
              <SummaryCard label="Unreadable" value={preview.stats.skipped} tone="warn" icon={<AlertTriangle className="h-4 w-4" />} />
            </div>

            {preview.stats.flagged > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p className="text-pretty">
                  {preview.stats.flagged.toLocaleString()}{' '}
                  {preview.stats.flagged === 1 ? 'row matches' : 'rows match'} an existing entry on customer
                  name, phone and date but name a <strong>different product</strong>. These are never written
                  automatically &mdash; open the Product conflicts tab and fix them by hand.
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border p-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={insertNew} onCheckedChange={(v) => setInsertNew(Boolean(v))} />
                Add the {preview.stats.inserts.toLocaleString()} new rows
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={applyUpdates} onCheckedChange={(v) => setApplyUpdates(Boolean(v))} />
                Apply the {preview.stats.updates.toLocaleString()} updates
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={removeDbOnly} onCheckedChange={(v) => setRemoveDbOnly(Boolean(v))} />
                Remove the {preview.stats.dbOnly.toLocaleString()} rows absent from the file
              </label>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Link products:</span>
                <Select value={productLinking} onValueChange={(v) => setProductLinking(v as typeof productLinking)}>
                  <SelectTrigger className="w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="exact+variant">Exact + variant suffix</SelectItem>
                    <SelectItem value="exact">Exact name only</SelectItem>
                    <SelectItem value="none">Do not link</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="ml-auto text-sm">
                <span className="text-muted-foreground">Net row change: </span>
                <span className="font-mono font-semibold">
                  {netChange >= 0 ? '+' : ''}
                  {netChange.toLocaleString()}
                </span>
              </div>
            </div>

            {removeDbOnly && preview.samples.dbOnly.some((d) => d.hasAssignment) && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {preview.samples.dbOnly.filter((d) => d.hasAssignment).length} of the rows you are about to remove
                  already have a rider or contractor assigned. They are archived first and can be restored, but check
                  the &quot;Only in system&quot; tab before continuing.
                </AlertDescription>
              </Alert>
            )}

            <Tabs defaultValue="updates" className="flex-1 min-h-0 flex flex-col">
              <TabsList className="flex-wrap h-auto">
                <TabsTrigger value="updates">Updates ({preview.stats.updates})</TabsTrigger>
                <TabsTrigger value="inserts">New rows ({preview.stats.inserts})</TabsTrigger>
                <TabsTrigger value="flagged">Product conflicts ({preview.stats.flagged})</TabsTrigger>
                <TabsTrigger value="dbonly">Only in system ({preview.stats.dbOnly})</TabsTrigger>
                <TabsTrigger value="dupes">Duplicates ({preview.stats.duplicates})</TabsTrigger>
                <TabsTrigger value="products">Products ({preview.unmatchedProducts.length})</TabsTrigger>
                <TabsTrigger value="quality">Data quality</TabsTrigger>
              </TabsList>

              <TabsContent value="updates" className="flex-1 min-h-0">
                <div className="flex flex-wrap gap-2 pb-3">
                  {Object.entries(preview.fieldCounts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([field, count]) => (
                      <button
                        key={field}
                        type="button"
                        onClick={() =>
                          setSkipFields((prev) => {
                            const next = new Set(prev)
                            if (next.has(field)) next.delete(field)
                            else next.add(field)
                            return next
                          })
                        }
                        className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                          skipFields.has(field)
                            ? 'border-dashed text-muted-foreground line-through'
                            : 'bg-secondary text-secondary-foreground'
                        }`}
                      >
                        {field} ({count.toLocaleString()})
                      </button>
                    ))}
                  <span className="text-xs text-muted-foreground self-center">click a field to leave it untouched</span>
                </div>
                <ScrollArea className="h-[38vh] rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Row</TableHead>
                        <TableHead className="w-28">Date</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead className="w-56">Matched on</TableHead>
                        <TableHead>Changes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.samples.updates.map((u) => (
                        <TableRow key={u.rowNumber}>
                          <TableCell className="font-mono text-xs">{u.rowNumber}</TableCell>
                          <TableCell className="font-mono text-xs">{u.date}</TableCell>
                          <TableCell className="max-w-[220px]">
                            <span className="block w-full truncate text-left">{u.customer}</span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-mono text-[10px]">
                              {u.tier}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              {u.diffs
                                .filter((d) => !skipFields.has(d.field))
                                .map((d) => (
                                  <div key={d.field} className="flex items-center gap-2 text-xs">
                                    <span className="text-muted-foreground w-24 shrink-0">{d.field}</span>
                                    <span className="line-through opacity-60 max-w-[220px] truncate">
                                      {String(d.from ?? '—')}
                                    </span>
                                    <ArrowRight className="h-3 w-3 shrink-0" />
                                    <span className="font-medium max-w-[220px] truncate">{String(d.to ?? '—')}</span>
                                  </div>
                                ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
                {preview.stats.updates > preview.samples.updates.length && (
                  <p className="pt-2 text-xs text-muted-foreground">
                    Showing the first {preview.samples.updates.length.toLocaleString()} of{' '}
                    {preview.stats.updates.toLocaleString()}. All of them are applied on commit.
                  </p>
                )}
              </TabsContent>

              <TabsContent value="inserts" className="flex-1 min-h-0">
                <ScrollArea className="h-[42vh] rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Row</TableHead>
                        <TableHead className="w-28">Date</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead className="w-32">Contact</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead className="w-24 text-right">Amount</TableHead>
                        <TableHead className="w-24">RTE</TableHead>
                        <TableHead>Flags</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.samples.inserts.map((r) => (
                        <TableRow key={r.rowNumber}>
                          <TableCell className="font-mono text-xs">{r.rowNumber}</TableCell>
                          <TableCell className="font-mono text-xs">{r.date}</TableCell>
                          <TableCell className="max-w-[220px]">
                            <span className="block w-full truncate text-left">{r.customer}</span>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{r.contact}</TableCell>
                          <TableCell className="max-w-[280px]">
                            <span className="block w-full truncate text-left">{r.product}</span>
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">{r.amount.toLocaleString()}</TableCell>
                          <TableCell className="font-mono text-xs">{r.rte}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {r.warnings.map((w) => (
                                <Badge key={w} variant="outline" className="text-[10px]">
                                  {w}
                                </Badge>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="flagged" className="flex-1 min-h-0">
                <p className="pb-3 text-sm text-muted-foreground">
                  Same customer name, same phone number, same date &mdash; but a different product. Either the product
                  was corrected, or these are two separate orders that only look alike. Nothing here is written on
                  commit.
                </p>
                {preview.samples.flagged.length === 0 ? (
                  <div className="flex h-[38vh] items-center justify-center rounded-md border">
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <CheckCircle2 className="h-4 w-4" />
                      No product conflicts. Every matched entry names the same product on both sides.
                    </p>
                  </div>
                ) : (
                  <ScrollArea className="h-[38vh] rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-16">Row</TableHead>
                          <TableHead className="w-28">Date</TableHead>
                          <TableHead>Customer</TableHead>
                          <TableHead className="w-32">Phone</TableHead>
                          <TableHead>In the file</TableHead>
                          <TableHead>In the system</TableHead>
                          <TableHead className="w-40">Other changes</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.samples.flagged.map((f) => (
                          <TableRow key={`${f.rowNumber}-${f.dbId}`}>
                            <TableCell className="font-mono text-xs text-muted-foreground">{f.rowNumber}</TableCell>
                            <TableCell className="font-mono text-xs">{f.date}</TableCell>
                            <TableCell className="text-sm">{f.customer}</TableCell>
                            <TableCell className="font-mono text-xs">{f.contact}</TableCell>
                            <TableCell className="text-sm">
                              {f.fileProduct}
                              <span className="ml-1 text-xs text-muted-foreground">
                                @ {f.fileAmount.toLocaleString()}
                              </span>
                            </TableCell>
                            <TableCell className="text-sm">
                              {f.dbProduct}
                              <span className="ml-1 text-xs text-muted-foreground">
                                @ {(f.dbAmount ?? 0).toLocaleString()}
                              </span>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {f.otherDiffs.length === 0
                                ? '—'
                                : f.otherDiffs.map((d) => d.field).join(', ')}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                )}
                {preview.stats.flagged > preview.samples.flagged.length && (
                  <p className="pt-2 text-xs text-muted-foreground">
                    Showing the first {preview.samples.flagged.length.toLocaleString()} of{' '}
                    {preview.stats.flagged.toLocaleString()}.
                  </p>
                )}
              </TabsContent>

              <TabsContent value="dbonly" className="flex-1 min-h-0">
                <p className="pb-3 text-sm text-muted-foreground">
                  These deliveries exist in the system but have no match in the spreadsheet. They are kept by default —
                  most carry an assignment, so removing them would lose real work.
                </p>
                <ScrollArea className="h-[38vh] rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-28">Date</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead className="w-32">Contact</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead className="w-24 text-right">Amount</TableHead>
                        <TableHead className="w-28">Status</TableHead>
                        <TableHead className="w-28">Assigned</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.samples.dbOnly.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="font-mono text-xs">{d.delivery_date}</TableCell>
                          <TableCell className="max-w-[220px]">
                            <span className="block w-full truncate text-left">{d.customer_name}</span>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{d.contact_1}</TableCell>
                          <TableCell className="max-w-[280px]">
                            <span className="block w-full truncate text-left">{d.products}</span>
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            {d.amount?.toLocaleString() ?? '—'}
                          </TableCell>
                          <TableCell className="text-xs">{d.status}</TableCell>
                          <TableCell>
                            {d.hasAssignment ? (
                              <Badge variant="secondary" className="text-[10px]">
                                assigned
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="dupes" className="flex-1 min-h-0">
                <p className="pb-3 text-sm text-muted-foreground">
                  Lines repeated inside the spreadsheet itself — every column identical. Only the first is used.
                </p>
                <ScrollArea className="h-[38vh] rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Row</TableHead>
                        <TableHead className="w-28">Same as row</TableHead>
                        <TableHead className="w-28">Date</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead className="w-24 text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.samples.duplicates.map((d) => (
                        <TableRow key={d.rowNumber}>
                          <TableCell className="font-mono text-xs">{d.rowNumber}</TableCell>
                          <TableCell className="font-mono text-xs">{d.duplicateOf}</TableCell>
                          <TableCell className="font-mono text-xs">{d.date}</TableCell>
                          <TableCell className="max-w-[220px]">
                            <span className="block w-full truncate text-left">{d.customer}</span>
                          </TableCell>
                          <TableCell className="max-w-[280px]">
                            <span className="block w-full truncate text-left">{d.product}</span>
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">{d.amount.toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="products" className="flex-1 min-h-0">
                <p className="pb-3 text-sm text-muted-foreground">
                  {preview.stats.productsUnmatched.toLocaleString()} rows name a product that is not in the catalogue,
                  across {preview.unmatchedProducts.length} distinct names. Those rows still import — they simply stay
                  unlinked from stock until the product exists.
                </p>
                <ScrollArea className="h-[38vh] rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product name in file</TableHead>
                        <TableHead className="w-24 text-right">Rows</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.unmatchedProducts.map((p) => (
                        <TableRow key={p.name}>
                          <TableCell>{p.name}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{p.rows}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </TabsContent>

              <TabsContent value="quality" className="flex-1 min-h-0">
                <ScrollArea className="h-[42vh] rounded-md border p-4">
                  <div className="flex flex-col gap-4">
                    <div>
                      <h4 className="text-sm font-semibold pb-2">Row flags</h4>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(preview.warningCounts)
                          .sort((a, b) => b[1] - a[1])
                          .map(([w, n]) => (
                            <Badge key={w} variant="outline">
                              {w}: {n.toLocaleString()}
                            </Badge>
                          ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold pb-2">How rows were matched</h4>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(preview.stats.matchedByTier).map(([tier, n]) => (
                          <Badge key={tier} variant="secondary" className="font-mono text-[10px]">
                            {tier}: {n.toLocaleString()}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    {preview.samples.skipped.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold pb-2">Rows that cannot be imported</h4>
                        <div className="flex flex-col gap-1">
                          {preview.samples.skipped.map((s) => (
                            <p key={s.rowNumber} className="text-xs text-muted-foreground">
                              Row {s.rowNumber}: {s.reason}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <h4 className="text-sm font-semibold pb-2">Totals</h4>
                      <p className="text-xs text-muted-foreground">
                        File rows {preview.stats.fileRows.toLocaleString()} · existing rows in{' '}
                        {preview.month} {preview.stats.dbRows.toLocaleString()} · file value{' '}
                        {preview.stats.fileAmountTotal.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </div>
        )}

        {stage === 'done' && result && (
          <div className="flex flex-col gap-4 py-4">
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                Reconciled {preview?.month}. Added {result.inserted.toLocaleString()}, updated{' '}
                {result.updated.toLocaleString()}, left {result.unchanged.toLocaleString()} untouched
                {result.removed ? `, removed ${result.removed.toLocaleString()}` : ''}. {result.archived.toLocaleString()}{' '}
                snapshots were stored, so this batch can be undone.
              </AlertDescription>
            </Alert>
            {result.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <div className="flex flex-col gap-1">
                    {result.errors.map((e, i) => (
                      <span key={i} className="text-xs">
                        {e}
                      </span>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter className="flex-row justify-end gap-2">
          {stage === 'pick' && (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={!rows.length || !month || busy} onClick={() => void call('preview')}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompareArrows className="h-4 w-4" />}
                Compare against the system
              </Button>
            </>
          )}
          {stage === 'review' && (
            <>
              <Button variant="ghost" onClick={reset} disabled={busy}>
                <RotateCcw className="h-4 w-4" />
                Start over
              </Button>
              <Button
                disabled={busy || (!insertNew && !applyUpdates && !removeDbOnly)}
                onClick={() => void call('commit')}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Apply to {preview?.month}
              </Button>
            </>
          )}
          {stage === 'done' && (
            <>
              <Button variant="outline" onClick={() => void revert()} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                Undo this batch
              </Button>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SummaryCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string
  value: number
  tone: 'add' | 'change' | 'warn' | 'quiet'
  icon: React.ReactNode
}) {
  const toneClass =
    tone === 'add'
      ? 'border-primary/40 text-primary'
      : tone === 'change'
        ? 'border-foreground/30'
        : tone === 'warn'
          ? 'border-destructive/40 text-destructive'
          : 'border-border text-muted-foreground'
  return (
    <div className={`flex flex-col gap-1 rounded-lg border p-3 ${toneClass}`}>
      <div className="flex items-center gap-2 text-xs">
        {icon}
        {label}
      </div>
      <span className="font-mono text-2xl font-semibold tabular-nums text-foreground">{value.toLocaleString()}</span>
    </div>
  )
}
