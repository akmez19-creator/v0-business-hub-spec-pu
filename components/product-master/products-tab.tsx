'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronRight, ExternalLink, Search, ShoppingCart } from 'lucide-react'

interface Product {
  id: string
  name: string
  sku: string | null
  category: string | null
  price: number | null
  quantity: number | null
  image_url: string | null
  is_active: boolean
}

interface PurchaseOrder {
  id: string
  product_id: string | null
  product_name: string | null
  status: string | null
  qty: number | null
  unit_price: number | null
  supplier_name: string | null
  tracking_number: string | null
  created_at: string
}

const LOW_STOCK = 10

// Everything inventory + purchase orders in one master view: a row per
// product with stock level and its open POs expandable inline.
async function fetchMasterData() {
  const supabase = createClient()
  const [{ data: products, error: pErr }, { data: pos, error: poErr }] = await Promise.all([
    supabase.from('products').select('id, name, sku, category, price, quantity, image_url, is_active').order('name'),
    supabase
      .from('purchase_orders')
      .select('id, product_id, product_name, status, qty, unit_price, supplier_name, tracking_number, created_at')
      .order('created_at', { ascending: false }),
  ])
  if (pErr) throw pErr
  if (poErr) throw poErr
  return { products: (products || []) as Product[], pos: (pos || []) as PurchaseOrder[] }
}

export function ProductsTab() {
  const { data, error, isLoading } = useSWR('product-master-data', fetchMasterData)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'low' | 'with-po'>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // POs grouped per product (by id when linked, by name as fallback)
  const posByProduct = useMemo(() => {
    const map = new Map<string, PurchaseOrder[]>()
    for (const po of data?.pos || []) {
      const key = po.product_id || (po.product_name || '').toLowerCase().trim()
      if (!key) continue
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(po)
    }
    return map
  }, [data])

  const productPos = (p: Product) =>
    posByProduct.get(p.id) || posByProduct.get(p.name.toLowerCase().trim()) || []

  const openPos = (p: Product) =>
    productPos(p).filter((po) => {
      const s = (po.status || '').toLowerCase()
      return s !== 'received' && s !== 'cancelled' && s !== 'completed' && s !== 'imported'
    })

  const filtered = useMemo(() => {
    let list = data?.products || []
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (p) => p.name.toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q),
      )
    }
    if (filter === 'low') list = list.filter((p) => (p.quantity ?? 0) <= LOW_STOCK)
    if (filter === 'with-po') list = list.filter((p) => openPos(p).length > 0)
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, search, filter, posByProduct])

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (error) {
    return <Card><CardContent className="py-10 text-center text-sm text-destructive">Failed to load products: {String(error.message || error)}</CardContent></Card>
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search product, SKU, category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        {(
          [
            ['all', 'All'],
            ['low', `Low stock (\u2264${LOW_STOCK})`],
            ['with-po', 'Has open PO'],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            variant={filter === key ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(key)}
          >
            {label}
          </Button>
        ))}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/deliveries/inventory">
              Full Inventory <ExternalLink className="ml-1 h-3 w-3" />
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/deliveries/purchase-orders">
              Purchase Orders <ExternalLink className="ml-1 h-3 w-3" />
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="grid grid-cols-[24px_1fr_90px_90px_90px_110px] items-center gap-2 border-b px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span />
            <span>Product</span>
            <span className="text-right">Stock</span>
            <span className="text-right">Price</span>
            <span className="text-right">Open POs</span>
            <span className="text-right">Status</span>
          </div>
          {isLoading && <div className="px-4 py-10 text-center text-sm text-muted-foreground">{'Loading inventory\u2026'}</div>}
          {!isLoading && filtered.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">No products match.</div>
          )}
          {filtered.map((p) => {
            const pos = productPos(p)
            const open = openPos(p)
            const qty = p.quantity ?? 0
            const isOpen = expanded.has(p.id)
            return (
              <div key={p.id} className="border-b last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggle(p.id)}
                  className="grid w-full grid-cols-[24px_1fr_90px_90px_90px_110px] items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/50"
                >
                  {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <span className="flex items-center gap-2 truncate">
                    {p.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image_url || "/placeholder.svg"} alt="" className="h-7 w-7 shrink-0 rounded object-cover" />
                    ) : (
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-bold text-muted-foreground">
                        {p.name.slice(0, 1)}
                      </span>
                    )}
                    <span className="truncate font-medium">{p.name}</span>
                    {p.sku && <span className="hidden truncate text-xs text-muted-foreground md:inline">{p.sku}</span>}
                  </span>
                  <span className={`text-right font-semibold tabular-nums ${qty <= 0 ? 'text-destructive' : qty <= LOW_STOCK ? 'text-amber-500' : ''}`}>
                    {qty}
                  </span>
                  <span className="text-right tabular-nums text-muted-foreground">
                    {p.price != null ? `Rs ${Number(p.price).toLocaleString()}` : '\u2014'}
                  </span>
                  <span className="text-right">
                    {open.length > 0 ? (
                      <Badge variant="outline" className="border-cyan-500/40 bg-cyan-500/10 text-cyan-500">
                        <ShoppingCart className="mr-1 h-3 w-3" />
                        {open.length}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">{'\u2014'}</span>
                    )}
                  </span>
                  <span className="text-right">
                    <Badge variant={p.is_active ? 'default' : 'secondary'}>{p.is_active ? 'Active' : 'Inactive'}</Badge>
                  </span>
                </button>
                {isOpen && (
                  <div className="bg-muted/30 px-10 py-3">
                    {pos.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No purchase orders for this product.</p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {pos.slice(0, 8).map((po) => (
                          <div key={po.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                            <Badge variant="outline" className="capitalize">{po.status || 'unknown'}</Badge>
                            <span className="tabular-nums">Qty {po.qty ?? '\u2014'}</span>
                            <span className="tabular-nums text-muted-foreground">
                              {po.unit_price != null ? `@ ${Number(po.unit_price).toLocaleString()}` : ''}
                            </span>
                            {po.supplier_name && <span className="text-muted-foreground">{po.supplier_name}</span>}
                            {po.tracking_number && <span className="font-mono text-muted-foreground">{po.tracking_number}</span>}
                            <span className="ml-auto text-muted-foreground">
                              {new Date(po.created_at).toLocaleDateString()}
                            </span>
                          </div>
                        ))}
                        {pos.length > 8 && (
                          <p className="text-xs text-muted-foreground">+{pos.length - 8} more in Purchase Orders</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
