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
import { ReconcileMapping } from '@/components/deliveries/reconcile-mapping'
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  FileSpreadsheet,
  GitCompareArrows,
  Link2,
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
  status: 'status',
  payment: 'payment_method',
  // The "Rider" column is not consistent across COMPILE files: some months hold
  // route labels (WEST, TRIOLET), others hold people (DIVESH, MOON). It is kept
  // raw here and classified server-side against the real rider names, because
  // the header alone cannot tell the two apart.
  rider: 'rider_raw',
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

interface DateBucket {
  date: string
  fileRows: number
  inserts: number
  updates: number
  unchanged: number
  flagged: number
  duplicates: number
  dbOnly: number
  dbRows: number
  fileAmountTotal: number
  outOfMonth: boolean
}

interface PreviewResponse {
  month: string
  /** Every delivery date present in the spreadsheet. */
  fileDates: string[]
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
    outOfScope: number
    productsUnmatched: number
    productLinks: number
    statusChanges: number
    contractorLinks: number
    blocked: number
    statusUnmapped: string[]
    ridersUnmapped: string[]
    /** Rider-column values that were not known riders, so became route labels. */
    riderValuesTreatedAsZone: string[]
    matchedByTier: Record<string, number>
    fileAmountTotal: number
    byDate: DateBucket[]
  }
  blockedByReason: Record<string, number>
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
    blocked: {
      rowNumber: number
      dbId: string
      date: string
      field: string
      from: unknown
      to: unknown
      reason: string
    }[]
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

/**
 * A delivery date is a calendar day, not an instant, so it must be read in
 * LOCAL time. `cellDates` hands us local midnight; `toISOString()` converts to
 * UTC and therefore rolls the day backwards everywhere east of Greenwich. In
 * Mauritius (UTC+4) that turned every row in COMPILE AUGUST into the previous
 * day and pushed the 1 August rows into July.
 */
