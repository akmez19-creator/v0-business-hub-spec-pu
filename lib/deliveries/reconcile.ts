/**
 * Delivery reconciliation core.
 *
 * Pure functions only - no Supabase, no React - so the whole plan can be
 * computed and verified offline against the real spreadsheet before anything
 * is written. See v0_memories/user/deliveries-import.md for the measured facts
 * this is built on.
 *
 * WHY RECONCILE INSTEAD OF IMPORT: the monthly COMPILE file overlaps ~69% with
 * rows already in the system, and those existing rows carry assignment work
 * (3,777 of 3,785 August rows have a contractor). A plain import would either
 * duplicate them or - if wiped first - destroy the assignments. Reconciliation
 * matches first, then only inserts what is genuinely new and updates what
 * genuinely changed.
 */

export type SalesType = 'sale' | 'refund' | 'exchange' | 'trade_in' | 'drop_off' | 'pick_up'

/** A row parsed out of the COMPILE spreadsheet, already keyed by our field names. */
export interface FileRow {
  rowNumber: number
  rte: string | null
  entry_date: string | null
  delivery_date: string | null
  customer_name: string | null
  contact_1: string | null
  contact_2: string | null
  region: string | null
  qty: number | null
  products: string | null
  amount: number | null
  payment_method: string | null
  sales_type: string | null
  notes: string | null
  medium: string | null
  /** Zone/route label ("WEST", "EAST-1"). NOT a person - never mapped to a rider. */
  zone: string | null
}

/** The subset of an existing delivery we need in order to compare. */
export interface DbRow {
  id: string
  delivery_date: string | null
  customer_name: string | null
  contact_1: string | null
  contact_2: string | null
  products: string | null
  amount: number | null
  qty: number | null
  sales_type: string | null
  medium: string | null
  notes: string | null
  rte: string | null
  locality: string | null
  entry_date: string | null
  payment_method: string | null
  rider_id: string | null
  contractor_id: string | null
  status: string | null
}

export interface FieldDiff {
  field: string
  from: unknown
  to: unknown
}

export type MatchTier = 'contact+date+product+amount' | 'contact+date+product' | 'name+date+product' | 'contact+date'

export interface PlanRow {
  rowNumber: number
  file: FileRow
  /** Canonical values we would actually write. */
  resolved: {
    delivery_date: string | null
    customer_name: string | null
    contact_1: string | null
    contact_2: string | null
    locality: string | null
    qty: number
    products: string | null
    product_id: string | null
    amount: number
    sales_type: SalesType
    notes: string | null
    medium: string | null
    rte: string | null
    entry_date: string | null
    payment_method: string | null
  }
  productMatch: 'exact' | 'normalized' | 'variant' | 'none'
  warnings: string[]
}

export interface InsertPlanRow extends PlanRow {
  action: 'insert'
}
export interface UpdatePlanRow extends PlanRow {
  action: 'update'
  dbId: string
  tier: MatchTier
  diffs: FieldDiff[]
}
export interface UnchangedPlanRow extends PlanRow {
  action: 'unchanged'
  dbId: string
  tier: MatchTier
}
export interface DuplicatePlanRow extends PlanRow {
  action: 'duplicate'
  /** Row number of the row inside the file this one duplicates. */
  duplicateOf: number
  /** true when every one of the 19 spreadsheet columns is identical. */
  identical: boolean
}

export interface DbOnlyRow {
  id: string
  delivery_date: string | null
  customer_name: string | null
  contact_1: string | null
  products: string | null
  amount: number | null
  hasAssignment: boolean
  status: string | null
}

export interface ReconcilePlan {
  inserts: InsertPlanRow[]
  updates: UpdatePlanRow[]
  unchanged: UnchangedPlanRow[]
  duplicates: DuplicatePlanRow[]
  dbOnly: DbOnlyRow[]
  skipped: { rowNumber: number; reason: string }[]
  stats: {
    fileRows: number
    dbRows: number
    inserts: number
    updates: number
    unchanged: number
    duplicates: number
    dbOnly: number
    skipped: number
    productsUnmatched: number
    matchedByTier: Record<string, number>
    fileAmountTotal: number
  }
}

