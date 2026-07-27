'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Copy,
  ExternalLink,
  Frame,
  Megaphone,
  Search,
  ShoppingCart,
  Sparkles,
  Users,
} from 'lucide-react'

// A row tool click: which tool, for which product
export interface ToolRequest {
  tool: 'ai-posts' | 'reels' | 'frames' | 'campaigns'
  product: { id: string; name: string }
}

interface PurchaseOrder {
  id: string
  status: string | null
  qty: number | null
  unit_price: number | null
  supplier_name: string | null
  tracking_number: string | null
  created_at: string
}

// Enriched product row from /api/product-master/overview:
// inventory + merged POs + ads intelligence + client demand
interface OverviewProduct {
  id: string
  name: string
  sku: string | null
  category: string | null
  price: number | null
  quantity: number | null
  image_url: string | null
  is_active: boolean
  soldOut: boolean
  activeCampaigns: number
  activeAds: number
  clientsPerDay: number
  clientsPerWeek: number
  openPOs: number
  openPOQty: number
  pos: PurchaseOrder[]
  aliases: string[]
}

const LOW_STOCK = 10

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function ProductsTab({ onOpenTool }: { onOpenTool?: (req: ToolRequest) => void }) {
  const { data, error, isLoading, mutate } = useSWR<{ success: boolean; products: OverviewProduct[] }>(
    '/api/product-master/overview',
    fetcher,
  )
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'low' | 'sold-out' | 'with-po' | 'advertised'>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [togglingSoldOut, setTogglingSoldOut] = useState<string | null>(null)

  // Manual, user-initiated sold-out toggle with optimistic update
  const toggleSoldOut = async (product: OverviewProduct) => {
    setTogglingSoldOut(product.id)
    const next = !product.soldOut
    try {
      await mutate(
        async (current) => {
          const res = await fetch('/api/product-master/overview', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: product.id, soldOut: next }),
          })
          const json = await res.json()
          if (!res.ok || !json.success) throw new Error(json.error || 'Update failed')
          return current
            ? { ...current, products: current.products.map((p) => (p.id === product.id ? { ...p, soldOut: next } : p)) }
            : current
        },
        {
          optimisticData: (current) =>
            current
              ? { ...current, products: current.products.map((p) => (p.id === product.id ? { ...p, soldOut: next } : p)) }
              : { success: true, products: [] },
          rollbackOnError: true,
          revalidate: false,
        },
      )
    } catch {
      /* rollback handled by SWR */
    } finally {
      setTogglingSoldOut(null)
    }
  }

  const filtered = useMemo(() => {
    let list = data?.products || []
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.sku || '').toLowerCase().includes(q) ||
          (p.category || '').toLowerCase().includes(q) ||
          p.aliases.some((a) => a.toLowerCase().includes(q)),
      )
    }
    if (filter === 'low') list = list.filter((p) => (p.quantity ?? 0) <= LOW_STOCK && !p.soldOut)
    if (filter === 'sold-out') list = list.filter((p) => p.soldOut)
    if (filter === 'with-po') list = list.filter((p) => p.openPOs > 0)
    if (filter === 'advertised') list = list.filter((p) => p.activeAds > 0)
    return list
  }, [data, search, filter])

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  if (error || (data && !data.success)) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-destructive">Failed to load product overview.</CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search product, alias, SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        {(
          [
            ['all', 'All'],
            ['sold-out', 'Sold out'],
            ['low', `Low stock (\u2264${LOW_STOCK})`],
            ['with-po', 'Has open PO'],
            ['advertised', 'Advertised'],
          ] as const
        ).map(([key, label]) => (
          <Button key={key} variant={filter === key ? 'default' : 'outline'} size="sm" onClick={() => setFilter(key)}>
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
          <div className="grid grid-cols-[24px_1fr_80px_80px_72px_72px_70px_96px] items-center gap-2 border-b px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span />
            <span>Product</span>
            <span className="text-right">Stock</span>
            <span className="text-right" title="Active ads running for this product">Ads</span>
            <span className="text-right" title="Clients today">Cl/day</span>
            <span className="text-right" title="Clients last 7 days">Cl/wk</span>
            <span className="text-right">POs</span>
            <span className="text-right">Status</span>
          </div>
          {isLoading && <div className="px-4 py-10 text-center text-sm text-muted-foreground">{'Loading product intelligence\u2026'}</div>}
          {!isLoading && filtered.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">No products match.</div>
          )}
          {filtered.map((p) => {
            const qty = p.quantity ?? 0
            const isOpen = expanded.has(p.id)
            return (
              <div key={p.id} className="border-b last:border-b-0">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggle(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggle(p.id)
                    }
                  }}
                  aria-expanded={isOpen}
                  className="grid w-full cursor-pointer grid-cols-[24px_1fr_80px_80px_72px_72px_70px_96px] items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/50"
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
                    {/* Per-product tools - popups pre-loaded with this product */}
                    {onOpenTool && (
                      <span className="ml-1 flex shrink-0 items-center gap-1">
                        {(
                          [
                            ['ai-posts', Sparkles, 'text-amber-500', 'AI Post'],
                            ['reels', Clapperboard, 'text-sky-500', 'Reels Studio'],
                            ['frames', Frame, 'text-muted-foreground', 'Frame Input (soon)'],
                            ['campaigns', Copy, 'text-emerald-500', 'Campaign Creator'],
                          ] as const
                        ).map(([tool, Icon, color, label]) => (
                          <Button
                            key={tool}
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            title={label}
                            aria-label={`${label} for ${p.name}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              onOpenTool({ tool, product: { id: p.id, name: p.name } })
                            }}
                          >
                            <Icon className={`h-3.5 w-3.5 ${color}`} />
                          </Button>
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center justify-end gap-1.5">
                    {p.soldOut && (
                      <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-400">Sold out</Badge>
                    )}
                    <span className={`font-semibold tabular-nums ${p.soldOut ? 'text-muted-foreground line-through' : qty <= LOW_STOCK ? 'text-amber-500' : ''}`}>
                      {qty}
                    </span>
                  </span>
                  <span className="text-right">
                    {p.activeAds > 0 ? (
                      <Badge variant="outline" className="border-blue-500/40 bg-blue-500/10 text-blue-400">
                        <Megaphone className="mr-1 h-3 w-3" />
                        {p.activeAds}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">{'\u2014'}</span>
                    )}
                  </span>
                  <span className="text-right tabular-nums">
                    {p.clientsPerDay > 0 ? p.clientsPerDay : <span className="text-muted-foreground">{'\u2014'}</span>}
                  </span>
                  <span className="text-right tabular-nums">
                    {p.clientsPerWeek > 0 ? p.clientsPerWeek : <span className="text-muted-foreground">{'\u2014'}</span>}
                  </span>
                  <span className="text-right">
                    {p.openPOs > 0 ? (
                      <Badge variant="outline" className="border-cyan-500/40 bg-cyan-500/10 text-cyan-500">
                        <ShoppingCart className="mr-1 h-3 w-3" />
                        {p.openPOs}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">{'\u2014'}</span>
                    )}
                  </span>
                  <span className="text-right">
                    <Badge variant={p.is_active ? 'default' : 'secondary'}>{p.is_active ? 'Active' : 'Inactive'}</Badge>
                  </span>
                </div>
                {isOpen && (
                  <div className="flex flex-col gap-3 bg-muted/30 px-10 py-3">
                    {/* Demand + ads summary line + manual sold-out control */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" /> {p.clientsPerDay} client(s) today {'\u00b7'} {p.clientsPerWeek} this week
                      </span>
                      {p.activeAds > 0 && (
                        <span className="flex items-center gap-1">
                          <Megaphone className="h-3 w-3" /> {p.activeAds} active ad(s) across {p.activeCampaigns} campaign(s)
                        </span>
                      )}
                      {p.openPOQty > 0 && (
                        <span className="flex items-center gap-1">
                          <ShoppingCart className="h-3 w-3" /> {p.openPOQty} unit(s) incoming
                        </span>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className={`ml-auto h-7 text-xs ${p.soldOut ? 'border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10' : 'border-red-500/40 text-red-400 hover:bg-red-500/10'}`}
                        disabled={togglingSoldOut === p.id}
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleSoldOut(p)
                        }}
                      >
                        {togglingSoldOut === p.id
                          ? 'Updating\u2026'
                          : p.soldOut
                            ? 'Mark back in stock'
                            : 'Mark sold out'}
                      </Button>
                    </div>
                    {/* Aliases from validated merges */}
                    {p.aliases.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="text-muted-foreground">Also known as:</span>
                        {p.aliases.map((a) => (
                          <Badge key={a} variant="outline" className="font-normal">{a}</Badge>
                        ))}
                      </div>
                    )}
                    {/* Open POs detail */}
                    {p.pos.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No open purchase orders for this product.</p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {p.pos.slice(0, 8).map((po) => (
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
                        {p.pos.length > 8 && (
                          <p className="text-xs text-muted-foreground">+{p.pos.length - 8} more in Purchase Orders</p>
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
