/**
 * Converting between an order's stored `products` text and structured lines.
 *
 * `deliveries.products` is one free-text line ("AirFryer - B1G1, Neck Massager
 * x2"), written by the extension as `name` or `name xN` joined with ", ". To
 * let an agent edit an existing order with the catalogue picker we have to read
 * that text back into cart lines - and be honest when we cannot.
 */

import { setSize, type QuickOrderProduct, type QuickOrderVariant } from '@/lib/orders/quick-order'

export type OrderLine = {
  /** Catalogue product. Null when the text could not be matched. */
  product: QuickOrderProduct | null
  variant: QuickOrderVariant | null
  /** Exactly as written in the order, kept so unmatched text is never lost. */
  rawText: string
  qty: number
  /**
   * The order was written with a B1G1 flag even though the catalogue no longer
   * carries that offer - it was withdrawn after the order was placed.
   *
   * Measured on live data: 25 open orders are in this state. The flag has to
   * survive an unrelated edit, because the picking list reads it to decide
   * whether a free unit goes in the box, and the client was promised one.
   */
  offerHonoured?: boolean
}

/**
 * The extension's wire format, reproduced exactly (content.js ~line 4323):
 * the line name is the product (plus " - {variant}" when one is chosen), then
 * " - B1G1" when the priced product carries the offer, then " xN" for a
 * quantity above one, all joined with ", ".
 *
 * The B1G1 suffix is not decoration - the picking list reads it to know a free
 * unit must go in the box, so dropping it on an edit would silently short the
 * client a unit.
 */
export function formatOrderLines(lines: OrderLine[]): string {
  return lines
    .map((l) => {
      // Set size only when there is no variant: "Cozy Stool - Blue" but
      // "Mirror Film - Set of 4". Mirrors orderTextFor - see it for why.
      let name = l.product?.name ?? l.rawText
      if (l.variant) {
        name += ` - ${l.variant.attribute_value}`
      } else if (l.product) {
        const set = setSize(l.product)
        if (set > 0) name += ` - Set of ${set}`
      }
      // A variant with its own price override drops the parent's offers, so the
      // flag has to follow the priced product, not the parent.
      const priced = l.product ? pricedProductFor(l.product, l.variant) : null
      if (priced?.is_b1g1 || l.offerHonoured) name += ' - B1G1'
      return l.qty > 1 ? `${name} x${l.qty}` : name
    })
    .join(', ')
}

/**
 * Remove a trailing " - B1G1" / " - B1G1 FREE" offer flag from a product text.
 *
 * The flag is an OFFER MARKER, never part of the catalogue name - no product is
 * called "... - B1G1" and none may ever be created that way, or the name stops
 * matching the deliveries text and the catalogue grows a phantom twin.
 *
 * Shared by the order parser, the deliveries importer and the inventory
 * importer so the three cannot drift. Order matters: the longer " FREE" rule
 * runs first, or the trailing " FREE" survives the shorter rule.
 */
export function stripOfferSuffix(name: string): string {
  return String(name || '')
    .replace(/\s*[-–]\s*B1G1\s+FREE\s*$/i, '')
    .replace(/\s*[-–]\s*B1G1\s*$/i, '')
    .trim()
}

/**
 * Remove a " - Set of 4" packaging marker from anywhere in a product text.
 *
 * Like B1G1 this is DERIVED from the product row, never part of the catalogue
 * name, so it has to come back off before matching or "Cozy Stool - Set of 4"
 * matches nothing.
 *
 * Not anchored to the end: the set sits in the MIDDLE when a colour follows
 * ("Cozy Stool - Set of 4 - Pink"), which is exactly the Cozy Stool case.
 *
 * "Set of 4" as a bare tail with no product before it is left alone - stripping
 * it would leave an empty name.
 */
export function stripSetSuffix(name: string): string {
  const out = String(name || '')
    .replace(/\s*[-–]\s*Set\s+of\s+\d+\s*/i, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return out || String(name || '').trim()
}

/**
 * Every catalogue name a piece of order text could be referring to.
 *
 * A product's OFFER STRUCTURE CHANGES OVER TIME while the product stays the
 * same: "Mirror Film" has been written plain, as "Mirror Film - B1G1" when it
 * ran as a buy-one-get-one, and as "Mirror Film - Set of 4" since it moved to
 * set pricing - often at the same money. Every one of those rows is the same
 * catalogue product, so matching has to see through all of the markers, in any
 * combination, in any order.
 *
 * Only the DERIVED markers come off (offer flag, set size). The variant is not
 * stripped: it is a real choice that identifies a specific row in
 * product_variants, so it is resolved rather than discarded.
 *
 * Widest-first would be wrong: the untouched text is tried first so a product
 * genuinely named "... Set of 4" still wins over the stripped form.
 */
export function productTextCandidates(text: string): string[] {
  const out: string[] = []
  const push = (s: string) => {
    const t = String(s || '').trim()
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t)
  }
  const raw = String(text || '').trim()
  push(raw)
  const noOffer = stripOfferSuffix(raw)
  push(noOffer)
  // Both orders, because the two markers can appear either way round:
  // "Mirror Film - Set of 4 - B1G1" and "Mirror Film - B1G1" both reduce here.
  for (const c of [raw, noOffer]) push(stripSetSuffix(c))
  return out
}

