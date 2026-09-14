import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { loadPricingCatalogue, validatePurchasingVariants } from '@/lib/products/pricing-server'
import type { PricingProduct } from '@/lib/products/pricing'
import { calculateReorder, legacyConfirmedAmounts } from './reorder-calculations'
import { clearSupplierReference, copyImportReference, reviewImportReferences, safeImportLink } from './reorder-reference'
import {
  IMPORT_REFERENCE_COLUMNS,
  emptyReorderSnapshot,
  importNumber,
  newReorderLine,
  type ImportReference,
  type ImportReorder,
  type ImportPurchaseEvent,
  type ReorderSnapshot,
  type SavedReorderItem,
  type ReorderSettings,
} from './workflow'
import { stockGuidance, type PlanningStock, type StockGuidance } from './reorder-suggestions'
import { loadSourcingPreferences } from './1688-preferences'

const uuid = z.string().uuid()
const amount = z.number().finite().min(0).max(99_999_999).nullable()
const quantity = z.number().int().min(1).max(10_000_000).nullable()
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => { const parsed = new Date(`${value}T00:00:00Z`); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value }, 'Invalid calendar date')
  .nullable()
const text = z.string().max(4000)
const lineSchema = z.object({
  id: uuid,
  productId: uuid.nullable(),
  variantId: uuid.nullable(),
  productName: text,
  variantLabel: text.nullable(),
  imageUrl: text.nullable(),
  supplierLabel: text,
  listingUrl: text,
  sourceImportId: uuid.nullable(),
  sourceSnapshot: z.unknown().nullable(),
  refreshSource: z.boolean().optional(),
  qty: quantity,
  priceCny: amount,
  priceMode: z.enum(['net', 'discount']),
  discountPercent: z.number().finite().min(0).max(100),
  chinaFreight: amount,
  chinaFreightBasis: z.enum(['fixed', 'unit']),
  unitsPerCarton: quantity,
  kgPerUnit: amount,
  cbmPerUnit: amount,
  unavailable: z.boolean(),
  notes: text,
})
const termsSchema = z.object({
  fxRate: z.number().finite().positive().max(100000).nullable(),
  sharedChinaFreight: amount,
  importFreightMode: z.enum(['fixed', 'cbm']),
  importFreightMur: amount,
  cbmRateMur: amount,
  otherChargesMur: amount,
  allocationBasis: z.enum(['qty', 'value', 'cbm']),
  landedReviewed: z.boolean(),
})
const snapshotSchema = z.object({
  supplierName: z.string().trim().max(500),
  notes: text,
  orderDate: date,
  expectedDate: date,
  terms: termsSchema,
  lines: z.array(lineSchema).max(200),
})
const mutationSchema = z.object({ id: uuid, revision: z.number().int().nonnegative(), requestKey: uuid })
export type ReorderMutation = z.infer<typeof mutationSchema>
export interface CreateReordersInput {
  requestKey: string
  selections: {
    productId: string
    variantId?: string | null
    sourceImportId?: string | null
    savedItemId?: string | null
    qty?: number | null
  }[]
  supplierName?: string
}
export interface ReorderCatalogue {
  products: PricingProduct[]
  references: ImportReference[]
  stocks: PlanningStock[]
  suppliers: string[]
}
export interface ReorderWorkspace {
  reorders: ImportReorder[]
  savedItems: SavedReorderItem[]
  settings: ReorderSettings[]
  guidance: StockGuidance[]
  guidanceError: string | null
}
export interface MutationResult {
  id: string
  revision: number
  number: number
  status: string
  imports?: { id: string; index: string; lineId: string }[]
}
export type SavedItemInput = Omit<SavedReorderItem, 'updatedAt'> & { requestKey: string }

type HeaderRow = {
  id: string
  number: number
  supplier_name: string
  status: ImportReorder['status']
  revision: number
  draft: Omit<ReorderSnapshot, 'lines'>
  requested_snapshot: ReorderSnapshot | null
  supplier_snapshot: ReorderSnapshot | null
  confirmed_snapshot: ImportReorder['confirmedSnapshot']
  approved_at: string | null
  confirmed_at: string | null
  created_at: string
  updated_at: string
}
type LineRow = {
  id: string
  reorder_id: string
  product_id: string | null
  variant_id: string | null
  line_data: ReorderSnapshot['lines'][number]
}
const HEADER_COLUMNS =
  'id,number,supplier_name,status,revision,draft,requested_snapshot,supplier_snapshot,confirmed_snapshot,approved_at,confirmed_at,created_at,updated_at'
