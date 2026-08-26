'use client'

import { useState, useEffect, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ProductThumb } from '@/components/ui/product-thumb'
import { Search, Loader2, PackageSearch } from 'lucide-react'
import { searchCatalogue, type CatalogueItem } from '@/lib/agent-catalogue'
import { RESULT_CAP } from '@/lib/products/categories'

interface CategoryCount {
  name: string
  count: number
}

/** Below this an agent sees the real number; above it, only that there is plenty. */
const SHOW_EXACT_BELOW = 50

interface Stock {
  label: string
  tone: 'good' | 'low' | 'bad' | 'unknown'
}

/**
 * What an agent may safely promise.
 *
 * quantity arrives as null when the product has NEVER been counted. That is not
 * the same as "none left" - verified on live data, no product has ever been
 * counted to a genuine zero - so it must read as unknown, never as sold out.
 * Telling an agent a stocked product is finished loses a sale just as surely as
 * promising one that is gone.
 */
function stockOf(p: CatalogueItem): Stock {
  if (p.sold_out) return { label: 'Sold out', tone: 'bad' }
  if (p.quantity === null) return { label: 'Stock not counted', tone: 'unknown' }
  if (p.quantity < SHOW_EXACT_BELOW) {
    return { label: `${p.quantity} left`, tone: p.quantity <= 5 ? 'low' : 'good' }
  }
  return { label: 'Over 50 in stock', tone: 'good' }
}

const TONE: Record<Stock['tone'], string> = {
  good: 'bg-success/15 text-success border-success/30',
  low: 'bg-warning/15 text-warning border-warning/30',
  bad: 'bg-destructive/15 text-destructive border-destructive/30',
  unknown: 'bg-muted text-muted-foreground border-border',
}

function chipClass(active: boolean): string {
  return [
    'shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors',
    active
      ? 'border-primary bg-primary text-primary-foreground'
      : 'border-border bg-card text-muted-foreground hover:text-foreground',
  ].join(' ')
}

export function AgentCatalogue({ categories }: { categories: CategoryCount[] }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [items, setItems] = useState<CatalogueItem[]>([])
  const [fallback, setFallback] = useState(false)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)

  // Debounced so a fast typist does not fire a query per keystroke, and
  // sequence-guarded so a slow early response cannot overwrite a later one.
  useEffect(() => {
    const id = seq.current + 1
    seq.current = id
    setLoading(true)
    const t = setTimeout(async () => {
      const res = await searchCatalogue(query, category)
      if (seq.current === id) {
        setItems(res.results)
        setFallback(res.fallback)
        setLoading(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [query, category])

  return (
    <div className="flex flex-col gap-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a product by name"
          className="pl-9"
          autoFocus
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Browsing beats searching when the customer says "what soap do you
          have?" rather than naming a product. Horizontally scrollable so the
          list never eats the screen on a phone. */}
      {categories.length > 0 && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          <button
            type="button"
            onClick={() => setCategory(null)}
            className={chipClass(category === null)}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => setCategory(c.name === category ? null : c.name)}
              className={chipClass(category === c.name)}
            >
              {c.name}
              <span className="ml-1 opacity-60">{c.count}</span>
            </button>
          ))}
        </div>
      )}

      {!loading && !items.length && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <PackageSearch className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {query
                ? `Nothing matches "${query}"${category ? ` in ${category}` : ''}.`
                : 'No products in this category.'}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Unlabelled near-misses are worse than none: an agent skims the grid,
          sees products, and quotes one that is not what the customer asked
          for. Naming the miss keeps the judgement with the person. */}
      {fallback && (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2">
          <p className="text-sm text-warning">
            No exact match for &quot;{query}&quot;. Showing related products - check the names
            before quoting.
          </p>
        </div>
      )}

      {/* The query is capped, and a silently truncated list is how an agent
          concludes a product does not exist. Say so, and say what to do. */}
      {items.length >= RESULT_CAP && (
        <p className="text-xs text-muted-foreground">
          Showing the first {RESULT_CAP}. Pick a category or search by name to narrow it down.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {items.map((p) => {
          const stock = stockOf(p)
          return (
            <Card key={p.id} className="overflow-hidden">
              <CardContent className="flex gap-3 p-3">
                <ProductThumb
                  src={p.image_url}
                  alt={p.name}
                  className="h-20 w-20 shrink-0 rounded-md border border-border object-cover"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex flex-col gap-0.5">
                    {p.category && (
                      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {p.category}
                      </span>
                    )}
                    <p className="text-pretty text-sm font-medium leading-snug">{p.name}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* 622 products have no price set. Printing "Rs 0" would
                        invite an agent to give the thing away. */}
                    {p.price === null ? (
                      <span className="text-sm text-warning">Price not set - ask before quoting</span>
                    ) : (
                      <span className="text-sm font-semibold">Rs {p.price}</span>
                    )}
                    {p.is_b1g1 && (
                      <Badge variant="outline" className="border-primary/40 text-primary">
                        Buy 1 Get 1
                      </Badge>
                    )}
                  </div>

                  {p.bundle_text && (
                    <p className="text-xs text-muted-foreground">Offer: {p.bundle_text}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className={TONE[stock.tone]}>
                      {stock.label}
                    </Badge>
                    {/* A sold-out product with 5,000 units on the water is a
                        "not yet", not a "no" - the agent can still take a name. */}
                    {p.incoming > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {p.incoming} more arriving
                      </span>
                    )}
                  </div>

                  {p.variants.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {p.variants.map((v) => (
                        <span
                          key={v.value}
                          className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground"
                        >
                          {v.value}
                          {v.quantity != null && v.quantity > 0
                            ? ` - ${v.quantity < SHOW_EXACT_BELOW ? v.quantity : '50+'}`
                            : ''}
                          {v.price ? ` - Rs ${v.price}` : ''}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
