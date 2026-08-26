'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Search, TruckIcon, DollarSign, Package, ExternalLink, Boxes, MessageSquare } from 'lucide-react'
import { formatCurrency, formatDate, statusColor } from './po-columns'
import { SupplierDetailSheet } from './supplier-detail-sheet'

/** Messages stored across every captured conversation with this supplier. */
function totalMessages(s: SupplierSummary) {
  return s.threads.reduce((n, t) => n + t.messages, 0)
}

export interface SupplierThread {
  id: string
  handle: string
  platform: string
  messages: number
  complete: boolean
  lastCaptured: string | null
}

export interface SupplierSummary {
  name: string
  orders: number
  qty: number
  spend: number
  spendYuan: number
  landed: number
  products: string[]
  lastOrder: string | null
  statuses: Record<string, number>
  sampleLink: string | null
  threads: SupplierThread[]
  manualProducts: { id: string; name: string }[]
}

export function SuppliersContent({
  suppliers,
  allProducts,
}: {
  suppliers: SupplierSummary[]
  allProducts: { id: string; name: string }[]
}) {
  const [search, setSearch] = useState('')
  // Only the NAME is held. Keeping the whole row would freeze a snapshot taken
  // at click time, so after router.refresh() the sheet would keep rendering the
  // pre-save data and a successful save would look like it did nothing.
  const [openName, setOpenName] = useState<string | null>(null)
  const openSupplier = openName ? (suppliers.find(s => s.name === openName) ?? null) : null

  const filtered = useMemo(() => {
    if (!search) return suppliers
    const q = search.toLowerCase()
    return suppliers.filter(
      s =>
        s.name.toLowerCase().includes(q) ||
        s.products.some(p => p.toLowerCase().includes(q)),
    )
  }, [suppliers, search])

  const totals = useMemo(() => {
    let spend = 0
    let qty = 0
    for (const s of filtered) {
      spend += s.spend
      qty += s.qty
    }
    return { spend, qty }
  }, [filtered])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Suppliers</h2>
        <p className="text-muted-foreground">
          Every supplier you have ordered from, ranked by spend
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Suppliers</CardTitle>
            <TruckIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{suppliers.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Spend</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totals.spend)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Units Ordered</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.qty.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Distinct Products</CardTitle>
            <Boxes className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {new Set(suppliers.flatMap(s => s.products)).size.toLocaleString()}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search supplier or product..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Badge variant="secondary" className="ml-auto">
          {filtered.length} / {suppliers.length} suppliers
        </Badge>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[220px]">Supplier</TableHead>
              <TableHead className="min-w-[80px] text-right">Orders</TableHead>
              <TableHead className="min-w-[80px] text-right">Qty</TableHead>
              <TableHead className="min-w-[130px] text-right">Spend</TableHead>
              <TableHead className="min-w-[120px] text-right">Spend (Yuan)</TableHead>
              <TableHead className="min-w-[130px] text-right">Landed Cost</TableHead>
              <TableHead className="min-w-[200px]">Products</TableHead>
              <TableHead className="min-w-[150px]">Conversations</TableHead>
              <TableHead className="min-w-[160px]">Status</TableHead>
              <TableHead className="min-w-[120px]">Last Order</TableHead>
              <TableHead className="min-w-[60px]">Link</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="text-center py-12 text-muted-foreground">
                  <TruckIcon className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p>
                    {suppliers.length === 0
                      ? 'No suppliers yet. Import a purchase order to populate this list.'
                      : 'No suppliers match your search.'}
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map(s => (
                <TableRow key={s.name}>
                  <TableCell className="font-medium">
                    {/* Deep-links into Orders, where the supplier filter narrows
                        the table to just this supplier's lines. */}
                    <Link
                      href={`/dashboard/purchasing?supplier=${encodeURIComponent(s.name)}`}
                      className="hover:underline"
                    >
                      {s.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">{s.orders}</TableCell>
                  <TableCell className="text-right">{s.qty.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(s.spend)}</TableCell>
                  <TableCell className="text-right">
                    {s.spendYuan ? `¥ ${s.spendYuan.toLocaleString()}` : '-'}
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(s.landed)}</TableCell>
                  <TableCell>
                    <span
                      className="block truncate max-w-[200px] text-sm text-muted-foreground"
                      title={s.products.join(', ')}
                    >
                      {s.products.length === 1
                        ? s.products[0]
                        : `${s.products[0]} +${s.products.length - 1} more`}
                    </span>
                  </TableCell>
                  <TableCell>
                    {s.threads.length === 0 ? (
                      <span className="text-sm text-muted-foreground">-</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setOpenName(s.name)}
                        className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                      >
                        <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
                        {totalMessages(s)} message{totalMessages(s) === 1 ? '' : 's'}
                        {s.threads.some(t => !t.complete) && (
                          <span className="text-muted-foreground" title="Some history has not been captured yet">
                            (partial)
                          </span>
                        )}
                      </button>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(s.statuses).map(([status, count]) => (
                        <Badge
                          key={status}
                          variant="outline"
                          className={`text-[10px] ${statusColor(status)}`}
                        >
                          {status} {count}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {formatDate(s.lastOrder)}
                  </TableCell>
                  <TableCell>
                    {s.sampleLink ? (
                      <a
                        href={s.sampleLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                        aria-label={`Open a listing from ${s.name}`}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <SupplierDetailSheet
        supplier={openSupplier}
        allProducts={allProducts}
        onClose={() => setOpenName(null)}
      />
    </div>
  )
}
