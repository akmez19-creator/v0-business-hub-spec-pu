import type { Metadata } from 'next'
import { CheckoutForm } from '@/components/shop/checkout-form'

export const metadata: Metadata = {
  title: 'Checkout - Destockage By Moris',
  description: 'Place your order. Pay cash on delivery anywhere in Mauritius.',
}

export default function CheckoutPage() {
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="font-display text-4xl font-extrabold tracking-tight text-foreground sm:text-5xl">
        Checkout
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Tell us where to deliver. No card needed &mdash; you pay cash on arrival.
      </p>
      <div className="mt-9">
        <CheckoutForm />
      </div>
    </div>
  )
}
