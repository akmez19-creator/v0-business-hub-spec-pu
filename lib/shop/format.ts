/**
 * Pure display helpers for the storefront.
 *
 * These live apart from `catalog.ts` ON PURPOSE. catalog.ts imports
 * `createAdminClient`, which pulls in `next/headers` - so the moment a
 * 'use client' component imports a VALUE from it (a type import is erased and
 * stays safe), Turbopack tries to bundle server-only code for the browser and
 * the whole route dies with "Ecmascript file had an error".
 *
 * Nothing in this file may import from catalog.ts or touch a database client.
 */

/** Minimal shape these formatters need, so this file imports no types either. */
type Priced = { fromPrice: number; minQty: number }

/**
 * 403 in-stock products genuinely have no price on file. "Rs 0" reads as free
 * and has already produced Rs 0 orders once, so it is never printed - those
 * items say "Price on request" and route to a WhatsApp enquiry instead.
 */
export function priceLabel(p: Priced): string {
  if (p.fromPrice <= 0) return 'Price on request'
  return `Rs ${Math.round(p.fromPrice).toLocaleString('en-US')}`
}

/** "/ 4 pcs" suffix for set-priced items, '' when sold singly or unpriced. */
export function perUnitLabel(p: Priced): string {
  if (p.minQty <= 1 || p.fromPrice <= 0) return ''
  return `/ ${p.minQty} pcs`
}
