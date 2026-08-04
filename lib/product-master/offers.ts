// Inventory offers (B1G1, multi-buy bundles) turned into the wording that goes
// on a reel's price tag.
//
// Why this exists: the promo tag was built around promo_price, but no product
// in inventory actually has one - while roughly half carry a B1G1 flag or a
// bundle tier. Those are the real offers, so the tag has to read them.

/** Bundle tiers as stored in products.bundle_prices, e.g. {"2": 775}. */
export type BundlePrices = Record<string, number | string> | null | undefined

export interface ProductOffer {
  /** Stable id used as the layout/chip value */
  id: string
  /** Short chip label in the editor, e.g. "B1G1" or "2 for Rs 775" */
  label: string
  /** Headline burned onto the video */
  headline: string
  /** Supporting line, usually the per-unit price it replaces */
  sub?: string
  /** Struck-out reference price, when the offer implies a saving */
  was?: string
  /** Percentage saved vs buying singly, 0 when not meaningful */
  savePct: number
}

/** Inventory stores numerics inconsistently - "775" and 775 both occur. */
export const toNum = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.-]/g, ''))
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/** Money as it appears on the tag. Mauritian rupees, no decimals. */
export const fmtRs = (n: number): string => `Rs ${Math.round(n).toLocaleString('en-US')}`

/**
 * Every offer available for a product, best-value first.
 * Returns [] when the product has no offer at all, in which case the caller
 * should fall back to the plain unit price.
 */
export function buildOffers(opts: {
  price?: number | string | null
  promoPrice?: number | string | null
  isB1g1?: boolean | null
  bundlePrices?: BundlePrices
}): ProductOffer[] {
  const unit = toNum(opts.price)
  const promo = toNum(opts.promoPrice)
  const offers: ProductOffer[] = []

  // A real promo price still wins when one is set - it is the most direct
  // discount and reads best on a reel
  if (promo > 0 && unit > promo) {
    offers.push({
      id: 'promo',
      label: 'Promo price',
      headline: fmtRs(promo),
      was: fmtRs(unit),
      savePct: Math.round(((unit - promo) / unit) * 100),
    })
  }

  // B1G1: two units for the price of one, so the saving is always 50%
  if (opts.isB1g1) {
    offers.push({
      id: 'b1g1',
      label: 'B1G1',
      headline: 'BUY 1 GET 1 FREE',
      sub: unit > 0 ? fmtRs(unit) : undefined,
      savePct: 50,
    })
  }

  // Multi-buy tiers, cheapest per unit first
  const tiers = Object.entries(opts.bundlePrices || {})
    .map(([qty, value]) => ({ qty: Number(qty), total: toNum(value) }))
    .filter((t) => t.qty > 1 && t.total > 0)
    .sort((a, b) => a.qty - b.qty)

  for (const t of tiers) {
    // Compare against buying that many singly. Some rows have price 0, so
    // only claim a saving when there is a unit price to compare against.
    const straight = unit * t.qty
    const savePct = straight > t.total ? Math.round(((straight - t.total) / straight) * 100) : 0
    offers.push({
      id: `bundle-${t.qty}`,
      label: `${t.qty} for ${fmtRs(t.total)}`,
      headline: `${t.qty} FOR ${fmtRs(t.total)}`,
      sub: unit > 0 ? `${fmtRs(unit)} each` : undefined,
      was: straight > t.total ? fmtRs(straight) : undefined,
      savePct,
    })
  }

  return offers
}
