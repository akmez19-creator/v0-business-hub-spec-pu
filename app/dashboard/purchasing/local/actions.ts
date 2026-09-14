'use server'

/**
 * Server actions for local purchase entry.
 *
 * Everything price-related is recomputed HERE from the database. The browser
 * sends the supplier's label, quantity and list price - it never sends a China
 * landed cost or a verdict, because a client that can post its own comparison
 * can post a flattering one.
 */

import { revalidatePath } from 'next/cache'
import type { ReceiptEvidence, ReceiptLine } from '@/lib/local-purchasing/evidence'
import type { ReceiptCheck, ReceiptOverrides } from '@/lib/local-purchasing/reconcile'
import { importLocalDocument } from '@/lib/local-purchasing/documents'
import { analyseReceiptLines } from '@/lib/local-purchasing/analyse'
import { persistLocalPurchase, type SavePurchaseInput } from '@/lib/local-purchasing/purchase-service'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { suggestForLabels, type Candidate } from '@/lib/local-purchasing/suggest'
import { decideAutoLink, type AutoLinkVerdict } from '@/lib/local-purchasing/autolink'
import { fetchChinaCostRefs, fetchProductRefs } from '@/lib/local-purchasing/costs'
import { normalizeName } from '@/lib/products/match'
import { houseName, type HouseNameResult } from '@/lib/products/house-name'
import { normaliseCategory } from '@/lib/products/categories'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { compareLine, purchaseUnitAmounts, vatBreakdown, DEFAULT_VAT_PERCENT, type LineComparison, type PurchaseUnitAmounts } from '@/lib/local-purchasing/vat'
import { findExistingPurchase, type ExistingPurchase } from '@/lib/local-purchasing/existing'
import { createInventoryProductRecord, parseNewInventoryProductInput, loadPricingCatalogue, loadPricingProduct } from '@/lib/products/pricing-server'
import {
  PRODUCT_PRICING_COLUMNS, pricingProductFromRow, productEditRevision, validateProductEdit, validateNewProductPricing,
  type NewInventoryProductInput, type NewVariantsDraft, type PricingDraft, type PricingProduct, type PricingProductRow, type ProductEditDraft, type VariantSelection,
} from '@/lib/products/pricing'

/** Only admins and managers see supplier pricing. Mirrors the purchasing page. */
async function requireBuyer() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in')

  const db = createAdminClient()
  const { data: profile } = await db.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    throw new Error('Not allowed')
  }
  return { userId: user.id, db, supabase }
}

/** What the import panel hands back to the entry form. */
export interface ImportedDoc {
  /** Draft lines, ready to be dropped into the grid. NOT saved yet. */
  lines: Array<{
    key: string
    supplierLabel: string
    supplierCode: string | null
    unit: string | null
    qty: number | null
    unitPriceGross: number | null
    lineTotal: number | null
    evidence: ReceiptLine
  }>
  evidence: ReceiptEvidence
  originalEvidence: ReceiptEvidence
  check: ReceiptCheck
  documentRevision: number
  reviewRevision: number
  supplierName: string | null
  vatNumber: string | null
  docRef: string | null
  docDate: string | null
  declaredTotal: number | null
  discountPercent: number | null
  /** Everything the owner must check before trusting the read. */
  warnings: string[]
  /** True when the lines do NOT reconcile with the document's own total. */
  suspect: boolean
  source: 'ai' | 'sheet'
  /** Set when the file was stored, so `savePurchaseAction` can attach it. */
  documentId: string | null
}

const SHEET_EXT = /\.(xlsx|xlsm|xls|csv)$/i

/**
 * PRIVATE bucket, following the existing `payment-proofs` precedent rather than
 * the public `product-images` one: a supplier invoice carries prices, VAT
 * numbers and trading terms and must never be world-readable.
 * Created by scripts/create-purchase-docs-bucket.mts.
 */
const PURCHASE_DOC_BUCKET = 'purchase-docs'

