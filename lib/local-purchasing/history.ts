import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { PURCHASE_DOC_BUCKET } from './documents'
import { orderNumberText } from './order-types'
import type { ReceiptEvidence, ReceiptLine } from './evidence'
import type { ReceiptCheck, NormalizedReceiptLine } from './reconcile'
import type { OrderComparison } from './order-reconcile'
import type { VariantSnapshot } from '@/lib/products/pricing'

export interface PurchaseSummary {
  id: string; supplierId: string | null; supplierName: string; docRef: string | null; purchaseDate: string;
  status: string; reviewStatus: string; netTotal: number | null; vatTotal: number | null; payableTotal: number | null;
  orderId: string | null; orderNumber: string | null; lineCount: number;
}
export interface SavedPurchaseLine {
  id: string; supplierLabel: string; supplierCode: string | null; unit: string | null; qty: number;
  productId: string | null; productName: string | null; matchMethod: string | null; printedUnitPrice: number | null;
  variantId: string | null; variantSnapshot: VariantSnapshot | null;
  unitPriceNet: number | null; printedDiscountPercent: number | null; appliedDiscountPercent: number | null;
  calculation: NormalizedReceiptLine | null; sourceEvidence: ReceiptLine | null; orderLineId: string | null;
}
export interface SavedPurchase extends PurchaseSummary {
  createdAt: string; recordedBy: string | null; notes: string | null; exceptionReason: string | null; vatReclaimable: boolean;
  calculation: ReceiptCheck | null; evidence: ReceiptEvidence | null; orderRevision: number | null;
  lines: SavedPurchaseLine[]; documents: Array<{ id: string; fileName: string; source: string; url: string | null; comparison: OrderComparison | null }>;
}
const numeric = (value: unknown) => value == null ? null : Number(value)
const relation = (value: unknown): Record<string, unknown> => (Array.isArray(value) ? value[0] : value) as Record<string, unknown> ?? {}
const summaryColumns = 'id,supplier_id,supplier_label,doc_ref,purchase_date,status,review_status,net_total,vat_total,payable_total,order_id,local_purchase_orders(order_number),local_purchase_lines(count)'
const summary = (row: Record<string, unknown>): PurchaseSummary => ({
  id: String(row.id), supplierId: row.supplier_id as string | null, supplierName: String(row.supplier_label || 'Supplier not recorded'),
  docRef: row.doc_ref as string | null, purchaseDate: String(row.purchase_date), status: String(row.status), reviewStatus: String(row.review_status),
  netTotal: numeric(row.net_total), vatTotal: numeric(row.vat_total), payableTotal: numeric(row.payable_total),
  orderId: row.order_id as string | null, orderNumber: relation(row.local_purchase_orders).order_number == null ? null : orderNumberText(String(relation(row.local_purchase_orders).order_number)),
  lineCount: Number(relation(row.local_purchase_lines).count ?? 0),
})

export async function listLocalPurchases(db: SupabaseClient): Promise<PurchaseSummary[]> {
  const rows = await fetchAll<Record<string, unknown>>((from, to) => db.from('local_purchases').select(summaryColumns)
    .order('purchase_date', { ascending: false }).order('created_at', { ascending: false }).order('id').range(from, to))
  return rows.map(summary)
}

export async function loadSavedPurchase(db: SupabaseClient, id: string): Promise<SavedPurchase | null> {
  z.string().uuid().parse(id)
  const { data: purchase, error } = await db.from('local_purchases').select(`${summaryColumns},created_at,created_by,notes,exception_reason,vat_reclaimable,calculation,evidence,order_revision`).eq('id', id).maybeSingle()
  if (error) throw new Error('Could not load the recorded purchase. Please retry.')
  if (!purchase) return null
  const [lines, documents, actor] = await Promise.all([
    fetchAll<Record<string, unknown>>((from, to) => db.from('local_purchase_lines').select('id,supplier_label,supplier_code,unit,qty,product_id,match_method,printed_unit_price,unit_price_net,printed_discount_percent,discount_percent,calculation,source_evidence,order_line_id,variant_id,variant_snapshot,products(name)')
      .eq('purchase_id', id).order('created_at').order('id').range(from, to)),
    fetchAll<Record<string, unknown>>((from, to) => db.from('local_purchase_documents').select('id,url,file_name,source,accepted_review').eq('purchase_id', id).order('created_at').order('id').range(from, to)),
    purchase.created_by ? db.from('profiles').select('name').eq('id', purchase.created_by).maybeSingle() : Promise.resolve({ data: null }),
  ])
  return { ...summary(purchase), lineCount: lines.length, createdAt: purchase.created_at, recordedBy: actor.data?.name ?? null,
    notes: purchase.notes, exceptionReason: purchase.exception_reason, vatReclaimable: purchase.vat_reclaimable,
    calculation: purchase.calculation as ReceiptCheck | null, evidence: purchase.evidence as ReceiptEvidence | null, orderRevision: purchase.order_revision,
    lines: lines.map((line) => ({ id: String(line.id), supplierLabel: String(line.supplier_label), supplierCode: line.supplier_code as string | null,
      unit: line.unit as string | null, qty: Number(line.qty), productId: line.product_id as string | null, productName: relation(line.products).name as string | null,
      variantId: line.variant_id as string | null, variantSnapshot: line.variant_snapshot as VariantSnapshot | null,
      matchMethod: line.match_method as string | null, printedUnitPrice: numeric(line.printed_unit_price), unitPriceNet: numeric(line.unit_price_net),
      printedDiscountPercent: numeric(line.printed_discount_percent), appliedDiscountPercent: numeric(line.discount_percent),
      calculation: line.calculation as NormalizedReceiptLine | null, sourceEvidence: line.source_evidence as ReceiptLine | null, orderLineId: line.order_line_id as string | null })),
    documents: await Promise.all(documents.map(async (document) => {
      const { data } = await db.storage.from(PURCHASE_DOC_BUCKET).createSignedUrl(String(document.url), 600)
      const accepted = document.accepted_review as { review?: { comparison?: OrderComparison } } | null
      return { id: String(document.id), fileName: String(document.file_name || 'Original supplier document'), source: String(document.source),
        url: data?.signedUrl ?? null, comparison: accepted?.review?.comparison ?? null }
    })),
  }
}
