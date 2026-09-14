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
  /**
   * How `sub` should read on the tag. 'pay' is the amount the customer
   * actually hands over (B1G1 still costs one unit), so it has to be the
   * loudest thing after the headline. 'note' is incidental detail.
   */
  subKind?: 'pay' | 'note'
  /** Struck-out reference price, when the offer implies a saving */
  was?: string
  /** Percentage saved vs buying singly, 0 when not meaningful */
  savePct: number
  /**
   * True when the headline already spells out the discount ("BUY 1 GET 1
   * FREE" is self-evidently -50%), so the badge would just be noise
   * competing with the price.
   */
  savingInHeadline?: boolean
  /**
   * Every tier at once, for the price-ladder tag: "5 PCS RS 375" over
   * "10 PCS RS 575". Set only on the combined `tiers` offer.
   *
   * The bigger pack being better value per unit is the whole reason to show
   * two rows - one tier alone gives the viewer nothing to trade up from - so
   * the ladder is a distinct offer rather than a variant of the single-tier
   * headline. Ordered smallest pack first: the eye lands on the cheap entry
   * price, then finds the better deal underneath.
   */
  ladder?: { qty: number; total: number; best?: boolean }[]
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
      // Rs 475 is what they pay, not a price being replaced - it must not be
      // dimmed or struck through
      sub: unit > 0 ? fmtRs(unit) : undefined,
      subKind: 'pay',
      savePct: 50,
      savingInHeadline: true,
    })
  }

  // Multi-buy tiers, cheapest per unit first
  const tiers = Object.entries(opts.bundlePrices || {})
    .map(([qty, value]) => ({ qty: Number(qty), total: toNum(value) }))
    .filter((t) => t.qty > 1 && t.total > 0)
    .sort((a, b) => a.qty - b.qty)

  // Two or more packs: offer the ladder first, so the default tag shows the
  // trade-up instead of silently picking one pack and hiding the other.
  if (tiers.length > 1) {
    // Best value is the lowest price PER UNIT, which is not always the biggest
    // pack - a badly keyed tier can be worse per unit, and marking it "best"
    // would talk the customer into the wrong one.
    const perUnit = tiers.map((t) => t.total / t.qty)
    const bestAt = perUnit.indexOf(Math.min(...perUnit))
    const ladder = tiers.map((t, i) => ({ qty: t.qty, total: t.total, best: i === bestAt }))
    // Savings are measured against the WORST per-unit tier when there is no
    // single price, since "vs buying singly" is meaningless for a set-only
    // product - there is no single to buy.
    const ref = unit > 0 ? unit : Math.max(...perUnit)
    const bestPer = perUnit[bestAt]
    offers.push({
      id: 'tiers',
      // Says "both" outright. It used to read "5 & 10 pcs", which describes the
      // packs but never announces that this is the one chip putting EVERY price
      // on the video - so the option existed and still looked unavailable next
      // to the single-tier chips.
      label:
        tiers.length === 2
          ? `Both: ${tiers.map((t) => t.qty).join(' & ')} pcs`
          : `All ${tiers.length} prices`,
      headline: `${tiers[0].qty} FOR ${fmtRs(tiers[0].total)}`,
      ladder,
      savePct: ref > bestPer ? Math.round(((ref - bestPer) / ref) * 100) : 0,
      // The ladder already shows both prices side by side, so a -N% badge on
      // top competes with the numbers it is describing.
      savingInHeadline: true,
    })
  }

  for (const t of tiers) {
    // Compare against buying that many singly. Some rows have price 0, so
    // only claim a saving when there is a unit price to compare against.
    const straight = unit * t.qty
    const savePct = straight > t.total ? Math.round(((straight - t.total) / straight) * 100) : 0
    offers.push({
      id: `bundle-${t.qty}`,
      label: `${t.qty} for ${fmtRs(t.total)}`,
      headline: `${t.qty} FOR ${fmtRs(t.total)}`,
      // The bundle total is already in the headline, so the unit price here
      // is context rather than the amount paid
      sub: unit > 0 ? `${fmtRs(unit)} each` : undefined,
      subKind: 'note',
      was: straight > t.total ? fmtRs(straight) : undefined,
      savePct,
    })
  }

  return offers
}