const LINE_COLUMNS = 'id,reorder_id,product_id,variant_id,line_data'
export const reorderRequestHash = (actor: string, operation: string, input: unknown) =>
  createHash('sha256').update(JSON.stringify({ actor, operation, input })).digest('hex')

async function replay(db: SupabaseClient, actor: string, key: string, hash: string) {
  const { data, error } = await db
    .from('import_purchase_events')
    .select('request_hash,actor_id,result')
    .eq('request_key', key)
    .maybeSingle()
  if (error) throw new Error('Could not check whether this request was already saved. Please retry.')
  if (!data) return null
  if (data.request_hash !== hash || data.actor_id !== actor)
    throw new Error('This request key already saved different content. Reload before continuing.')
  return data.result
}

export { loadReorderCatalogue, loadReorderWorkspace }

async function loadReorderCatalogue(db: SupabaseClient): Promise<ReorderCatalogue> {
  const [catalogue, stocks, references] = await Promise.all([
    loadPricingCatalogue(db),
    fetchAll<PlanningStock>((from, to) =>
      db
        .from('products')
        .select('id,name,quantity,sold_out,last_counted_at,zone,is_active')
        .order('id')
        .range(from, to),
    ),
    fetchAll<ImportReference>((from, to) =>
      db
        .from('purchase_orders')
        .select(IMPORT_REFERENCE_COLUMNS)
        .order('order_date', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to),
    ),
  ])
  const active = new Set(stocks.filter((product) => product.is_active === true).map((product) => product.id))
  const products = catalogue.filter((product) => active.has(product.id))
  return {
    products,
    stocks,
    references: reviewImportReferences(references),
    suppliers: [
      ...new Set(references.map((row) => row.supplier_name?.trim()).filter((name): name is string => Boolean(name))),
    ].sort(),
  }
}

