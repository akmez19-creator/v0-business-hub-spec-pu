import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { normaliseEvidence, evidenceRevision, type ReceiptEvidence } from './evidence'
import { calculateOrder, orderItemIdentityKey, orderNumberText, type LocalOrder, type LocalOrderLine, type OrderParty, type OrderSnapshot, type OrderDocumentSummary, type OrderTerms } from './order-types'
import { compareOrderDocument, orderReviewRevision, type OrderReviewInput, type OrderComparison } from './order-reconcile'
import { loadOwnedDocument, PURCHASE_DOC_BUCKET } from './documents'
import { cleanCopiedFigures } from './extract'
import { analyseReceiptLines } from './analyse'
import { comparableEvidence, purchaseReviewRevision } from './receipt-input'
import { persistLocalPurchase, type SavePurchaseInput } from './purchase-service'
import { loadSupplierCatalogue } from './supplier-catalogue'
import { conflictingSupplierSelections, supplierIdentityMatch, supplierSelectionConflict } from './supplier-identity'
import { validatePurchasingVariants } from '@/lib/products/pricing-server'
import { recordedVariantId, type VariantSnapshot } from '@/lib/products/pricing'
import type { DraftLineInput } from '@/app/dashboard/purchasing/local/actions'

const uuid = z.string().uuid()
const text = z.string().max(2000).nullable()
const percent = z.number().finite().min(0).max(100)
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()
const lineSchema = z.object({
  id: uuid, supplierProductId: uuid.nullable(), productId: uuid.nullable(),
  variantId: uuid.nullable().optional(), variantSource: z.enum(['manual','supplier','order']).nullable().optional(), variantCleared: z.boolean().optional(),
  supplierLabel: z.string().trim().min(1).max(2000), supplierCode: text, unit: text,
  qty: z.number().finite().positive().max(10_000_000), expectedUnitPrice: z.number().finite().min(0).max(1_000_000_000).nullable(),
  vatPercent: percent, pricesIncludeVat: z.boolean(), discountPercent: percent,
  sourcePurchaseLineId: uuid.nullable(), priceReferenceDate: date,
})
const mutationSchema = z.object({ id: uuid, revision: z.number().int().nonnegative(), updatedAt: z.string().datetime({ offset: true }).nullable(), requestKey: uuid })
const saveSchema = mutationSchema.extend({ supplierId: uuid, lines: z.array(lineSchema).min(1).max(2000),
  terms: z.object({ charges: z.array(z.object({ label: z.string().max(2000), amount: z.number().finite().min(0).max(1_000_000_000).nullable(), vatPercent: percent.nullable(), pricesIncludeVat: z.boolean().nullable() })).max(50), roundingAmount: z.number().finite().min(-1000).max(1000).nullable() }),
  notes: z.string().max(10000).nullable(), expectedDate: date,
})
export type OrderMutationInput = z.infer<typeof mutationSchema>
export type SaveOrderInput = z.infer<typeof saveSchema>
export interface OrderListItem { id: string; orderNumber: string; supplierName: string; status: LocalOrder['status']; revision: number; updatedAt: string; total: number | null }
export interface OrderBundle { order: LocalOrder; documents: OrderDocumentSummary[] }
export interface OrderDocumentView {
  id: string; fileName: string; documentRevision: number; reviewRevision: number;
  original: ReceiptEvidence; input: OrderReviewInput; sourceUrl: string | null; accepted: boolean;
}
export interface ReviewRequest {
  orderId: string; documentId: string; orderRevision: number; allocationRevision: number; reviewEpoch: number;
  documentRevision: number; reviewRevision: number; input: OrderReviewInput;
  acknowledgement: { revision: string; reason: string } | null;
}
export interface RecordOrderRequest extends ReviewRequest { idempotencyKey: string; actualPurchase: boolean }
const requestHash = (userId: string, value: unknown) => createHash('sha256').update(JSON.stringify({ userId, value })).digest('hex')
const party = (row: Record<string, unknown>): OrderParty => ({ name: String(row.name ?? row.company_name ?? ''), vatNumber: row.vat_number as string | null,
  address: (row.address ?? row.company_address) as string | null, phone: row.phone as string | null, email: row.email as string | null, brn: row.brn as string | null })
