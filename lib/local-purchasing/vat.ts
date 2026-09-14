/**
 * VAT and cost-comparison maths for LOCAL purchasing.
 *
 * PURE - no `next/headers`, no Supabase. Client components import from here.
 * The server-side queries live in `./costs.ts`, which imports the admin client
 * and therefore CANNOT be imported from the browser. Same split as
 * `lib/shop/format.ts` vs `lib/shop/catalog.ts`, and as
 * `lib/entry-activity-visits.ts` vs `lib/entry-activity.ts` - both of which I
 * broke once by putting a helper on the wrong side.
 */

/** Mauritius standard rate. Overridable per document, never hardcoded downstream. */
export const DEFAULT_VAT_PERCENT = 15

/**
 * THE CENTRAL ACCOUNTING RULE OF THIS MODULE.
 *
 * Input VAT that you are entitled to reclaim is NOT a cost - it is a receivable
 * from the MRA. So it must be RECORDED (that is what the VAT section is for) but
 * EXCLUDED from any decision about whether a price is good.
 *
 * This is why the comparison uses the net price. Concretely, on Quotation 144:
 *   list Rs 210 -> less 20% = Rs 168 net -> plus 15% VAT = Rs 193.20 payable.
 * You pay Rs 193.20 and reclaim Rs 25.20, so the item cost you Rs 168. Comparing
 * Rs 193.20 against a China landed cost of Rs 131 would overstate the local
 * price by the exact amount of a tax you get back, and could reject a supplier
 * who was actually competitive.
 *
 * The opposite error is just as real: if the supplier is NOT VAT-registered you
 * cannot reclaim anything, so their "cheaper" price is the whole price. Hence
 * `reclaimable` is an explicit input, driven by the supplier's VAT number, and
 * never assumed.
 */
export interface VatBreakdown {
  /** Goods value excluding VAT, after discount. The comparable figure. */
  net: number
  /** VAT charged on the net. */
  vat: number
  /** What actually leaves the bank. */
  gross: number
  /** VAT you can claim back from the MRA. Zero when not reclaimable. */
  reclaimable: number
  /**
   * TRUE cost after reclaim. Equals `net` when VAT is reclaimable, and `gross`
   * when it is not. This - not `net` - is what the comparison should use.
   */
  effectiveCost: number
}

export function vatBreakdown(
  net: number,
  vatPercent = DEFAULT_VAT_PERCENT,
  reclaimable = true,
): VatBreakdown {
  const n = Number.isFinite(net) ? net : 0
  const rate = Number.isFinite(vatPercent) ? vatPercent : 0
  const vat = round2((n * rate) / 100)
  const claim = reclaimable ? vat : 0
  return {
    net: round2(n),
    vat,
    gross: round2(n + vat),
    reclaimable: claim,
    // Non-reclaimable VAT is a genuine cost and must land in the comparison.
    effectiveCost: round2(n + vat - claim),
  }
}

/**
 * Strips VAT out of a price that ALREADY CONTAINS IT.
 *
 * THE BUG THIS FIXES, reported by the owner: an invoice whose printed total was
 * Rs 69,958 VAT-INCLUSIVE was read as VAT-exclusive, so the screen added
 * Rs 10,493.70 on top and claimed Rs 80,451.70 was payable. Rs 10,493.70 of
 * cost that does not exist, on one document.
 *
 * Every price in this module means EXCLUDING VAT (`unit_price_net` is generated
 * as gross x (1 - discount) with no VAT term, and price history, valuation and
 * the China comparison all read it that way). So a VAT-inclusive document has to
 * be converted ONCE, here, at the edge - never by adjusting the maths further
 * downstream, which would leave two different meanings of "net" in one system.
 *
 * Divide, never subtract: Rs 210 inclusive at 15% is 210 / 1.15 = Rs 182.61, NOT
 * 210 - 15% = Rs 178.50. The second is the classic VAT error and is out by
 * Rs 4.11 a unit.
 */
export function vatExclusive(
  enteredPrice: number,
  vatPercent = DEFAULT_VAT_PERCENT,
  pricesIncludeVat = false,
): number {
  const p = Number.isFinite(enteredPrice) ? enteredPrice : 0
  if (!pricesIncludeVat) return round4(p)
  const rate = Number.isFinite(vatPercent) ? vatPercent : 0
  // A 0% rate means inclusive and exclusive are the same figure.
  if (rate <= 0) return round4(p)
  return round4(p / (1 + rate / 100))
}

/** What the document's prices turned out to mean, and how we know. */
export type VatBasis = {
  pricesIncludeVat: boolean
  /** True when the document did not give us enough to decide. */
  uncertain: boolean
  reason: string
}