function assembleReorder(row: HeaderRow, lines: LineRow[]): ImportReorder {
  return {
    id: row.id,
    number: importNumber(row.number),
    status: row.status,
    revision: row.revision,
    draft: {
      ...row.draft,
      supplierName: row.supplier_name,
      lines: lines.map((line) => ({ ...line.line_data, productId: line.product_id, variantId: line.variant_id })),
    },
    requestedSnapshot: row.requested_snapshot,
    supplierSnapshot: row.supplier_snapshot,
    confirmedSnapshot: row.confirmed_snapshot,
    approvedAt: row.approved_at,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
export async function loadImportReorder(db: SupabaseClient, id: string): Promise<ImportReorder> {
  uuid.parse(id)
  const [header, lines] = await Promise.all([
    db.from('import_reorders').select(HEADER_COLUMNS).eq('id', id).maybeSingle(),
    fetchAll<LineRow>((from, to) =>
      db
        .from('import_reorder_lines')
        .select(LINE_COLUMNS)
        .eq('reorder_id', id)
        .eq('is_active', true)
        .order('position')
        .order('id')
        .range(from, to),
    ),
  ])
  if (header.error || !header.data) throw new Error('This import reorder could not be loaded.')
  return assembleReorder(header.data as HeaderRow, lines)
}
export async function loadPurchaseEvents(
  db: SupabaseClient,
  id: string,
  kind: 'reorder' | 'import' = 'reorder',
): Promise<ImportPurchaseEvent[]> {
  const rows = await fetchAll<{
    id: string
    event_type: string
    created_at: string
    reason: string | null
    before_snapshot: unknown
    after_snapshot: unknown
    profiles: unknown
  }>((from, to) =>
    db
      .from('import_purchase_events')
      .select('id,event_type,created_at,reason,before_snapshot,after_snapshot,profiles:actor_id(name)')
      .eq(kind === 'reorder' ? 'reorder_id' : 'import_id', uuid.parse(id))
      .order('created_at', { ascending: false })
      .order('id')
      .range(from, to),
  )
  return rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    createdAt: row.created_at,
    reason: row.reason,
    actorName:
      ((Array.isArray(row.profiles) ? row.profiles[0] : row.profiles) as { name?: string } | null)?.name || 'Buyer',
    beforeSnapshot: row.before_snapshot,
    afterSnapshot: row.after_snapshot,
  }))
}
export async function loadSavedReorderItems(db: SupabaseClient): Promise<SavedReorderItem[]> {
  const rows = await fetchAll<{
    id: string
    item: SavedReorderItem['item']
    product_id: string | null
    variant_id: string | null
    supplier_name: string
    status: SavedReorderItem['status']
    priority: number
    review_date: string | null
    revision: number
    updated_at: string
  }>((from, to) =>
    db
      .from('import_reorder_items')
      .select('id,item,product_id,variant_id,supplier_name,status,priority,review_date,revision,updated_at')
      .order('priority')
      .order('updated_at', { ascending: false })
      .order('id')
      .range(from, to),
  )
  return rows.map((row) => ({
    id: row.id,
    item: { ...row.item, productId: row.product_id, variantId: row.variant_id },
    supplierName: row.supplier_name,
    status: row.status,
    priority: row.priority,
    reviewDate: row.review_date,
    revision: row.revision,
    updatedAt: row.updated_at,
  }))
}
export async function loadReorderSettings(db: SupabaseClient): Promise<ReorderSettings[]> {
  const rows = await fetchAll<{
    id: string
    product_id: string | null
    supplier_name: string | null
    lead_days: number | null
    cover_days: number | null
    buffer_days: number | null
    daily_units: number | null
    quantity_multiple: number | null
    revision: number
  }>((from, to) =>
    db
      .from('import_reorder_settings')
      .select('id,product_id,supplier_name,lead_days,cover_days,buffer_days,daily_units,quantity_multiple,revision')
      .order('id')
      .range(from, to),
  )
  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    supplierName: row.supplier_name,
    leadDays: row.lead_days,
    coverDays: row.cover_days,
    bufferDays: row.buffer_days,
    dailyUnits: row.daily_units == null ? null : Number(row.daily_units),
    quantityMultiple: row.quantity_multiple,
    revision: row.revision,
  }))
}
async function loadReorderWorkspace(db: SupabaseClient, catalogue: ReorderCatalogue): Promise<ReorderWorkspace> {
  const [headers, lines, savedItems, settings] = await Promise.all([
    fetchAll<HeaderRow>((from, to) =>
      db
        .from('import_reorders')
        .select(HEADER_COLUMNS)
        .order('updated_at', { ascending: false })
        .order('id')
        .range(from, to),
    ),
    fetchAll<LineRow>((from, to) =>
      db
        .from('import_reorder_lines')
        .select(LINE_COLUMNS)
        .eq('is_active', true)
        .order('position')
        .order('id')
        .range(from, to),
    ),
    loadSavedReorderItems(db),
    loadReorderSettings(db),
  ])
  const guidance = catalogue.products.map((product) => {
    const stock = catalogue.stocks.find((row) => row.id === product.id)!
    const variants = product.variants?.filter((variant) => variant.isActive) ?? []
    const combined = variants.length
      ? {
          ...stock,
          quantity: variants.every((variant) => variant.stockOnHand != null)
            ? variants.reduce((sum, variant) => sum + (variant.stockOnHand ?? 0), 0)
            : null,
          last_counted_at: null,
        }
      : stock
    const answer = stockGuidance(combined, settings, catalogue.references)
    if (variants.length)
      answer.warnings.unshift(
        'Stock shown is the sum of active variants, not parent stock. Choose the required variant and quantity manually.',
      )
    return answer
  })
  return {
    reorders: headers.map((header) =>
      assembleReorder(
        header,
        lines.filter((line) => line.reorder_id === header.id),
      ),
    ),
    savedItems,
    settings,
    guidance,
    guidanceError: null,
  }
}

