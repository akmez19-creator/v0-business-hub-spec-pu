import { normaliseEvidence, type ReceiptEvidence } from './evidence'
import { reconcileReceipt, type ReceiptCheck } from './reconcile'
import { supplierIdentityKey } from './supplier-identity'
import { recordedVariantId, type VariantSelection, type VariantSnapshot } from '@/lib/products/pricing'

export interface OrderParty { name: string; vatNumber: string | null; address: string | null; phone: string | null; email: string | null; brn?: string | null }
export interface LocalOrderLine extends VariantSelection {
  variantSnapshot?: VariantSnapshot | null
  id: string
  supplierProductId: string | null
  productId: string | null
  supplierLabel: string
  supplierCode: string | null
  unit: string | null
  qty: number
  expectedUnitPrice: number | null
  vatPercent: number
  pricesIncludeVat: boolean
  discountPercent: number
  sourcePurchaseLineId: string | null
  priceReferenceDate: string | null
}
export interface OrderTerms { charges: NonNullable<ReceiptEvidence['charges']>; roundingAmount: number | null }
export interface OrderSnapshot {
  orderId: string
  orderNumber: string
  revision: number
  supplier: OrderParty
  buyer: OrderParty
  lines: LocalOrderLine[]
  terms: OrderTerms
  notes: string | null
  expectedDate: string | null
  issuedAt: string
  calculation: ReceiptCheck
}
export interface LocalOrder {
  id: string
  orderNumber: string
  supplierId: string
  supplier: OrderParty
  status: 'draft' | 'issued' | 'confirmed' | 'partial' | 'completed' | 'cancelled'
  revision: number
  issuedRevision: number | null
  allocationRevision: number
  reviewEpoch: number
  issuedSnapshot: OrderSnapshot | null
  revisionHistory: OrderSnapshot[]
  confirmation: Record<string, unknown> | null
  lines: LocalOrderLine[]
  terms: OrderTerms
  notes: string | null
  expectedDate: string | null
  updatedAt: string
  cancellationReason: string | null
  received: Record<string, number>
}
export interface OrderDocumentSummary {
  id: string; fileName: string | null; kind: string; createdAt: string; orderRevision: number | null;
  reviewRevision: number; purchaseId: string | null; accepted: boolean; owned: boolean
}
export const orderItemIdentityKey = (line: Pick<LocalOrderLine, 'supplierLabel' | 'supplierCode' | 'unit' | 'productId' | 'variantId' | 'variantSnapshot'>) =>
  JSON.stringify([supplierIdentityKey(line), line.productId, recordedVariantId(line)])

export const orderNumberText = (number: string | number) => `LPO-${String(number).padStart(6,'0')}`

export function orderEvidence(lines: LocalOrderLine[], terms: OrderTerms, supplier?: OrderParty): ReceiptEvidence {
  return { ...normaliseEvidence({ lines: [] }), docKind: 'quote', supplierName: supplier?.name ?? null, vatNumber: supplier?.vatNumber ?? null,
    pricesIncludeVat: true, vatPercent: 15, discountPercent: 0, discountIncluded: false,
    charges: terms.charges, roundingAmount: terms.roundingAmount,
    lines: lines.map((line,index) => ({ key: line.id, label: line.supplierLabel, code: line.supplierCode, unit: line.unit,
      qty: line.qty, unitPrice: line.expectedUnitPrice, lineTotal: null, unitPriceStage:'before_discount',
      discountPercent: line.discountPercent, vatPercent: line.vatPercent, pricesIncludeVat: line.pricesIncludeVat,
      sourceRow: String(index+1), issues:[] })),
  }
}
export const calculateOrder = (lines: LocalOrderLine[], terms: OrderTerms, supplier?: OrderParty) => reconcileReceipt(orderEvidence(lines,terms,supplier))
