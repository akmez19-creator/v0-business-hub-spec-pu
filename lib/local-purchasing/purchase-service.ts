import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { evidenceRevision, normaliseEvidence, type ReceiptEvidence } from './evidence'
import { reconcileReceipt, type ReceiptOverrides } from './reconcile'
import { comparableEvidence, draftEvidence, purchaseReviewRevision } from './receipt-input'
import { analyseReceiptLines } from './analyse'
import { loadOwnedDocument } from './documents'
import { cleanCopiedFigures } from './extract'
import { supplierIdentityIssue } from './supplier-identity'
import { validatePurchasingVariants } from '@/lib/products/pricing-server'
import type { DraftLineInput } from '@/app/dashboard/purchasing/local/actions'

export interface SavePurchaseInput {
  supplierId: string
  docRef?: string | null
  purchaseDate?: string | null
  discountPercent?: number | null
  vatPercent?: number | null
  vatReclaimable?: boolean
  pricesIncludeVat?: boolean
  documentTotalGross?: number | null
  notes?: string | null
  status?: string
  documentIds?: string[]
  documentRevision?: number
  reviewRevision?: number
  document?: ReceiptEvidence | null
  overrides?: ReceiptOverrides
  lines: DraftLineInput[]
  idempotencyKey: string
  actualPurchase: boolean
  acknowledgement?: { revision: string; reason: string } | null
}
export interface OrderCommitContext {
  orderId: string
  revision: number
  allocationRevision: number
  documentId: string
  reviewHash: string | null
  reviewEpoch: number
  requestHash: string
  comparison: unknown
  hasDifferences: boolean
}

const number = z.number().finite().min(0).max(1_000_000_000).nullable()
const draftSchema = z.object({
  key: z.string().min(1).max(120), supplierLabel: z.string().max(2000), supplierCode: z.string().max(2000).nullable().optional(),
  unit: z.string().max(2000).nullable().optional(), qty: number, unitPriceGross: number, lineTotal: number.optional(),
  discountPercent: z.number().finite().min(0).max(100).nullable().optional(),
  variantId: z.string().uuid().nullable().optional(), variantSource: z.enum(['manual','supplier','order']).nullable().optional(), variantCleared: z.boolean().optional(),
  productId: z.string().uuid().nullable().optional(), matchMethod: z.enum(['auto','confirmed','created','alias','manual','unmatched']).nullable().optional(),
  orderLineId: z.string().uuid().nullable().optional(), evidence: z.custom<DraftLineInput['evidence']>().optional(),
})
const requestSchema = z.object({
  supplierId: z.string().uuid(), idempotencyKey: z.string().uuid(), actualPurchase: z.literal(true),
  docRef: z.string().max(2000).nullable().optional(), purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().max(10000).nullable().optional(), documentIds: z.array(z.string().uuid()).max(1).optional(),
  documentRevision: z.number().int().positive().optional(), reviewRevision: z.number().int().nonnegative().optional(),
  document: z.custom<ReceiptEvidence | null>().optional(),
  overrides: z.object({ pricesIncludeVat: z.boolean().nullable().optional(), discountTreatment: z.enum(['apply','included']).nullable().optional(), vatPercent: z.number().finite().min(0).max(100).nullable().optional() }).optional(),
  acknowledgement: z.object({ revision: z.string().max(300), reason: z.string().trim().min(8).max(4000) }).nullable().optional(),
  lines: z.array(draftSchema).min(1).max(2000),
  discountPercent: z.number().finite().min(0).max(100).nullable().optional(), vatPercent: z.number().finite().min(0).max(100).nullable().optional(), pricesIncludeVat: z.boolean().optional(),
})

