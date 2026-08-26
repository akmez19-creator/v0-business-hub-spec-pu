/**
 * What one unit of stock cost, and what the stock on the shelf is worth.
 *
 * Currency, established by probing the real data rather than assuming:
 *   - `unit_price` and `total_payment_supplier_yuan` are YUAN (1688 prices).
 *   - `total_payment_supplier`, `cbm_cost` and `total_cp_import` are MUR.
 *     Verified: total_cp_import = total_payment_supplier + cbm_cost exactly on
 *     every sampled row, and MUR/yuan lands at ~8.4 across 616 priced POs.
 * Everything below is MUR. Yuan is only ever shown as a labelled reference.
 */

/** A per-unit landed cost and where it came from. */
export interface UnitCost {
  /** Landed cost of one unit, in MUR. */
  cost: number
  source: 'manual' | 'po'
  /** For 'po': which order the cost came from, so the number is checkable. */
  poDate?: string | null
  poQty?: number
  poTotal?: number
  /** >1 when several equally-recent orders were pooled to get this cost. */
  pooledFrom?: number
  /** Yuan unit price on that order, for reference only. Never valued. */
  yuanUnitPrice?: number | null
}

export interface CostRow {
  product_id: string | null
  qty: number | null
  total_cp_import: number | null
  unit_price: number | null
  order_date: string | null
  created_at: string | null
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

/**
 * Cost per unit from ONE purchase order: the whole landed cost divided by the
 * quantity it covers.
 *
 * `import_cp` already holds this division and agrees within 1% on all 616
 * priced rows, but it is a stored copy - dividing here means an edited total or
 * qty can never leave a stale per-unit figure behind.
 */
export function poUnitCost(row: CostRow): number | null {
  const total = num(row.total_cp_import)
  const qty = num(row.qty)
  if (total <= 0 || qty <= 0) return null
  return total / qty
}

/**
 * How recent a purchase order is, as [orderDate, createdAt].
 *
 * Both parts are needed. order_date is the real purchasing date but is null on
 * many rows, and 483 of the priced orders share ONE order_date - they were
 * imported together - so order_date alone leaves hundreds of ties and "most
 * recent" would come down to whatever order the rows happened to arrive in.
 * created_at breaks those ties. Undated rows sort below every dated one so a
 * back-filled import cannot outrank a genuinely newer order.
 */
function recencyOf(row: CostRow): [number, number] {
  const d = row.order_date ? Date.parse(row.order_date) : NaN
  const c = row.created_at ? Date.parse(row.created_at) : NaN
  const created = Number.isFinite(c) ? c : -Infinity
  return [Number.isFinite(d) ? d : -Infinity, created]
}

/** Positive when `a` is the more recent order. */
function moreRecent(a: [number, number], b: [number, number]): number {
  return a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]
}

/**
 * Most recent priced purchase order per product, as a per-unit landed cost.
 *
 * Rows with no usable cost are skipped rather than counted as zero - a zero
 * would quietly value real stock at nothing.
 */
export function costsFromPurchaseOrders(rows: CostRow[]): Map<string, UnitCost> {
  // Keep every row tied for most-recent, not just the first one seen. Only 1 of
  // 613 priced orders carries an order_date, so recency is decided almost
  // entirely by import timestamp - and rows imported in the same batch tie
  // exactly. Picking one of a tie by arrival order made a 10-unit sample order
  // set the cost for 160 units of A9 Camera and moved the inventory total by
  // Rs 17,489 with nothing to justify the choice.
  const best = new Map<string, { rows: CostRow[]; at: [number, number] }>()
  for (const row of rows) {
    if (!row.product_id) continue
    if (poUnitCost(row) === null) continue
    const at = recencyOf(row)
    const prev = best.get(row.product_id)
    if (!prev) {
      best.set(row.product_id, { rows: [row], at })
      continue
    }
    const cmp = moreRecent(at, prev.at)
    if (cmp > 0) best.set(row.product_id, { rows: [row], at })
    else if (cmp === 0) prev.rows.push(row)
  }

  const out = new Map<string, UnitCost>()
  for (const [id, { rows: tied }] of best) {
    // A tie is pooled, not picked: total landed cost of the tied orders over
    // the total quantity they cover. That is the same "total CP / qty" rule,
    // just applied to orders that are equally recent, and it stops a tiny
    // order - which carries the same fixed shipping - from pricing the lot.
    const totalCost = tied.reduce((s, r) => s + num(r.total_cp_import), 0)
    const totalQty = tied.reduce((s, r) => s + num(r.qty), 0)
    if (totalQty <= 0) continue
    const head = tied[0]
    out.set(id, {
      cost: totalCost / totalQty,
      source: 'po',
      poDate: head.order_date ?? head.created_at ?? null,
      poQty: totalQty,
      poTotal: totalCost,
      pooledFrom: tied.length,
      yuanUnitPrice: head.unit_price == null ? null : num(head.unit_price),
    })
  }
  return out
}

/**
 * The cost actually used for a product.
 *
 * A hand-entered cost wins over purchase history. That is deliberate: without
 * it there would be no way to correct a wrong or unrepresentative PO, and the
 * UI labels every row with the source so the override is never invisible.
 */
export function resolveUnitCost(
  product: { id: string; cost_price?: number | string | null },
  fromPo: Map<string, UnitCost>,
): UnitCost | null {
  const manual = product.cost_price == null ? 0 : num(product.cost_price)
  if (manual > 0) return { cost: manual, source: 'manual' }
  return fromPo.get(product.id) ?? null
}

export interface ValuationInput {
  id: string
  name?: string | null
  quantity?: number | null
  cost_price?: number | string | null
  sold_out?: boolean | null
  has_variants?: boolean | null
}

export interface Valuation {
  /** Products with stock on the shelf AND a known cost. */
  valuedCount: number
  /** Units behind `total`. */
  valuedUnits: number
  /** MUR value of counted on-hand stock that has a cost. */
  total: number
  /** Products with stock on the shelf but NO cost - excluded from `total`. */
  missingCount: number
  /** Units excluded from `total` for want of a cost. */
  missingUnits: number
  /** How many of the valued products used a hand-entered cost. */
  manualCount: number
}

/**
 * Value of stock physically on the shelf.
 *
 * Uses `products.quantity` only - the counted Mauritius on-hand, and the same
 * number the inventory table shows. Goods in China or undelivered are owned but
 * not on the shelf, and folding them in would make this disagree with the
 * on-hand column right next to it.
 *
 * Products without a cost are counted separately, never valued at zero: a
 * silent zero would present a half-covered total as the whole inventory.
 */
export function valueStock(products: ValuationInput[], fromPo: Map<string, UnitCost>): Valuation {
  const v: Valuation = {
    valuedCount: 0,
    valuedUnits: 0,
    total: 0,
    missingCount: 0,
    missingUnits: 0,
    manualCount: 0,
  }
  for (const p of products) {
    const qty = num(p.quantity)
    if (qty <= 0) continue
    const unit = resolveUnitCost(p, fromPo)
    if (!unit) {
      v.missingCount++
      v.missingUnits += qty
      continue
    }
    v.valuedCount++
    v.valuedUnits += qty
    v.total += qty * unit.cost
    if (unit.source === 'manual') v.manualCount++
  }
  return v
}

/** Rs with no decimals - inventory value is never meaningful to the cent. */
export function fmtMur(n: number): string {
  return `Rs ${Math.round(n).toLocaleString('en-US')}`
}

/** Per-unit costs are small, so cents matter here where they do not in totals. */
export function fmtMurUnit(n: number): string {
  return `Rs ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