async function validateSnapshot(
  db: SupabaseClient,
  raw: ReorderSnapshot,
  previous?: ReorderSnapshot,
): Promise<ReorderSnapshot> {
  const input = snapshotSchema.parse(raw) as ReorderSnapshot
  const catalogue = await loadReorderCatalogue(db)
  const variants = await validatePurchasingVariants(db, input.lines)
  const identities = new Set<string>()
  const lines = input.lines.map((line) => {
    const product = catalogue.products.find((product) => product.id === line.productId)
    if (!product) throw new Error('A product is unavailable or inactive. Choose an active catalogue product.')
    const identity = `${line.productId}:${line.variantId ?? ''}`
    if (identities.has(identity))
      throw new Error('Combine the quantity for duplicate products with the same variant in this supplier request.')
    identities.add(identity)
    const old = previous?.lines.find((item) => item.id === line.id)
    let source = !line.refreshSource && old?.sourceImportId === line.sourceImportId ? (old?.sourceSnapshot ?? null) : null
    if (line.sourceImportId && !source)
      source = catalogue.references.find((ref) => ref.id === line.sourceImportId) ?? null
    // Any historical import may be referenced. Cross-product / cross-supplier
    // references are estimates (see copyImportReference); only require that the
    // referenced import still exists.
    if (line.sourceImportId && !source)
      throw new Error('This historical import is no longer available. Clear the reference before saving.')
    if (line.listingUrl && !safeImportLink(line.listingUrl))
      throw new Error('Use a valid HTTP or HTTPS supplier listing link.')
    const variant = line.variantId ? variants.get(line.variantId) : null
    return {
      ...line,
      productName: product.name,
      imageUrl: product.variants?.find((item) => item.id === line.variantId)?.imageUrl || product.imageUrl,
      variantLabel: variant ? `${variant.attributeName}: ${variant.attributeValue}` : null,
      supplierLabel: line.supplierLabel.trim() || product.name,
      sourceSnapshot: source,
      refreshSource: false,
      listingUrl: safeImportLink(line.listingUrl),
    }
  })
  const snapshot = { ...input, lines }
  const calculation = calculateReorder(snapshot)
  if (
    calculation.lines.some((line) =>
      [line.goods, line.chinaFreight, line.supplierCny, line.supplierMur, line.landed].some(
        (value) => value != null && (!Number.isFinite(value) || value > 999_999_999.99),
      ),
    )
  )
    throw new Error('The calculated amount exceeds the import record limit. Check quantity, price and exchange rate.')
  if (calculation.lines.some((line) => (line.weight != null && line.weight > 999_999.99) || (line.cbm != null && line.cbm > 9_999.9999) || (line.chinaFreight != null && line.chinaFreight > 99_999_999.99) || (line.landedPerUnit != null && line.landedPerUnit > 99_999_999.99)))
    throw new Error('Weight, volume or per-unit amounts exceed the import record limits. Check the per-unit assumptions.')
  if (snapshot.terms.landedReviewed && !calculation.complete)
    throw new Error('Complete all freight, charges and exchange-rate inputs before marking landed costs verified.')
  return snapshot
}

