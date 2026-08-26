/**
 * Quick Order rules, ported verbatim from the Chrome extension
 * (public/extension/content.js) so the dashboard and the extension price and
 * schedule an order identically.
 *
 * These were previously only reachable inside a content script that depends on
 * `chrome.storage`, which is why they are re-expressed here as pure functions.
 * Any change to pricing or delivery scheduling must be made in BOTH places or
 * the same basket will quote two different totals depending on where the agent
 * happened to be working.
 */

export type QuickOrderProduct = {
  id: string
  name: string
  price: number | string | null
  image_url?: string | null
  /** Map of "quantity" -> bundle price, e.g. { "2": 850, "3": 1200 }. */
  bundle_prices?: Record<string, number | string> | null
  is_b1g1?: boolean | null
  has_variants?: boolean | null
  /**
   * Owner-set "on hand IS zero" - the only trustworthy empty in the schema.
   * A `quantity` of 0 means "nobody has counted it", so stock must never be
   * inferred from a count.
   */
  sold_out?: boolean | null
  variants?: QuickOrderVariant[]
}

export type QuickOrderVariant = {
  id: string
  product_id: string
  attribute_name: string
  attribute_value: string
  /**
   * NOT a stock level you can act on. `product_variants` has no
   * `last_counted_at`, so 0 cannot be distinguished from "never counted" - and
   * 22 of 49 live rows sit at 0 on products that are demonstrably in stock
   * (66W Powerbank: 11 in zone D, all 3 models 0). Only a value > 0 is
   * information; never disable or hide an option because this is 0.
   */
  quantity?: number | null
  price_override?: number | string | null
}

/** Admin-managed closure, inclusive of both ends. */
export type Holiday = { start: string; end: string }

/**
 * Single-unit price as a number.
 *
 * Postgres returns `numeric` columns as strings, so `product.price` is a string
 * at runtime often enough that multiplying it directly silently concatenates.
 */
export function unitPrice(product: QuickOrderProduct | null | undefined): number {
  return Number.parseFloat(String(product?.price ?? 0)) || 0
}

type Tier = { n: number; price: number }

/** The usable qty -> price tiers, as numbers. */
function tiersOf(product: QuickOrderProduct | null | undefined): Tier[] {
  const bundles = product?.bundle_prices
  if (!bundles || typeof bundles !== 'object') return []
  return Object.keys(bundles)
    .map(k => ({ n: Number.parseInt(k, 10), price: Number.parseFloat(String(bundles[k])) }))
    .filter(t => t.n > 0 && t.price > 0)
}

/**
 * Units in one sellable set, or 0 when the product is sold singly.
 *
 * "Sold only in sets" is an EXISTING owner convention, not a new idea: no
 * single price (`price` 0) plus a bundle tier is how 8 products are already
 * set up - Cozy Stool {"4":1075}, Microfiber Towel {"6":475}, Ice Cube Mold
 * {"3":475}. Derived from that rather than stored in a new column, so the rule
 * matches the data that already exists and needs no migration.
 *
 * A SET IS ORTHOGONAL TO A VARIANT, which is why it lives on the product and
 * not in product_variants: Cozy Stool is sold as a set of 4 AND the client
 * picks the colour. The set is the packaging, the variant is the choice inside
 * it. Modelling the set as a variant would collide with the colour axis, and
 * product_variants holds exactly one axis per product today.
 */
export function setSize(product: QuickOrderProduct | null | undefined): number {
  if (unitPrice(product) > 0) return 0
  const tiers = tiersOf(product)
  if (!tiers.length) return 0
  return Math.min(...tiers.map(t => t.n))
}