/** Lookup tables for {@link resolveProductText}, built once per import. */
export function buildProductIndex(products: QuickOrderProduct[]) {
  const byName = new Map<string, QuickOrderProduct>()
  const byVariant = new Map<string, { p: QuickOrderProduct; v: QuickOrderVariant }>()
  for (const p of products) {
    byName.set(p.name.trim().toLowerCase(), p)
    for (const v of p.variants ?? []) {
      byVariant.set(`${p.name} - ${v.attribute_value}`.trim().toLowerCase(), { p, v })
    }
  }
  return { byName, byVariant }
}

/**
 * Resolve one piece of order text to a catalogue product (and variant).
 *
 * THE single matcher. The order parser, the deliveries importer and its
 * "create product" button all call this, so a text that resolves in the editor
 * cannot be reported as unknown by the importer - previously each kept its own
 * copy of the candidate rules and the importer's copy had no variant support at
 * all, so 1,092 delivery rows looked unmatched and "Add All to Inventory" would
 * have created a phantom twin for each one.
 *
 * Exact on the whole candidate, never a substring: "Shampoo" is contained in
 * "Shampoo Brush", and substring matching mis-identifies dozens of products.
 */
export function resolveProductText(
  text: string,
  index: ReturnType<typeof buildProductIndex>,
): { product: QuickOrderProduct; variant: QuickOrderVariant | null; hadB1g1: boolean } | null {
  const raw = String(text || '').trim()
  const hadB1g1 = stripOfferSuffix(raw).toLowerCase() !== raw.toLowerCase()
  for (const cand of productTextCandidates(raw)) {
    const key = cand.toLowerCase()
    // Variant first: "Cozy Stool - Light Blue" must resolve to the colour, not
    // fall back to the bare product and lose which one was sold.
    const variantHit = index.byVariant.get(key)
    if (variantHit) return { product: variantHit.p, variant: variantHit.v, hadB1g1 }
    const hit = index.byName.get(key)
    if (hit) return { product: hit, variant: null, hadB1g1 }
  }
  return null
}

/**
 * Split an order's product text into its parts.
 *
 * Orders in the wild use commas, semicolons and plus signs as separators, so
 * all three are honoured. A trailing "x3" is read as the quantity.
 */
function splitParts(text: string): { name: string; qty: number }[] {
  return String(text || '')
    .split(/[,;+]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^(.*?)\s*[x×]\s*(\d+)$/i)
      if (m) return { name: m[1].trim(), qty: Math.max(1, Number.parseInt(m[2], 10) || 1) }
      return { name: part, qty: 1 }
    })
}

/**
 * Match each part of the text against the catalogue.
 *
 * Matching is deliberately EXACT on the whole part (case-insensitive), never a
 * substring test: "Shampoo" is contained in "Shampoo Brush", and a substring
 * rule mis-identifies dozens of the catalogue's products. A part that does not
 * match is returned with `product: null` and its original text intact, so the
 * editor can show it as-is rather than silently dropping what the client
 * actually ordered.
 */
export function parseOrderLines(
  text: string | null | undefined,
  products: QuickOrderProduct[],
): OrderLine[] {
  const parts = splitParts(text ?? '')
  if (!parts.length) return []

  // Index once: catalogues here run to ~850 products and an order can list
  // several parts.
  const index = buildProductIndex(products)

  return parts.map(({ name, qty }) => {
    // All the candidate rules (offer flag, set marker, variant) live in
    // resolveProductText so the importer cannot drift from the editor.
    const hit = resolveProductText(name, index)
    if (!hit) return { product: null, variant: null, rawText: name, qty }
    // The offer was written on the row even though the catalogue no longer
    // carries it - see offerHonoured.
    const priced = hit.variant ? pricedProductFor(hit.product, hit.variant) : hit.product
    return {
      product: hit.product,
      variant: hit.variant,
      rawText: name,
      qty,
      offerHonoured: hit.hadB1g1 && !priced.is_b1g1,
    }
  })
}

/**
 * The price a variant is sold at.
 *
 * A variant may override the base price. That replaces the price and the
 * parent's qty bundle tiers (those tiers are multiples of the base price, so
 * they are meaningless against a different one) - but it does NOT cancel B1G1.
 *
 * `is_b1g1` used to be forced false here, which conflated two separate things:
 * what one unit COSTS versus whether a second unit is GIVEN. Crrju Watch is a
 * B1G1 product whose 10 models all carry an override, so picking any model
 * silently dropped the offer and the free-model picker never appeared.
 *
 * Mirrors akmezCartResolve() in the extension - keep the two in step.
 */
export function pricedProductFor(
  product: QuickOrderProduct,
  variant: QuickOrderVariant | null,
): QuickOrderProduct {
  const override = variant?.price_override
  if (override === null || override === undefined || override === '') return product
  // A non-positive override cannot be a selling price. Crrju Watch W-008 is
  // stored as -1375.00, and honouring it would book a Rs 1,375 REFUND as a
  // sale. Fall back to the parent price rather than invent one; the row still
  // needs correcting in Inventory.
  const n = Number(override)
  if (!Number.isFinite(n) || n <= 0) return product
  return { ...product, price: override, bundle_prices: null }
}