export async function createImportReorders(
  db: SupabaseClient,
  actor: string,
  raw: CreateReordersInput,
): Promise<{ requests: MutationResult[] }> {
  const input = z
    .object({
      requestKey: uuid,
      supplierName: z.string().trim().max(500).optional(),
      selections: z
        .array(
          z.object({
            productId: uuid,
            variantId: uuid.nullable().optional(),
            sourceImportId: uuid.nullable().optional(),
            savedItemId: uuid.nullable().optional(),
            qty: quantity.optional(),
          }),
        )
        .max(200),
    })
    .parse(raw)
  const hash = reorderRequestHash(actor, 'create', input)
  const existing = await replay(db, actor, input.requestKey, hash)
  if (existing) return existing
  const [catalogue, saved, preferences] = await Promise.all([loadReorderCatalogue(db), loadSavedReorderItems(db), loadSourcingPreferences(db)])
  const groups = new Map<string, ReorderSnapshot>()
  for (const selection of input.selections) {
    const product = catalogue.products.find((product) => product.id === selection.productId)
    if (!product) throw new Error('Choose an active catalogue product.')
    const savedItem = selection.savedItemId ? saved.find((item) => item.id === selection.savedItemId) : null
    if (selection.savedItemId && (!savedItem || savedItem.item.productId !== product.id))
      throw new Error('The saved item changed. Reload your list.')
    const sourceId = selection.sourceImportId ?? savedItem?.item.sourceImportId
    const source = sourceId ? catalogue.references.find((row) => row.id === sourceId) : null
    if (sourceId && !source)
      throw new Error('The selected historical import is unavailable. Reload your list.')
    // Only an OWN-product reference dictates the supplier and variant of this
    // request. A cross-product reference is a cost estimate, so the supplier
    // comes from the buyer and no foreign variant is adopted.
    const ownSource = Boolean(source && source.product_id === product.id)
    const preferred = !selection.sourceImportId && !input.supplierName?.trim() ? preferences.find(value => value.product_id === product.id) : null
    const supplier = input.supplierName?.trim() || preferred?.supplier_name || (ownSource ? source!.supplier_name?.trim() : '') || savedItem?.supplierName || ''
    let line = savedItem ? { ...savedItem.item, id: randomUUID() } : newReorderLine(product)
    const variantId =
      selection.variantId !== undefined
        ? selection.variantId
        : savedItem?.item.variantId ?? (ownSource ? source!.variant_id ?? null : null)
    if (savedItem && variantId !== savedItem.item.variantId) line = clearSupplierReference(line)
    line.variantId = variantId
    line.qty = selection.qty !== undefined ? selection.qty : (savedItem?.item.qty ?? null)
    if (source && !savedItem) line = copyImportReference(line, source)
    if (preferred) line = { ...clearSupplierReference(line), sourceImportId: line.sourceImportId, sourceSnapshot: line.sourceSnapshot, listingUrl: preferred.listing_url }
    const group = groups.get(supplier) ?? { ...emptyReorderSnapshot(), supplierName: supplier }
    group.lines.push(line)
    groups.set(supplier, group)
  }
  if (!groups.size)
    groups.set(input.supplierName || '', { ...emptyReorderSnapshot(), supplierName: input.supplierName || '' })
  const requests = []
  for (const group of groups.values()) requests.push(await validateSnapshot(db, group))
  const { data, error } = await db.rpc('import_reorder_mutate', {
    p_actor: actor,
    p_id: randomUUID(),
    p_revision: 0,
    p_key: input.requestKey,
    p_hash: hash,
    p_operation: 'create',
    p_payload: { requests },
  })
  if (error) throw new Error(error.message)
  return data
}

export async function mutateImportReorder(
  db: SupabaseClient,
  actor: string,
  operation: 'save' | 'approve' | 'response' | 'confirm' | 'reopen' | 'cancel',
  raw: ReorderMutation & { snapshot?: ReorderSnapshot; accepted?: boolean; reason?: string },
): Promise<MutationResult> {
  const input = mutationSchema
    .extend({ snapshot: snapshotSchema.optional(), accepted: z.boolean().optional(), reason: text.optional() })
    .parse(raw)
  const hash = reorderRequestHash(actor, operation, input)
  const existing = await replay(db, actor, input.requestKey, hash)
  if (existing) return existing
  const current = await loadImportReorder(db, input.id)
  if (current.revision !== input.revision) throw new Error('This reorder changed. Reload before continuing.')
  let payload: Record<string, unknown> = { reason: input.reason }
  if (operation === 'save') {
    if (!input.snapshot) throw new Error('Missing draft inputs.')
    payload.snapshot = await validateSnapshot(db, input.snapshot as ReorderSnapshot, current.draft)
  } else if (operation === 'approve') {
    if (
      !current.draft.supplierName.trim() ||
      !current.draft.lines.length ||
      current.draft.lines.some((line) => !line.qty || line.unavailable)
    )
      throw new Error('Choose a supplier and enter a positive whole-unit quantity for every requested product.')
    await validateSnapshot(db, current.draft, current.draft)
    payload.snapshot = current.draft
  } else if (operation === 'response') {
    if (!input.snapshot || !current.requestedSnapshot)
      throw new Error('Buyer approval is required before a supplier response.')
    const proposed = input.snapshot as ReorderSnapshot
    if (
      proposed.supplierName !== current.requestedSnapshot.supplierName ||
      proposed.lines.length !== current.requestedSnapshot.lines.length
    )
      throw new Error('Supplier response must keep the approved supplier and product identities.')
    for (const line of proposed.lines) {
      const requested = current.requestedSnapshot.lines.find((item) => item.id === line.id)
      if (
        !requested ||
        line.productId !== requested.productId ||
        line.variantId !== requested.variantId ||
        line.sourceImportId !== requested.sourceImportId
      )
        throw new Error('Reopen the request to change products, variants or supplier references.')
      if (!line.unavailable && (!line.qty || line.priceCny == null))
        throw new Error(
          'Record the supplier’s quantity and unit price for each available line. Mark unavailable products explicitly.',
        )
    }
    payload.snapshot = await validateSnapshot(db, proposed, current.requestedSnapshot)
  } else if (operation === 'confirm') {
    if (!input.accepted || !current.supplierSnapshot || !current.supplierSnapshot.orderDate)
      throw new Error('Review the saved supplier response, enter its order date and explicitly accept it.')
    await validateSnapshot(db, current.supplierSnapshot, current.supplierSnapshot)
    const imports = legacyConfirmedAmounts(current.supplierSnapshot)
    if (!imports.length) throw new Error('There are no available products to import.')
    payload = { accepted: true, snapshot: current.supplierSnapshot, imports }
  }
  const { data, error } = await db.rpc('import_reorder_mutate', {
    p_actor: actor,
    p_id: input.id,
    p_revision: input.revision,
    p_key: input.requestKey,
    p_hash: hash,
    p_operation: operation,
    p_payload: payload,
  })
  if (error) throw new Error(error.message)
  return data
}