export async function persistLocalPurchase(db: SupabaseClient, userId: string, raw: SavePurchaseInput, order?: OrderCommitContext) {
  const parsed = requestSchema.safeParse(raw)
  if (!parsed.success) throw new Error(raw.actualPurchase !== true ? 'Confirm that this records an actual purchase, not just a supplier quotation.' : 'Correct the missing or invalid purchase fields before saving.')
  const input = parsed.data
  const hash = order?.requestHash ?? createHash('sha256').update(JSON.stringify({ userId, input })).digest('hex')
  const { data: previous, error: replayError } = await db.from('local_purchases').select('id,created_by,payload_hash,calculation').eq('idempotency_key', input.idempotencyKey).maybeSingle()
  if (replayError) throw new Error('Could not check the save request. Nothing new was recorded.')
  if (previous) {
    if (previous.created_by !== userId || previous.payload_hash !== hash) throw new Error('This save request already recorded a different revision. Reload the saved purchase before starting another.')
    return { id: String(previous.id), lineCount: (previous.calculation as { lines?: unknown[] } | null)?.lines?.length ?? input.lines.length, replayed: true }
  }
  await validatePurchasingVariants(db, input.lines)
  const { data: supplier, error: supplierError } = await db.from('local_suppliers').select('id,name,vat_number').eq('id', input.supplierId).eq('is_active', true).single()
  if (supplierError || !supplier) throw new Error('Choose an active supplier.')
  const reclaimable = Boolean(supplier.vat_number)
  const document = draftEvidence(input.lines, input.document, input)
  const receipt = reconcileReceipt(document, input.overrides, reclaimable)
  if (!receipt.canRecord || !receipt.resolved || !receipt.totals) throw new Error(receipt.issues.find((i) => i.essential)?.message ?? 'The document price treatment is unresolved. Correct the evidence or explicitly confirm the VAT and discount terms.')
  const acknowledgementRevision = purchaseReviewRevision(receipt.inputRevision, input)
  const reason = input.acknowledgement?.revision === acknowledgementRevision ? input.acknowledgement.reason.trim() : ''
  const sourceDocuments = await Promise.all((input.documentIds ?? []).map((id) => loadOwnedDocument(db, userId, id)))
  if (order && (sourceDocuments.length !== 1 || sourceDocuments[0].id !== order.documentId)) throw new Error('Record the specific document reviewed for this order.')
  let amendedEvidence = false
  for (const source of sourceDocuments) {
    if (source.purchase_id) throw new Error('This source document was already recorded. Open its saved purchase instead.')
    if (source.evidence_revision !== input.documentRevision || source.review_revision !== input.reviewRevision) throw new Error('The source document revision changed. Reload and review it again.')
    if (!order && source.order_id) throw new Error('This document belongs to an order. Confirm it from the order review, not direct receipt entry.')
    if (order && (source.order_id !== order.orderId || source.order_revision !== order.revision || source.review_hash !== order.reviewHash)) throw new Error('The order document review is stale.')
    const original = cleanCopiedFigures(normaliseEvidence(source.extracted as ReceiptEvidence)).doc
    amendedEvidence ||= evidenceRevision(comparableEvidence(original)) !== evidenceRevision(comparableEvidence(document))
  }
  const supplierIssue = sourceDocuments.length ? supplierIdentityIssue(document, { name: supplier.name, vatNumber: supplier.vat_number }) : null
  const analysis = await analyseReceiptLines(db, { lines: input.lines, supplierId: input.supplierId, document, overrides: input.overrides })
  const mappingConflict = analysis.find((line) => line.supplierConflict)?.supplierConflict
  const manualTreatment = Object.values(input.overrides ?? {}).some((v) => v != null)
  const kindException = !['invoice','receipt'].includes(document.docKind)
  const requiresReason = receipt.status !== 'verified' || amendedEvidence || manualTreatment || Boolean(supplierIssue) || Boolean(mappingConflict) || kindException || Boolean(order?.hasDifferences)
  if (requiresReason && reason.length < 8) throw new Error(mappingConflict ?? supplierIssue ?? 'Review the current differences and give a specific reason before recording this exception.')
  const normalized = new Map(receipt.lines.map((line) => [line.key, line]))
  const compared = new Map(analysis.map((line) => [line.key, line]))
  const lines = input.lines.filter((line) => normalized.has(line.key)).map((line) => {
    const result = normalized.get(line.key)!
    const comparison = compared.get(line.key)?.comparison
    const source = sourceDocuments[0]?.extracted as ReceiptEvidence | undefined
    return { supplier_label: line.supplierLabel, supplier_code: line.supplierCode || null, unit: line.unit || null,
      product_id: line.productId || null, match_method: line.productId ? line.matchMethod || 'auto' : 'unmatched',
      variant_id: line.variantId || null, variant_source: line.variantSource || 'manual',
      qty: result.qty, unit_price_gross: result.unitAmounts.listPriceNet, discount_percent: result.unitAmounts.discountPercent,
      china_cp_at_purchase: comparison?.chinaUnitCost ?? null, variance_percent: comparison?.variancePercent ?? null,
      order_line_id: order ? line.orderLineId || null : null,
      source_evidence: source ? normaliseEvidence(source).lines.find((l) => l.key === line.key) ?? null : null,
      calculation: result, vat_percent: result.unitAmounts.vatPercent, printed_discount_percent: result.printedDiscountPercent,
      printed_unit_price: document.lines.find((l) => l.key === line.key)?.unitPrice ?? null,
      source_key: line.key, unit_payable: Math.round(result.rawPayable / result.qty * 10000) / 10000 }
  })
  const payload = {
    supplier_id: input.supplierId, doc_ref: input.docRef?.trim() || document.docRef || null,
    purchase_date: input.purchaseDate || document.docDate || new Date().toISOString().slice(0,10),
    discount_percent: receipt.resolved.additionalDiscountPercent, vat_percent: receipt.resolved.vatPercent,
    prices_include_vat: receipt.resolved.pricesIncludeVat, vat_reclaimable: reclaimable,
    document_total_gross: document.declaredTotal, charges_payable: receipt.totals.chargesPayable, notes: input.notes || null,
    idempotency_key: input.idempotencyKey, payload_hash: hash, evidence: document, calculation: receipt,
    calculation_revision: receipt.inputRevision, review_status: requiresReason ? 'exception' : 'verified', exception_reason: reason || null,
    net_total: receipt.totals.net, vat_total: receipt.totals.vat, payable_total: receipt.totals.payable,
    order_id: order?.orderId ?? null, order_revision: order?.revision ?? null, allocation_revision: order?.allocationRevision ?? null,
    review_epoch: order?.reviewEpoch ?? null,
    allow_overage: Boolean(order && reason.length >= 8), order_review: order?.comparison ?? null,
    lines, documents: sourceDocuments.map((source) => ({ id: source.id, evidence_revision: source.evidence_revision,
      review_revision: source.review_revision, review_hash: order?.reviewHash ?? null })),
  }
  const { data, error } = await db.rpc('local_commit_purchase', { p_actor: userId, p_payload: payload })
  if (error?.code === '23505') throw new Error('This supplier reference was already recorded. The duplicate purchase was not saved.')
  if (error) throw new Error(`Purchase not recorded: ${error.message}`)
  return data as { id: string; lineCount: number; replayed: boolean }
}
