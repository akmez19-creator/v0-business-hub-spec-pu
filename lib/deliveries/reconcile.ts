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

/**
 * Which signals agreed. The DELIVERY DATE always agrees - matching is done one
 * date at a time and nothing is ever paired across two dates.
 *
 * The date cannot be dropped from identity: 849 customers have more than one
 * row and 675 of those span different dates, so name+number alone would merge a
 * customer's separate orders from different days into one entry.
 *
 * 'name+date' exists because the stored phone number is not always usable -
 * measured cases include digit typos ('581044227' vs '58104227'), country-code
 * prefixes, and whole sentences pasted into the number column. When the name,
 * the day and the product all agree, that is the same order.
 */
export type MatchTier = 'name+number+date' | 'number+date' | 'name+date'

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
/**
 * Same customer (name + number) on the same day, but the product does not
 * match the existing entry. NEVER written automatically - a product change is
 * either a genuine correction or a sign the two rows are actually different
 * orders, and only a human can tell which.
 */
export interface FlaggedPlanRow extends PlanRow {
  action: 'flagged'
  dbId: string
  tier: MatchTier
  reason: 'product mismatch'
  dbProducts: string | null
  dbAmount: number | null
  diffs: FieldDiff[]
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

/**
 * One delivery date from the spreadsheet, with everything that would happen on
 * that day. This is what makes reconciling date-by-date possible: the operator
 * picks the days to apply and the totals for exactly those days are already
 * known, without re-running the plan.
 */
export interface DateBucket {
  /** YYYY-MM-DD delivery date, taken from the file - never the entry date. */
  date: string
  fileRows: number
  inserts: number
  updates: number
  unchanged: number
  flagged: number
  duplicates: number
  /** Existing entries on this date that the file does not mention. */
  dbOnly: number
  /** Existing entries in the system on this date. */
  dbRows: number
  fileAmountTotal: number
  /** True when this date falls outside the target month being reconciled. */
  outOfMonth: boolean
}

export interface ReconcilePlan {
  inserts: InsertPlanRow[]
  updates: UpdatePlanRow[]
  unchanged: UnchangedPlanRow[]
  flagged: FlaggedPlanRow[]
  duplicates: DuplicatePlanRow[]
  dbOnly: DbOnlyRow[]
  skipped: { rowNumber: number; reason: string }[]
  /**
   * Rows whose delivery date was not among the selected dates. Held back
   * entirely - not counted as new, not counted as skipped errors.
   */
  outOfScope: { rowNumber: number; date: string }[]
  stats: {
    fileRows: number
    dbRows: number
    inserts: number
    updates: number
    unchanged: number
    flagged: number
    duplicates: number
    dbOnly: number
    skipped: number
    outOfScope: number
    productsUnmatched: number
    matchedByTier: Record<string, number>
    fileAmountTotal: number
    /** Per delivery date, ascending. */
    byDate: DateBucket[]
  }
}

export interface BuildPlanOptions {
  /**
   * Restrict reconciliation to these delivery dates (YYYY-MM-DD). Omit to use
   * every date present in the file. Existing entries on other dates are left
   * completely alone - they cannot be updated, flagged or removed.
   */
  dates?: string[]
  /** Target month (YYYY-MM), used only to mark dates that fall outside it. */
  month?: string
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
/** Untouched cell values, used only to tell a true byte-repeat from a normalised one. */
function rawRowFingerprint(r: FileRow): string {
  return [
    r.rte,
    r.entry_date,
    r.delivery_date,
    r.customer_name,
    r.contact_1,
    r.contact_2,
    r.region,
    r.qty,
    r.products,
    r.amount,
    r.payment_method,
    r.sales_type,
    r.notes,
    r.medium,
    r.zone,
  ]
    .map((v) => String(v ?? ''))
    .join('\u0001')
}

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
 * HOW MATCHING WORKS - ONE DELIVERY DATE AT A TIME.
 *
 * The delivery date is the anchor: both sides are partitioned by it and a row
 * is NEVER paired against a different date. Within a single date, a customer
 * may legitimately have several separate orders, so the passes below run
 * strongest-first and each existing row can be claimed only once:
 *
 *   1. name + number + product   - the same customer, the same item
 *   2. number + product          - the name is spelled differently
 *   3. name + product            - the stored number is wrong or unusable
 *   4. name + number             - same customer, DIFFERENT product -> FLAG
 *   5. number only, unambiguous  - DIFFERENT product -> FLAG
 *   6. name only, unambiguous    - DIFFERENT product -> FLAG
 *   7. anything left over        - genuinely a new order -> insert
 *
 * Passes 1-3 anchor on the product, which is what stops a customer's two
 * same-day orders from being cross-matched and both reported as "changed".
 * Passes 4-6 are how an existing customer whose product does not line up gets
 * surfaced for review instead of being silently overwritten or duplicated.
 *
 * The output buckets always sum back to the file's row count.
 *
 * Pass `options.dates` to reconcile only certain delivery dates. Rows on other
 * dates go to `outOfScope` and existing entries on those dates are excluded
 * from the index entirely, so a single-day run cannot touch the rest of the
 * month. `stats.byDate` always reports every date, selected or not, so the UI
 * can show what each day would do before anything is applied.
 */
export function buildPlan(
  fileRows: FileRow[],
  dbRows: DbRow[],
  products: { id: string; name: string }[],
  options: BuildPlanOptions = {},
): ReconcilePlan {
  const lookup = buildProductLookup(products)
  // An empty array means "no dates selected", which is different from omitted.
  const selected = options.dates ? new Set(options.dates) : null
  const inScope = (date: string) => selected === null || selected.has(date)

  const plan: ReconcilePlan = {
    inserts: [],
    updates: [],
    unchanged: [],
    flagged: [],
    duplicates: [],
    dbOnly: [],
    skipped: [],
    outOfScope: [],
    stats: {
      fileRows: fileRows.length,
      dbRows: dbRows.length,
      inserts: 0,
      updates: 0,
      unchanged: 0,
      flagged: 0,
      duplicates: 0,
      dbOnly: 0,
      skipped: 0,
      outOfScope: 0,
      productsUnmatched: 0,
      matchedByTier: {},
      fileAmountTotal: 0,
      byDate: [],
    },
  }

  // ---- index the DB side, partitioned by delivery date ----
  // Existing entries on a date that was NOT selected are dropped from the index
  // entirely, so they can never be matched, changed or reported as orphaned.
  const byId = new Map<string, DbRow>()
  const dbIdsByDate = new Map<string, string[]>()
  const dbRowsPerDate = new Map<string, number>()
  for (const d of dbRows) {
    const date = normDate(d.delivery_date)
    if (!date) continue
    dbRowsPerDate.set(date, (dbRowsPerDate.get(date) ?? 0) + 1)
    if (!inScope(date)) continue
    byId.set(d.id, d)
    const cur = dbIdsByDate.get(date)
    if (cur) cur.push(d.id)
    else dbIdsByDate.set(date, [d.id])
  }

  /* ---- phase 1: resolve, validate, drop in-file duplicates ---- */
  interface Candidate {
    base: PlanRow
    date: string
    name: string
    contact: string
    productKey: string
    productBase: string
  }
  const candidates: Candidate[] = []
  const seenFingerprints = new Map<string, number>()
  const rawFingerprints = new Map<string, string>()

  for (const row of fileRows) {
    const { resolved, productMatch, warnings } = buildResolved(row, lookup)
    const base: PlanRow = { rowNumber: row.rowNumber, file: row, resolved, productMatch, warnings }

    if (!resolved.delivery_date) {
      plan.skipped.push({ rowNumber: row.rowNumber, reason: 'unparseable or missing delivery date' })
      continue
    }
    // Scope is decided by the DELIVERY date, before any other validation, so a
    // row on an unselected day is simply not part of this run rather than being
    // reported as a problem.
    if (!inScope(resolved.delivery_date)) {
      plan.outOfScope.push({ rowNumber: row.rowNumber, date: resolved.delivery_date })
      continue
    }
    if (!resolved.customer_name) {
      plan.skipped.push({ rowNumber: row.rowNumber, reason: 'missing customer name (NOT NULL in the database)' })
      continue
    }

    plan.stats.fileAmountTotal += resolved.amount
    if (productMatch === 'none' && resolved.products) plan.stats.productsUnmatched++

    const fp = fileRowFingerprint(row)
    const firstSeen = seenFingerprints.get(fp)
    if (firstSeen !== undefined) {
      // `identical` distinguishes a byte-for-byte repeat from one that only
      // matches after normalising (measured: 4 rows differ solely by
      // 'SALES' vs 'sale'), so the UI never overstates what it dropped.
      plan.duplicates.push({
        ...base,
        action: 'duplicate',
        duplicateOf: firstSeen,
        identical: rawFingerprints.get(fp) === rawRowFingerprint(row),
      })
      continue
    }
    seenFingerprints.set(fp, row.rowNumber)
    rawFingerprints.set(fp, rawRowFingerprint(row))

    candidates.push({
      base,
      date: resolved.delivery_date,
      name: normText(resolved.customer_name),
      contact: normContact(resolved.contact_1),
      productKey: normText(resolved.products),
      productBase: productBaseKey(resolved.products),
    })
  }

  /* ---- phase 2: match one delivery date at a time ---- */
  const claimed = new Set<string>()
  const pairs: { cand: Candidate; dbId: string; tier: MatchTier; productMismatch: boolean }[] = []
  const inserts: Candidate[] = []

  const fileByDate = new Map<string, Candidate[]>()
  for (const c of candidates) {
    const cur = fileByDate.get(c.date)
    if (cur) cur.push(c)
    else fileByDate.set(c.date, [c])
  }

  /** Identical product text. */
  const exactProduct = (c: Candidate, d: DbRow) => normText(d.products) === c.productKey
  /**
   * Same product once a variant suffix is stripped ('- Small', '- B1G1').
   * Deliberately tried only AFTER every exact match on the date is taken: one
   * customer bought 'Leather Patch - Small' AND '- Large' on the same day, and
   * matching on the shared base first paired them crosswise and swapped their
   * amounts.
   */
  const variantProduct = (c: Candidate, d: DbRow) =>
    c.productBase !== '' && productBaseKey(d.products) === c.productBase
  const sameName = (c: Candidate, d: DbRow) => c.name !== '' && c.name === normText(d.customer_name)
  const sameNumber = (c: Candidate, d: DbRow) => c.contact !== '' && c.contact === normContact(d.contact_1)

  // process dates in order so the plan reads chronologically
  for (const date of [...fileByDate.keys()].sort()) {
    const avail = (dbIdsByDate.get(date) ?? []).filter((id) => !claimed.has(id))
    let remaining = fileByDate.get(date)!

    /** Run one pass over the rows still unpaired on this date. */
    const pass = (
      tier: MatchTier,
      productMismatch: boolean,
      match: (c: Candidate, d: DbRow, unpaired: Set<Candidate>) => boolean,
    ) => {
      if (avail.length === 0) return
      const next: Candidate[] = []
      const unpaired = new Set(remaining)
      for (const c of remaining) {
        const i = avail.length ? avail.findIndex((id) => match(c, byId.get(id)!, unpaired)) : -1
        unpaired.delete(c)
        if (i >= 0) {
          const id = avail.splice(i, 1)[0]
          claimed.add(id)
          pairs.push({ cand: c, dbId: id, tier, productMismatch })
        } else next.push(c)
      }
      remaining = next
    }

    // ---- product-anchored: these are the same order ----
    // every EXACT product match first, across all three identity strengths ...
    pass('name+number+date', false, (c, d) => sameName(c, d) && sameNumber(c, d) && exactProduct(c, d))
    pass('number+date', false, (c, d) => sameNumber(c, d) && exactProduct(c, d))
    pass('name+date', false, (c, d) => sameName(c, d) && exactProduct(c, d))
    // ... only then fall back to variant-of-the-same-product
    pass('name+number+date', false, (c, d) => sameName(c, d) && sameNumber(c, d) && variantProduct(c, d))
    pass('number+date', false, (c, d) => sameNumber(c, d) && variantProduct(c, d))
    pass('name+date', false, (c, d) => sameName(c, d) && variantProduct(c, d))

    // ---- same customer, product does not line up -> flag for review ----
    pass('name+number+date', true, (c, d) => sameName(c, d) && sameNumber(c, d))
    // number-only and name-only are weaker, so only when a single candidate
    // remains on BOTH sides - otherwise two separate orders could be paired.
    pass('number+date', true, (c, d, unpaired) => {
      if (!sameNumber(c, d)) return false
      const dbHits = avail.filter((id) => normContact(byId.get(id)!.contact_1) === c.contact).length
      let fileHits = 0
      for (const x of unpaired) if (x.contact === c.contact) fileHits++
      return dbHits === 1 && fileHits === 1
    })
    pass('name+date', true, (c, d, unpaired) => {
      if (!sameName(c, d)) return false
      const dbHits = avail.filter((id) => normText(byId.get(id)!.customer_name) === c.name).length
      let fileHits = 0
      for (const x of unpaired) if (x.name === c.name) fileHits++
      return dbHits === 1 && fileHits === 1
    })

    for (const c of remaining) inserts.push(c)
  }

  /* ---- phase 3: classify every pair ---- */
  for (const { cand, dbId, tier, productMismatch } of pairs) {
    const db = byId.get(dbId)!
    const diffs = diffAgainstDb(cand.base.resolved, db)
    plan.stats.matchedByTier[tier] = (plan.stats.matchedByTier[tier] ?? 0) + 1

    // Hard invariant: a commit must NEVER rewrite the product of an existing
    // entry. Even a pass that believed it had a product match is overridden
    // here if the resulting text would change (e.g. a variant pairing).
    if (productMismatch || diffs.some((d) => d.field === 'products')) {
      plan.flagged.push({
        ...cand.base,
        action: 'flagged',
        dbId,
        tier,
        reason: 'product mismatch',
        dbProducts: db.products,
        dbAmount: db.amount,
        diffs,
      })
      cand.base.warnings.push(`product differs from the existing entry ("${db.products ?? '-'}")`)
    } else if (diffs.length) {
      plan.updates.push({ ...cand.base, action: 'update', dbId, tier, diffs })
    } else {
      plan.unchanged.push({ ...cand.base, action: 'unchanged', dbId, tier })
    }
  }
  for (const c of inserts) plan.inserts.push({ ...c.base, action: 'insert' })

  // keep everything in spreadsheet order so the UI lines up with the file
  const byRow = (a: { rowNumber: number }, b: { rowNumber: number }) => a.rowNumber - b.rowNumber
  plan.inserts.sort(byRow)
  plan.updates.sort(byRow)
  plan.unchanged.sort(byRow)
  plan.flagged.sort(byRow)

  for (const d of dbRows) {
    if (claimed.has(d.id)) continue
    // An existing entry on an unselected date is NOT an orphan - it was simply
    // not part of this run. Without this guard, reconciling a single day would
    // report the whole rest of the month as removable.
    if (!inScope(normDate(d.delivery_date))) continue
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
  plan.stats.flagged = plan.flagged.length
  plan.stats.duplicates = plan.duplicates.length
  plan.stats.dbOnly = plan.dbOnly.length
  plan.stats.skipped = plan.skipped.length
  plan.stats.outOfScope = plan.outOfScope.length

  /* ---- per-date breakdown, so the operator can apply one day at a time ---- */
  const buckets = new Map<string, DateBucket>()
  const bucket = (date: string): DateBucket => {
    let b = buckets.get(date)
    if (!b) {
      b = {
        date,
        fileRows: 0,
        inserts: 0,
        updates: 0,
        unchanged: 0,
        flagged: 0,
        duplicates: 0,
        dbOnly: 0,
        dbRows: dbRowsPerDate.get(date) ?? 0,
        fileAmountTotal: 0,
        outOfMonth: options.month ? !date.startsWith(`${options.month}-`) : false,
      }
      buckets.set(date, b)
    }
    return b
  }
  // Every date present in the system for this month gets a row too, so a day
  // the file forgot entirely is still visible rather than silently missing.
  for (const date of dbRowsPerDate.keys()) bucket(date)

  const countRow = (r: PlanRow, key: 'inserts' | 'updates' | 'unchanged' | 'flagged' | 'duplicates') => {
    const date = r.resolved.delivery_date
    if (!date) return
    const b = bucket(date)
    b[key]++
    b.fileRows++
    b.fileAmountTotal += r.resolved.amount
  }
  for (const r of plan.inserts) countRow(r, 'inserts')
  for (const r of plan.updates) countRow(r, 'updates')
  for (const r of plan.unchanged) countRow(r, 'unchanged')
  for (const r of plan.flagged) countRow(r, 'flagged')
  for (const r of plan.duplicates) countRow(r, 'duplicates')
  for (const d of plan.dbOnly) if (d.delivery_date) bucket(d.delivery_date).dbOnly++
  for (const o of plan.outOfScope) bucket(o.date).fileRows++

  plan.stats.byDate = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date))
  return plan
}