/**
 * Reads an uploaded purchase document into DRAFT lines.
 *
 * Nothing here writes to `local_purchases`. The read is a suggestion the buyer
 * reviews, because the matcher provably hits a decoy duplicate with "exact"
 * confidence - so auto-saving an AI read would auto-link the wrong product.
 *
 * Spreadsheets are PARSED, never sent to the model: they already hold exact
 * values and asking a model to retype them can only introduce error.
 */
export async function importPurchaseDocumentAction(form: FormData): Promise<ImportedDoc> {
  const { db, userId } = await requireBuyer()

  // The shared importer files AI and spreadsheet evidence in the same private bucket.
  // A failed storage write is returned as a warning, never a claim of verification.
  return importLocalDocument(form, db, userId)
}

/**
 * Mirrors the CHECK constraint on `local_purchase_lines.match_method`
 * (scripts/add-auto-match-method.sql). Kept as a union so a typo cannot reach
 * the database and fail at runtime.
 */
export type LineMatchMethod =
  | 'auto'
  | 'confirmed'
  | 'created'
  | 'alias'
  | 'manual'
  | 'unmatched'

export interface DraftLineInput extends VariantSelection {
  /** Row key from the client, echoed back so answers land on the right row. */
  key: string
  supplierLabel: string
  supplierCode?: string | null
  unit?: string | null
  qty: number | null
  unitPriceGross: number | null
  lineTotal?: number | null
  evidence?: ReceiptLine
  orderLineId?: string | null
  /** Line-level discount override; falls back to the header. */
  discountPercent?: number | null
  /** Set once the line is linked, automatically or by hand. */
  productId?: string | null
  /**
   * HOW the link happened. Must be carried from the client, because only the
   * client knows whether the person touched it: the previous version stored
   * 'confirmed' for every linked line, which would have recorded the system's
   * own automatic guesses as human decisions and made a bad batch impossible to
   * find afterwards.
   */
  matchMethod?: LineMatchMethod | null
  /**
   * The China landed cost this line was judged against, carried from the
   * analysis so the SAVE stores what the buyer actually saw. Re-deriving it at
   * save time could store a different figure than the one on screen.
   */
  chinaCpAtPurchase?: number | null
  variancePercent?: number | null
}

export interface AnalysedLine {
  key: string
  candidates: Candidate[]
  /**
   * Whether the top candidate is safe to link WITHOUT a human. Returned even
   * for lines that are already linked, so re-analysing never silently
   * re-decides something a person has already answered - the client only ever
   * applies this to lines that carry no product yet.
   */
  autoLink: AutoLinkVerdict
  comparison: LineComparison
  /** Net unit price after discount - recomputed server-side. */
  unitPriceNet: number
  /** The same supplier unit figures used by the row and both product dialogs. */
  unitAmounts: PurchaseUnitAmounts | null
  receiptRevision: string
  receiptStatus: ReceiptCheck['status']
  supplierConflict: string | null
  supplierVariant?: { productId: string; variantId: string } | null
  variantError?: string | null
  comparisonScope?: 'product' | 'variant_unavailable'
  productImportReference?: { unitCost: number; count: number } | null
  /** VAT split for this line's total, for the VAT section. */
  vat: { net: number; vat: number; gross: number; reclaimable: number }
  /** Import rows rejected as mis-linked, so a bad link can be seen and fixed. */
  suspectImports: { landedUnitCost: number; label: string | null; importedAt: string | null }[]
}

/**
 * Suggests products for every line AND compares the ones already linked.
 *
 * One action rather than two, so the screen cannot show candidates from one
 * request beside a comparison from another.
 */
export async function analyseLinesAction(input: {
  lines: DraftLineInput[]
  supplierId?: string | null
  document?: ReceiptEvidence | null
  overrides?: ReceiptOverrides
  discountPercent?: number | null
  vatPercent?: number | null
  vatReclaimable?: boolean
  /**
   * True when the document's prices ALREADY CONTAIN VAT. Everything below means
   * excluding VAT, so an inclusive price is converted once, on entry.
   */
  pricesIncludeVat?: boolean
}): Promise<AnalysedLine[]> {
  const { db } = await requireBuyer()
  return analyseReceiptLines(db, input)
}