/* ------------------------------------------------------------------ *
 * Normalisation
 * ------------------------------------------------------------------ */

export function normText(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Phone numbers arrive as NUMBERS from Excel (58483166) but are stored as TEXT
 * ("57868750"). Comparing raw values makes every row look new - that mistake
 * showed a 0% overlap when the truth was 69%. Always compare digits only.
 */
export function normContact(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).replace(/\D/g, '')
}

/** Excel Dates, ISO strings and timestamps all collapse to YYYY-MM-DD. */
export function normDate(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return ''
    return v.toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return iso[0]
  const parsed = new Date(s)
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  return ''
}

/**
 * Variant suffixes are why 106 of 234 file product names miss the catalogue:
 * "Funnel - B1G1", "Posture Corrector - M", "Welding Rods - Set of 8".
 * Stripping them recovers the base product. Reported as tier 'variant' so a
 * human can still review what was collapsed.
 */
export function productBaseKey(name: unknown): string {
  let s = normText(name)
  if (!s) return ''
  s = s.replace(/\s*[-–]\s*(b\d ?g\d|buy \d get \d)\s*$/i, '')
  s = s.replace(/\s*[-–]\s*set of \d+\s*$/i, '')
  s = s.replace(/\s*[-–]\s*(xxl|xxxl|xl|l|m|s|small|medium|large)\s*$/i, '')
  s = s.replace(/\s*\(\s*(b\d ?g\d|set of \d+|xxl|xxxl|xl|l|m|s)\s*\)\s*$/i, '')
  s = s.replace(/\s*[-–]\s*\d+\s*(pc|pcs|pieces?|pack)\s*$/i, '')
  return s.trim()
}

/**
 * The file writes the same meaning many ways: SALES/sale, TRADE IN/TRADEIN/
 * "TARDE IN" (a real typo in the data), EXCHANGE/exchange, DROP OFF/drop_off.
 * The DB stores lowercase snake_case.
 */
export function canonicalSalesType(v: unknown): SalesType {
  const s = normText(v).replace(/[\s-]+/g, '_')
  if (!s) return 'sale'
  if (/^(sale|sales|paid)$/.test(s)) return 'sale'
  if (/^refund/.test(s)) return 'refund'
  if (/^exchange/.test(s)) return 'exchange'
  if (/^(trade_in|tradein|tarde_in|tardein|trade)$/.test(s)) return 'trade_in'
  if (/^drop_?off$/.test(s)) return 'drop_off'
  if (/^pick_?up$/.test(s)) return 'pick_up'
  return 'sale'
}

export function canonicalMedium(v: unknown): string | null {
  const s = normText(v)
  if (!s) return null
  return s.toUpperCase()
}

export function parseAmount(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0
  const n = Number(String(v).replace(/[^0-9.-]/g, ''))
  return isNaN(n) ? 0 : n
}

export function parseQty(v: unknown): number {
  const n = parseInt(String(v ?? '').replace(/[^0-9-]/g, ''), 10)
  if (isNaN(n) || n === 0) return 1
  return n
}

/* ------------------------------------------------------------------ *
 * Matching
 * ------------------------------------------------------------------ */

const keyContactDateProductAmount = (
  contact: string,
  date: string,
  product: string,
  amount: number,
) => `${contact}|${date}|${product}|${amount}`
const keyContactDateProduct = (contact: string, date: string, product: string) => `${contact}|${date}|${product}`
const keyNameDateProduct = (name: string, date: string, product: string) => `${name}|${date}|${product}`
const keyContactDate = (contact: string, date: string) => `${contact}|${date}`

/** Fields we are willing to overwrite from the spreadsheet. */
export const UPDATABLE_FIELDS = [
  'customer_name',
  'contact_1',
  'contact_2',
  'locality',
  'qty',
  'products',
  'amount',
  'sales_type',
  'notes',
  'medium',
  'rte',
  'entry_date',
  'payment_method',
] as const

