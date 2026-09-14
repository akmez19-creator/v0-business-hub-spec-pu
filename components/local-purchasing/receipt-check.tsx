'use client'

import { CheckCircle2, FileSearch, AlertTriangle } from 'lucide-react'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { moneyText } from '@/lib/local-purchasing/evidence'
import type { CheckIssue, ReceiptCheck } from '@/lib/local-purchasing/reconcile'

export function ReceiptCheckSummary({ check }: { check: ReceiptCheck }) {
  const verified = check.status === 'verified'
  const Icon = verified ? CheckCircle2 : check.status === 'not_checkable' ? FileSearch : AlertTriangle
  return (
    <section aria-label="Automatic document checks" className="flex min-w-0 flex-col gap-3">
      <Alert role="status">
        <Icon />
        <AlertTitle>{verified ? 'Receipt arithmetic reconciles' : check.status === 'not_checkable' ? 'Calculated, not document-verified' : 'Document needs review'}</AlertTitle>
        <AlertDescription>
          <p>{check.resolved?.explanation ?? 'No safe price treatment was found. Check the printed figures below; no VAT or discount assumption will be saved silently.'}</p>
          <p>Product matching and supplier identity are checked separately. Reading a file is not proof that its figures are correct.</p>
        </AlertDescription>
      </Alert>
      {check.totals && (
        <dl className="flex flex-wrap gap-x-10 gap-y-4">
          {[['Total payable', check.totals.payable], ['Accounting net', check.totals.net], ['VAT', check.totals.vat]].map(([label, value]) => (
            <div key={String(label)} className="flex flex-col gap-1">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="font-mono text-lg font-semibold tabular-nums">{moneyText(Number(value))}</dd>
            </div>
          ))}
        </dl>
      )}
      {check.checkpoints.length > 0 && (
        <Table>
          <TableHeader><TableRow><TableHead>Printed checkpoint</TableHead><TableHead className="text-right">Printed</TableHead><TableHead className="text-right">Calculated</TableHead><TableHead className="text-right">Difference</TableHead></TableRow></TableHeader>
          <TableBody>{check.checkpoints.map((point) => <TableRow key={point.label}>
            <TableCell>{point.label}</TableCell><TableCell className="text-right font-mono">{moneyText(point.printed)}</TableCell>
            <TableCell className="text-right font-mono">{moneyText(point.calculated)}</TableCell>
            <TableCell className="text-right"><Badge variant={point.matches ? 'outline' : 'destructive'}>{point.matches ? 'Matches' : moneyText(point.difference)}</Badge></TableCell>
          </TableRow>)}</TableBody>
        </Table>
      )}
      {Object.values(check.roundingAllocation).some((n) => n !== 0) && (
        <p className="text-sm leading-relaxed text-muted-foreground">Document-level rounding allocates {moneyText(check.roundingAllocation.net)} to net and {moneyText(check.roundingAllocation.vat)} to VAT compared with summing individually rounded rows. Product unit costs are unchanged. Payable adjustment: {moneyText(check.roundingAllocation.payable)}.</p>
      )}
      {check.issues.length > 0 && <details open={check.issues.length <= 8} className="rounded-lg border border-border bg-card text-card-foreground">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">{check.issues.length} check{check.issues.length === 1 ? '' : 's'} to review</summary>
        <div className="px-4 pb-4"><ReceiptIssues issues={check.issues} /></div>
      </details>}
    </section>
  )
}

export function ReceiptIssues({ issues }: { issues: CheckIssue[] }) {
  return <ul className="flex flex-col gap-3 text-sm leading-relaxed">
    {issues.map((issue, index) => <li key={`${issue.code}-${issue.lineKey}-${index}`} className="flex flex-wrap items-start justify-between gap-2">
      <span className="min-w-0 flex-1">{issue.message}{issue.printed != null && <> Printed {moneyText(issue.printed)}; calculated {moneyText(issue.calculated ?? 0)}; difference {moneyText(issue.difference ?? 0)}.</>}</span>
      {issue.lineKey && <Button size="sm" variant="outline" type="button" onClick={() => {
        const row = document.getElementById(`receipt-line-${issue.lineKey}`)
        row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        row?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
      }}>Go to row</Button>}
    </li>)}
  </ul>
}