const related = (row: unknown): Record<string, unknown> => (Array.isArray(row) ? row[0] : row) as Record<string, unknown> ?? {}
const columns = 'id,order_number,supplier_id,status,revision,issued_revision,allocation_revision,review_epoch,issued_snapshot,revision_history,confirmation,terms,notes,expected_date,updated_at,cancellation_reason,local_suppliers(name,vat_number,address,phone,email,brn)'

export async function listLocalOrders(db: SupabaseClient): Promise<OrderListItem[]> {
  const rows = await fetchAll<Record<string, unknown>>((from, to) => db.from('local_purchase_orders')
    .select('id,order_number,status,revision,updated_at,issued_snapshot,local_suppliers(name)')
    .order('updated_at', { ascending: false }).order('id').range(from, to))
  return rows.map((row) => ({ id: String(row.id), orderNumber: orderNumberText(String(row.order_number)), supplierName: String(related(row.local_suppliers).name ?? 'Supplier'),
    status: row.status as LocalOrder['status'], revision: Number(row.revision), updatedAt: String(row.updated_at),
    total: (row.issued_snapshot as OrderSnapshot | null)?.calculation?.totals?.payable ?? null }))
}

export async function loadLocalOrder(db: SupabaseClient, id: string): Promise<LocalOrder> {
  uuid.parse(id)
  const { data, error } = await db.from('local_purchase_orders').select(columns).eq('id', id).maybeSingle()
  if (error || !data) throw new Error('This local order is unavailable.')
  const [rows, allocations] = await Promise.all([
    fetchAll<Record<string, unknown>>((from, to) => db.from('local_purchase_order_lines').select('id,supplier_product_id,product_id,supplier_label,supplier_code,unit,qty,expected_unit_price,vat_percent,prices_include_vat,discount_percent,source_purchase_line_id,price_reference_date,variant_id,variant_snapshot')
      .eq('order_id', id).eq('is_active', true).order('position').order('id').range(from, to)),
    fetchAll<{ order_line_id: string | null; qty: number }>((from, to) => db.from('local_purchase_lines').select('id,order_line_id,qty,local_purchases!inner(order_id,status)')
      .eq('local_purchases.order_id', id).eq('local_purchases.status', 'recorded').not('order_line_id', 'is', null).order('id').range(from, to)),
  ])
  const received: Record<string, number> = {}
  for (const allocation of allocations) if (allocation.order_line_id) received[allocation.order_line_id] = (received[allocation.order_line_id] ?? 0) + Number(allocation.qty)
  const lines: LocalOrderLine[] = rows.map((row) => ({ id: String(row.id), supplierProductId: row.supplier_product_id as string | null, productId: row.product_id as string | null,
    supplierLabel: String(row.supplier_label), supplierCode: row.supplier_code as string | null, unit: row.unit as string | null,
    qty: Number(row.qty), expectedUnitPrice: row.expected_unit_price == null ? null : Number(row.expected_unit_price), vatPercent: Number(row.vat_percent),
    pricesIncludeVat: Boolean(row.prices_include_vat), discountPercent: Number(row.discount_percent), sourcePurchaseLineId: row.source_purchase_line_id as string | null,
    priceReferenceDate: row.price_reference_date as string | null,
    variantId: row.variant_id as string | null, variantSnapshot: row.variant_snapshot as VariantSnapshot | null,
    variantSource: (row.variant_snapshot as VariantSnapshot | null)?.provenance ?? null }))
  return { id, orderNumber: orderNumberText(data.order_number), supplierId: data.supplier_id, supplier: party(related(data.local_suppliers)),
    status: data.status, revision: data.revision, issuedRevision: data.issued_revision, allocationRevision: data.allocation_revision, reviewEpoch: data.review_epoch,
    issuedSnapshot: data.issued_snapshot as OrderSnapshot | null, revisionHistory: data.revision_history ?? [], confirmation: data.confirmation,
    lines, terms: { charges: [], roundingAmount: null, ...data.terms } as OrderTerms, notes: data.notes, expectedDate: data.expected_date,
    updatedAt: data.updated_at, cancellationReason: data.cancellation_reason, received }
}

