import type { Metadata } from 'next'
import { Outfit } from 'next/font/google'
import { CartProvider } from '@/components/shop/cart-provider'
import { ShopChrome } from '@/components/shop/shop-chrome'
import { getCategoryList } from '@/lib/shop/catalog'

// Loaded here rather than in the root layout so the dashboard never pays for
// a font only the storefront uses.
const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit', display: 'swap' })

export const metadata: Metadata = {
  title: 'Destockage By Moris - Catalogue',
  description:
    'Browse hundreds of household, kitchen, tools and gadget deals in Mauritius. Delivery island-wide, pay cash on delivery.',
  openGraph: {
    title: 'Destockage By Moris - Catalogue',
    description: 'Hundreds of deals in Mauritius. Delivered to your door, pay on delivery.',
    type: 'website',
  },
}

export const viewport = {
  themeColor: '#FFFBF3',
}

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  const categories = await getCategoryList()

  return (
    // .shop-theme keeps the bright palette scoped to this subtree; the dark
    // dashboard theme on :root is untouched.
    <div className={`shop-theme min-h-screen font-sans ${outfit.variable}`}>
      <CartProvider>
        {/* Header + drawer share one open/close state, so they live together
            in a client component rather than being lifted into this RSC. */}
        <ShopChrome categories={categories.map((c) => ({ name: c.name, slug: c.slug }))}>
          {children}
        </ShopChrome>
      </CartProvider>
    </div>
  )
}
