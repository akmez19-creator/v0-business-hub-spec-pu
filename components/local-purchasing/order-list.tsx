'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { moneyText } from '@/lib/local-purchasing/evidence'
import type { OrderListItem } from '@/lib/local-purchasing/order-service'

export function LocalOrderList({ orders }: { orders: OrderListItem[] }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const filtered = useMemo(() => orders.filter((order) => (status === 'all' || order.status === status) &&
    `${order.orderNumber} ${order.supplierName}`.toLowerCase().includes(query.trim().toLowerCase())), [orders, query, status])
  return <section className="flex min-w-0 flex-col gap-6 font-sans">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex max-w-2xl flex-col gap-2"><p className="text-sm text-muted-foreground">Local purchasing</p><h1 className="text-balance text-2xl font-semibold">Supplier orders</h1><p className="text-pretty text-sm leading-relaxed text-muted-foreground">Reorder using the supplier&apos;s own names and codes. Compare their response before accepting it or recording an actual purchase.</p></div>
      <div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link href="/dashboard/purchasing/local">Record a receipt</Link></Button><Button asChild><Link href="/dashboard/purchasing/local/orders/new"><Plus data-icon="inline-start" />New supplier order</Link></Button></div>
    </header>
    <FieldGroup className="sm:grid sm:grid-cols-3">
      <Field className="sm:col-span-2"><FieldLabel htmlFor="order-search">Find an order</FieldLabel><Input id="order-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Order number or supplier name" /></Field>
      <Field><FieldLabel htmlFor="order-status">Status</FieldLabel><Select value={status} onValueChange={setStatus}><SelectTrigger id="order-status"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">All statuses</SelectItem>{['draft','issued','confirmed','partial','completed','cancelled'].map((value) => <SelectItem key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</SelectItem>)}</SelectGroup></SelectContent></Select></Field>
    </FieldGroup>
    {filtered.length ? <div className="min-w-0 rounded-lg border border-border bg-card text-card-foreground"><Table><TableHeader><TableRow><TableHead>Order / revision</TableHead><TableHead>Supplier</TableHead><TableHead>Status</TableHead><TableHead>Updated</TableHead><TableHead className="text-right">Last issued estimate</TableHead><TableHead><span className="sr-only">Open order</span></TableHead></TableRow></TableHeader><TableBody>{filtered.map((order) => <TableRow key={order.id}>
      <TableCell><Link className="font-medium underline-offset-4 hover:underline" href={`/dashboard/purchasing/local/orders/${order.id}`}>{order.orderNumber} <span className="text-muted-foreground">· r{order.revision}</span></Link></TableCell><TableCell>{order.supplierName}</TableCell><TableCell><Badge variant={order.status === 'draft' || order.status === 'cancelled' ? 'outline' : 'secondary'}>{order.status}</Badge></TableCell><TableCell>{new Date(order.updatedAt).toLocaleDateString('en-GB')}</TableCell><TableCell className="text-right font-mono">{order.total == null ? 'Not issued' : moneyText(order.total)}</TableCell><TableCell><Button asChild variant="ghost" size="icon"><Link href={`/dashboard/purchasing/local/orders/${order.id}`} aria-label={`Open ${order.orderNumber}`}><ArrowUpRight /></Link></Button></TableCell>
    </TableRow>)}</TableBody></Table></div> : <Empty><EmptyHeader><EmptyTitle>{orders.length ? 'No matching orders' : 'Your next local purchase starts here'}</EmptyTitle><EmptyDescription>{orders.length ? 'Try another supplier name or status.' : 'Saved receipts automatically build each supplier’s product catalogue. You can also start an order by entering their product wording directly.'}</EmptyDescription></EmptyHeader><Button asChild variant="outline"><Link href="/dashboard/purchasing/local/orders/new">Create an order</Link></Button></Empty>}
    <p className="text-sm leading-relaxed text-muted-foreground">{filtered.length} order{filtered.length === 1 ? '' : 's'} shown. Drafting, issuing and accepting a supplier confirmation do not record a purchase, post stock or record payment.</p>
  </section>
}