/** Suppliers for the picker, plus whether each can pass on reclaimable VAT. */
export async function listSuppliersAction() {
  const { db } = await requireBuyer()
  const data = await fetchAll<{ id: string; name: string; vat_number: string | null; phone: string | null; payment_terms_days: number | null }>((from, to) =>
    db.from('local_suppliers').select('id,name,vat_number,phone,payment_terms_days').eq('is_active', true).order('name').order('id').range(from, to))
  return data.map((s) => ({
    id: s.id as string,
    name: s.name as string,
    vatNumber: (s.vat_number as string) ?? null,
    phone: (s.phone as string) ?? null,
    paymentTermsDays: s.payment_terms_days as number | null,
  }))
}

/** The digits of a VAT/BRN number - its identity, minus the label and punctuation. */
const vatDigits = (s: string) => s.replace(/\D/g, '')

export async function createSupplierAction(input: {
  name: string
  vatNumber?: string | null
  brn?: string | null
  phone?: string | null
  contactName?: string | null
}) {
  const { db } = await requireBuyer()
  const name = (input.name ?? '').trim()
  if (!name) throw new Error('Supplier name is required')

  /*
   * A VAT number is the firm's identity; the printed name is how a particular
   * invoice template spells it. "BERNARD AND FENLAN CO. LTD." and "Bernard
   * Trading" with the same number are one supplier, and the name-only unique
   * constraint below would happily make them two. The document-prefilled Add
   * button makes this likely (it submits the name AS PRINTED), so the number
   * is checked first and the existing row is returned - the caller treats it
   * exactly like a fresh insert.
   */
  const vat = input.vatNumber?.trim() || null
  if (vat) {
    /*
     * Compared by DIGITS. My first version stripped punctuation but kept the
     * letters, so "VAT 2846-1839" typed by hand became "vat28461839" and did
     * not equal the document's "28461839" - and the browser test inserted the
     * twin this guard exists to stop. A Mauritian VAT number is 8 digits; the
     * "VAT"/"VAT No" is how a form labels it, not part of the identity. A
     * digit-less value (someone typing "none") has no identity and is not
     * compared at all.
     */
    const key = vatDigits(vat)
    const existing = key ? await fetchAll<{ id: string; name: string; vat_number: string | null }>((from, to) =>
      db.from('local_suppliers').select('id,name,vat_number').eq('is_active', true).not('vat_number', 'is', null).order('id').range(from, to)) : []
    const same = key ? (existing ?? []).find((s) => vatDigits((s.vat_number as string) ?? '') === key) : undefined
    if (same) {
      return {
        id: same.id as string,
        name: same.name as string,
        vatNumber: (same.vat_number as string) ?? null,
        reused: `VAT number ${vat} already belongs to "${same.name}" - used that supplier instead of adding a second one`,
      }
    }
  }

  const { data, error } = await db
    .from('local_suppliers')
    .insert({
      name,
      vat_number: input.vatNumber?.trim() || null,
      brn: input.brn?.trim() || null,
      phone: input.phone?.trim() || null,
      contact_name: input.contactName?.trim() || null,
    })
    .select('id,name,vat_number')
    .single()

  // The unique constraint is the real guard against duplicate suppliers, which
  // is the mess the China side already has with free-text supplier_name.
  if (error) {
    if (error.code === '23505' || /duplicate|unique/i.test(error.message)) {
      throw new Error(`A supplier called "${name}" already exists`)
    }
    throw new Error(error.message)
  }
  revalidatePath('/dashboard/purchasing/local')
  return {
    id: data.id as string,
    name: data.name as string,
    vatNumber: (data.vat_number as string) ?? null,
    reused: null as string | null,
  }
}

/**
 * Saves the PURCHASE and its lines - money already spent, not a quote.
 *
 * Unlinked lines ARE saved, with `match_method: 'unmatched'`. Refusing to save
 * them would push the buyer to link something wrong just to get the document in,
 * which is the failure this whole screen exists to prevent.
 */
