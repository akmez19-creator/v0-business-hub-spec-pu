'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  ExternalLink,
  FileText,
  Megaphone,
  Search,
  ShoppingCart,
  Sparkles,
  Tag,
  Users,
} from 'lucide-react'
import { ManagePosts } from '@/components/product-master/manage-posts'
import { BulkPosterDialog, type BulkProduct } from '@/components/product-master/bulk-poster-dialog'
import { mediaSrc } from '@/lib/media-url'

// A row tool click: which tool, for which product.
// 'reels' is the single entry point from the table - Studio covers titles,
// promo pricing, logo, publishing and the ad handoff. 'campaigns' is still
// reachable, but only as the "Boost this post" handoff out of Studio.
export interface ToolRequest {
  tool: 'reels' | 'campaigns' | 'poster'
  product: {
    id: string
    name: string
    image?: string | null
    /** List price from Product Master - the struck-out "was" */
    price?: number | string | null
    /** Promo price from Product Master - the highlighted "now" */
    promoPrice?: number | string | null
    /** Buy-one-get-one flag from inventory */
    isB1g1?: boolean | null
    /** Multi-buy tiers from inventory, e.g. {"2": 775} */
    bundlePrices?: Record<string, number | string> | null
  }
  /** Pre-selected page + post when arriving from "Boost this post" */
  boost?: { pageId: string; postId: string }
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
  // numeric columns can arrive as strings - always run them through toNum()
  price: number | string | null
  promo_price: number | string | null
  // Inventory offers - these, not promo_price, are what most products carry
  is_b1g1: boolean | null
  bundle_prices: Record<string, number | string> | null
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
  postsCount: number
  pos: PurchaseOrder[]
  aliases: string[]
}

const LOW_STOCK = 10