/**
 * Cheapest way to buy `qty` units, allowing bundle tiers to be combined.
 *
 * A greedy "use the biggest bundle first" pass is wrong: with tiers of 2 for
 * Rs850 and 3 for Rs1200, five units is 1200+850 = Rs2050, which greedy finds,
 * but for four units greedy would take 3+1 (1200+unit) when 2+2 (Rs1700) can be
 * cheaper. So this is a small unbounded-knapsack over the tiers.
 *
 * B1G1 deliberately does NOT reduce the price - the free unit is bonus stock
 * that ships with the order, and the customer still pays the full unit price.
 *
 * SET-ONLY PRODUCTS TOOK A DIFFERENT PATH AND IT PAID RS 0. With `price` 0 the
 * single-unit step below is `cost[i-1] + 0`, which is cheaper than ANY tier, so
 * the knapsack "bought" singles at no cost and every quantity came back free -
 * measured on all 8 products, including at the correct set size (Cozy Stool
 * qty 4 -> Rs 0, not Rs 1075). 12 live orders are already booked at Rs 0.
 * So when there is no single price, singles are not a purchasable option:
 * price the smallest combination of whole SETS that covers the quantity.
 */
export function priceFor(product: QuickOrderProduct | null | undefined, qty: number): number {
  const q = Math.max(0, Number.parseInt(String(qty), 10) || 0)
  if (q === 0 || !product) return 0

  const unit = unitPrice(product)
  const tiers = tiersOf(product)
  const set = setSize(product)

  if (set > 0) {
    // Set-only. Overshoot is allowed and required: asking for 1 of a set of 4
    // must charge for the whole set, so search up to one extra full set past q
    // and take the cheapest way to cover AT LEAST q.
    const biggest = Math.max(...tiers.map(t => t.n))
    const cap = q + biggest
    const cost = new Array<number>(cap + 1).fill(Number.POSITIVE_INFINITY)
    cost[0] = 0
    for (let i = 1; i <= cap; i++) {
      for (const t of tiers) {
        if (t.n <= i && cost[i - t.n] + t.price < cost[i]) cost[i] = cost[i - t.n] + t.price
      }
    }
    let best = Number.POSITIVE_INFINITY
    for (let i = q; i <= cap; i++) if (cost[i] < best) best = cost[i]
    // Unreachable in practice (one set always covers), but never return 0 for
    // something that is genuinely for sale.
    return Number.isFinite(best) ? best : 0
  }

  if (tiers.length) {
    const cost = new Array<number>(q + 1).fill(Number.POSITIVE_INFINITY)
    cost[0] = 0
    for (let i = 1; i <= q; i++) {
      cost[i] = cost[i - 1] + unit
      for (const t of tiers) {
        if (t.n <= i && cost[i - t.n] + t.price < cost[i]) cost[i] = cost[i - t.n] + t.price
      }
    }
    if (Number.isFinite(cost[q])) return cost[q]
  }
  return unit * q
}

/**
 * Short badge describing the active offer, e.g. "B1G1", "Set of 4" or
 * "2 for Rs850".
 *
 * A set is packaging, not a discount: "4 for Rs1075" reads as an optional deal
 * on a product you could also buy singly, which is exactly what these cannot
 * be sold as.
 */
export function offerLabel(product: QuickOrderProduct | null | undefined): string {
  if (!product) return ''
  if (product.is_b1g1) return 'B1G1'
  const set = setSize(product)
  if (set > 0) return `Set of ${set}`
  const tiers = tiersOf(product).sort((a, b) => a.n - b.n)
  if (tiers.length) return `${tiers[0].n} for Rs${Math.round(tiers[0].price)}`
  return ''
}

/**
 * Order text for a product. The set size is written ONLY when the product has
 * no variant:
 *
 *   variants    -> "Cozy Stool - Blue"        (set omitted)
 *   no variants -> "Mirror Film - Set of 4"
 *
 * The variant is the more useful suffix - it is what the client chose and what
 * has to be picked off the shelf - so the set becomes noise next to it. With no
 * variant there is nothing else to say, and the marker is what distinguishes a
 * set from a single unit.
 *
 * This is what the live data already does, unanimously: Cozy Stool (variants)
 * is 0 of 20 orders carrying "Set of", while Welding Rod is 100/100, USB Light
 * 19/19 and Mirror Film 20/27.
 *
 * The 9 products with the set baked into products.name emit it as part of the
 * name either way. stripSetSuffix() keeps parsing every form, so this governs
 * what we WRITE, never what we can READ.
 *
 * B1G1 is deliberately NOT appended for variant products - see itemText in
 * inventory-content.tsx; the flag is re-derived when the line is stored.
 */