/**
 * Early warning for the entry screen, before the buyer links 470 lines.
 * The lookup itself lives in `lib/local-purchasing/existing.ts` so the test
 * suite can call the real thing; this is only the authenticated door to it.
 */
export async function findExistingPurchaseAction(input: {
  supplierId: string | null
  docRef: string | null
}): Promise<ExistingPurchase | null> {
  await requireBuyer()
  return findExistingPurchase(input.supplierId, input.docRef)
}

export async function savePurchaseAction(input: SavePurchaseInput) {
  const { db, userId } = await requireBuyer()
  // Net inputs, evidence, attachments and supplier mappings commit together.
  // Original prices and honest machine/human provenance remain separate facts.
  const result = await persistLocalPurchase(db, userId, input)
  revalidatePath('/dashboard/purchasing/local')
  revalidatePath('/dashboard/purchasing/local/orders')
  return result
}

/**
 * Teaches the catalogue that a supplier's wording means a given product, so the
 * NEXT invoice links it automatically instead of asking again.
 *
 * This is what makes automation compound: the buyer answers a label once, and
 * `suggestForLabels` then scores it 96 ("Known alias") forever after. Without
 * this, the same 30-line invoice from the same supplier would need the same
 * corrections every month.
 *
 * Never throws on a clash. Failing to learn is a lost improvement, not a reason
 * to lose the buyer's actual work.
 */
export async function learnAliasAction(input: {
  label: string
  productId: string
}): Promise<{ learned: boolean; reason?: string }> {
  await requireBuyer()
  void input
  return { learned: false, reason: 'Product decisions are staged on this receipt and saved for this supplier only when the purchase is recorded.' }
}

/**
 * Creates a catalogue product for a line the catalogue does not have yet, and
 * returns it linked.
 *
 * DANGER THIS GUARDS AGAINST: a free "create" button is precisely how this
 * catalogue grew its duplicate rows - the decoy "Automatic Sweeping Robot"
 * (0 imports) sitting beside the real "Sweeping Robot" (3 imports) is one of
 * them, and it has already caused a wrong cost comparison. So before inserting
 * anything this checks whether the product effectively exists already, by
 * NORMALISED name, and returns the existing row instead of minting a twin.
 * `products.name` is also UNIQUE, which catches the exact-spelling case.
 */
/**
 * The house name and category for a product about to be created.
 *
 * Owner: "when create a product, name should have the same logic as the one
 * that got through all my products and suggest a name based on picture, two
 * words - the AI sees the product names of all the system - and the product
 * should be well categorised too." The PO import's renamer did exactly that;
 * the create dialog used the stock-count identifier, which describes objects
 * rather than naming them in the shop's style, and wrote NO category at all.
 *
 * This hands the shared naming module the WHOLE catalogue (fetchAll - a
 * `.select()` silently stops at 1000 rows and the catalogue is heading there)
 * plus a handful of real (name -> category) pairs per category, so the answer
 * lands in the same vocabulary and filing as everything already on the shelf.
 * Returns null on a model failure; the dialog keeps whatever name it has.
 */
export async function houseNameForNewProductAction(input: {
  imageUrl: string | null
  currentName: string
}): Promise<HouseNameResult | null> {
  const { db } = await requireBuyer()

  const rows = await fetchAll<{ name: string | null; category: string | null }>((from, to) =>
    db.from('products').select('name,category').order('name').order('id').range(from, to),
  )
  const vocabulary = rows.map((r) => (r.name ?? '').trim()).filter(Boolean)

  // Up to 6 examples per canonical category, so every category the shop
  // actually uses is illustrated but none dominates the prompt.
  const perCategory = new Map<string, string[]>()
  for (const r of rows) {
    const cat = normaliseCategory(r.category)
    const name = (r.name ?? '').trim()
    if (!cat || !name) continue
    const list = perCategory.get(cat) ?? []
    if (list.length < 6) list.push(name)
    perCategory.set(cat, list)
  }
  const categoryExamples = [...perCategory.entries()].flatMap(([category, names]) =>
    names.map((name) => ({ name, category })),
  )

  try {
    return await houseName({
      imageUrl: input.imageUrl,
      currentName: input.currentName,
      vocabulary,
      categoryExamples,
    })
  } catch (e) {
    console.error('[v0] houseNameForNewProductAction failed:', e instanceof Error ? e.message : e)
    return null
  }
}

