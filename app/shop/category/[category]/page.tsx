import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCategoryPage } from '@/lib/shop/catalog'
import { ProductGrid } from '@/components/shop/product-grid'

export const revalidate = 300

// Next 16: params is a promise and must be awaited.
// The segment is a SLUG ("tools-hardware"), not the display name - "Tools &
// Hardware" would not survive as a path segment.
type Props = { params: Promise<{ category: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category } = await params
  const page = await getCategoryPage(category)
  if (!page) return { title: 'Category not found - Destockage By Moris' }
  return {
    title: `${page.name} - Destockage By Moris`,
    description: `Browse ${page.name} at destockage prices in Mauritius. Delivered island-wide, pay cash on delivery.`,
  }
}

export default async function CategoryPage({ params }: Props) {
  const { category } = await params

  // Resolved against the real category list, so an unknown slug 404s rather
  // than rendering a convincing but empty shelf.
  const page = await getCategoryPage(category)
  if (!page) notFound()

  const available = page.products.filter((p) => !p.soldOut).length
  const soldOut = page.products.length - available

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 sm:py-14">
      <Link
        href="/shop"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        All categories
      </Link>

      <h1 className="mt-5 font-display text-4xl font-extrabold tracking-tight text-foreground text-balance sm:text-6xl">
        {page.name}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {available} available
        {soldOut > 0 ? ` · ${soldOut} sold out` : ''}
      </p>

      <div className="mt-9">
        <ProductGrid products={page.products} />
      </div>
    </div>
  )
}
