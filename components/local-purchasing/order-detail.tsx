'use client'

import { useState, useTransition } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Download, FileCheck2, Loader2, Pencil, Printer, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { DocumentImport } from './document-import'
import { LocalOrderEditor } from './order-editor'
import { OrderDocumentReview } from './order-document-review'
import type { SupplierOption } from './purchase-entry'
import type { PickableProduct } from './product-picker'
import type { ImportedDoc } from '@/app/dashboard/purchasing/local/actions'
import type { OrderBundle } from '@/lib/local-purchasing/order-service'
import { calculateOrder } from '@/lib/local-purchasing/order-types'
import { moneyText } from '@/lib/local-purchasing/evidence'
import { variantDescription } from '@/lib/products/pricing'
import { cancelLocalOrderAction, exportLocalOrderAction, getLocalOrderAction, getOrderDocumentAction, getSupplierCatalogueAction, issueLocalOrderAction } from '@/app/dashboard/purchasing/local/orders/actions'

const statusText = { draft: 'Draft', issued: 'Issued', confirmed: 'Confirmation accepted', partial: 'Partially purchased', completed: 'Fully purchased', cancelled: 'Cancelled' }

export function LocalOrderDetail({ initial, suppliers, products }: { initial: OrderBundle; suppliers: SupplierOption[]; products: PickableProduct[] }) {
  const router = useRouter()
  const { data: bundle = initial, mutate: reload, error: loadError } = useSWR(['local-order', initial.order.id], ([, id]) => getLocalOrderAction(id), {
    fallbackData: initial, revalidateOnMount: false, revalidateOnFocus: false, shouldRetryOnError: false,
  })
  const { order, documents } = bundle
  const [editing, setEditing] = useState(false)
  const [selectedDocument, setSelectedDocument] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'issue' | 'cancel' | null>(null)
  const [reason, setReason] = useState('')
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const blocked = busy || pending
  const closed = order.status === 'completed' || order.status === 'cancelled'
  const currentIssued = order.issuedRevision === order.revision && Boolean(order.issuedSnapshot)
  const reviewable = !closed && currentIssued && order.status !== 'draft'
  const selected = documents.find((item) => item.id === selectedDocument)
  const canReviewSelected = reviewable && selected?.owned && !selected.purchaseId && selected.orderRevision === order.revision
  const { data: source, error: documentError, isLoading: loadingDocument } = useSWR(
    canReviewSelected ? ['order-document', order.id, selectedDocument!, order.reviewEpoch, selected.reviewRevision] : null,
    ([, id, documentId]) => getOrderDocumentAction(id, documentId), { revalidateOnFocus: false, shouldRetryOnError: false },
  )
  const { data: catalogue, error: catalogueError } = useSWR(['supplier-products', order.supplierId], ([, id]) => getSupplierCatalogueAction(id), { revalidateOnFocus: false, shouldRetryOnError: false })
  const calculation = calculateOrder(order.lines, order.terms, order.supplier)
  const productNames = new Map(products.map((item) => [item.id, item.name]))
  const amounts = new Map(calculation.lines.map((line) => [line.key, line]))

  const refresh = async () => { await reload(); router.refresh() }
  const reloadReview = async () => { await refresh(); setNotice('Review saved. No purchase, stock movement or payment was created.') }
  const imported = async (doc: ImportedDoc) => {
    setError(null)
    setNotice(doc.warnings.length ? doc.warnings.join(' ') : 'Document filed. Review the differences before confirming.')
    if (!doc.documentId) { setError('The file was read but could not be filed against this order. Retry the upload; no confirmation was recorded.'); return }
    try { await refresh(); setSelectedDocument(doc.documentId) }
    catch { setError('The document was filed, but this page could not refresh. Reload the order before reviewing it.') }
  }
  const mutateOrder = () => startTransition(async () => {
    setError(null)
    try {
      const input = { id: order.id, revision: order.revision, updatedAt: order.updatedAt, requestKey }
      if (dialog === 'issue') await issueLocalOrderAction(input)
      else await cancelLocalOrderAction({ ...input, reason })
      setDialog(null)
      setReason('')
      setSelectedDocument(null)
      await refresh()
    } catch (error) { setError(error instanceof Error ? error.message : 'The order could not be updated.') }
  })
  const exportExcel = (revision: number) => startTransition(async () => {
    setError(null)
    try {
      const [result, XLSX] = await Promise.all([exportLocalOrderAction(order.id, revision), import('xlsx')])
      const workbook = XLSX.utils.book_new()
      const sheet = XLSX.utils.aoa_to_sheet(result.rows)
      sheet['!cols'] = [{ wch: 42 }, { wch: 26 }, { wch: 16 }, { wch: 12 }, { wch: 22 }, { wch: 18 }, { wch: 20 }, { wch: 10 }, { wch: 22 }, { wch: 22 }, { wch: 24 }, { wch: 24 }]
      XLSX.utils.book_append_sheet(workbook, sheet, 'Purchase order')
      XLSX.writeFile(workbook, result.fileName)
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not export this issued revision.') }
  })

  if (editing) return <LocalOrderEditor order={order} suppliers={suppliers} products={products} onCancel={() => setEditing(false)} onSaved={async () => {
    await refresh(); setEditing(false); setSelectedDocument(null); setNotice('Draft saved. Issue this new revision before using a supplier response.')
  }} />

  return <div className="flex min-w-0 flex-col gap-6 font-sans">
    <nav aria-label="Local purchasing"><Button asChild variant="ghost" size="sm"><Link href="/dashboard/purchasing/local/orders"><ArrowLeft data-icon="inline-start" />All local orders</Link></Button></nav>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-2"><div className="flex flex-wrap items-center gap-3"><h1 className="text-balance text-2xl font-semibold">{order.orderNumber}</h1><Badge variant={closed ? 'secondary' : 'outline'}>{statusText[order.status]}</Badge></div><p className="break-words text-base">{order.supplier.name}</p><p className="text-sm text-muted-foreground">Revision {order.revision}{order.expectedDate ? ` · Delivery requested ${order.expectedDate}` : ''}</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={blocked} onClick={() => { setError(null); startTransition(async () => { try { await refresh() } catch { setError('Could not refresh the order. Try again.') } }) }}><RefreshCw data-icon="inline-start" />Refresh</Button>{!closed && <Button variant="outline" disabled={blocked} onClick={() => { setSelectedDocument(null); setEditing(true) }}><Pencil data-icon="inline-start" />Edit order</Button>}{order.status === 'draft' && <Button disabled={blocked || !calculation.canRecord} onClick={() => { setRequestKey(crypto.randomUUID()); setDialog('issue') }}><FileCheck2 data-icon="inline-start" />Issue revision {order.revision}</Button>}</div>
    </header>
    {(error || loadError) && <Alert variant="destructive"><AlertTitle>Action needs attention</AlertTitle><AlertDescription>{error || 'Could not refresh this order. The saved view remains visible; refresh before continuing.'}</AlertDescription></Alert>}
    {notice && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
    {order.status === 'draft' && <Alert><AlertTitle>{order.issuedSnapshot ? 'A newer draft is not issued yet' : 'This draft has not been issued'}</AlertTitle><AlertDescription>Issuing freezes the expected items and prices for this revision. It does not send anything, record a purchase, post stock or mark a payment.</AlertDescription></Alert>}
    {order.cancellationReason && <Alert><AlertTitle>Order cancelled</AlertTitle><AlertDescription>{order.cancellationReason} Previously recorded purchases remain in the purchase history.</AlertDescription></Alert>}
    <section className="flex min-w-0 flex-col gap-4" aria-label="Current order quantities">
      <div className="flex flex-wrap items-end justify-between gap-4"><h2 className="text-lg font-semibold">{order.status === 'draft' ? 'Draft items' : 'Ordered items'}</h2><div className="flex flex-col gap-1 text-right"><p className="text-sm text-muted-foreground">Expected full-order payable</p><p className="font-mono text-xl font-semibold">{calculation.totals ? moneyText(calculation.totals.payable) : 'Complete the expected prices'}</p></div></div>
      <Table><TableHeader><TableRow><TableHead>Supplier description</TableHead><TableHead>Code / unit</TableHead><TableHead className="text-right">Ordered</TableHead><TableHead className="text-right">Purchased</TableHead><TableHead className="text-right">Outstanding</TableHead><TableHead className="text-right">Expected payable / unit</TableHead></TableRow></TableHeader><TableBody>{order.lines.map((line) => <TableRow key={line.id}><TableCell><p className="max-w-sm whitespace-normal break-words font-medium">{line.supplierLabel}</p>{line.productId && <p className="max-w-sm whitespace-normal text-sm text-muted-foreground">Inventory: {productNames.get(line.productId) || 'Linked product'}</p>}{line.productId && <p className="text-sm text-muted-foreground">{variantDescription(line.variantSnapshot)}</p>}</TableCell><TableCell>{line.supplierCode || '—'}<p className="text-sm text-muted-foreground">{line.unit || 'Unit not stated'}</p></TableCell><TableCell className="text-right font-mono">{line.qty}</TableCell><TableCell className="text-right font-mono">{order.received[line.id] ?? 0}</TableCell><TableCell className="text-right font-mono">{Math.max(0, line.qty - (order.received[line.id] ?? 0))}</TableCell><TableCell className="text-right font-mono">{amounts.has(line.id) ? moneyText(amounts.get(line.id)!.rawPayable / line.qty) : 'Not entered'}</TableCell></TableRow>)}</TableBody></Table>
      {order.notes && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">Supplier instructions: {order.notes}</p>}
    </section>
    {order.revisionHistory.length > 0 && <section className="flex flex-col gap-3" aria-label="Issued order exports"><h2 className="text-lg font-semibold">Issued revisions</h2><p className="text-sm text-muted-foreground">Supplier-only descriptions and prices. Downloading does not mark an order as sent.</p><ul className="flex flex-col gap-3">{[...order.revisionHistory].reverse().map((snapshot) => <li key={snapshot.revision}><div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm">Revision {snapshot.revision} · {snapshot.issuedAt.slice(0, 10)}{snapshot.revision !== order.revision ? ' · Superseded by a newer revision' : ''}</p><div className="flex flex-wrap gap-2"><Button asChild variant="outline" size="sm"><Link href={`/dashboard/purchasing/local/orders/${order.id}/print?revision=${snapshot.revision}`} target="_blank" rel="noopener noreferrer"><Printer data-icon="inline-start" />Print / PDF</Link></Button><Button variant="outline" size="sm" disabled={blocked} onClick={() => exportExcel(snapshot.revision)}><Download data-icon="inline-start" />Excel</Button></div></div></li>)}</ul></section>}
    <section className="flex min-w-0 flex-col gap-4" aria-label="Supplier responses"><h2 className="text-lg font-semibold">Supplier response or invoice</h2>
      {reviewable && <DocumentImport order={{ id: order.id, revision: order.revision }} disabled={blocked} onBusyChange={setBusy} onImported={(doc) => { void imported(doc) }} />}
      {!documents.length ? <Empty><EmptyHeader><EmptyTitle>No supplier response filed</EmptyTitle><EmptyDescription>{reviewable ? 'Import the returned document to compare its figures with this issued order.' : 'Issue the draft first, then upload the supplier’s response. Direct receipts remain available separately.'}</EmptyDescription></EmptyHeader></Empty> : <ul className="flex flex-col gap-3">{documents.map((doc) => <li key={doc.id} className="rounded-lg border border-border bg-card p-4 text-card-foreground"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 flex-col gap-1"><p className="break-words text-sm font-medium">{doc.fileName || 'Supplier document'}</p><p className="text-sm text-muted-foreground">Revision {doc.orderRevision} · {doc.createdAt.slice(0, 10)} · {doc.kind}{!doc.owned ? ' · Uploaded by another buyer' : ''}</p></div><div className="flex flex-wrap items-center gap-2">{doc.accepted && <Badge variant="outline">Confirmation accepted</Badge>}{doc.purchaseId ? <Button asChild variant="outline" size="sm"><Link href={`/dashboard/purchasing/local/history/${doc.purchaseId}`}>View recorded purchase</Link></Button> : doc.orderRevision !== order.revision ? <Badge variant="secondary">Older revision</Badge> : doc.owned && reviewable ? <Button variant={doc.id === selectedDocument ? 'secondary' : 'outline'} size="sm" disabled={blocked} onClick={() => setSelectedDocument(doc.id)}>Review document</Button> : <Badge variant="secondary">Read only</Badge>}</div></div></li>)}</ul>}
    </section>
    {canReviewSelected && <section className="flex min-w-0 flex-col gap-4" aria-label="Active supplier review">{loadingDocument || !catalogue ? <p role="status" className="text-sm text-muted-foreground">Loading document and supplier mappings…</p> : null}{(documentError || catalogueError) && <Alert variant="destructive"><AlertTitle>Review unavailable</AlertTitle><AlertDescription>{documentError instanceof Error ? documentError.message : 'Supplier mappings could not be loaded. Refresh before reviewing.'}</AlertDescription></Alert>}{source && catalogue && !documentError && !catalogueError && <OrderDocumentReview key={`${source.id}:${source.reviewRevision}:${order.reviewEpoch}`} order={order} document={source} products={products} catalogue={catalogue} onBusyChange={setBusy} onSaved={reloadReview} onRecorded={async (id) => { setNotice('Purchase recorded. Opening the saved receipt; no stock movement or payment was posted.'); router.push(`/dashboard/purchasing/local/history/${id}`) }} />}</section>}
    {!closed && <div><Button variant="ghost" disabled={blocked} onClick={() => { setReason(''); setRequestKey(crypto.randomUUID()); setDialog('cancel') }}>Cancel remaining order</Button></div>}
    <AlertDialog open={dialog !== null} onOpenChange={(open) => { if (!open && !pending) setDialog(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{dialog === 'issue' ? `Issue ${order.orderNumber}, revision ${order.revision}?` : 'Cancel the remaining order?'}</AlertDialogTitle><AlertDialogDescription>{dialog === 'issue' ? 'This saves the supplier-facing baseline for comparison and export. It does not send the order, record a purchase or post stock or payment.' : 'The unpurchased balance will be closed. Existing purchases, original files and issued revisions are retained.'}</AlertDialogDescription></AlertDialogHeader>{dialog === 'cancel' && <Field><FieldLabel htmlFor="order-cancel-reason">Reason for cancellation</FieldLabel><Textarea id="order-cancel-reason" value={reason} onChange={(event) => { setReason(event.target.value); setRequestKey(crypto.randomUUID()) }} minLength={8} maxLength={4000} /></Field>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<AlertDialogFooter><AlertDialogCancel disabled={pending}>Keep reviewing</AlertDialogCancel><AlertDialogAction disabled={pending || (dialog === 'cancel' && reason.trim().length < 8)} onClick={(event) => { event.preventDefault(); mutateOrder() }}>{pending && <Loader2 className="animate-spin" data-icon="inline-start" />}{dialog === 'issue' ? 'Issue this revision' : 'Cancel remaining order'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}