// Prices are Postgres `numeric`. supabase-js returns them as real numbers, but
// raw SQL clients serialize the same column as a string ("475.00"), so coerce
// before formatting or comparing instead of trusting typeof.
function toNum(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

type SortKey = 'name' | 'stock' | 'ads' | 'clday' | 'clwk' | 'pos' | 'posts' | 'status'
type SortDir = 'asc' | 'desc'

// Status severity for sorting: sold out first, then low stock, then inactive, then ok
function statusRank(p: OverviewProduct): number {
  if (p.soldOut) return 0
  if ((p.quantity ?? 0) <= LOW_STOCK) return 1
  if (!p.is_active) return 2
  return 3
}

function sortValue(p: OverviewProduct, key: SortKey): number | string {
  switch (key) {
    case 'name': return p.name.toLowerCase()
    case 'stock': return p.quantity ?? 0
    case 'ads': return p.activeAds
    case 'clday': return p.clientsPerDay
    case 'clwk': return p.clientsPerWeek
    case 'pos': return p.openPOs
    case 'posts': return p.postsCount
    case 'status': return statusRank(p)
  }
}

export function ProductsTab({ onOpenTool }: { onOpenTool?: (req: ToolRequest) => void }) {
  const { data, error, isLoading, mutate } = useSWR<{ success: boolean; products: OverviewProduct[] }>(
    '/api/product-master/overview',
    fetcher,
  )
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'low' | 'sold-out' | 'with-po' | 'advertised'>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [togglingSoldOut, setTogglingSoldOut] = useState<string | null>(null)
  const [savingPromo, setSavingPromo] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  // Manage Posts dialog - controlled so a Posts badge click can open it
  // pre-filtered to that product
  const [postsOpen, setPostsOpen] = useState(false)
  const [postsProductFilter, setPostsProductFilter] = useState('')
  // Bulk poster generation - tick rows, then generate a one-click post for each
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  // Snapshot the chosen products at launch so filtering/sorting the table
  // mid-run cannot change what the batch is working on
  const [bulkProducts, setBulkProducts] = useState<BulkProduct[]>([])

  // Click a column header to sort; click again to flip direction
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      // Numeric columns default to descending (biggest first), name/status ascending
      setSortDir(key === 'name' || key === 'status' ? 'asc' : 'desc')
    }
  }

  // Save the promo price for one product. Blank clears it, which puts the
  // product back to plain list-price branding in Studio.
  const savePromoPrice = async (product: OverviewProduct, raw: string) => {
    const trimmed = raw.trim()
    const next = trimmed === '' ? null : Number(trimmed)
    if (next !== null && (!Number.isFinite(next) || next < 0)) return
    // Compare as numbers so a string-shaped stored value still matches
    if (toNum(product.promo_price) === next) return

    setSavingPromo(product.id)
    try {
      await mutate(
        async (current) => {
          const res = await fetch('/api/product-master/overview', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: product.id, promoPrice: next }),
          })
          const json = await res.json()
          if (!res.ok || !json.success) throw new Error(json.error || 'Update failed')
          return current
            ? { ...current, products: current.products.map((p) => (p.id === product.id ? { ...p, promo_price: next } : p)) }
            : current
        },
        {
          optimisticData: (current) =>
            current
              ? { ...current, products: current.products.map((p) => (p.id === product.id ? { ...p, promo_price: next } : p)) }
              : (current as never),
          rollbackOnError: true,
          revalidate: false,
        },
      )
    } catch {
      // SWR rolls the optimistic value back on failure
    } finally {
      setSavingPromo(null)
    }
  }

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
    const dir = sortDir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      const va = sortValue(a, sortKey)
      const vb = sortValue(b, sortKey)
      if (va < vb) return -1 * dir
      if (va > vb) return 1 * dir
      return a.name.localeCompare(b.name)
    })
  }, [data, search, filter, sortKey, sortDir])

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Select-all acts on what is currently visible (search + filter), so ticking
  // it while a filter is on never quietly selects hidden rows.
  const visibleIds = filtered.map((p) => p.id)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))
  const toggleSelectAll = () =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id))
      else visibleIds.forEach((id) => next.add(id))
      return next
    })

  // Freeze the current selection into the batch, then open the dialog
  const startBulk = () => {
    const chosen = (data?.products || [])
      .filter((p) => selected.has(p.id))
      .map((p) => ({
        id: p.id,
        name: p.name,
        image: p.image_url,
        price: p.price,
        promoPrice: p.promo_price,
      }))
    if (chosen.length === 0) return
    setBulkProducts(chosen)
    setBulkOpen(true)
  }

  const selectedWithoutPhoto = (data?.products || []).filter(
    (p) => selected.has(p.id) && !(p.image_url && p.image_url.trim()),
  ).length

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
            <Link href="/dashboard/purchasing">
              Purchase Orders <ExternalLink className="ml-1 h-3 w-3" />
            </Link>
          </Button>
          <ManagePosts
            open={postsOpen}
            onOpenChange={(v) => {
              setPostsOpen(v)
              if (!v) setPostsProductFilter('')
            }}
            productFilter={postsProductFilter}
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="grid grid-cols-[28px_24px_1fr_80px_80px_72px_72px_70px_70px_96px] items-center gap-2 border-b px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span className="flex items-center justify-center">
              <input
                type="checkbox"
                className="h-4 w-4 cursor-pointer accent-fuchsia-500"
                checked={allVisibleSelected}
                onChange={toggleSelectAll}
                aria-label="Select all visible products"
                title="Select all visible products"
              />
            </span>
            <span />
            {(
              [
                ['name', 'Product', 'justify-start', 'Sort by product name'],
                ['stock', 'Stock', 'justify-end', 'Sort by stock level'],
                ['ads', 'Ads', 'justify-end', 'Sort by active ads'],
                ['clday', 'Cl/day', 'justify-end', 'Sort by clients today'],
                ['clwk', 'Cl/wk', 'justify-end', 'Sort by clients last 7 days'],
                ['pos', 'POs', 'justify-end', 'Sort by open purchase orders'],
                ['posts', 'Posts', 'justify-end', 'Sort by number of posts in the library'],
                ['status', 'Status', 'justify-end', 'Sort by status severity (sold out, low stock first)'],
              ] as const
            ).map(([key, label, align, title]) => (
              <button
                key={key}
                type="button"
                title={title}
                onClick={() => handleSort(key)}
                className={`flex items-center gap-1 ${align} uppercase tracking-wide transition-colors hover:text-foreground ${sortKey === key ? 'text-foreground' : ''}`}
              >
                {label}
                {sortKey === key ? (
                  sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                ) : (
                  <ArrowUpDown className="h-3 w-3 opacity-40" />
                )}
              </button>
            ))}
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
                  className="grid w-full cursor-pointer grid-cols-[28px_24px_1fr_80px_80px_72px_72px_70px_70px_96px] items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted/50"
                >
                  <span
                    className="flex items-center justify-center"
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer accent-fuchsia-500"
                      checked={selected.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                      aria-label={`Select ${p.name} for bulk posts`}
                    />
                  </span>
                  {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <span className="flex items-center gap-2 truncate">
                    {p.image_url ? (
                      // Supplier CDNs refuse browser requests, so those photos
                      // are streamed through the proxy instead.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={mediaSrc(p.image_url) || "/placeholder.svg"} alt="" className="h-7 w-7 shrink-0 rounded object-cover" />
                    ) : (
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-bold text-muted-foreground">
                        {p.name.slice(0, 1)}
                      </span>
                    )}
                    <span className="truncate font-medium">{p.name}</span>
                    {/* One entry point. Studio already covers the title, promo
                        price, logo, publishing and the boost-to-campaign
                        handoff, so the old four-icon strip was four doors into
                        the same room. */}
                    {onOpenTool && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-1 h-6 shrink-0 gap-1.5 px-2 text-[11px] font-medium text-sky-500 hover:bg-sky-500/10 hover:text-sky-400"
                        title={`Open Studio for ${p.name}`}
                        aria-label={`Open Studio for ${p.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpenTool({
                            tool: 'reels',
                            product: {
                              id: p.id,
                              name: p.name,
                              image: p.image_url,
                                    price: p.price,
                                    promoPrice: p.promo_price,
                                    isB1g1: p.is_b1g1,
                                    bundlePrices: p.bundle_prices,
                                  },
                          })
                        }}
                      >
                        <Clapperboard className="h-3.5 w-3.5" />
                        Studio
                      </Button>
                    )}
                    {/* Poster sits beside Studio rather than inside it: video
                        and still-image promos are separate jobs, and burying
                        one inside the other would hide it. */}
                    {onOpenTool && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 shrink-0 gap-1.5 px-2 text-[11px] font-medium text-fuchsia-400 hover:bg-fuchsia-500/10 hover:text-fuchsia-300"
                        title={`Generate a promo poster for ${p.name}`}
                        aria-label={`Generate a promo poster for ${p.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          onOpenTool({
                            tool: 'poster',
                            product: {
                              id: p.id,
                              name: p.name,
                              image: p.image_url,
                              price: p.price,
                              promoPrice: p.promo_price,
                              isB1g1: p.is_b1g1,
                              bundlePrices: p.bundle_prices,
                            },
                          })
                        }}
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        Poster
                      </Button>
                    )}
                  </span>
                  <span className="text-right">
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
                    {p.postsCount > 0 ? (
                      <span
                        role="button"
                        tabIndex={0}
                        title={`View ${p.postsCount} post(s) for ${p.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setPostsProductFilter(p.name)
                          setPostsOpen(true)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            e.stopPropagation()
                            setPostsProductFilter(p.name)
                            setPostsOpen(true)
                          }
                        }}
                        className="inline-flex cursor-pointer"
                      >
                        <Badge
                          variant="outline"
                          className="border-amber-500/40 bg-amber-500/10 text-amber-500 transition-colors hover:bg-amber-500/25"
                        >
                          <FileText className="mr-1 h-3 w-3" />
                          {p.postsCount}
                        </Badge>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{'\u2014'}</span>
                    )}
                  </span>
                  <span className="text-right">
                    {/* One structured status flag per row - severity drives sorting too */}
                    {p.soldOut ? (
                      <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-400">Sold out</Badge>
                    ) : qty <= LOW_STOCK ? (
                      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-500">Low stock</Badge>
                    ) : !p.is_active ? (
                      <Badge variant="secondary">Inactive</Badge>
                    ) : (
                      <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-500">In stock</Badge>
                    )}
                  </span>
                </div>
                {isOpen && (
                  <div className="flex flex-col gap-3 bg-muted/30 px-10 py-3">
                    {/* Pricing: the list price is read-only inventory data, the
                        promo price is set here and drives the Studio price tag */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Tag className="h-3 w-3" />
                        List price
                        <span className="font-semibold tabular-nums text-foreground">
                          {toNum(p.price) !== null ? `Rs ${toNum(p.price)!.toLocaleString('en-IN')}` : '\u2014'}
                        </span>
                      </span>
                      <label className="flex items-center gap-1.5 text-muted-foreground">
                        Promo price
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          defaultValue={p.promo_price ?? ''}
                          placeholder="none"
                          disabled={savingPromo === p.id}
                          onClick={(e) => e.stopPropagation()}
                          // Commit on blur / Enter rather than per keystroke,
                          // so typing "1200" is one write, not four
                          onBlur={(e) => savePromoPrice(p, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.currentTarget.blur()
                          }}
                          className="h-7 w-28 text-xs"
                          aria-label={`Promo price for ${p.name}`}
                        />
                      </label>
                      {(() => {
                        const list = toNum(p.price)
                        const promo = toNum(p.promo_price)
                        if (list === null || promo === null || list <= 0 || promo >= list) return null
                        return (
                          <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-500">
                            {Math.round(((list - promo) / list) * 100)}% off in Studio
                          </Badge>
                        )
                      })()}
                      {savingPromo === p.id && <span className="text-muted-foreground">Saving{'\u2026'}</span>}
                    </div>
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

      {/* Floating batch bar - only present once something is ticked */}
      {selected.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-full border border-border bg-card/95 px-4 py-2 shadow-lg backdrop-blur">
            <span className="text-sm font-medium tabular-nums">
              {selected.size} selected
            </span>
            {selectedWithoutPhoto > 0 && (
              <span className="text-xs text-amber-500">
                {selectedWithoutPhoto} without a photo will be skipped
              </span>
            )}
            <Button size="sm" onClick={startBulk}>
              <Sparkles className="mr-1.5 h-4 w-4" />
              Generate posts
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      <BulkPosterDialog open={bulkOpen} onOpenChange={setBulkOpen} products={bulkProducts} />
    </div>
  )
}