function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function toIsoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) return isNaN(v.getTime()) ? null : localYmd(v)
  const s = String(v).trim()
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return m[0]
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : localYmd(d)
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
  // Exact-only by default: a variant match would happily point
  // "AirFryer - B1G1" at plain "AirFryer".
  const [productLinking, setProductLinking] = useState<'exact' | 'exact+variant' | 'none'>('exact')
  // 'forward' never rewinds a delivered row; 'fill' never steals an assignment.
  const [statusPolicy, setStatusPolicy] = useState<'forward' | 'overwrite' | 'pending_only' | 'off'>('forward')
  const [contractorPolicy, setContractorPolicy] = useState<'fill' | 'overwrite' | 'report' | 'off'>('fill')
  const [skipFields, setSkipFields] = useState<Set<string>>(new Set())
  /**
   * Delivery dates to apply. Null means "every date in the file"; a Set means
   * the operator is reconciling day by day. Days left out are untouched.
   */
  const [selectedDates, setSelectedDates] = useState<Set<string> | null>(null)
  /** Hide dates the file does not mention (they exist only in the system). */
  const [datesFileOnly, setDatesFileOnly] = useState(true)
  /** Controlled so the unmapped-value notices can jump to the Mapping tab. */
  const [tab, setTab] = useState('dates')

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
    setSelectedDates(null)
    setDatesFileOnly(true)
    setTab('dates')
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
            .join(', ')}). Those delivery dates are still compared properly and appear in the date list, ` +
            `marked as outside the month, so you can include or exclude them.`,
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
              statusPolicy,
              contractorPolicy,
              fields: preview ? Object.keys(preview.fieldCounts).filter((f) => !skipFields.has(f)) : undefined,
              // A PREVIEW always covers every date, so the per-date table can
              // show what each day would do. Only the COMMIT is narrowed.
              dates: mode === 'commit' && selectedDates ? [...selectedDates].sort() : undefined,
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
    [
      file,
      month,
      rows,
      insertNew,
      applyUpdates,
      removeDbOnly,
      productLinking,
      statusPolicy,
      contractorPolicy,
      preview,
      skipFields,
      selectedDates,
      router,
    ],
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

  /** Dates the file actually contains, in order. */
  const fileDateBuckets = useMemo(
    () => (preview ? preview.stats.byDate.filter((b) => b.fileRows > 0) : []),
    [preview],
  )
  const isDateOn = useCallback(
    (date: string) => selectedDates === null || selectedDates.has(date),
    [selectedDates],
  )

  /**
   * What the commit will actually do, for the selected days only. Summed from
   * the per-date breakdown so the button never promises more than it applies.
   */
  const scoped = useMemo(() => {
    const zero = { dates: 0, inserts: 0, updates: 0, unchanged: 0, flagged: 0, duplicates: 0, dbOnly: 0 }
    if (!preview) return zero
    return preview.stats.byDate.reduce((acc, b) => {
      if (!isDateOn(b.date)) return acc
      if (b.fileRows > 0) acc.dates++
      acc.inserts += b.inserts
      acc.updates += b.updates
      acc.unchanged += b.unchanged
      acc.flagged += b.flagged
      acc.duplicates += b.duplicates
      acc.dbOnly += b.dbOnly
      return acc
    }, zero)
  }, [preview, isDateOn])

  /** Distinct spreadsheet values still awaiting a mapping decision. */
  const unmappedTotal = preview
    ? preview.stats.statusUnmapped.length +
      preview.stats.riderValuesTreatedAsZone.length +
      preview.unmatchedProducts.length
    : 0

  const partialRun = preview !== null && scoped.dates < fileDateBuckets.length
  const nothingSelected = preview !== null && scoped.dates === 0

  const toggleDate = useCallback(
    (date: string) => {
      setSelectedDates((cur) => {
        const all = fileDateBuckets.map((b) => b.date)
        const next = new Set(cur ?? all)
        if (next.has(date)) next.delete(date)
        else next.add(date)
        return next
      })
    },
    [fileDateBuckets],
  )

  const netChange = useMemo(
    () => (insertNew ? scoped.inserts : 0) - (removeDbOnly ? scoped.dbOnly : 0),
    [scoped, insertNew, removeDbOnly],
  )

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
              <p className="text-xs text-muted-foreground text-pretty">
                Detected from the delivery dates in the file. Used for labelling and to spot days the file left
                out &mdash; you choose the exact dates to apply on the next screen.
              </p>
            </div>
          </div>
        )}

        {stage === 'review' && preview && (
          <div className="flex-1 min-h-0 flex flex-col gap-4">
            {/* Totals follow the selected days, so what is shown is what is applied. */}
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
              <SummaryCard label="To add" value={scoped.inserts} tone="add" icon={<Plus className="h-4 w-4" />} />
              <SummaryCard label="To update" value={scoped.updates} tone="change" icon={<ArrowRight className="h-4 w-4" />} />
              <SummaryCard label="Already correct" value={scoped.unchanged} tone="quiet" icon={<CheckCircle2 className="h-4 w-4" />} />
              <SummaryCard label="Product conflict" value={scoped.flagged} tone="warn" icon={<AlertTriangle className="h-4 w-4" />} />
              <SummaryCard label="Duplicate lines" value={scoped.duplicates} tone="quiet" icon={<Minus className="h-4 w-4" />} />
              <SummaryCard label="Only in system" value={scoped.dbOnly} tone="warn" icon={<AlertTriangle className="h-4 w-4" />} />
              <SummaryCard label="Unreadable" value={preview.stats.skipped} tone="warn" icon={<AlertTriangle className="h-4 w-4" />} />
            </div>

            {partialRun && (
              <div className="flex items-start gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-sm">
                <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
                <p className="text-pretty">
                  Reconciling <strong>{scoped.dates}</strong> of {fileDateBuckets.length} delivery dates. The
                  figures above cover only the selected days &mdash; every other day in the month is left exactly
                  as it is, including its rows that the file does not mention.
                </p>
              </div>
            )}

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
                Add the {scoped.inserts.toLocaleString()} new rows
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={applyUpdates} onCheckedChange={(v) => setApplyUpdates(Boolean(v))} />
                Apply the {scoped.updates.toLocaleString()} updates
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={removeDbOnly} onCheckedChange={(v) => setRemoveDbOnly(Boolean(v))} />
                Remove the {scoped.dbOnly.toLocaleString()} rows absent from the file
                {partialRun && <span className="text-muted-foreground">(selected days only)</span>}
              </label>
              <div className="ml-auto text-sm">
                <span className="text-muted-foreground">Net row change: </span>
                <span className="font-mono font-semibold">
                  {netChange >= 0 ? '+' : ''}
                  {netChange.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Linking rules. Every default here is the non-destructive one. */}
            <div className="rounded-lg border p-4">
              <div className="mb-3 flex items-center gap-2">
                <Link2 className="h-4 w-4 text-muted-foreground" />
                <h4 className="text-sm font-semibold">Linking rules</h4>
                <span className="text-xs text-muted-foreground">
                  how the file&apos;s status, rider and product columns reach the system
                </span>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Status</span>
                  <Select value={statusPolicy} onValueChange={(v) => setStatusPolicy(v as typeof statusPolicy)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="forward">Only move forward</SelectItem>
                      <SelectItem value="pending_only">Only fill pending rows</SelectItem>
                      <SelectItem value="overwrite">Always take the file</SelectItem>
                      <SelectItem value="off">Do not change status</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {statusPolicy === 'forward'
                      ? 'A delivered row is never reset to pending.'
                      : statusPolicy === 'pending_only'
                        ? 'Touches nothing that already shows progress.'
                        : statusPolicy === 'overwrite'
                          ? 'The sheet wins, even moving a row backwards.'
                          : 'Status is left exactly as it is.'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {preview.stats.statusChanges.toLocaleString()} row(s) would change.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Rider &amp; contractor</span>
                  <Select
                    value={contractorPolicy}
                    onValueChange={(v) => setContractorPolicy(v as typeof contractorPolicy)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fill">Fill only when empty</SelectItem>
                      <SelectItem value="overwrite">Always take the file</SelectItem>
                      <SelectItem value="report">Report differences only</SelectItem>
                      <SelectItem value="off">Do not link</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {contractorPolicy === 'fill'
                      ? 'Existing assignments are kept and reported.'
                      : contractorPolicy === 'overwrite'
                        ? 'Replaces assignments already made in the app.'
                        : contractorPolicy === 'report'
                          ? 'Nothing is written; differences are listed.'
                          : 'The rider column is ignored.'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {preview.stats.contractorLinks.toLocaleString()} row(s) would link.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">Products</span>
                  <Select value={productLinking} onValueChange={(v) => setProductLinking(v as typeof productLinking)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="exact">Exact name only</SelectItem>
                      <SelectItem value="exact+variant">Exact + variant suffix</SelectItem>
                      <SelectItem value="none">Do not link</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {productLinking === 'exact'
                      ? 'Variant suffixes stay unlinked for review.'
                      : productLinking === 'exact+variant'
                        ? 'A "- B1G1" name can link to the base product.'
                        : 'No product ids are written.'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {preview.stats.productLinks.toLocaleString()} row(s) would link.
                  </p>
                </div>
              </div>

              {(preview.stats.statusUnmapped.length > 0 || preview.stats.riderValuesTreatedAsZone.length > 0) && (
                <div className="mt-3 flex flex-col gap-1.5 border-t pt-3 text-xs">
                  {preview.stats.statusUnmapped.length > 0 && (
                    <p className="text-pretty">
                      <span className="text-amber-600">Unrecognised status:</span>{' '}
                      <span className="font-mono">{preview.stats.statusUnmapped.join(', ')}</span> &mdash; left
                      unchanged.{' '}
                      <button
                        type="button"
                        onClick={() => setTab('mapping')}
                        className="underline underline-offset-2 hover:text-foreground"
                      >
                        Map them
                      </button>{' '}
                      to apply them.
                    </p>
                  )}
                  {/*
                    Tone depends on whether the column is MIXED. If nothing matched a
                    rider the column is simply this month's route column (COMPILE
                    AUGUST is all zones), which is normal and not a warning. If some
                    values did match, the leftovers are worth a second look because a
                    misspelled name loses its assignment.
                  */}
                  {preview.stats.riderValuesTreatedAsZone.length > 0 && (
                    <p className="text-pretty">
                      {preview.stats.contractorLinks === 0 ? (
                        <>
                          <span className="text-muted-foreground">Rider column holds routes, not people</span>{' '}
                          <span className="font-mono">
                            ({preview.stats.riderValuesTreatedAsZone.slice(0, 6).join(', ')}
                            {preview.stats.riderValuesTreatedAsZone.length > 6 &&
                              ` +${preview.stats.riderValuesTreatedAsZone.length - 6}`}
                            )
                          </span>{' '}
                          &mdash; kept as the delivery zone. No contractor assignments were touched.{' '}
                          <button
                            type="button"
                            onClick={() => setTab('mapping')}
                            className="underline underline-offset-2 hover:text-foreground"
                          >
                            Map any that are people
                          </button>
                          .
                        </>
                      ) : (
                        <>
                          <span className="text-amber-600">Some rider values matched no one:</span>{' '}
                          <span className="font-mono">
                            {preview.stats.riderValuesTreatedAsZone.slice(0, 25).join(', ')}
                          </span>
                          {preview.stats.riderValuesTreatedAsZone.length > 25 &&
                            ` +${preview.stats.riderValuesTreatedAsZone.length - 25} more`}{' '}
                          &mdash; kept as zones, so no contractor was linked. If one of these is a person,{' '}
                          <button
                            type="button"
                            onClick={() => setTab('mapping')}
                            className="underline underline-offset-2 hover:text-foreground"
                          >
                            map it to a rider
                          </button>
                          .
                        </>
                      )}
                    </p>
                  )}
                </div>
              )}

              {preview.stats.blocked > 0 && (
                <p className="mt-3 border-t pt-3 text-xs text-muted-foreground text-pretty">
                  <strong className="text-foreground">{preview.stats.blocked.toLocaleString()}</strong> change(s)
                  withheld to protect existing work &mdash; see the Protected tab.
                </p>
              )}
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

            <Tabs value={tab} onValueChange={setTab} className="flex-1 min-h-0 flex flex-col">
              <TabsList className="flex-wrap h-auto">
                <TabsTrigger value="dates">
                  Delivery dates ({scoped.dates}/{fileDateBuckets.length})
                </TabsTrigger>
                <TabsTrigger value="updates">Updates ({scoped.updates})</TabsTrigger>
                <TabsTrigger value="inserts">New rows ({scoped.inserts})</TabsTrigger>
                <TabsTrigger value="flagged">Product conflicts ({scoped.flagged})</TabsTrigger>
                <TabsTrigger value="dbonly">Only in system ({scoped.dbOnly})</TabsTrigger>
                <TabsTrigger value="dupes">Duplicates ({scoped.duplicates})</TabsTrigger>
                <TabsTrigger value="products">Products ({preview.unmatchedProducts.length})</TabsTrigger>
                {preview.stats.blocked > 0 && (
                  <TabsTrigger value="protected">Protected ({preview.stats.blocked})</TabsTrigger>
                )}
                <TabsTrigger value="mapping">
                  Mapping{unmappedTotal > 0 ? ` (${unmappedTotal})` : ''}
                </TabsTrigger>
                <TabsTrigger value="quality">Data quality</TabsTrigger>
              </TabsList>

              <TabsContent value="dates" className="flex-1 min-h-0">
                <div className="flex flex-wrap items-center gap-2 pb-3">
                  <p className="text-xs text-muted-foreground text-pretty flex-1 min-w-[280px]">
                    Grouped by the <strong>delivery date in the spreadsheet</strong>, not the entry date &mdash; in
                    this file every order was entered weeks before it shipped. Tick the days to reconcile; unticked
                    days are not touched at all.
                  </p>
                  <label className="flex items-center gap-2 text-xs whitespace-nowrap">
                    <Checkbox
                      checked={datesFileOnly}
                      onCheckedChange={(v) => setDatesFileOnly(Boolean(v))}
                    />
                    Only days in this file
                  </label>
                  <Button type="button" variant="outline" size="sm" onClick={() => setSelectedDates(null)}>
                    Select all
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedDates(new Set())}
                  >
                    Clear
                  </Button>
                </div>
                <ScrollArea className="h-[38vh] rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">Do</TableHead>
                        <TableHead className="w-36">Delivery date</TableHead>
                        <TableHead className="w-24 text-right">In file</TableHead>
                        <TableHead className="w-24 text-right">In system</TableHead>
                        <TableHead className="w-20 text-right">Add</TableHead>
                        <TableHead className="w-20 text-right">Update</TableHead>
                        <TableHead className="w-24 text-right">Correct</TableHead>
                        <TableHead className="w-24 text-right">Conflict</TableHead>
                        <TableHead className="w-24 text-right">Dupes</TableHead>
                        <TableHead className="w-28 text-right">Only in system</TableHead>
                        <TableHead className="text-right">File total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.stats.byDate
                        .filter((b) => !datesFileOnly || b.fileRows > 0)
                        .map((b) => {
                        const inFile = b.fileRows > 0
                        const on = inFile && isDateOn(b.date)
                        return (
                          <TableRow key={b.date} className={on ? undefined : 'opacity-55'}>
                            <TableCell>
                              <Checkbox
                                checked={on}
                                disabled={!inFile}
                                onCheckedChange={() => toggleDate(b.date)}
                                aria-label={`Reconcile ${b.date}`}
                              />
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              <div className="flex flex-col gap-1">
                                <span>{b.date}</span>
                                {!inFile && (
                                  <span className="font-sans text-[10px] text-muted-foreground">
                                    not in this file
                                  </span>
                                )}
                                {b.outOfMonth && (
                                  <Badge variant="outline" className="w-fit font-sans text-[10px]">
                                    outside {preview.month}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              {b.fileRows ? b.fileRows.toLocaleString() : '—'}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              {b.dbRows ? b.dbRows.toLocaleString() : '—'}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">{b.inserts || '—'}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{b.updates || '—'}</TableCell>
                            <TableCell className="text-right font-mono text-xs text-muted-foreground">
                              {b.unchanged || '—'}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              {b.flagged ? (
                                <span className="text-amber-600 font-semibold">{b.flagged}</span>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs text-muted-foreground">
                              {b.duplicates || '—'}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              {b.dbOnly ? <span className="text-amber-600">{b.dbOnly}</span> : '—'}
                            </TableCell>
                            <TableCell className="text-right font-mono text-xs">
                              {b.fileAmountTotal
                                ? b.fileAmountTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })
                                : '—'}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
                {datesFileOnly && preview.stats.byDate.some((b) => b.fileRows === 0) && (
                  <p className="pt-2 text-xs text-muted-foreground">
                    {preview.stats.byDate.filter((b) => b.fileRows === 0).length} day(s) exist in the system for
                    this month but are not in the file &mdash; hidden. Untick &ldquo;Only days in this file&rdquo;
                    to see them.
                  </p>
                )}
              </TabsContent>

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

              <TabsContent value="protected" className="flex-1 min-h-0">
                <p className="pb-3 text-sm text-muted-foreground text-pretty">
                  The file asks to change these, but the current rules keep the system&apos;s value because it
                  represents work already done. Nothing here is written. Widen a linking rule above to apply them, or
                  fix the rows by hand.
                </p>
                {Object.keys(preview.blockedByReason).length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {Object.entries(preview.blockedByReason)
                      .sort((a, b) => b[1] - a[1])
                      .map(([reason, n]) => (
                        <Badge key={reason} variant="secondary" className="font-normal">
                          {reason} &mdash; {n.toLocaleString()}
                        </Badge>
                      ))}
                  </div>
                )}
                <ScrollArea className="h-[38vh] rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Row</TableHead>
                        <TableHead className="w-28">Date</TableHead>
                        <TableHead className="w-32">Field</TableHead>
                        <TableHead className="w-32">Kept</TableHead>
                        <TableHead className="w-32">File wanted</TableHead>
                        <TableHead>Why</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.samples.blocked.map((b, i) => (
                        <TableRow key={`${b.dbId}-${b.field}-${i}`}>
                          <TableCell className="font-mono text-xs">{b.rowNumber}</TableCell>
                          <TableCell className="font-mono text-xs">{b.date}</TableCell>
                          <TableCell className="font-mono text-xs">{b.field}</TableCell>
                          <TableCell className="font-mono text-xs">{String(b.from ?? '—').slice(0, 14)}</TableCell>
                          <TableCell className="font-mono text-xs">{String(b.to ?? '—').slice(0, 14)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{b.reason}</TableCell>
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
                  unlinked from stock until the product exists.{' '}
                  <button
                    type="button"
                    onClick={() => setTab('mapping')}
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    Map them to catalogue products
                  </button>{' '}
                  to link them now.
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

              <TabsContent value="mapping" className="flex-1 min-h-0">
                <ReconcileMapping
                  statusValues={preview.stats.statusUnmapped}
                  riderValues={preview.stats.riderValuesTreatedAsZone}
                  productValues={preview.unmatchedProducts}
                  disabled={busy}
                  // Saved mappings only change the outcome once the file is
                  // compared again, so re-run the preview rather than leaving
                  // stale counts on screen.
                  onSaved={() => call('preview')}
                />
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
                      <p className="pb-2 text-xs text-muted-foreground text-pretty">
                        Every match is made within a single delivery date &mdash; nothing is ever paired across two
                        dates. <span className="font-mono">name+number+date</span> is the strongest;{' '}
                        <span className="font-mono">name+date</span> means the stored phone number could not be
                        used (a typo, a country code, or text pasted into the number column).
                      </p>
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
                disabled={busy || nothingSelected || (!insertNew && !applyUpdates && !removeDbOnly)}
                onClick={() => void call('commit')}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {nothingSelected
                  ? 'Pick at least one delivery date'
                  : partialRun
                    ? `Apply ${scoped.dates} ${scoped.dates === 1 ? 'date' : 'dates'}`
                    : `Apply to ${preview?.month}`}
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
