import type { SupabaseClient } from '@supabase/supabase-js'
import { suggestForLabels, type Candidate } from './suggest'
import { decideAutoLink } from './autolink'
import { fetchChinaCostRefs, fetchProductRefs } from './costs'
import { compareLine } from './vat'
import { reconcileReceipt, type ReceiptOverrides } from './reconcile'
import { draftEvidence } from './receipt-input'
import { loadSupplierCatalogue } from './supplier-catalogue'
import { conflictingSupplierSelections, supplierIdentityKey, supplierIdentityMatch } from './supplier-identity'
import { recordedVariantId, variantDescription } from '@/lib/products/pricing'
import { loadPurchasingVariants } from '@/lib/products/pricing-server'
import type { ReceiptEvidence } from './evidence'
import type { AnalysedLine, DraftLineInput } from '@/app/dashboard/purchasing/local/actions'

export interface ReceiptAnalysisInput {
  lines: DraftLineInput[]
  supplierId?: string | null
  document?: ReceiptEvidence | null
  overrides?: ReceiptOverrides
  discountPercent?: number | null
  vatPercent?: number | null
  vatReclaimable?: boolean
  pricesIncludeVat?: boolean
}

export async function analyseReceiptLines(db: SupabaseClient, input: ReceiptAnalysisInput): Promise<AnalysedLine[]> {
  if (!Array.isArray(input.lines) || input.lines.length > 2000) throw new Error('Check at most 2,000 lines at once.')
  const lines = input.lines.filter((line) => line.supplierLabel.trim())
  if (!lines.length) return []
  let reclaimable = false
  if (input.supplierId) {
    const { data, error } = await db.from('local_suppliers').select('id,vat_number').eq('id', input.supplierId).eq('is_active', true).single()
    if (error || !data) throw new Error('Choose an active supplier.')
    reclaimable = Boolean(data.vat_number)
  }
  const document = draftEvidence(input.lines, input.document, input)
  const receipt = reconcileReceipt(document, input.overrides, reclaimable)
  const normalized = new Map(receipt.lines.map((line) => [line.key, line]))
  const [suggestions, catalogue] = await Promise.all([
    suggestForLabels(lines.map((line) => line.supplierLabel)),
    input.supplierId ? loadSupplierCatalogue(db, input.supplierId) : Promise.resolve([]),
  ])
  const ids = [...new Set([...lines.map((line) => line.productId), ...catalogue.map((p) => p.productId)].filter((id): id is string => Boolean(id)))]
  const [chinaRefs, products, variants] = await Promise.all([fetchChinaCostRefs(ids), fetchProductRefs(ids), loadPurchasingVariants(db, ids)])
  const conflicts = conflictingSupplierSelections(lines)
  return lines.map((line) => {
    const mapped = supplierIdentityMatch(line, catalogue)
    let candidates = suggestions.get(line.supplierLabel) ?? []
    let autoLink = decideAutoLink(candidates)
    let supplierConflict: string | null = conflicts.has(supplierIdentityKey(line))
      ? 'Identical supplier description, code and unit have different product or variant choices. Every receipt row will be retained, but no supplier mapping will be learned for these conflicting rows.' : null
    let supplierVariant: AnalysedLine['supplierVariant'] = null
    if (mapped.match) {
      const match = mapped.match
      const cost = chinaRefs.get(match.productId)
      const known: Candidate = { productId: match.productId, name: match.productName, imageUrl: match.imageUrl,
        stockOnHand: products.get(match.productId)?.stockOnHand ?? null, importCount: cost?.orderCount ?? 0,
        landedUnitCost: cost?.landedUnitCost ?? null, score: 100,
        reason: match.provenance === 'auto' ? 'Saved supplier identity; its original product link was automatic' : 'Saved product identity for this supplier' }
      candidates = [known, ...candidates.filter((c) => c.productId !== match.productId)].slice(0, 6)
      autoLink = { link: true, productId: match.productId, productName: match.productName, reason: known.reason }
      const savedVariantId = recordedVariantId(match)
      const savedVariant = variants.get(match.productId)?.find((variant) => variant.id === savedVariantId && variant.isActive)
      if (savedVariant && !conflicts.has(supplierIdentityKey(line))) supplierVariant = { productId: match.productId, variantId: savedVariant.id }
      if (line.productId && (line.productId !== match.productId || (line.variantId && savedVariantId && line.variantId !== savedVariantId))) {
        supplierConflict = `This supplier identity is already saved as “${match.productName}${savedVariantId ? ` — ${variantDescription(match.variantSnapshot)}` : ''}”. Your receipt can use another product or variant with a reason, but the saved mapping will not be repointed.`
      } else if (savedVariantId && !savedVariant) {
        supplierConflict = 'The variant in this supplier’s saved identity is no longer active or available. Choose an existing variant or leave this purchase unspecified; the historical mapping will be kept.'
      }
    } else if (mapped.ambiguous) {
      autoLink = { link: false, needsChoice: true, reason: 'The supplier catalogue has this wording with different codes or units. Complete the identity or choose the correct Inventory product.' }
    }
    const amounts = normalized.get(line.key)
    const china = line.productId ? chinaRefs.get(line.productId) ?? null : null
    const productVariants = line.productId ? variants.get(line.productId) ?? [] : []
    const selectedVariant = productVariants.find((variant) => variant.id === line.variantId && variant.isActive)
    const variantError = line.variantId && !selectedVariant ? 'Selected variant is unavailable, inactive or belongs to another product. Choose another or explicitly clear it.' : null
    const variantScoped = Boolean(line.variantId || productVariants.length || (line.productId && products.get(line.productId)?.hasVariants))
    const comparison = compareLine({ localNetUnit: amounts?.unitAmounts.unitPriceNet ?? 0, qty: line.qty ?? 0,
      vatPercent: amounts?.unitAmounts.vatPercent ?? 0, vatReclaimable: reclaimable,
      china: variantScoped ? null : china,
      stockOnHand: variantScoped ? selectedVariant?.stockOnHand ?? null : line.productId ? products.get(line.productId)?.stockOnHand ?? null : null,
      linked: Boolean(line.productId) && Boolean(amounts) })
    if (variantScoped) comparison.message = 'China imports do not identify variants, so no like-for-like price difference or saving is calculated.'
    if (variantError) comparison.message = variantError
    if (!amounts) comparison.message = 'Receipt price unresolved. Correct the document checks before comparing costs.'
    return { key: line.key, candidates, autoLink, comparison, supplierConflict, supplierVariant, variantError,
      comparisonScope: variantScoped ? 'variant_unavailable' as const : 'product' as const,
      productImportReference: variantScoped && china && china.landedUnitCost > 0 ? { unitCost: china.landedUnitCost, count: china.orderCount } : null,
      receiptRevision: receipt.inputRevision, receiptStatus: receipt.status,
      unitPriceNet: amounts?.unitAmounts.unitPriceNet ?? 0, unitAmounts: amounts?.unitAmounts ?? null,
      vat: { net: amounts?.net ?? 0, vat: amounts?.vat ?? 0, gross: amounts?.payable ?? 0, reclaimable: reclaimable ? amounts?.vat ?? 0 : 0 },
      suspectImports: (china?.suspectRows ?? []).map((row) => ({ landedUnitCost: row.landedUnitCost, label: row.label, importedAt: row.importedAt })) }
  })
}
