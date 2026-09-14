'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

export type CartLine = {
  id: string
  name: string
  image: string
  /** Price of ONE step (a unit, or a whole set for set-only products). */
  stepPrice: number
  /** Units per step. A set of 4 moves 4 at a time. */
  minQty: number
  offer: string
  /** Number of steps, not units. */
  steps: number
  /** Counted stock, so the cart can never exceed what is on the shelf. */
  stock: number
}

/**
 * Fired to pop the cart drawer open. The drawer's open state lives in
 * ShopChrome, so this travels as a DOM event instead of being threaded through
 * every page that renders a buy button. Declared here rather than in
 * shop-chrome so the emitter and the listener can both import it without
 * dragging the chrome component into a product page bundle.
 */
export const OPEN_CART_EVENT = 'shop:open-cart'

type CartCtx = {
  lines: CartLine[]
  add: (line: Omit<CartLine, 'steps'>, steps?: number) => void
  setSteps: (id: string, steps: number) => void
  remove: (id: string) => void
  clear: () => void
  count: number
  total: number
  ready: boolean
}

const Ctx = createContext<CartCtx | null>(null)

/**
 * The basket only. This is in-progress interface state, not the order record:
 * a submitted order is written to `deliveries` server-side by
 * /api/shop/order, which re-prices every line from the database.
 *
 * It survives a reload via localStorage because losing a half-built basket on
 * an accidental refresh is the single most annoying thing a shop can do. Prices
 * held here are for DISPLAY; they are never trusted at checkout.
 */
const KEY = 'dbm-shop-cart-v1'

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([])
  // Starts false so the server render and the first client render agree - the
  // badge cannot show a count until localStorage has actually been read, or
  // React reports a hydration mismatch.
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) setLines(parsed.filter((l) => l && l.id && l.steps > 0))
      }
    } catch {
      // Corrupt or unavailable storage must not take the whole shop down
    }
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    try {
      localStorage.setItem(KEY, JSON.stringify(lines))
    } catch {
      // Private mode / quota - the cart still works for this page view
    }
  }, [lines, ready])

  const add = useCallback((line: Omit<CartLine, 'steps'>, steps = 1) => {
    setLines((prev) => {
      const found = prev.find((l) => l.id === line.id)
      // Steps are capped by real stock: a set of 4 with 10 counted units can
      // only ship 2 whole sets.
      const maxSteps = Math.max(1, Math.floor(Math.max(0, line.stock) / Math.max(1, line.minQty)))
      if (found) {
        return prev.map((l) =>
          l.id === line.id ? { ...l, steps: Math.min(maxSteps, l.steps + steps) } : l,
        )
      }
      return [...prev, { ...line, steps: Math.min(maxSteps, Math.max(1, steps)) }]
    })
  }, [])

  const setStepsFor = useCallback((id: string, steps: number) => {
    setLines((prev) =>
      prev.flatMap((l) => {
        if (l.id !== id) return [l]
        const maxSteps = Math.max(1, Math.floor(Math.max(0, l.stock) / Math.max(1, l.minQty)))
        const next = Math.min(maxSteps, Math.round(steps))
        return next <= 0 ? [] : [{ ...l, steps: next }]
      }),
    )
  }, [])

  const remove = useCallback((id: string) => {
    setLines((prev) => prev.filter((l) => l.id !== id))
  }, [])

  const clear = useCallback(() => setLines([]), [])

  const value = useMemo<CartCtx>(() => {
    return {
      lines,
      add,
      setSteps: setStepsFor,
      remove,
      clear,
      // Units, which is what a shopper counts - not steps.
      count: lines.reduce((s, l) => s + l.steps * l.minQty, 0),
      total: lines.reduce((s, l) => s + l.steps * l.stepPrice, 0),
      ready,
    }
  }, [lines, add, setStepsFor, remove, clear, ready])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useCart(): CartCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useCart must be used inside CartProvider')
  return ctx
}