export async function saveReorderItem(db: SupabaseClient, actor: string, raw: SavedItemInput) {
  const input = mutationSchema
    .extend({
      item: lineSchema,
      supplierName: z.string().trim().max(500),
      status: z.enum(['active', 'deferred', 'excluded']),
      priority: z.number().int().min(1).max(3),
      reviewDate: date,
    })
    .parse(raw)
  const hash = reorderRequestHash(actor, 'item', input)
  const existing = await replay(db, actor, input.requestKey, hash)
  if (existing) return existing
  const previous = (await loadSavedReorderItems(db)).find((item) => item.id === input.id)
  const snapshot = {
    ...emptyReorderSnapshot(),
    supplierName: input.supplierName,
    lines: [input.item as SavedReorderItem['item']],
  }
  const validated =
    input.status === 'excluded'
      ? snapshot
      : await validateSnapshot(db, snapshot, previous ? { ...snapshot, lines: [previous.item] } : undefined)
  const { data, error } = await db.rpc('import_reorder_support', {
    p_actor: actor,
    p_id: input.id,
    p_revision: input.revision,
    p_key: input.requestKey,
    p_hash: hash,
    p_operation: 'item',
    p_payload: { ...input, item: validated.lines[0] },
  })
  if (error) throw new Error(error.message)
  return data as { id: string; revision: number }
}
export async function saveReorderSettings(
  db: SupabaseClient,
  actor: string,
  raw: ReorderSettings & { requestKey: string },
) {
  const days = (max: number) => z.number().int().min(0).max(max).nullable()
  const input = mutationSchema
    .extend({
      productId: uuid.nullable(),
      supplierName: z.string().trim().min(1).max(500).nullable(),
      leadDays: days(730),
      coverDays: days(730),
      bufferDays: days(365),
      dailyUnits: z.number().finite().min(0).max(10_000_000).nullable(),
      quantityMultiple: quantity,
    })
    .parse(raw)
  if (input.productId && input.supplierName) throw new Error('Choose either a product override or a supplier override.')
  if (!input.productId && (input.dailyUnits != null || input.quantityMultiple != null))
    throw new Error('Daily rates and carton multiples must be set for an individual product, not every product.')
  const hash = reorderRequestHash(actor, 'settings', input)
  const { data, error } = await db.rpc('import_reorder_support', {
    p_actor: actor,
    p_id: input.id,
    p_revision: input.revision,
    p_key: input.requestKey,
    p_hash: hash,
    p_operation: 'settings',
    p_payload: input,
  })
  if (error) throw new Error(error.message)
  return data as { id: string; revision: number }
}
