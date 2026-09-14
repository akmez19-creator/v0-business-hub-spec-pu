'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { moneyText } from '@/lib/local-purchasing/evidence'
import type { PurchaseSummary } from '@/lib/local-purchasing/history'

export function PurchaseHistory({ purchases }: { purchases: PurchaseSummary[] }) {
  const [query, setQuery] = useState('')
  const [review, setReview] = useState('all')
  const filtered = useMemo(() => purchases.filter((purchase) => (review === 'all' || purchase.reviewStatus === review) && `${purchase.supplierName} ${purchase.docRef || ''} ${purchase.orderNumber || ''}`.toLowerCase().includes(query.trim().toLowerCase())), [purchases, query, review])
  const recorded = filtered.filter((purchase) => purchase.status === 'recorded')
  const total = recorded.reduce((sum, purchase) => sum + (purchase.payableTotal ?? 0), 0)
  const unknown = recorded.filter((purchase) => purchase.payableTotal == null).length
  return <section className="flex min-w-0 flex-col gap-6 font-sans">
    <header className="flex flex-wrap items-start justify-between gap-4"><div className="flex max-w-2xl flex-col gap-2"><p className="text-sm text-muted-foreground">Local purchasing</p><h1 className="text-balance text-2xl font-semibold">Saved purchases</h1><p className="text-sm leading-relaxed text-muted-foreground">Recorded receipts, their original evidence and accepted differences. Saving a purchase here does not post stock or record payment.</p></div><div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link href="/dashboard/purchasing/local/orders">Supplier reorders</Link></Button><Button asChild><Link href="/dashboard/purchasing/local">Record a receipt</Link></Button></div></header>
    <FieldGroup className="sm:grid sm:grid-cols-3"><Field className="sm:col-span-2"><FieldLabel htmlFor="purchase-search">Find a purchase</FieldLabel><Input id="purchase-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Supplier, receipt reference or order number" /></Field><Field><FieldLabel htmlFor="purchase-review-filter">Review outcome</FieldLabel><Select value={review} onValueChange={setReview}><SelectTrigger id="purchase-review-filter"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">All outcomes</SelectItem><SelectItem value="verified">Verified</SelectItem><SelectItem value="exception">Accepted exception</SelectItem><SelectItem value="not_checkable">Not document-verified</SelectItem></SelectGroup></SelectContent></Select></Field></FieldGroup>
    <div className="flex flex-wrap items-center justify-between gap-4"><p className="text-sm text-muted-foreground">{filtered.length} purchase{filtered.length === 1 ? '' : 's'} shown</p><p className="text-sm">Recorded payable in this view: <span className="font-mono font-semibold">{moneyText(total)}</span>{unknown > 0 && <span className="text-muted-foreground"> · {unknown} without a recorded total, excluded</span>}</p></div>
    {filtered.length ? <Table><TableHeader><TableRow><TableHead>Reference / supplier</TableHead><TableHead>Date</TableHead><TableHead>Lines</TableHead><TableHead>Review</TableHead><TableHead>Order</TableHead><TableHead className="text-right">Recorded payable</TableHead></TableRow></TableHeader><TableBody>{filtered.map((purchase) => <TableRow key={purchase.id}><TableCell><Link className="font-medium underline-offset-4 hover:underline" href={`/dashboard/purchasing/local/history/${purchase.id}`}>{purchase.docRef || 'No document reference'}</Link><p className="text-sm text-muted-foreground">{purchase.supplierName}</p>{purchase.status !== 'recorded' && <Badge variant="outline">{purchase.status}</Badge>}</TableCell><TableCell>{purchase.purchaseDate}</TableCell><TableCell className="font-mono">{purchase.lineCount}</TableCell><TableCell><Badge variant={purchase.reviewStatus === 'verified' ? 'secondary' : 'outline'}>{purchase.reviewStatus === 'exception' ? 'Accepted exception' : purchase.reviewStatus === 'verified' ? 'Verified' : 'Not document-verified'}</Badge></TableCell><TableCell>{purchase.orderId ? <Link className="underline underline-offset-4" href={`/dashboard/purchasing/local/orders/${purchase.orderId}`}>{purchase.orderNumber}</Link> : 'Direct receipt'}</TableCell><TableCell className="text-right font-mono">{purchase.payableTotal == null ? 'Not recorded' : moneyText(purchase.payableTotal)}</TableCell></TableRow>)}</TableBody></Table> : <Empty><EmptyHeader><EmptyTitle>{purchases.length ? 'No matching purchases' : 'No purchases recorded yet'}</EmptyTitle><EmptyDescription>{purchases.length ? 'Try another reference, supplier or review outcome.' : 'Start with an actual receipt. Its supplier descriptions and prices become available when building the next reorder.'}</EmptyDescription></EmptyHeader><Button asChild variant="outline"><Link href="/dashboard/purchasing/local">Record a receipt</Link></Button></Empty>}
  </section>
}