export async function createProductForLineAction(input: {
  name: string
  /** One of PRODUCT_CATEGORIES; anything else is stored as no category. */
  category?: string | null
  supplierCode?: string | null
  /** Net unit cost from this purchase, used to seed cost_price when positive. */
  unitCostNet?: number | null
  /**
   * Photo already uploaded to the product-images bucket. Optional, but the
   * create dialog pushes for it: a product with no picture cannot be found by
   * the photo identifier later, so it is the row most likely to be re-created
   * under a second name.
   */
  imageUrl?: string | null
  pricing: PricingDraft
  variants?: NewVariantsDraft
  requestId?: string
}): Promise<{
  productId: string
  name: string
  product: PricingProduct
  created: boolean
  /** Set when an existing row was reused, so the UI can say so plainly. */
  reusedReason?: string
}> {
  const { db, supabase } = await requireBuyer()
  const creationInput: NewInventoryProductInput = {
    requestId: input?.requestId ?? crypto.randomUUID(), name: input?.name,
    pricing: input?.pricing, variants: input?.variants, imageUrl: input?.imageUrl,
    category: input?.category, sku: input?.supplierCode, unitCostNet: input?.unitCostNet,
    quantity: 0,
  }
  const details = parseNewInventoryProductInput(creationInput)
  const name = details.name
  const checkedPricing = validateNewProductPricing(details.pricing, details.variants)
  if (!checkedPricing.ok) throw new Error(checkedPricing.issues[0].message)

  const wanted = normalizeName(name)

  // Compare against the whole catalogue on NORMALISED names, so "Wall Clock "
  // and "wall  clock" cannot become two products.
  const all = await fetchAll<{ id: string; name: string | null; image_url: string | null; category: string | null }>(
    (from, to) => db.from('products').select('id,name,image_url,category').order('id').range(from, to),
  )

  const twin = all.find((p) => normalizeName(p.name ?? '') === wanted)
  if (twin) {
    // The buyer just photographed the thing. If the row we are reusing has no
    // picture, that photo is worth more to the catalogue than a duplicate row
    // would have cost it - so keep it, and say so. Same for a category the
    // existing row never had: filling a blank is not overwriting a decision.
    const photo = input.imageUrl?.trim()
    const category = normaliseCategory(input.category)
    const patch: Record<string, string> = {}
    if (photo && !twin.image_url) patch.image_url = photo
    if (category && !normaliseCategory(twin.category)) patch.category = category
    let photoNote = ''
    if (Object.keys(patch).length) {
      let update = supabase.from('products').update(patch).eq('id', twin.id)
      if (patch.image_url) update = twin.image_url == null ? update.is('image_url', null) : update.eq('image_url', twin.image_url)
      if (patch.category) update = twin.category == null ? update.is('category', null) : update.eq('category', twin.category)
      const { data: changed, error: upErr } = await update.select('id').maybeSingle()
      if (!upErr && changed) {
        const added = [patch.image_url ? 'your photo' : null, patch.category ? `the category ${category}` : null]
          .filter(Boolean)
          .join(' and ')
        photoNote = ` and ${added} ${patch.image_url && patch.category ? 'were' : 'was'} added to it`
      }
    }
    const product = await loadPricingProduct(db, twin.id)
    refreshPricingViews()
    return {
      productId: product.id,
      name: product.name,
      product,
      created: false,
      reusedReason: `"${product.name}" is already in the catalogue - linked to that instead of creating a second row${photoNote}. New-product selling prices were not applied; its existing prices are unchanged.`,
    }
  }

  // `sku` carries the supplier's own code when the document had one; it is
  // the only durable handle on their side.
  // Stock is NOT assumed. This purchase has not been received into the
  // warehouse by this screen, and inventing an opening quantity would
  // corrupt every stock comparison that follows.
  // CHECK products_cost_price_positive: cost_price must be NULL or > 0, so a
  // zero or missing price must stay NULL rather than be written as 0.
  // Canonical list only (lib/products/categories.ts). A value off the list
  // is exactly how the column ended up with 21 overlapping spellings.
  const result = await createInventoryProductRecord(supabase, creationInput, { requirePricing: true, allowOpeningStock: false })
  const product = await loadPricingProduct(db, result.productId)
  refreshPricingViews()
  return {
    productId: product.id, name: product.name, product, created: result.created,
    ...(!result.created ? { reusedReason: `"${product.name}" already existed - linked to that instead. New-product selling prices and variants were not applied; its existing prices and variants are unchanged.` } : {}),
  }
}

