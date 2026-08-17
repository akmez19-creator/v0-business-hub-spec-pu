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
  variants?: QuickOrderVariant[]
}

export type QuickOrderVariant = {
  id: string
  product_id: string
  attribute_name: string
  attribute_value: string
  quantity?: number | null
  price_override?: number | string | null
}

/** Admin-managed closure, inclusive of both ends. */
export type Holiday = { start: string; end: string }

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
 */
export function priceFor(product: QuickOrderProduct | null | undefined, qty: number): number {
  const q = Math.max(0, Number.parseInt(String(qty), 10) || 0)
  if (q === 0 || !product) return 0

  const unit = Number.parseFloat(String(product.price ?? 0)) || 0
  const bundles = product.bundle_prices
  if (bundles && typeof bundles === 'object') {
    const tiers = Object.keys(bundles)
      .map((k) => ({ n: Number.parseInt(k, 10), price: Number.parseFloat(String(bundles[k])) }))
      .filter((t) => t.n > 0 && t.price > 0)

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
  }
  return unit * q
}

/** Short badge describing the active offer, e.g. "B1G1" or "2 for Rs850". */
export function offerLabel(product: QuickOrderProduct | null | undefined): string {
  if (!product) return ''
  if (product.is_b1g1) return 'B1G1'
  const bundles = product.bundle_prices
  if (bundles && typeof bundles === 'object') {
    const keys = Object.keys(bundles)
      .map((k) => Number.parseInt(k, 10))
      .filter((n) => n > 0)
      .sort((a, b) => a - b)
    if (keys.length) {
      const n = keys[0]
      return `${n} for Rs${Math.round(Number.parseFloat(String(bundles[String(n)])))}`
    }
  }
  return ''
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
