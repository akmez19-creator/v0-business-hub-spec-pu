'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Menu, Search, ShoppingBag, X } from 'lucide-react'
import { useCart } from './cart-provider'

export function ShopHeader({
  categories,
  onOpenCart,
}: {
  categories: { name: string; slug: string }[]
  onOpenCart: () => void
}) {
  const { count, ready } = useCart()
  const [navOpen, setNavOpen] = useState(false)

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3 sm:gap-5 sm:px-6">
        <button
          type="button"
          onClick={() => setNavOpen((v) => !v)}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border text-foreground lg:hidden"
          aria-label={navOpen ? 'Close categories' : 'Open categories'}
          aria-expanded={navOpen}
        >
          {navOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>

        <Link href="/shop" className="shrink-0">
          <span className="block font-display text-lg font-extrabold leading-none tracking-tight text-foreground sm:text-xl">
            Destockage
          </span>
          <span className="block font-display text-[0.6rem] font-bold uppercase tracking-[0.28em] text-primary">
            By Moris
          </span>
        </Link>

        {/* A plain GET form: works without JS and produces a shareable URL */}
        <form action="/shop/search" className="relative ml-auto hidden max-w-sm flex-1 items-center md:flex">
          <Search className="pointer-events-none absolute left-4 h-4 w-4 text-muted-foreground" />
          <input
            name="q"
            placeholder="Search products..."
            className="h-11 w-full rounded-full border border-border bg-card pl-11 pr-4 text-sm text-foreground outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/15"
            aria-label="Search products"
          />
        </form>

        <button
          type="button"
          onClick={onOpenCart}
          className="relative ml-auto grid h-11 w-11 shrink-0 place-items-center rounded-full bg-foreground text-background transition hover:scale-105 md:ml-0"
          aria-label={`Open basket, ${count} item${count === 1 ? '' : 's'}`}
        >
          <ShoppingBag className="h-5 w-5" />
          {/* `ready` gates this: the count comes from localStorage, so drawing
              it before hydration would be a server/client mismatch. */}
          {ready && count > 0 && (
            <span className="absolute -right-1 -top-1 grid h-6 min-w-6 place-items-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground ring-2 ring-background">
              {count}
            </span>
          )}
        </button>
      </div>

      <nav
        className={`${navOpen ? 'block' : 'hidden'} border-t border-border lg:block`}
        aria-label="Product categories"
      >
        <div className="shop-rail mx-auto flex max-w-[1400px] gap-2 overflow-x-auto px-4 py-2.5 sm:px-6">
          <Link
            href="/shop"
            className="shrink-0 rounded-full bg-foreground px-4 py-2 text-xs font-bold text-background"
          >
            All
          </Link>
          {categories.map((c) => (
            <Link
              key={c.slug}
              href={`/shop/category/${c.slug}`}
              className="shrink-0 rounded-full border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground transition hover:border-primary hover:text-primary"
            >
              {c.name}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  )
}