/**
 * Deliberately NOT updated: rider_id, contractor_id, status, assigned_*,
 * delivered_at, cash_*, juice_*, stock_*, payment_status, rider_paid.
 * Those are operational facts earned in the app; a spreadsheet must never
 * clobber them. 3,777 August rows carry a contractor assignment.
 */

export interface ProductLookup {
  /** normalised full name -> product id */
  byName: Map<string, string>
  /** variant-stripped base name -> product id */
  byBase: Map<string, string>
}

export function buildProductLookup(products: { id: string; name: string }[]): ProductLookup {
  const byName = new Map<string, string>()
  const byBase = new Map<string, string>()
  for (const p of products) {
    const n = normText(p.name)
    if (n && !byName.has(n)) byName.set(n, p.id)
    const b = productBaseKey(p.name)
    if (b && !byBase.has(b)) byBase.set(b, p.id)
  }
  return { byName, byBase }
}

function resolveProduct(
  name: string | null,
  lookup: ProductLookup,
): { id: string | null; match: PlanRow['productMatch'] } {
  if (!name) return { id: null, match: 'none' }
  const exact = lookup.byName.get(normText(name))
  if (exact) return { id: exact, match: 'exact' }
  const base = productBaseKey(name)
  const viaBase = lookup.byBase.get(base) ?? lookup.byName.get(base)
  if (viaBase) return { id: viaBase, match: 'variant' }
  return { id: null, match: 'none' }
}

/** Region -> locality. The file's Region is free text; locality is what we store. */
function resolveLocality(region: string | null): string | null {
  const s = region ? String(region).trim() : ''
  return s === '' ? null : s
}

function buildResolved(row: FileRow, lookup: ProductLookup): { resolved: PlanRow['resolved']; productMatch: PlanRow['productMatch']; warnings: string[] } {
  const warnings: string[] = []
  const product = resolveProduct(row.products, lookup)
  const amount = parseAmount(row.amount)
  const date = normDate(row.delivery_date)

  if (!row.customer_name || String(row.customer_name).trim() === '') warnings.push('missing customer name')
  if (!row.products || String(row.products).trim() === '') warnings.push('missing product')
  if (!normContact(row.contact_1)) warnings.push('missing phone')
  else if (normContact(row.contact_1).length < 8) warnings.push(`short phone (${normContact(row.contact_1).length} digits)`)
  if (row.amount === null || row.amount === undefined || String(row.amount).trim() === '') warnings.push('missing amount')
  else if (amount < 0) warnings.push('negative amount (refund?)')
  else if (amount === 0) warnings.push('zero amount')
  if (product.match === 'variant') warnings.push('product matched by stripping a variant suffix')
  if (product.match === 'none' && row.products) warnings.push('product not in catalogue')
  if (normText(row.zone) === 'not found') warnings.push('zone marked NOT FOUND')

  return {
    productMatch: product.match,
    warnings,
    resolved: {
      delivery_date: date || null,
      customer_name: row.customer_name ? String(row.customer_name).trim() : null,
      contact_1: row.contact_1 ? String(row.contact_1).trim() : null,
      contact_2: row.contact_2 ? String(row.contact_2).trim() : null,
      locality: resolveLocality(row.region),
      qty: parseQty(row.qty),
      products: row.products ? String(row.products).trim() : null,
      product_id: product.id,
      amount,
      sales_type: canonicalSalesType(row.sales_type),
      notes: row.notes ? String(row.notes).trim() : null,
      medium: canonicalMedium(row.medium),
      rte: row.rte ? String(row.rte).trim() : null,
      entry_date: normDate(row.entry_date) || null,
      payment_method: row.payment_method ? normText(row.payment_method) : null,
    },
  }
}