export async function loadOrderBundle(db: SupabaseClient, userId: string, id: string): Promise<OrderBundle> {
  const order = await loadLocalOrder(db, id)
  const rows = await fetchAll<Record<string, unknown>>((from, to) => db.from('local_purchase_documents')
    .select('id,file_name,kind,created_at,order_revision,review_revision,purchase_id,accepted_review,created_by')
    .eq('order_id', id).order('created_at', { ascending: false }).order('id').range(from, to))
  return { order, documents: rows.map((row) => ({ id: String(row.id), fileName: row.file_name as string | null, kind: String(row.kind),
    createdAt: String(row.created_at), orderRevision: row.order_revision as number | null, reviewRevision: Number(row.review_revision), purchaseId: row.purchase_id as string | null,
    accepted: Number((row.accepted_review as { epoch?: number } | null)?.epoch) === order.reviewEpoch, owned: row.created_by === userId })) }
}

async function mutationReplay(db: SupabaseClient, id: string, key: string, hash: string) {
  const { data, error } = await db.from('local_purchase_orders').select('id,revision,last_request_key,last_request_hash').eq('id', id).maybeSingle()
  if (error) throw new Error('Could not check the order request. Please retry.')
  if (data?.last_request_key !== key) return null
  if (data.last_request_hash !== hash) throw new Error('This request already saved different content. Reload the order.')
  return { id: data.id as string, revision: data.revision as number, replayed: true }
}

export async function saveLocalOrder(db: SupabaseClient, userId: string, raw: SaveOrderInput) {
  const input = saveSchema.parse(raw)
  const hash = requestHash(userId, { operation: 'save', input })
  const replay = await mutationReplay(db, input.id, input.requestKey, hash)
  if (replay) return replay
  await validatePurchasingVariants(db, input.lines)
  const identities = input.lines.map(orderItemIdentityKey)
  if (new Set(identities).size !== identities.length) throw new Error('Combine identical supplier items and variants into one ordered quantity. Different codes, units or variants may remain separate.')
  const { data, error } = await db.rpc('local_mutate_order', { p_actor: userId, p_id: input.id, p_revision: input.revision, p_updated_at: input.updatedAt,
    p_request_key: input.requestKey, p_request_hash: hash, p_operation: 'save', p_payload: {
      supplier_id: input.supplierId, notes: input.notes, expected_date: input.expectedDate, terms: input.terms,
      lines: input.lines.map((line) => ({ id: line.id, supplier_product_id: line.supplierProductId, product_id: line.productId,
        variant_id: line.variantId || null, variant_source: line.variantSource || 'manual',
        supplier_label: line.supplierLabel, supplier_code: line.supplierCode, unit: line.unit, qty: line.qty,
        expected_unit_price: line.expectedUnitPrice, vat_percent: line.vatPercent, prices_include_vat: line.pricesIncludeVat,
        discount_percent: line.discountPercent, source_purchase_line_id: line.sourcePurchaseLineId, price_reference_date: line.priceReferenceDate })),
    } })
  if (error) throw new Error(error.message)
  return data as { id: string; revision: number; replayed: boolean }
}

