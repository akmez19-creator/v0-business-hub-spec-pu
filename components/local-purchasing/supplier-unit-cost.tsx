import { Loader2 } from 'lucide-react'
import { formatSellingPrice } from '@/lib/products/pricing'
import type { PurchaseUnitAmounts } from '@/lib/local-purchasing/vat'

export function SupplierUnitCost({
  amounts,
  checking = false,
}: {
  amounts: PurchaseUnitAmounts | null
  checking?: boolean
}) {
  if (!amounts) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm leading-relaxed text-muted-foreground">
        {checking && <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />}
        {checking
          ? 'Recalculating the supplier purchase price…'
          : 'Supplier cost unavailable. Enter a quantity and unit price, then check the purchase prices.'}
      </p>
    )
  }

  return (
    <section aria-label="Supplier purchase price breakdown" className="flex min-w-0 flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Supplier purchase price · {amounts.discountAlreadyIncluded
          ? `printed ${amounts.printedDiscountPercent ?? ''}% discount already reflected; no second deduction`
          : amounts.discountPercent > 0 ? `after ${amounts.discountPercent}% additional discount` : 'no further percentage deduction'}
      </p>
      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">Payable / unit (incl. VAT)</dt>
          <dd className="font-mono text-base font-semibold tabular-nums text-foreground">{formatSellingPrice(amounts.unitVat.gross)}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">Net / unit (excl. VAT)</dt>
          <dd className="font-mono text-sm tabular-nums text-foreground">{formatSellingPrice(amounts.unitPriceNet)}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-muted-foreground">VAT / unit ({amounts.vatPercent}%)</dt>
          <dd className="font-mono text-sm tabular-nums text-foreground">{formatSellingPrice(amounts.unitVat.vat)}</dd>
        </div>
      </dl>
    </section>
  )
}
