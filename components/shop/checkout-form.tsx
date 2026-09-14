'use client'

import Link from 'next/link'
import { useState } from 'react'
import useSWR from 'swr'
import { CheckCircle2, Loader2, ShoppingBag } from 'lucide-react'
import { useCart } from './cart-provider'
import { shopMedia } from '@/lib/shop/media'

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function CheckoutForm() {
  const { lines, total: subtotal, clear } = useCart()
  // SWR, not fetch-in-useEffect
  const { data } = useSWR<{ localities: { name: string; district: string }[] }>(
    '/api/shop/localities',
    fetcher,
  )
  const localities = data?.localities ?? []

  const [form, setForm] = useState({ name: '', phone: '', locality: '', address: '', notes: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ orderCode: string | null; total: number } | null>(null)

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/shop/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Only ids + quantities. The server prices the order.
        body: JSON.stringify({
          ...form,
          // The cart counts STEPS; the server prices in UNITS. A set of 4 at
          // 2 steps is 8 units - sending steps here would under-order and let
          // priceFor() charge a single-unit price for a whole set.
          items: lines.map((l) => ({ id: l.id, qty: l.steps * l.minQty })),
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not place your order')
      setDone({ orderCode: json.orderCode ?? null, total: json.total ?? 0 })
      clear()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not place your order')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-lg rounded-[2rem] border border-border bg-card px-6 py-14 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-accent" />
        <h1 className="mt-5 font-display text-3xl font-extrabold tracking-tight text-foreground">
          Order received
        </h1>
        {done.orderCode && (
          <p className="mt-3 text-sm text-muted-foreground">
            Your reference is{' '}
            <span className="font-mono font-bold text-foreground">{done.orderCode}</span>
          </p>
        )}
        <p className="mt-1.5 font-display text-2xl font-bold text-primary">
          Rs {done.total.toLocaleString()}
        </p>
        <p className="mx-auto mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
          We will call you to confirm the delivery day. Pay cash when your parcel arrives.
        </p>
        <Link
          href="/shop"
          className="mt-7 inline-flex rounded-full bg-primary px-7 py-3.5 text-sm font-bold text-primary-foreground"
        >
          Keep shopping
        </Link>
      </div>
    )
  }

  if (lines.length === 0) {
    return (
      <div className="mx-auto max-w-lg rounded-[2rem] border border-border bg-card px-6 py-14 text-center">
        <ShoppingBag className="mx-auto h-12 w-12 text-muted-foreground" />
        <p className="mt-4 font-display text-xl font-bold text-foreground">Your basket is empty</p>
        <Link
          href="/shop"
          className="mt-6 inline-flex rounded-full bg-primary px-7 py-3.5 text-sm font-bold text-primary-foreground"
        >
          Browse the catalogue
        </Link>
      </div>
    )
  }

  const field =
    'h-12 w-full rounded-2xl border border-border bg-card px-4 text-sm text-foreground outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/15'

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_380px]">
      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <label htmlFor="co-name" className="text-sm font-bold text-foreground">
            Your name
          </label>
          <input id="co-name" required value={form.name} onChange={set('name')} className={field} />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label htmlFor="co-phone" className="text-sm font-bold text-foreground">
              Phone
            </label>
            <input
              id="co-phone"
              required
              inputMode="numeric"
              placeholder="5xxx xxxx"
              value={form.phone}
              onChange={set('phone')}
              className={field}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="co-locality" className="text-sm font-bold text-foreground">
              Locality
            </label>
            <select
              id="co-locality"
              required
              value={form.locality}
              onChange={set('locality')}
              className={field}
            >
              <option value="">Choose&hellip;</option>
              {localities.map((l) => (
                <option key={l.name} value={l.name}>
                  {l.name} ({l.district})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="co-address" className="text-sm font-bold text-foreground">
            Address
          </label>
          <input
            id="co-address"
            required
            placeholder="Street, house number, landmark"
            value={form.address}
            onChange={set('address')}
            className={field}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="co-notes" className="text-sm font-bold text-foreground">
            Notes <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input id="co-notes" value={form.notes} onChange={set('notes')} className={field} />
        </div>

        {error && (
          <p role="alert" className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-semibold text-destructive">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-14 items-center justify-center gap-2 rounded-full bg-primary px-8 text-base font-bold text-primary-foreground transition hover:scale-[1.02] disabled:opacity-60"
        >
          {busy && <Loader2 className="h-5 w-5 animate-spin" />}
          {/* Plain "..." - an HTML entity inside a JS string renders literally */}
          {busy ? 'Placing your order...' : `Place order · Rs ${subtotal.toLocaleString()}`}
        </button>

        <p className="text-xs leading-relaxed text-muted-foreground">
          No payment now. We call you to confirm the delivery day and you pay cash when the parcel
          arrives.
        </p>
      </form>

      {/* Order summary */}
      <aside className="h-fit rounded-[2rem] border border-border bg-card p-6 lg:sticky lg:top-28">
        <h2 className="font-display text-lg font-bold text-foreground">Your basket</h2>
        <ul className="mt-4 flex flex-col gap-4">
          {lines.map((l) => (
            <li key={l.id} className="flex gap-3">
              <img
                src={shopMedia(l.image) || '/placeholder.svg?height=56&width=56'}
                alt=""
                className="h-14 w-14 shrink-0 rounded-xl bg-muted object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
                  {l.name}
                </p>
                {/* Show real units so "2 sets" never reads as "2 pieces". */}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {l.steps * l.minQty} {l.steps * l.minQty === 1 ? 'pc' : 'pcs'} · Rs{' '}
                  {l.stepPrice.toLocaleString()}
                  {l.minQty > 1 ? ` / ${l.minQty}` : ''}
                </p>
              </div>
              <p className="text-sm font-bold text-foreground">
                Rs {(l.steps * l.stepPrice).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex items-baseline justify-between border-t border-border pt-5">
          <span className="text-sm font-bold text-foreground">Total</span>
          <span className="font-display text-2xl font-extrabold text-primary">
            Rs {subtotal.toLocaleString()}
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Multi-buy discounts are applied when we confirm your order.
        </p>
      </aside>
    </div>
  )
}