export async function changeLocalOrder(db: SupabaseClient, userId: string, operation: 'issue' | 'cancel', raw: OrderMutationInput & { reason?: string }) {
  const input = mutationSchema.extend({ reason: z.string().max(4000).optional() }).parse(raw)
  const hash = requestHash(userId, { operation, input })
  const replay = await mutationReplay(db, input.id, input.requestKey, hash)
  if (replay) return replay
  const order = await loadLocalOrder(db, input.id)
  let snapshot: OrderSnapshot | undefined
  if (operation === 'issue') {
    await validatePurchasingVariants(db, order.lines.map((line) => ({ ...line, variantId: recordedVariantId(line) })))
    const calculation = calculateOrder(order.lines, order.terms, order.supplier)
    if (!calculation.canRecord) throw new Error('Complete quantities, expected prices and VAT terms before issuing this revision.')
    const { data: company, error } = await db.from('company_settings').select('company_name,company_address,brn,vat_number,phone,email').order('id').limit(1).maybeSingle()
    if (error || !company?.company_name) throw new Error('Set the buyer company details in Settings before issuing a purchase order.')
    snapshot = { orderId: order.id, orderNumber: order.orderNumber, revision: order.revision, supplier: order.supplier, buyer: party(company),
      lines: order.lines, terms: order.terms, notes: order.notes, expectedDate: order.expectedDate, issuedAt: new Date().toISOString(), calculation }
  }
  const { data, error } = await db.rpc('local_mutate_order', { p_actor: userId, p_id: input.id, p_revision: input.revision, p_updated_at: input.updatedAt,
    p_request_key: input.requestKey, p_request_hash: hash, p_operation: operation, p_payload: { snapshot, reason: input.reason } })
  if (error) throw new Error(error.message)
  return data as { id: string; revision: number; replayed: boolean }
}

function validatedReview(raw: OrderReviewInput): OrderReviewInput {
  const parsed = z.object({ document: z.custom<ReceiptEvidence>(), overrides: z.object({ pricesIncludeVat: z.boolean().nullable().optional(), discountTreatment: z.enum(['apply','included']).nullable().optional(), vatPercent: percent.nullable().optional() }),
    decisions: z.record(z.string().max(120), uuid.nullable()), products: z.record(z.string().max(120), z.object({ productId: uuid.nullable(), matchMethod: z.enum(['auto','confirmed','manual','created','alias','unmatched']),
      variantId: uuid.nullable().optional(), variantSource: z.enum(['manual','supplier','order']).nullable().optional(), variantCleared: z.boolean().optional() })) }).parse(raw)
  const document = normaliseEvidence(parsed.document)
  const keys = document.lines.map((line) => z.string().min(1).max(120).parse(line.key))
  if (keys.length !== new Set(keys).size) throw new Error('Document rows must have distinct source identities.')
  if (Object.keys(parsed.decisions).some((key) => !keys.includes(key)) || Object.keys(parsed.products).some((key) => !keys.includes(key))) throw new Error('A product decision belongs to a removed document row.')
  return { ...parsed, document }
}

export function reviewDraftLines(input: OrderReviewInput, comparison?: OrderComparison): DraftLineInput[] {
  const allocations = new Map(comparison?.allocations.map((item) => [item.lineKey, item.orderLineId]) ?? [])
  return input.document.lines.map((line) => ({ key: line.key!, supplierLabel: line.label, supplierCode: line.code, unit: line.unit,
    qty: line.qty, unitPriceGross: line.unitPrice, lineTotal: line.lineTotal, evidence: line,
    productId: input.products[line.key!]?.productId ?? null, matchMethod: input.products[line.key!]?.matchMethod ?? 'unmatched', orderLineId: allocations.get(line.key!) ?? null,
    variantId: input.products[line.key!]?.variantId ?? null, variantSource: input.products[line.key!]?.variantSource ?? null, variantCleared: input.products[line.key!]?.variantCleared === true }))
}

