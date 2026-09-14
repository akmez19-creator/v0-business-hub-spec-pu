import Link from 'next/link'
import { ArrowRight, Sparkles, Truck, Wallet } from 'lucide-react'
import { getShopHome } from '@/lib/shop/catalog'
import { ProductCard } from '@/components/shop/product-card'

// The catalog changes when stock moves, so revalidate rather than build once.
export const revalidate = 300

export default async function ShopPage() {
  const { deals, lanes, categories, total } = await getShopHome()

  return (
    <div>
      {/* ── Hero. One signature element: the giant type + live counts. ── */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="mx-auto max-w-[1400px] px-4 py-14 sm:px-6 sm:py-20">
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--shop-ink)] px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-background">
            <Sparkles className="h-3.5 w-3.5" />
            Destockage Mauritius
          </span>

          <h1 className="mt-6 max-w-4xl font-display text-5xl font-extrabold leading-[0.95] tracking-tight text-foreground text-balance sm:text-7xl lg:text-8xl">
            {total} deals.
            <br />
            <span className="text-primary">Delivered to your door.</span>
          </h1>

          <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Household, kitchen, tools and gadgets at destockage prices. Order online, pay cash when it
            arrives.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="#catalogue"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-7 py-3.5 text-sm font-bold text-primary-foreground transition hover:scale-[1.03]"
            >
              Browse the catalogue
              <ArrowRight className="h-4 w-4" />
            </Link>
            {deals.length > 0 && (
              <Link
                href="/shop/deals"
                className="inline-flex items-center gap-2 rounded-full border-2 border-foreground px-7 py-3.5 text-sm font-bold text-foreground transition hover:bg-foreground hover:text-background"
              >
                See {deals.length} special offers
              </Link>
            )}
          </div>

          {/* Trust strip - the two things that actually decide a purchase here */}
          <div className="mt-12 flex flex-wrap gap-x-8 gap-y-3">
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
              <Truck className="h-4 w-4 text-accent" />
              Delivery all over Mauritius
            </span>
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
              <Wallet className="h-4 w-4 text-accent" />
              Pay cash on delivery
            </span>
          </div>
        </div>
      </section>

      {/* ── Special offers ── */}
      {deals.length > 0 && (
        <section className="border-b border-border bg-card">
          <div className="mx-auto max-w-[1400px] px-4 py-12 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="font-display text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
                  Special offers
                </h2>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Buy-one-get-one and multi-buy prices
                </p>
              </div>
              <Link
                href="/shop/deals"
                className="inline-flex items-center gap-1.5 text-sm font-bold text-primary hover:underline"
              >
                All offers
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="shop-rail -mx-4 mt-7 flex gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
              {deals.slice(0, 12).map((p, i) => (
                <div key={p.id} className="w-[260px] shrink-0 sm:w-[280px]">
                  <ProductCard product={p} index={i} />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Category lanes: the catalog "spread". Each is one horizontal lane
             so 19 categories stay scannable instead of one endless grid. ── */}
      <section id="catalogue" className="mx-auto max-w-[1400px] px-4 py-12 sm:px-6">
        <h2 className="font-display text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl">
          Shop by category
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {categories.length} categories, {total} products in stock
        </p>

        <div className="mt-10 flex flex-col gap-14">
          {lanes.map((lane) => (
            <div key={lane.category}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                  {lane.category}
                  <span className="ml-2.5 align-middle text-xs font-semibold text-muted-foreground">
                    {lane.count}
                  </span>
                </h3>
                {/* Slug, not the raw name: the category page resolves by slug,
                    and "Tools & Hardware" would break as a path segment. */}
                <Link
                  href={`/shop/category/${lane.slug}`}
                  className="inline-flex items-center gap-1.5 text-sm font-bold text-primary hover:underline"
                >
                  See all
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="shop-rail -mx-4 mt-5 flex gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
                {lane.products.map((p, i) => (
                  <div key={p.id} className="w-[220px] shrink-0 sm:w-[250px]">
                    <ProductCard product={p} index={i} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