/**
 * Works out whether a document's prices include VAT, from the document itself.
 *
 * This is decided by ARITHMETIC, not by trusting a label. `declaredTotal` is
 * extracted as "the grand total payable", which by definition already contains
 * VAT. So if the lines already add up to that total, the line prices must
 * contain VAT too; if they add up to it only after VAT is added, they do not.
 *
 * Returns `uncertain` rather than guessing when neither fits (or no total was
 * printed). A silent default is exactly what produced the Rs 10,493.70 error,
 * so an undecidable document must ask the buyer instead of picking quietly.
 */
export function detectVatBasis(
  lineSumAfterDiscount: number,
  declaredTotal: number | null | undefined,
  vatPercent = DEFAULT_VAT_PERCENT,
): VatBasis {
  const sum = Number.isFinite(lineSumAfterDiscount) ? lineSumAfterDiscount : 0
  const rate = Number.isFinite(vatPercent) ? vatPercent : 0

  if (declaredTotal == null || !Number.isFinite(declaredTotal) || declaredTotal <= 0 || sum <= 0) {
    return {
      pricesIncludeVat: false,
      uncertain: true,
      reason: 'The document does not print a grand total, so whether its prices include VAT cannot be checked. Assuming they exclude it - change this if the supplier bills VAT-inclusive.',
    }
  }

  // Tolerance absorbs per-line rounding across a dozen lines.
  const tol = Math.max(1, declaredTotal * 0.01)
  const withVat = sum * (1 + rate / 100)

  if (Math.abs(sum - declaredTotal) <= tol) {
    return {
      pricesIncludeVat: true,
      uncertain: false,
      reason: `The lines add up to ${sum.toFixed(2)}, which is the printed total payable - so these prices already include VAT.`,
    }
  }
  if (Math.abs(withVat - declaredTotal) <= tol) {
    return {
      pricesIncludeVat: false,
      uncertain: false,
      reason: `The lines add up to ${sum.toFixed(2)}, and only reach the printed total of ${declaredTotal.toFixed(2)} once ${rate}% VAT is added - so these prices exclude VAT.`,
    }
  }
  return {
    pricesIncludeVat: false,
    uncertain: true,
    reason: `The lines add up to ${sum.toFixed(2)}, which matches the printed total of ${declaredTotal.toFixed(2)} neither with nor without ${rate}% VAT. Check which basis is right before saving.`,
  }
}

/** Net unit price from a list price and a discount. Mirrors the generated column. */
export function netUnitPrice(gross: number, discountPercent?: number | null): number {
  const g = Number.isFinite(gross) ? gross : 0
  const d = discountPercent == null || !Number.isFinite(discountPercent) ? 0 : discountPercent
  return round4(g * (1 - d / 100))
}

export interface PurchaseUnitAmounts {
  enteredPrice: number
  /** Before discount, excluding VAT; this is the stored unit_price_gross. */
  listPriceNet: number
  /** After discount, excluding VAT; keep four decimals until line totals. */
  unitPriceNet: number
  discountPercent: number
  vatPercent: number
  pricesIncludeVat: boolean
  printedDiscountPercent?: number | null
  discountAlreadyIncluded?: boolean
  unitVat: VatBreakdown
}

export function purchaseUnitAmounts(input: {
  enteredPrice: number
  discountPercent?: number | null
  headerDiscountPercent?: number | null
  vatPercent?: number | null
  pricesIncludeVat?: boolean
  reclaimable?: boolean
}): PurchaseUnitAmounts {
  const rate = input.vatPercent ?? DEFAULT_VAT_PERCENT
  const discount = input.discountPercent ?? input.headerDiscountPercent ?? 0
  for (const [label, value] of [['VAT', rate], ['Discount', discount]] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 100 || Math.abs(value * 1000 - Math.round(value * 1000)) > 0.000001) {
      throw new Error(`${label} must be from 0 to 100%, with at most 3 decimal places.`)
    }
  }
  if (!Number.isFinite(input.enteredPrice) || input.enteredPrice < 0) {
    throw new Error('Enter a supplier unit price of 0 or more.')
  }
  const includesVat = input.pricesIncludeVat === true
  const listPriceNet = vatExclusive(input.enteredPrice, rate, includesVat)
  const unitPriceNet = netUnitPrice(listPriceNet, discount)
  return {
    enteredPrice: input.enteredPrice,
    listPriceNet,
    unitPriceNet,
    discountPercent: discount,
    vatPercent: rate,
    pricesIncludeVat: includesVat,
    unitVat: vatBreakdown(unitPriceNet, rate, input.reclaimable === true),
  }
}

