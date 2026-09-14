import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { ChevronLeft, Truck, Wallet } from 'lucide-react'
import { categorySlug, getProductPage, priceLabel } from '@/lib/shop/catalog'
import { ProductGallery } from '@/components/shop/product-gallery'
import { BuyPanel } from '@/components/shop/buy-panel'
import { ProductCard } from '@/components/shop/product-card'

export const revalidate = 300

type Props = { params: Promise<{ id: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const page = await getProductPage(id)
  if (!page) return { title: 'Product not found' }
  const { product } = page
  return {
    title: `${product.name} - Destockage By Moris`,
    description: `${product.name} - ${priceLabel(product)}. Delivered anywhere in Mauritius, pay cash on delivery.`,
    openGraph: { title: product.name, images: product.image ? [product.image] : [] },
  }
}

export default async function ProductPage({ params }: Props) {
  const { id } = await params
  const page = await getProductPage(id)
  if (!page) notFound()
  const { product, siblings } = page

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 sm:py-12">
      <Link
        href={`/shop/category/${categorySlug(product.category)}`}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        {product.category}
      </Link>

      <div className="mt-6 grid gap-10 lg:grid-cols-2 lg:gap-14">
        {/* `video` is a single clip, not a list - wrap it for the gallery. */}
        <ProductGallery
          name={product.name}
          images={product.images}
          videos={product.video ? [product.video] : []}
        />

        <div className="flex flex-col gap-6">
          <div>
            {product.offer && (
              <span className="inline-block rounded-full bg-[var(--shop-pink)] px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider text-white">
                {product.offer}
              </span>
            )}
            <h1 className="mt-3 font-display text-3xl font-extrabold leading-tight tracking-tight text-foreground text-balance sm:text-5xl">
              {product.name}
            </h1>
          </div>

          <div className="flex items-baseline gap-2">
            <p className="font-display text-4xl font-extrabold text-primary sm:text-5xl">
              {priceLabel(product)}
            </p>
            {product.minQty > 1 && product.fromPrice > 0 && (
              <span className="text-sm font-semibold text-muted-foreground">
                / {product.minQty} pcs
              </span>
            )}
          </div>

          <BuyPanel product={product} />

          <ul className="flex flex-col gap-2.5 border-t border-border pt-5">
            <li className="flex items-center gap-2.5 text-sm font-semibold text-foreground">
              <Truck className="h-4 w-4 shrink-0 text-accent" />
              Delivery all over Mauritius
            </li>
            <li className="flex items-center gap-2.5 text-sm font-semibold text-foreground">
              <Wallet className="h-4 w-4 shrink-0 text-accent" />
              Pay cash when your parcel arrives
            </li>
          </ul>
        </div>
      </div>

      {siblings.length > 0 && (
        <section className="mt-20">
          <h2 className="font-display text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
            More in {product.category}
          </h2>
          <div className="shop-rail -mx-4 mt-6 flex gap-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
            {siblings.map((p, i) => (
              <div key={p.id} className="w-[220px] shrink-0 sm:w-[250px]">
                <ProductCard product={p} index={i} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
