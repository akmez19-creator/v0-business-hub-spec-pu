import { ProductCard } from './product-card'
import type { ShopProduct } from '@/lib/shop/catalog'

export function ProductGrid({ products }: { products: ShopProduct[] }) {
  if (products.length === 0) {
    return (
      <p className="rounded-3xl border border-border bg-card px-6 py-16 text-center text-sm text-muted-foreground">
        Nothing here yet.
      </p>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {products.map((p, i) => (
        <ProductCard key={p.id} product={p} index={i} />
      ))}
    </div>
  )
}