/** Rounds to 2dp without float dust (0.1 + 0.2 style). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100 || 0
}

function round4(n: number): number {
  return Math.round((n + Number.EPSILON) * 10000) / 10000
}

// ---------------------------------------------------------------------------
// The cross-check
// ---------------------------------------------------------------------------

/** One costed China import, reduced to what choosing a reference needs. */
export interface ChinaCostRow {
  landedUnitCost: number
  importedAt: string | null
  qty: number | null
  supplierName: string | null
  /** The PO's own product label, for explaining a suspect row. */
  label: string | null
}

/** What we already know about buying this product from China. */
export interface ChinaCostRef {
  /**
   * Landed cost PER UNIT in rupees (`purchase_orders.import_cp`).
   *
   * VERIFIED per-unit, not a total: MEASURED 610 of 616 costed rows have
   * `total_cp_import / import_cp` within half a unit of `qty`, and the 6
   * exceptions are rounding on cheap high-quantity items (implied 9002.6 against
   * a qty of 9000), not a different meaning. Getting this backwards would have
   * divided the comparison by the order quantity - a 1,008-unit order would have
   * looked about 1,000x cheaper.
   */
  landedUnitCost: number
  /** When that order was imported, so a stale reference can be spotted. */
  importedAt: string | null
  /** Units bought on that order - context for whether the price is volume-based. */
  qty: number | null
  supplierName: string | null
  /** How many China POs exist for this product. 0 means genuinely never imported. */
  orderCount: number
  /** Costed rows only - how solid the reference is. */
  costedCount?: number
  /** Median landed cost of the costed rows, for context beside the reference. */
  medianUnitCost?: number | null
  /**
   * Rows rejected as price outliers - almost certainly a PO attached to the
   * wrong product. Surfaced rather than hidden so the link can be fixed.
   */
  suspectRows?: ChinaCostRow[]
}

/**
 * How far from the median a costed row may sit before it is treated as belonging
 * to a different product.
 *
 * WHY THIS EXISTS - a measured, live example. "Sweeping Robot" carries three
 * import POs: Rs 131.43 (qty 1008), Rs 133.56 (qty 528) and Rs 3,104.55 (qty 5,
 * labelled "Cleaning Cart"). The Cleaning Cart row is the NEWEST, so taking the
 * most recent import made the cross-check announce that a local price of Rs 168
 * was "94.6% cheaper than importing" - the exact opposite of the truth, which is
 * that local is about 26% dearer than the real Rs 133 landed cost.
 *
 * WHY NOT MATCH ON THE PO's NAME INSTEAD: measured, 226 of 547 linked products
 * have a PO whose label differs from the master name, and 186 of those carry a
 * cost - but nearly all are legitimate synonyms ("Back Roller" / "back
 * massager", "Marshall Headset" / "Marshall Headphone", "Mini Cooker" / "Mini
 * Rice Cooker"). Rejecting on the name would throw away ~186 valid references to
 * catch a handful of bad links. Magnitude is what actually separates them.
 *
 * 4x is deliberately loose: real landed costs for one product move by tens of
 * percent between shipments (freight and CBM apportionment), so a tight band
 * would reject genuine variation.
 */
export const OUTLIER_FACTOR = 4

function median(values: number[]): number | null {
  const s = values.filter((v) => v > 0).sort((a, b) => a - b)
  if (!s.length) return null
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : round2((s[mid - 1] + s[mid]) / 2)
}

/**
 * Picks the landed cost to compare against, from all of a product's imports.
 *
 * NEWEST WINS, because that is the price you could actually buy at today - an
 * average of an old cheap shipment and a recent dear one describes a price that
 * no longer exists. But a row more than `OUTLIER_FACTOR` away from the median is
 * skipped first (see above), so one mis-linked PO cannot dictate the verdict.
 *
 * Pure, so it is tested without touching the database.
 */
export function chooseChinaReference(
  rows: ChinaCostRow[],
  orderCount: number,
): ChinaCostRef {
  const costed = rows.filter((r) => r.landedUnitCost > 0)
  const med = median(costed.map((r) => r.landedUnitCost))

  const suspectRows: ChinaCostRow[] = []
  let usable = costed
  // Only meaningful with 3+ costed rows: with two, there is no majority and the
  // "outlier" could equally be the correct one.
  if (med != null && costed.length >= 3) {
    usable = costed.filter((r) => {
      const bad = r.landedUnitCost > med * OUTLIER_FACTOR || r.landedUnitCost < med / OUTLIER_FACTOR
      if (bad) suspectRows.push(r)
      return !bad
    })
  }

  // Newest first. Rows with no date sort last - an undated row is worse evidence
  // than a dated one, but still better than nothing.
  const sorted = usable
    .slice()
    .sort((a, b) => (b.importedAt ?? '').localeCompare(a.importedAt ?? ''))
  const chosen = sorted[0] ?? null

  return {
    landedUnitCost: chosen?.landedUnitCost ?? 0,
    importedAt: chosen?.importedAt ?? null,
    qty: chosen?.qty ?? null,
    supplierName: chosen?.supplierName ?? null,
    orderCount,
    costedCount: costed.length,
    medianUnitCost: med,
    suspectRows,
  }
}