export async function loadOrderDocument(db: SupabaseClient, userId: string, orderId: string, documentId: string): Promise<OrderDocumentView> {
  const [order, source] = await Promise.all([loadLocalOrder(db, orderId), loadOwnedDocument(db, userId, documentId)])
  if (source.order_id !== orderId) throw new Error('This document belongs to a different order.')
  if (source.purchase_id) throw new Error('This document has already been recorded. Open the saved purchase.')
  const original = cleanCopiedFigures(normaliseEvidence(source.extracted as ReceiptEvidence)).doc
  let input: OrderReviewInput
  if (source.reviewed_document?.document) input = validatedReview(source.reviewed_document as OrderReviewInput)
  else {
    input = { document: original, overrides: {}, decisions: {}, products: {} }
    const [analysis] = await Promise.all([analyseReceiptLines(db, { supplierId: order.supplierId, document: original, lines: reviewDraftLines(input) })])
    const preliminary = order.issuedSnapshot ? compareOrderDocument(order.issuedSnapshot, input, order.received, order.allocationRevision, Boolean(order.supplier.vatNumber)) : null
    for (const line of original.lines) {
      const allocated = preliminary?.allocations.find((item) => item.lineKey === line.key)
      const orderedItem = order.issuedSnapshot?.lines.find((item) => item.id === allocated?.orderLineId)
      const answer = analysis.find((item) => item.key === line.key)
      const suggestion = answer?.autoLink
      const productId = orderedItem?.productId || (suggestion?.link ? suggestion.productId : null)
      const variantId = orderedItem ? recordedVariantId(orderedItem) : answer?.supplierVariant?.productId === productId ? answer.supplierVariant.variantId : null
      input.products[line.key!] = { productId, matchMethod: productId ? 'auto' : 'unmatched',
        variantId, variantSource: variantId ? orderedItem ? 'order' : 'supplier' : null, variantCleared: false }
    }
  }
  const { data: signed } = await db.storage.from(PURCHASE_DOC_BUCKET).createSignedUrl(source.url, 600)
  return { id: source.id, fileName: source.file_name || 'Supplier document', documentRevision: source.evidence_revision, reviewRevision: source.review_revision,
    original, input, sourceUrl: signed?.signedUrl ?? null, accepted: source.accepted_review?.epoch === order.reviewEpoch }
}

async function currentReview(db: SupabaseClient, userId: string, raw: ReviewRequest) {
  const ids = z.object({ orderId: uuid, documentId: uuid, orderRevision: z.number().int().positive(), allocationRevision: z.number().int().nonnegative(), reviewEpoch: z.number().int().nonnegative(),
    documentRevision: z.number().int().positive(), reviewRevision: z.number().int().nonnegative(), acknowledgement: z.object({ revision: z.string().max(300), reason: z.string().max(4000) }).nullable() }).parse(raw)
  const input = validatedReview(raw.input)
  const [order, source] = await Promise.all([loadLocalOrder(db, ids.orderId), loadOwnedDocument(db, userId, ids.documentId)])
  if (!order.issuedSnapshot || !['issued','confirmed','partial'].includes(order.status) || order.revision !== ids.orderRevision || order.issuedRevision !== ids.orderRevision || order.allocationRevision !== ids.allocationRevision || order.reviewEpoch !== ids.reviewEpoch) throw new Error('The order, its documents or recorded quantities changed. Reload and review the current revision.')
  if (source.order_id !== order.id || source.order_revision !== order.revision || source.purchase_id || source.evidence_revision !== ids.documentRevision || source.review_revision !== ids.reviewRevision) throw new Error('This source document revision is stale or already recorded.')
  await validatePurchasingVariants(db, reviewDraftLines(input))
  const comparison = compareOrderDocument(order.issuedSnapshot, input, order.received, order.allocationRevision, Boolean(order.supplier.vatNumber))
  const catalogue = await loadSupplierCatalogue(db, order.supplierId)
  const conflicts = input.document.lines.flatMap((line) => {
    const found = supplierIdentityMatch({ supplierLabel: line.label, supplierCode: line.code, unit: line.unit }, catalogue).match
    const chosen = input.products[line.key!]
    const conflict = found && chosen ? supplierSelectionConflict(chosen, found) : null
    return conflict ? [conflict] : []
  })
  if (conflictingSupplierSelections(reviewDraftLines(input)).size) conflicts.push('Identical supplier wording has contradictory product or variant choices. Every row is retained, but no supplier identity will be learned for these rows.')
  const original = cleanCopiedFigures(normaliseEvidence(source.extracted as ReceiptEvidence)).doc
  const amended = evidenceRevision(comparableEvidence(original)) !== evidenceRevision(comparableEvidence(input.document))
  const requiresReason = comparison.differences.length > 0 || amended || conflicts.length > 0 || Object.values(input.overrides).some((value) => value != null)
  const revision = orderReviewRevision(comparison.revision, ids)
  const reason = ids.acknowledgement?.revision === revision ? ids.acknowledgement.reason.trim() : ''
  return { ids, input, order, source, comparison, requiresReason, conflicts, reason }
}