function diffAgainstDb(resolved: PlanRow['resolved'], db: DbRow): FieldDiff[] {
  const diffs: FieldDiff[] = []
  const cmp = (field: string, next: unknown, current: unknown, mode: 'text' | 'num' | 'contact' | 'date' = 'text') => {
    // Never blank out an existing value with an empty spreadsheet cell.
    const nextEmpty = next === null || next === undefined || String(next).trim() === ''
    if (nextEmpty) return
    let same: boolean
    if (mode === 'num') same = Number(next ?? 0) === Number(current ?? 0)
    else if (mode === 'contact') same = normContact(next) === normContact(current)
    else if (mode === 'date') same = normDate(next) === normDate(current)
    else same = normText(next) === normText(current)
    if (!same) diffs.push({ field, from: current ?? null, to: next })
  }

  cmp('customer_name', resolved.customer_name, db.customer_name)
  cmp('contact_1', resolved.contact_1, db.contact_1, 'contact')
  cmp('contact_2', resolved.contact_2, db.contact_2, 'contact')
  cmp('locality', resolved.locality, db.locality)
  cmp('qty', resolved.qty, db.qty, 'num')
  cmp('products', resolved.products, db.products)
  cmp('amount', resolved.amount, db.amount, 'num')
  cmp('sales_type', resolved.sales_type, db.sales_type)
  cmp('notes', resolved.notes, db.notes)
  cmp('medium', resolved.medium, db.medium)
  cmp('rte', resolved.rte, db.rte)
  cmp('entry_date', resolved.entry_date, db.entry_date, 'date')
  cmp('payment_method', resolved.payment_method, db.payment_method)
  return diffs
}

/** Every one of the meaningful spreadsheet columns identical => a true duplicate line. */
function fileRowFingerprint(r: FileRow): string {
  return [
    normDate(r.delivery_date),
    normDate(r.entry_date),
    normText(r.customer_name),
    normContact(r.contact_1),
    normContact(r.contact_2),
    normText(r.region),
    parseQty(r.qty),
    normText(r.products),
    parseAmount(r.amount),
    normText(r.payment_method),
    canonicalSalesType(r.sales_type),
    normText(r.notes),
    normText(r.medium),
    normText(r.zone),
    normText(r.rte),
  ].join('\u0001')
}

/**
 * Build the full reconciliation plan.
 *
 * Matching runs in tiers, strongest first, and each existing row can only be
 * claimed once. `contact+date` alone is deliberately the LAST resort and only
 * used when the key is unique on both sides: 377 file rows share a
 * contact+date, but most are one customer buying several different products
 * that day, so treating that key as identity would wrongly merge real orders.
 */
