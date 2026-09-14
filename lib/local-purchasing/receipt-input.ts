import { evidenceRevision, normaliseEvidence, type ReceiptEvidence, type ReceiptLine } from './evidence'
import type { VariantSelection } from '@/lib/products/pricing'

export interface EvidenceDraftLine {
  key: string
  supplierLabel: string
  supplierCode?: string | null
  unit?: string | null
  qty: number | null
  unitPriceGross: number | null
  lineTotal?: number | null
  discountPercent?: number | null
  evidence?: ReceiptLine
}

export function draftEvidence(lines: EvidenceDraftLine[], document?: ReceiptEvidence | null, terms?: {
  discountPercent?: number | null; vatPercent?: number | null; pricesIncludeVat?: boolean; docRef?: string | null; docDate?: string | null
}): ReceiptEvidence {
  const original = new Map(document?.lines.map((line) => [line.key, line]) ?? [])
  return {
    ...normaliseEvidence({ lines: [] }),
    ...(document ?? { docKind: 'unknown', pricesIncludeVat: terms?.pricesIncludeVat ?? false, vatPercent: terms?.vatPercent ?? 15,
      discountPercent: terms?.discountPercent ?? 0, discountIncluded: false, docRef: terms?.docRef ?? null, docDate: terms?.docDate ?? null }),
    lines: lines.filter((line) => line.supplierLabel.trim() || line.qty != null || line.unitPriceGross != null || line.lineTotal != null).map((line) => {
      const source = line.evidence ?? original.get(line.key)
      return { ...source, key: line.key, label: line.supplierLabel, code: line.supplierCode || null,
        unit: line.unit === undefined ? source?.unit ?? null : line.unit,
        qty: line.qty, unitPrice: line.unitPriceGross,
        lineTotal: line.lineTotal === undefined ? source?.lineTotal ?? null : line.lineTotal,
        discountPercent: line.discountPercent === undefined ? source?.discountPercent ?? null : line.discountPercent,
      }
    }),
  }
}

export function purchaseReviewRevision(receiptRevision: string, input: {
  supplierId: string; docRef?: string | null; purchaseDate?: string | null; documentIds?: string[];
  documentRevision?: number; reviewRevision?: number; actualPurchase?: boolean;
  lines: Array<VariantSelection & { key: string; productId?: string | null; matchMethod?: string | null; orderLineId?: string | null }>
}): string {
  return evidenceRevision({ receiptRevision, supplierId: input.supplierId, docRef: input.docRef?.trim() || null,
    purchaseDate: input.purchaseDate || null, documentIds: input.documentIds ?? [], documentRevision: input.documentRevision ?? null,
    reviewRevision: input.reviewRevision ?? null, actualPurchase: input.actualPurchase === true,
    products: input.lines.map((line) => [line.key, line.productId || null, line.matchMethod || null, line.orderLineId || null,
      line.variantId || null, line.variantSource || null, line.variantCleared === true]) })
}

export function comparableEvidence(document: ReceiptEvidence): unknown {
  try {
    const normal = normaliseEvidence(document)
    return { ...normal, lines: normal.lines.map(({ key: _key, ...line }) => line) }
  } catch {
    return document
  }
}
