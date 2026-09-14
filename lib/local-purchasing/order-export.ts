import type { OrderSnapshot } from './order-types'
import { variantDescription } from '@/lib/products/pricing'

export const spreadsheetText = (value: string | null | undefined) => {
  const text = value ?? ''
  return /^[\s\u0000-\u001f]*[=+@-]/.test(text) ? `'${text}` : text
}

export function supplierOrderRows(snapshot: OrderSnapshot): Array<Array<string | number | null>> {
  const safe = spreadsheetText
  const totals = snapshot.calculation.totals
  const amounts = new Map(snapshot.calculation.lines.map((line) => [line.key, line]))
  return [
    ['PURCHASE ORDER', safe(snapshot.orderNumber), 'Revision', snapshot.revision],
    ['Buyer', safe(snapshot.buyer.name)], ['Buyer address', safe(snapshot.buyer.address)],
    ['Buyer VAT', safe(snapshot.buyer.vatNumber), 'BRN', safe(snapshot.buyer.brn)],
    ['Buyer phone', safe(snapshot.buyer.phone), 'Email', safe(snapshot.buyer.email)],
    ['Supplier', safe(snapshot.supplier.name)], ['Supplier address', safe(snapshot.supplier.address)],
    ['Supplier VAT', safe(snapshot.supplier.vatNumber), 'BRN', safe(snapshot.supplier.brn)],
    ['Supplier phone', safe(snapshot.supplier.phone), 'Email', safe(snapshot.supplier.email)],
    ['Issued', safe(snapshot.issuedAt.slice(0, 10)), 'Requested date', safe(snapshot.expectedDate)],
    ['Currency', 'MUR', 'Prices', 'Expected; please confirm changes before supplying'], [],
    ['Supplier description', 'Supplier code', 'Unit', 'Quantity', 'Expected unit price', 'Price VAT basis', 'Discount still to apply %', 'VAT %', 'Net/unit after discount', 'Payable/unit incl. VAT', 'Line payable incl. VAT', 'Variant'],
    ...snapshot.lines.map((line) => {
      const amount = amounts.get(line.id)
      return [safe(line.supplierLabel), safe(line.supplierCode), safe(line.unit), line.qty, line.expectedUnitPrice,
        line.pricesIncludeVat ? 'VAT included' : 'VAT added', line.discountPercent, line.vatPercent,
        amount?.unitAmounts.unitPriceNet ?? null, amount ? amount.rawPayable / amount.qty : null, amount?.payable ?? null, line.variantSnapshot ? safe(variantDescription(line.variantSnapshot)) : 'Not specified']
    }), [],
    ...snapshot.terms.charges.map((charge) => ['Charge', safe(charge.label), charge.amount, 'VAT %', charge.vatPercent,
      charge.pricesIncludeVat === false ? 'VAT added' : 'VAT included']),
    ['Rounding', snapshot.terms.roundingAmount ?? 0],
    ['Accounting net', totals?.net ?? null], ['VAT', totals?.vat ?? null], ['TOTAL PAYABLE', totals?.payable ?? null],
    ['Supplier instructions', safe(snapshot.notes)],
    ['Please quote this purchase order and revision on your response. This order is not a receipt or proof of payment.'],
  ]
}
