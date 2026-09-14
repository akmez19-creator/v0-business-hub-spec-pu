'use client'

import { useEffect, useState } from 'react'
import { ShopHeader } from './shop-header'
import { CartDrawer } from './cart-drawer'
import { OPEN_CART_EVENT } from './cart-provider'

/**
 * Holds the one piece of state the header and the drawer must agree on.
 * Keeping it here means the layout stays a server component and the category
 * list is still fetched on the server.
 */
export function ShopChrome({
  categories,
  children,
}: {
  categories: { name: string; slug: string }[]
  children: React.ReactNode
}) {
  const [cartOpen, setCartOpen] = useState(false)

  // Buy buttons live deep inside pages and cannot reach this state directly,
  // so they announce the intent and the owner of the state reacts.
  useEffect(() => {
    const open = () => setCartOpen(true)
    window.addEventListener(OPEN_CART_EVENT, open)
    return () => window.removeEventListener(OPEN_CART_EVENT, open)
  }, [])

  return (
    <>
      <ShopHeader categories={categories} onOpenCart={() => setCartOpen(true)} />
      <main>{children}</main>
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
      <footer className="mt-20 border-t border-border bg-card">
        <div className="mx-auto max-w-[1400px] px-6 py-12">
          <p className="font-display text-2xl font-extrabold tracking-tight text-foreground">
            Destockage By Moris
          </p>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            Delivery all over Mauritius. Order online and pay cash when your parcel arrives &mdash; no
            card needed.
          </p>
        </div>
      </footer>
    </>
  )
}