export type Verdict =
  | 'local_cheaper'
  | 'local_dearer'
  | 'comparable'
  | 'no_china_history'
  | 'unlinked'

export interface LineComparison {
  verdict: Verdict
  /** Local effective cost per unit, after discount and after VAT reclaim. */
  localUnitCost: number
  /** China landed cost per unit, or null when there is nothing to compare to. */
  chinaUnitCost: number | null
  /**
   * Signed % difference of local against China. Positive = local costs MORE.
   * Null when there is no China reference.
   */
  variancePercent: number | null
  /** Money difference across the whole quoted quantity. Positive = local costs more. */
  totalDifference: number | null
  /** Stock already held, so you can see you may not need to buy at all. */
  stockOnHand: number | null
  /** True when existing stock already covers the quoted quantity. */
  stockCoversQty: boolean
  /** One-line plain-English summary for the UI. */
  message: string
}

/**
 * Prices within this band are called "comparable" rather than cheaper/dearer.
 *
 * Without a dead band, a 0.4% difference gets a colour and a verdict, which
 * trains the reader to ignore both. 3% is also inside the noise of what a
 * landed cost even means - freight and CBM apportionment move it by more than
 * that between shipments.
 */
export const COMPARABLE_BAND_PERCENT = 3

export function compareLine(input: {
  /** Net local unit price, excluding VAT (the generated `unit_price_net`). */
  localNetUnit: number
  qty: number
  vatPercent?: number
  /** False when the supplier is not VAT-registered - then VAT is a real cost. */
  vatReclaimable?: boolean
  china: ChinaCostRef | null
  stockOnHand?: number | null
  /** False when the quotation line is not yet linked to a product. */
  linked: boolean
}): LineComparison {
  const {
    localNetUnit,
    qty,
    vatPercent = DEFAULT_VAT_PERCENT,
    vatReclaimable = true,
    china,
    stockOnHand = null,
    linked,
  } = input

  const localUnitCost = vatBreakdown(localNetUnit, vatPercent, vatReclaimable).effectiveCost
  const stock = stockOnHand == null ? null : Number(stockOnHand)
  const stockCoversQty = stock != null && qty > 0 && stock >= qty

  // An unlinked line is NOT "no history" - it is "we do not know yet". Saying
  // "never imported" here is the single most expensive lie this screen could
  // tell, because it is indistinguishable from a genuine new product.
  if (!linked) {
    return {
      verdict: 'unlinked',
      localUnitCost,
      chinaUnitCost: null,
      variancePercent: null,
      totalDifference: null,
      stockOnHand: stock,
      stockCoversQty,
      message: 'Not linked to a product yet - link it to compare against import cost.',
    }
  }

  if (!china || !china.orderCount || !(china.landedUnitCost > 0)) {
    return {
      verdict: 'no_china_history',
      localUnitCost,
      chinaUnitCost: null,
      variancePercent: null,
      totalDifference: null,
      stockOnHand: stock,
      stockCoversQty,
      message: 'Never imported from China - no import cost to compare against.',
    }
  }

  const chinaUnitCost = china.landedUnitCost
  const variancePercent = round2(((localUnitCost - chinaUnitCost) / chinaUnitCost) * 100)
  const totalDifference = round2((localUnitCost - chinaUnitCost) * (qty || 0))

  const verdict: Verdict =
    Math.abs(variancePercent) <= COMPARABLE_BAND_PERCENT
      ? 'comparable'
      : variancePercent > 0
        ? 'local_dearer'
        : 'local_cheaper'

  const abs = Math.abs(variancePercent).toFixed(1)
  const message =
    verdict === 'comparable'
      ? `Within ${COMPARABLE_BAND_PERCENT}% of the import cost - effectively the same price.`
      : verdict === 'local_dearer'
        ? `${abs}% dearer than importing (Rs ${chinaUnitCost.toFixed(2)}/unit landed).`
        : `${abs}% cheaper than importing (Rs ${chinaUnitCost.toFixed(2)}/unit landed).`

  return {
    verdict,
    localUnitCost,
    chinaUnitCost,
    variancePercent,
    totalDifference,
    stockOnHand: stock,
    stockCoversQty,
    message,
  }
}
