'use client'

import { useMemo, useState } from 'react'
import { Tag, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { USD_TO_RS } from '@/lib/ads/currency'

export type AdvertisedProduct = {
  id: string
  name: string
  price: number | string | null
  image_url?: string | null
  bundle_prices?: Record<string, number | string> | null
  is_b1g1?: boolean | null
  sold_out?: boolean | null
  /** USD spend today across the product's campaigns. */
  spendToday: number
  activeCampaigns: number
  totalCampaigns: number
}

/** "Rs 475 | 2 for Rs 775" - the same shape agents type into the inbox. */
export function offerLine(p: Pick<AdvertisedProduct, 'price' | 'bundle_prices' | 'is_b1g1'>): string {
  const unit = Number.parseFloat(String(p.price ?? 0)) || 0
  const tiers = Object.entries(p.bundle_prices ?? {})
    .map(([n, v]) => ({ n: Number.parseInt(n, 10), price: Number.parseFloat(String(v)) }))
    .filter((t) => t.n > 0 && t.price > 0)
    .sort((a, b) => a.n - b.n)
  const parts: string[] = []
  if (unit > 0) parts.push(`Rs ${unit}${p.is_b1g1 ? ' (Buy 1 Get 1 Free)' : ''}`)
  for (const t of tiers) parts.push(`${t.n} for Rs ${t.price}`)
  return parts.length ? parts.join(' | ') : 'No price set'
}

export function AdvertisedPriceList({ products }: { products: AdvertisedProduct[] }) {
  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return products
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => b.spendToday - a.spendToday || a.name.localeCompare(b.name))
  }, [products, query])

  const spent = products.filter((p) => p.spendToday > 0).length
  const activeOnly = products.length - spent

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="bg-card">
          <Tag className="mr-2 h-4 w-4" aria-hidden="true" />
          Price list
          <Badge variant="secondary" className="ml-2 h-5 px-1.5 tabular-nums">{products.length}</Badge>
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle>Products on air today</SheetTitle>
          <SheetDescription>
            {spent} spending today{activeOnly ? `, ${activeOnly} active at Rs 0` : ''}. Prices are what the inbox quotes, so a mismatch with the ad copy shows up here.
          </SheetDescription>
          <div className="relative mt-2">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a product"
              aria-label="Find a product"
              className="h-9 pl-8"
            />
          </div>
        </SheetHeader>
        <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
          {rows.length === 0 ? (
            <li className="px-5 py-10 text-center text-sm text-muted-foreground">
              {products.length === 0 ? 'No linked product has a campaign spending or active today.' : 'No product matches.'}
            </li>
          ) : rows.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-5 py-3">
              {p.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.image_url} alt="" className="h-11 w-11 shrink-0 rounded-md border border-border object-cover" />
              ) : (
                <div className="h-11 w-11 shrink-0 rounded-md border border-dashed border-border bg-muted/40" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                  {p.sold_out ? <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">Sold out</Badge> : null}
                </div>
                <p className="mt-0.5 text-sm text-foreground/90">{offerLine(p)}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {p.activeCampaigns} active of {p.totalCampaigns} campaign{p.totalCampaigns === 1 ? '' : 's'}
                </p>
              </div>
              <div className="shrink-0 text-right">
                {p.spendToday > 0 ? (
                  <>
                    <p className="text-sm font-semibold tabular-nums">Rs {Math.round(p.spendToday * USD_TO_RS).toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">${p.spendToday.toFixed(2)} today</p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Active, Rs 0 yet</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  )
}