export async function saveOrderReview(db: SupabaseClient, userId: string, request: ReviewRequest, accept: boolean) {
  const current = await currentReview(db, userId, request)
  const { order, source, input, comparison, requiresReason, reason, conflicts } = current
  if (accept && (!comparison.canAccept || (requiresReason && reason.length < 8))) throw new Error(conflicts[0] ?? 'Resolve essential errors and acknowledge the current differences before accepting.')
  const { data, error } = await db.rpc('local_save_order_review', { p_actor: userId, p_order_id: order.id, p_document_id: source.id,
    p_order_revision: order.revision, p_allocation_revision: order.allocationRevision, p_review_epoch: order.reviewEpoch,
    p_document_revision: source.review_revision, p_evidence_revision: source.evidence_revision, p_review_hash: comparison.revision,
    p_input: { ...input, requiresReason }, p_comparison: comparison, p_accept: accept, p_reason: reason || null })
  if (error) throw new Error(error.message)
  return data as { reviewRevision: number; reviewEpoch: number; replayed: boolean }
}

export async function recordOrderPurchase(db: SupabaseClient, userId: string, request: RecordOrderRequest) {
  uuid.parse(request.idempotencyKey)
  if (request.actualPurchase !== true) throw new Error('Confirm that this is an actual purchase, not just a supplier confirmation.')
  const hash = requestHash(userId, request)
  const { data: previous, error: replayError } = await db.from('local_purchases').select('id,payload_hash,created_by,calculation').eq('idempotency_key', request.idempotencyKey).maybeSingle()
  if (replayError) throw new Error('Could not check the save request. Please retry.')
  if (previous) {
    if (previous.created_by !== userId || previous.payload_hash !== hash) throw new Error('This request key already recorded a different purchase revision.')
    return { id: String(previous.id), lineCount: previous.calculation?.lines?.length ?? 0, replayed: true }
  }
  const { input, order, source, comparison, requiresReason, reason } = await currentReview(db, userId, request)
  if (!comparison.canAccept) throw new Error('Resolve the essential receipt or allocation errors before recording.')
  if ((requiresReason || !['invoice','receipt'].includes(input.document.docKind)) && reason.length < 8) throw new Error('Accept the current differences, corrections or document-type exception with a specific reason.')
  const lines = reviewDraftLines(input, comparison)
  const payload: SavePurchaseInput = { supplierId: order.supplierId, docRef: input.document.docRef, purchaseDate: input.document.docDate,
    documentIds: [source.id], documentRevision: source.evidence_revision, reviewRevision: source.review_revision,
    document: input.document, overrides: input.overrides, lines, idempotencyKey: request.idempotencyKey, actualPurchase: true }
  if (reason.length >= 8) payload.acknowledgement = { revision: purchaseReviewRevision(comparison.receipt.inputRevision, payload), reason }
  return persistLocalPurchase(db, userId, payload, { orderId: order.id, revision: order.revision, allocationRevision: order.allocationRevision,
    documentId: source.id, reviewHash: source.review_hash, reviewEpoch: order.reviewEpoch, requestHash: hash,
    comparison: { comparison, input }, hasDifferences: requiresReason })
}
