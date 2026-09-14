import type { Metadata } from 'next'
import { getDeals } from '@/lib/shop/catalog'
import { ProductGrid } from '@/components/shop/product-grid'

export const revalidate = 300

export const metadata: Metadata = {
  title: 'Special offers - Destockage By Moris',
  description: 'Buy-one-get-one free and multi-buy deals in Mauritius, delivered to your door.',
}

export default async function DealsPage() {
  const deals = await getDeals()

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="font-display text-4xl font-extrabold tracking-tight text-foreground text-balance sm:text-6xl">
        Special offers
      </h1>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
        Buy-one-get-one free and multi-buy prices. The more you take, the cheaper each one gets.
      </p>

      <div className="mt-9">
        <ProductGrid products={deals} />
      </div>
    </div>
  )
}
