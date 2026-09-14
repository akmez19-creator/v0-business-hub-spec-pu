'use client'

// TYPE-only from catalog (erased at compile time, so no server code is bundled);
// the formatter comes from the client-safe module.
import type { ShopProduct } from '@/lib/shop/catalog'
import { priceLabel } from '@/lib/shop/format'
import { Check, Gift, MessageCircle, Plus } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useCart } from './cart-provider'
import { ProductMedia } from './product-media'

// Re-exported because several components already import priceLabel from here.
export { priceLabel }

export function ProductCard({
  product,
  index = 0,
  priority = false,
}: {
  product: ShopProduct
  index?: number
  priority?: boolean
}) {
  const { add } = useCart()
  const [added, setAdded] = useState(false)
  const sellable = !product.soldOut && !product.needsEnquiry
  // In stock, but no price on file - the customer can still start a chat.
  const enquire = !product.soldOut && product.needsEnquiry

  const onAdd = (e: React.MouseEvent) => {
    // The whole card is a link to the detail page; adding must not navigate.
    e.preventDefault()
    e.stopPropagation()
    add({
      id: product.id,
      name: product.name,
      image: product.image,
      stepPrice: product.fromPrice,
      minQty: product.minQty,
      offer: product.offer,
      stock: product.quantity,
    })
    setAdded(true)
    window.setTimeout(() => setAdded(false), 1400)
  }

  return (
    <Link
      href={`/shop/p/${product.id}`}
      className="shop-rise group relative flex flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}
    >
      <div className="relative aspect-square w-full overflow-hidden">
        <ProductMedia
          image={product.image}
          video={product.video}
          alt={product.name}
          priority={priority}
          className={`h-full w-full transition-transform duration-500 group-hover:scale-105 ${
            product.soldOut ? 'opacity-45 saturate-0' : ''
          }`}
        />

        {/* Offer badges. B1G1 gets the loud pink because it is the strongest
            hook in this catalog; quieter bundle/set labels stay on aqua. */}
        <div className="pointer-events-none absolute top-3 left-3 flex flex-col items-start gap-1.5">
          {product.isB1g1 && (
            <span
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold text-white shadow-md"
              style={{ backgroundColor: 'var(--shop-pink)' }}
            >
              <Gift className="h-3 w-3" aria-hidden="true" />
              Buy 1 Get 1
            </span>
          )}
          {!product.isB1g1 && product.offer && (
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-bold text-white shadow-md"
              style={{ backgroundColor: 'var(--shop-aqua)' }}
            >
              {product.offer}
            </span>
          )}
        </div>

        {product.soldOut && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="rounded-full bg-foreground/85 px-4 py-1.5 text-xs font-bold tracking-wide text-background uppercase">
              Sold out
            </span>
          </div>
        )}

        {sellable && (
          <button
            type="button"
            onClick={onAdd}
            aria-label={`Add ${product.name} to cart`}
            className="absolute right-3 bottom-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform duration-200 hover:scale-110 active:scale-95 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {added ? (
              <Check className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Plus className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
        )}

        {/* Unpriced items get a chat cue in the same spot the Add button would
            occupy, so the grid reads consistently. It is decorative here - the
            real WhatsApp link lives on the detail page this card opens. */}
        {enquire && (
          <span
            aria-hidden="true"
            className="absolute right-3 bottom-3 flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-secondary-foreground shadow-lg"
          >
            <MessageCircle className="h-5 w-5" />
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 p-3.5">
        <h3 className="line-clamp-2 text-sm leading-snug font-medium text-pretty">{product.name}</h3>
        <div className="mt-auto flex items-baseline gap-1.5 pt-1">
          <span className="font-display text-lg font-extrabold text-foreground">
            {priceLabel(product)}
          </span>
          {product.minQty > 1 && product.fromPrice > 0 && (
            <span className="text-[11px] text-muted-foreground">/ {product.minQty} pcs</span>
          )}
        </div>
      </div>
    </Link>
  )
}
