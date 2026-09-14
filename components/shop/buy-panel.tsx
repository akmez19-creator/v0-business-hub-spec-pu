'use client'

import { useState } from 'react'
import { Check, MessageCircle, Minus, Plus, ShoppingBag } from 'lucide-react'
import { OPEN_CART_EVENT, useCart } from './cart-provider'
import { WHATSAPP_DISPLAY, whatsappEnquiryUrl } from '@/lib/shop/config'
import type { ShopProduct } from '@/lib/shop/catalog'

export function BuyPanel({ product }: { product: ShopProduct }) {
  // The cart holds lines only - the drawer's open state lives in ShopChrome.
  // Opening it is a one-off signal, so it travels as a DOM event instead of
  // being threaded through every page that renders a buy panel.
  const { add } = useCart()

  // STEPS, not units. A "set of 4" moves 4 units per step, so counting steps
  // is the only way the quantity control and the server price agree.
  const [steps, setSteps] = useState(1)
  const [added, setAdded] = useState(false)

  const unitsPerStep = Math.max(1, product.minQty)
  // Never offer more than is on the shelf, measured in whole steps.
  const maxSteps = Math.max(1, Math.floor(product.quantity / unitsPerStep))
  const units = steps * unitsPerStep

  // 403 in-stock products have no price on file. Selling those at Rs 0 has
  // already reached live orders once, so they are shown but never purchasable.
  // The flag is computed in the catalog so the card, this panel and the order
  // route cannot drift apart about what is buyable.
  const priced = !product.needsEnquiry

  const onAdd = () => {
    add(
      {
        id: product.id,
        name: product.name,
        image: product.image,
        stepPrice: product.fromPrice,
        minQty: unitsPerStep,
        offer: product.offer,
        stock: product.quantity,
      },
      steps,
    )
    setAdded(true)
    window.dispatchEvent(new Event(OPEN_CART_EVENT))
    window.setTimeout(() => setAdded(false), 1800)
  }

  if (product.soldOut) {
    return (
      <div className="rounded-3xl border border-border bg-muted px-6 py-5">
        <p className="font-display text-lg font-bold text-foreground">Sold out</p>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          This one has gone. Message us and we will tell you when it is back.
        </p>
      </div>
    )
  }

  if (!priced) {
    return (
      <div className="flex flex-col gap-3 rounded-3xl border border-border bg-secondary px-6 py-5">
        {/* No heading here: the page already prints "Price on request" as the
            price, so repeating it just pushed the button down the page. */}
        <p className="text-sm leading-relaxed text-muted-foreground">
          We have {product.quantity} in stock. Send us a message and we will quote you
          straight away.
        </p>
        {/* The product name travels in the message, so the customer never has to
            describe the item - that friction is the whole reason this exists. */}
        <a
          href={whatsappEnquiryUrl(product.name, product.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-7 py-3.5 text-sm font-bold text-primary-foreground transition hover:brightness-110"
        >
          <MessageCircle className="h-5 w-5" />
          Ask the price on WhatsApp
        </a>
        <p className="text-center text-xs text-muted-foreground">{WHATSAPP_DISPLAY}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {product.offer && (
        <div className="rounded-3xl border-2 border-dashed border-accent/50 bg-accent/5 p-4">
          <p className="text-xs font-bold tracking-[0.16em] text-accent uppercase">Offer</p>
          <p className="mt-1.5 font-display text-lg font-bold text-foreground">{product.offer}</p>
          {unitsPerStep > 1 && (
            <p className="mt-1 text-sm text-muted-foreground">
              Sold in sets of {unitsPerStep} — Rs{' '}
              {Math.round(product.fromPrice).toLocaleString('en-US')} per set.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1">
          <button
            type="button"
            onClick={() => setSteps((s) => Math.max(1, s - 1))}
            disabled={steps <= 1}
            className="grid h-10 w-10 place-items-center rounded-full text-foreground transition hover:bg-muted disabled:opacity-35"
            aria-label="Decrease quantity"
          >
            <Minus className="h-4 w-4" />
          </button>
          <span
            className="min-w-10 text-center font-display text-lg font-bold text-foreground"
            aria-live="polite"
          >
            {steps}
          </span>
          <button
            type="button"
            onClick={() => setSteps((s) => Math.min(maxSteps, s + 1))}
            disabled={steps >= maxSteps}
            className="grid h-10 w-10 place-items-center rounded-full text-foreground transition hover:bg-muted disabled:opacity-35"
            aria-label="Increase quantity"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={onAdd}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-primary px-7 py-3.5 text-sm font-bold text-primary-foreground transition hover:brightness-110"
        >
          {added ? <Check className="h-5 w-5" /> : <ShoppingBag className="h-5 w-5" />}
          {added
            ? 'Added to basket'
            : `Add to basket · Rs ${Math.round(product.fromPrice * steps).toLocaleString('en-US')}`}
        </button>
      </div>

      {unitsPerStep > 1 && (
        <p className="text-xs font-medium text-muted-foreground">
          That is {units} {units === 1 ? 'piece' : 'pieces'} in total.
        </p>
      )}

      {product.quantity <= 10 && (
        <p className="text-xs font-bold text-destructive">
          Only {product.quantity} left in stock
        </p>
      )}
    </div>
  )
}