export function orderTextFor(
  product: QuickOrderProduct | null | undefined,
  variantValue?: string | null,
): string {
  if (!product) return ''
  if (variantValue) return `${product.name} - ${variantValue}`
  const set = setSize(product)
  return set > 0 ? `${product.name} - Set of ${set}` : product.name
}

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Sundays and admin-configured closures are never delivery days. */
export function isNonWorkingDay(d: Date, holidays: Holiday[]): boolean {
  if (d.getDay() === 0) return true
  const s = ymd(d)
  return holidays.some((h) => h.start && s >= h.start && s <= (h.end || h.start))
}

function addWorkingDays(from: Date, n: number, holidays: Holiday[]): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  let added = 0
  let guard = 0
  while (added < n && guard < 60) {
    d.setDate(d.getDate() + 1)
    if (!isNonWorkingDay(d, holidays)) added++
    guard++
  }
  return d
}

/**
 * The next day the vans actually run after `from`.
 *
 * Reuses the SAME closure list the extension and quick-order already obey, so
 * a day the admin has closed can never be offered as the day to move work TO.
 * `from` is a plain YYYY-MM-DD; parsed field-by-field because `new Date(s)`
 * treats a bare date as UTC and shifts it a day backwards in Mauritius.
 */
export function nextWorkingDay(from: string, holidays: Holiday[]): string {
  const [y, m, d] = from.split('-').map(Number)
  if (!y || !m || !d) return from
  return ymd(addWorkingDays(new Date(y, m - 1, d), 1, holidays))
}

/** First date strictly after `from` landing on `target` weekday. */
function nextDateForWeekday(from: Date, target: number, holidays: Holiday[]): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  for (let i = 0; i < 21; i++) {
    d.setDate(d.getDate() + 1)
    if (d.getDay() === target && !isNonWorkingDay(d, holidays)) return d
  }
  return addWorkingDays(from, 1, holidays)
}

export type DeliveryDate = {
  /** YYYY-MM-DD, safe to send straight to the order API. */
  date: string
  /** True when the order missed today's cut-off and slipped an extra day. */
  afterCutoff: boolean
  /** True when an admin weekday scheme decided the date instead of the cut-off. */
  fromScheme: boolean
}

/**
 * The default delivery date for an order placed now.
 *
 * Two independent rules, and the scheme wins:
 *  - if the admin mapped today's weekday to a target weekday, deliver on the
 *    next occurrence of that weekday and ignore the cut-off entirely; else
 *  - next working day, or the one after when we are past the cut-off.
 */
export function computeDefaultDeliveryDate(
  now: Date,
  cutoff: string,
  scheme: Record<string, string | number | null | undefined>,
  holidays: Holiday[],
): DeliveryDate {
  const target = scheme?.[String(now.getDay())]
  if (target !== undefined && target !== null && target !== '') {
    const t = Number.parseInt(String(target), 10)
    if (t >= 0 && t <= 6) {
      return { date: ymd(nextDateForWeekday(now, t, holidays)), afterCutoff: false, fromScheme: true }
    }
  }

  const [ch, cm] = (cutoff || '20:00').split(':').map(Number)
  const afterCutoff = now.getHours() > ch || (now.getHours() === ch && now.getMinutes() >= cm)
  return {
    date: ymd(addWorkingDays(now, afterCutoff ? 2 : 1, holidays)),
    afterCutoff,
    fromScheme: false,
  }
}

/**
 * Best-effort Mauritian mobile number found in free text.
 *
 * Local mobiles are 8 digits starting with 5, and customers write them with
 * spaces, dashes or a +230 prefix. Returns the normalised 8 digits.
 */
export function extractPhone(text: string): string | null {
  if (!text) return null
  const cleaned = text.replace(/[^\d+]/g, ' ')
  const match = cleaned.match(/(?:\+?230)?\s*(5\d{3}\s*\d{4}|5\d{7})/)
  if (!match) return null
  return match[1].replace(/\s/g, '')
}