function refreshPricingViews() {
  revalidatePath('/dashboard/purchasing/local', 'layout')
  revalidatePath('/dashboard/deliveries/inventory')
}

function checkedProductId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('Choose a valid product from Inventory.')
  }
  return value
}

export async function getPurchasingCatalogueAction(): Promise<PricingProduct[]> {
  const { db } = await requireBuyer()
  return loadPricingCatalogue(db)
}

export async function getProductPricingAction(productId: string): Promise<PricingProduct> {
  const { db } = await requireBuyer()
  return loadPricingProduct(db, checkedProductId(productId))
}

export async function savePurchasingProductAction(input: {
  productId: string
  draft: ProductEditDraft
  expectedRevision: string
}): Promise<PricingProduct> {
  const { db, supabase } = await requireBuyer()
  const productId = checkedProductId(input?.productId)
  const current = await loadPricingProduct(db, productId)
  if (typeof input.expectedRevision !== 'string' || productEditRevision(current) !== input.expectedRevision) {
    throw new Error('This product changed while the dialog was open. Reload current product before saving.')
  }
  const checked = validateProductEdit(input?.draft, current)
  if (!checked.ok) throw new Error(checked.issues[0].message)
  if (!Object.keys(checked.patch).length) return current

  if (checked.patch.name) {
    const wanted = normalizeName(checked.patch.name)
    const catalogue = await fetchAll<{ id: string; name: string }>((from, to) =>
      db.from('products').select('id,name').order('id').range(from, to),
    )
    const twin = catalogue.find((product) => product.id !== productId && normalizeName(product.name) === wanted)
    if (twin) throw new Error(`“${twin.name}” already exists in Inventory. Choose another name; these products have not been merged.`)
  }

  // Compare-and-set uses the authoritative snapshot, not client-provided filters.
  // Checking only updated_at misses writers that do not maintain that timestamp.
  let update = supabase.from('products').update({
    ...checked.patch,
    updated_at: new Date().toISOString(),
  }).eq('id', productId)

  const details = { name: current.name, image_url: current.imageUrl, category: current.category }
  for (const [column, value] of Object.entries(details)) {
    update = value == null ? update.is(column, null) : update.eq(column, value)
  }
  const columns = ['price', 'price_spx2', 'price_spx3', 'price_b1g1', 'promo_price', 'is_b1g1', 'has_variants', 'updated_at'] as const
  for (const column of columns) {
    const value = current.pricing[column]
    update = value == null ? update.is(column, null) : update.eq(column, value)
  }
  update = current.pricing.bundle_prices == null
    ? update.is('bundle_prices', null)
    : update.eq('bundle_prices', JSON.stringify(current.pricing.bundle_prices))

  // The request client supplies auth.uid() to the existing price-history trigger.
  const { data, error } = await update.select(PRODUCT_PRICING_COLUMNS).maybeSingle()
  if (error?.code === '23505') throw new Error('That product name already exists. Choose another name; nothing was overwritten.')
  if (error) throw new Error('Could not save the product. Your entries are still here; please try again.')
  if (!data) throw new Error('This product changed before the save completed. Nothing was overwritten. Reload current product and try again.')

  refreshPricingViews()
  return pricingProductFromRow(data as PricingProductRow, current.pricing.hasVariantPrice, current.variants)
}