export function buildPlan(
  fileRows: FileRow[],
  dbRows: DbRow[],
  products: { id: string; name: string }[],
): ReconcilePlan {
  const lookup = buildProductLookup(products)
  const plan: ReconcilePlan = {
    inserts: [],
    updates: [],
    unchanged: [],
    duplicates: [],
    dbOnly: [],
    skipped: [],
    stats: {
      fileRows: fileRows.length,
      dbRows: dbRows.length,
      inserts: 0,
      updates: 0,
      unchanged: 0,
      duplicates: 0,
      dbOnly: 0,
      skipped: 0,
      productsUnmatched: 0,
      matchedByTier: {},
      fileAmountTotal: 0,
    },
  }

  // ---- index the DB side, tier by tier ----
  const claimed = new Set<string>()
  const byId = new Map<string, DbRow>()
  const t1 = new Map<string, string[]>()
  const t2 = new Map<string, string[]>()
  const t3 = new Map<string, string[]>()
  const t4 = new Map<string, string[]>()
  const push = (m: Map<string, string[]>, k: string, id: string) => {
    const cur = m.get(k)
    if (cur) cur.push(id)
    else m.set(k, [id])
  }
  for (const d of dbRows) {
    byId.set(d.id, d)
    const date = normDate(d.delivery_date)
    const contact = normContact(d.contact_1)
    const product = normText(d.products)
    const name = normText(d.customer_name)
    if (contact && date) {
      push(t1, keyContactDateProductAmount(contact, date, product, Number(d.amount ?? 0)), d.id)
      push(t2, keyContactDateProduct(contact, date, product), d.id)
      push(t4, keyContactDate(contact, date), d.id)
    }
    if (name && date) push(t3, keyNameDateProduct(name, date, product), d.id)
  }

  const take = (m: Map<string, string[]>, k: string): string | null => {
    const ids = m.get(k)
    if (!ids) return null
    for (const id of ids) if (!claimed.has(id)) return id
    return null
  }

  const seenFingerprints = new Map<string, number>()

  for (const row of fileRows) {
    const { resolved, productMatch, warnings } = buildResolved(row, lookup)
    const base: PlanRow = { rowNumber: row.rowNumber, file: row, resolved, productMatch, warnings }

    if (!resolved.delivery_date) {
      plan.skipped.push({ rowNumber: row.rowNumber, reason: 'unparseable or missing delivery date' })
      continue
    }
    if (!resolved.customer_name) {
      plan.skipped.push({ rowNumber: row.rowNumber, reason: 'missing customer name (NOT NULL in the database)' })
      continue
    }

    plan.stats.fileAmountTotal += resolved.amount
    if (productMatch === 'none' && resolved.products) plan.stats.productsUnmatched++

    // in-file duplicate?
    const fp = fileRowFingerprint(row)
    const firstSeen = seenFingerprints.get(fp)
    if (firstSeen !== undefined) {
      plan.duplicates.push({ ...base, action: 'duplicate', duplicateOf: firstSeen, identical: true })
      continue
    }
    seenFingerprints.set(fp, row.rowNumber)

    const contact = normContact(resolved.contact_1)
    const date = resolved.delivery_date
    const product = normText(resolved.products)
    const name = normText(resolved.customer_name)

    let dbId: string | null = null
    let tier: MatchTier | null = null
    if (contact) {
      dbId = take(t1, keyContactDateProductAmount(contact, date, product, resolved.amount))
      if (dbId) tier = 'contact+date+product+amount'
      if (!dbId) {
        dbId = take(t2, keyContactDateProduct(contact, date, product))
        if (dbId) tier = 'contact+date+product'
      }
    }
    if (!dbId && name) {
      dbId = take(t3, keyNameDateProduct(name, date, product))
      if (dbId) tier = 'name+date+product'
    }
    if (!dbId && contact) {
      // last resort, and only when unambiguous on both sides
      const k = keyContactDate(contact, date)
      const candidates = (t4.get(k) ?? []).filter((id) => !claimed.has(id))
      if (candidates.length === 1) {
        dbId = candidates[0]
        tier = 'contact+date'
      }
    }

    if (dbId && tier) {
      claimed.add(dbId)
      plan.stats.matchedByTier[tier] = (plan.stats.matchedByTier[tier] ?? 0) + 1
      const db = byId.get(dbId)!
      const diffs = diffAgainstDb(resolved, db)
      if (diffs.length) plan.updates.push({ ...base, action: 'update', dbId, tier, diffs })
      else plan.unchanged.push({ ...base, action: 'unchanged', dbId, tier })
    } else {
      plan.inserts.push({ ...base, action: 'insert' })
    }
  }

  for (const d of dbRows) {
    if (claimed.has(d.id)) continue
    plan.dbOnly.push({
      id: d.id,
      delivery_date: normDate(d.delivery_date) || null,
      customer_name: d.customer_name,
      contact_1: d.contact_1,
      products: d.products,
      amount: d.amount,
      hasAssignment: Boolean(d.rider_id || d.contractor_id),
      status: d.status,
    })
  }

  plan.stats.inserts = plan.inserts.length
  plan.stats.updates = plan.updates.length
  plan.stats.unchanged = plan.unchanged.length
  plan.stats.duplicates = plan.duplicates.length
  plan.stats.dbOnly = plan.dbOnly.length
  plan.stats.skipped = plan.skipped.length
  return plan
}
