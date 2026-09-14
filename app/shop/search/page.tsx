import type { Metadata } from 'next'
import { searchProducts } from '@/lib/shop/catalog'
import { ProductGrid } from '@/components/shop/product-grid'

export const metadata: Metadata = {
  title: 'Search - Destockage By Moris',
}

// Next 16: searchParams is a promise and must be awaited.
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q = '' } = await searchParams
  const query = q.trim()
  const products = query ? await searchProducts(query) : []

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="font-display text-3xl font-extrabold tracking-tight text-foreground sm:text-5xl">
        {query ? `"${query}"` : 'Search'}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {query
          ? `${products.length} result${products.length === 1 ? '' : 's'}`
          : 'Type a product name in the search box above.'}
      </p>

      {query && (
        <div className="mt-9">
          <ProductGrid products={products} />
        </div>
      )}
    </div>
  )
}
