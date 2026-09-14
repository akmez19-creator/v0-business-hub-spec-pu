'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { purchaseMoney, type ImportPurchaseEvent, type ReorderSnapshot } from '@/lib/purchase-orders/workflow'
import { calculateReorder } from '@/lib/purchase-orders/reorder-calculations'

export function ReorderComparison({ requested, response }: { requested: ReorderSnapshot; response: ReorderSnapshot }) {
  const a = calculateReorder(requested),
    b = calculateReorder(response)
  const show = (value: number | null | string) => (value == null ? 'Not quoted' : String(value))
  return (
    <Card>
      <CardHeader>
        <CardTitle>Buyer request → supplier response</CardTitle>
        <CardDescription>
          The approved request is preserved. Check every supplier change before accepting.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product / term</TableHead>
                <TableHead>Buyer requested</TableHead>
                <TableHead>Supplier returned</TableHead>
                <TableHead>Change</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requested.lines.flatMap((line) => {
                const answer = response.lines.find((item) => item.id === line.id)
                if (!answer)
                  return [
                    <TableRow key={line.id}>
                      <TableCell>{line.productName}</TableCell>
                      <TableCell>{line.qty}</TableCell>
                      <TableCell>Missing response</TableCell>
                      <TableCell>
                        <Badge variant="outline">Review</Badge>
                      </TableCell>
                    </TableRow>,
                  ]
                const rows: [string, string, string][] = [
                  ['Quantity', show(line.qty), answer.unavailable ? 'Unavailable' : show(answer.qty)],
                  ['Unit price · CNY', purchaseMoney(line.priceCny, 'CNY'), purchaseMoney(answer.priceCny, 'CNY')],
                  [
                    'Price basis',
                    line.priceMode === 'net' ? 'Net' : `${line.discountPercent}% off list`,
                    answer.priceMode === 'net' ? 'Net' : `${answer.discountPercent}% off list`,
                  ],
                  [
                    'China freight',
                    `${purchaseMoney(line.chinaFreight, 'CNY')} · ${line.chinaFreightBasis}`,
                    `${purchaseMoney(answer.chinaFreight, 'CNY')} · ${answer.chinaFreightBasis}`,
                  ],
                  ['Units / carton', show(line.unitsPerCarton), show(answer.unitsPerCarton)],
                  ['Kg / unit', show(line.kgPerUnit), show(answer.kgPerUnit)],
                  ['CBM / unit', show(line.cbmPerUnit), show(answer.cbmPerUnit)],
                ]
                return rows.map(([label, before, after], index) => (
                  <TableRow key={`${line.id}-${label}`}>
                    <TableCell className="whitespace-normal">
                      <p className="font-medium">
                        {index === 0 ? `${line.productName}${line.variantLabel ? ` · ${line.variantLabel}` : ''}` : ''}
                      </p>
                      <span className="text-sm text-muted-foreground">{label}</span>
                    </TableCell>
                    <TableCell>{before}</TableCell>
                    <TableCell>{after}</TableCell>
                    <TableCell>{before !== after && <Badge variant="outline">Changed</Badge>}</TableCell>
                  </TableRow>
                ))
              })}
              {(
                [
                  ['MUR per CNY', show(requested.terms.fxRate), show(response.terms.fxRate)],
                  [
                    'Shared China freight',
                    purchaseMoney(requested.terms.sharedChinaFreight, 'CNY'),
                    purchaseMoney(response.terms.sharedChinaFreight, 'CNY'),
                  ],
                  ['Import freight', purchaseMoney(a.freight), purchaseMoney(b.freight)],
                  [
                    'Other import charges',
                    purchaseMoney(requested.terms.otherChargesMur),
                    purchaseMoney(response.terms.otherChargesMur),
                  ],
                  ['Allocation basis', requested.terms.allocationBasis, response.terms.allocationBasis],
                  ['Supplier total · CNY', purchaseMoney(a.supplierCny, 'CNY'), purchaseMoney(b.supplierCny, 'CNY')],
                  ['Supplier total · MUR', purchaseMoney(a.supplierMur), purchaseMoney(b.supplierMur)],
                  ['Landed estimate · MUR', purchaseMoney(a.landed), purchaseMoney(b.landed)],
                  ['Expected arrival', requested.expectedDate || 'Not set', response.expectedDate || 'Not set'],
                ] as [string, string, string][]
              ).map(([label, before, after]) => (
                <TableRow key={label}>
                  <TableCell>{label}</TableCell>
                  <TableCell>{before}</TableCell>
                  <TableCell>{after}</TableCell>
                  <TableCell>{before !== after && <Badge variant="outline">Changed</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}

const eventLabels: Record<string, string> = {
  save: 'Draft saved',
  approve: 'Buyer approved',
  response: 'Supplier response recorded',
  confirm: 'Supplier response accepted; imports created',
  reopen: 'Request reopened; approval reset',
  cancel: 'Draft cancelled',
  correction: 'Import corrected',
}
export function PurchaseAudit({ events }: { events: ImportPurchaseEvent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Purchasing history</CardTitle>
        <CardDescription>Saved revisions and the people who recorded them.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          {events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No changes recorded yet.</p>
          ) : (
            events.map((event) => {
              const after = event.afterSnapshot as {
                requested_snapshot?: ReorderSnapshot
                supplier_snapshot?: ReorderSnapshot
                lines?: ReorderSnapshot['lines']
              } | null
              const snapshot = after?.supplier_snapshot || after?.requested_snapshot
              return (
                <div key={event.id} className="border-b border-border pb-4 last:border-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium">{eventLabels[event.eventType] || event.eventType}</p>
                    <p className="text-sm text-muted-foreground">
                      {event.actorName} ·{' '}
                      {new Date(event.createdAt).toLocaleString('en-GB', { timeZone: 'Indian/Mauritius' })}
                    </p>
                  </div>
                  {event.reason && <p className="text-sm leading-relaxed text-muted-foreground">{event.reason}</p>}
                  {snapshot && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-muted-foreground">View saved terms</summary>
                      <div className="flex flex-col gap-2">
                        <p>{snapshot.supplierName}</p>
                        {snapshot.lines.map((line) => (
                          <p key={line.id}>
                            {line.supplierLabel} · {line.variantLabel || 'Variant unspecified'} ·{' '}
                            {line.unavailable ? 'Unavailable' : `${line.qty ?? '?'} units`} ·{' '}
                            {purchaseMoney(line.priceCny, 'CNY')} / unit
                          </p>
                        ))}
                        <p>
                          Shared China freight: {purchaseMoney(snapshot.terms.sharedChinaFreight, 'CNY')}; FX:{' '}
                          {snapshot.terms.fxRate ?? 'not set'} MUR/CNY
                        </p>
                      </div>
                    </details>
                  )}
                </div>
              )
            })
          )}
        </div>
      </CardContent>
    </Card>
  )
}
