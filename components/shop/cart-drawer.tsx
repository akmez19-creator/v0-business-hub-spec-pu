'use client'

import { shopMedia } from '@/lib/shop/media'
import { Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react'
import Link from 'next/link'
import { useCart } from './cart-provider'

export function CartDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { lines, setSteps, remove, total, count } = useCart()

  return (
    <>
      {/* Backdrop. aria-hidden + a real button underneath keeps the overlay
          out of the accessibility tree while still being clickable. */}
      <div
        className={`fixed inset-0 z-40 bg-foreground/40 backdrop-blur-sm transition-opacity duration-300 ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Shopping cart"
        className={`fixed top-0 right-0 z-50 flex h-full w-full max-w-md flex-col bg-card shadow-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-display flex items-center gap-2 text-lg font-extrabold">
            <ShoppingBag className="h-5 w-5" aria-hidden="true" />
            Your cart
            {count > 0 && <span className="text-sm font-normal text-muted-foreground">({count})</span>}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close cart"
            className="rounded-full p-2 transition-colors hover:bg-muted"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        {lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
              <ShoppingBag className="h-9 w-9 text-muted-foreground" aria-hidden="true" />
            </div>
            <p className="font-display text-lg font-bold">Nothing here yet</p>
            <p className="text-sm text-muted-foreground">
              Add something you like and it will show up here.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Keep browsing
            </button>
          </div>
        ) : (
          <>
            <ul className="flex-1 divide-y divide-border overflow-y-auto px-5">
              {lines.map((l) => {
                const maxSteps = Math.max(1, Math.floor(l.stock / Math.max(1, l.minQty)))
                return (
                  <li key={l.id} className="flex gap-3 py-4">
                    <img
                      src={shopMedia(l.image) || '/placeholder.svg'}
                      alt={l.name}
                      className="h-20 w-20 flex-shrink-0 rounded-2xl object-cover"
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <p className="line-clamp-2 text-sm font-medium">{l.name}</p>
                      {l.minQty > 1 && (
                        <p className="text-[11px] text-muted-foreground">
                          Sold in {l.minQty}s &middot; {l.steps * l.minQty} pcs
                        </p>
                      )}
                      <div className="mt-auto flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1 rounded-full border border-border">
                          <button
                            type="button"
                            onClick={() => setSteps(l.id, l.steps - 1)}
                            aria-label={`Reduce quantity of ${l.name}`}
                            className="rounded-full p-1.5 transition-colors hover:bg-muted"
                          >
                            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                          <span className="min-w-6 text-center text-sm font-semibold">{l.steps}</span>
                          <button
                            type="button"
                            onClick={() => setSteps(l.id, l.steps + 1)}
                            disabled={l.steps >= maxSteps}
                            aria-label={`Increase quantity of ${l.name}`}
                            className="rounded-full p-1.5 transition-colors hover:bg-muted disabled:opacity-30"
                          >
                            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                        <span className="font-display text-sm font-extrabold">
                          Rs {Math.round(l.steps * l.stepPrice).toLocaleString('en-US')}
                        </span>
                        <button
                          type="button"
                          onClick={() => remove(l.id)}
                          aria-label={`Remove ${l.name}`}
                          className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                      {l.steps >= maxSteps && (
                        <p className="text-[11px] text-muted-foreground">
                          That is all we have in stock
                        </p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>

            <footer className="border-t border-border px-5 py-4">
              <div className="mb-3 flex items-baseline justify-between">
                <span className="text-sm text-muted-foreground">Total</span>
                <span className="font-display text-2xl font-extrabold">
                  Rs {Math.round(total).toLocaleString('en-US')}
                </span>
              </div>
              <p className="mb-3 text-[11px] text-muted-foreground">
                Delivery is arranged after we confirm your order by phone.
              </p>
              <Link
                href="/shop/checkout"
                onClick={onClose}
                className="flex w-full items-center justify-center rounded-full bg-primary px-6 py-3.5 font-display font-bold text-primary-foreground transition-transform hover:scale-[1.02] active:scale-95"
              >
                Checkout
              </Link>
            </footer>
          </>
        )}
      </aside>
    </>
  )
}
