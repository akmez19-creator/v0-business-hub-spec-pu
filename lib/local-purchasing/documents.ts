import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { parseSupplierSheet } from './parse-sheet'
import { extractPurchaseDocument } from './extract'
import { normaliseEvidence, type ReceiptEvidence } from './evidence'
import { reconcileReceipt } from './reconcile'
import type { ImportedDoc } from '@/app/dashboard/purchasing/local/actions'

export const PURCHASE_DOC_BUCKET = 'purchase-docs'
const uuid = z.string().uuid()

export async function importLocalDocument(form: FormData, db: SupabaseClient, userId: string): Promise<ImportedDoc> {
  const file = form.get('file')
  if (!(file instanceof File) || !file.size) throw new Error('Choose a file first.')
  if (file.size > 20 * 1024 * 1024) throw new Error('That file is over 20MB. Send a smaller document.')
  const orderId = form.get('orderId') ? uuid.parse(form.get('orderId')) : null
  const orderRevision = orderId ? z.coerce.number().int().positive().parse(form.get('orderRevision')) : null
  let order: { status: string; allocation_revision: number } | null = null
  if (orderId) {
    const { data, error } = await db.from('local_purchase_orders').select('id,status,revision,issued_revision,allocation_revision').eq('id', orderId).single()
    if (error || !data || !['issued','confirmed','partial'].includes(data.status) || data.issued_revision !== orderRevision || data.revision !== orderRevision) throw new Error('Issue the current order revision before importing its response.')
    order = data
  }
  const sheetTypes: Record<string, string> = { xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12', xls: 'application/vnd.ms-excel', csv: 'text/csv' }
  const sheetMime = sheetTypes[file.name.split('.').pop()?.toLowerCase() ?? '']
  const isSheet = Boolean(sheetMime)
  const mime = sheetMime || file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : /\.png$/i.test(file.name) ? 'image/png' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : 'application/octet-stream')
  if (!isSheet && !['application/pdf','image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'].includes(mime)) throw new Error('Use a photo, PDF, Excel file or CSV.')
  const buffer = Buffer.from(await file.arrayBuffer())
  let evidence: ReceiptEvidence
  let original: ReceiptEvidence
  let attempts: unknown[] = []
  let warnings: string[] = []
  if (isSheet) {
    const parsed = parseSupplierSheet(buffer, file.name)
    if (parsed.status === 'error') throw new Error(parsed.message)
    evidence = normaliseEvidence(parsed.doc)
    original = evidence
    warnings = [`Description: ${parsed.mapping.label}; unit price: ${parsed.mapping.price ?? 'not printed'}; line amount: ${parsed.mapping.amount ?? 'not printed'}.`, ...parsed.warnings]
  } else {
    const result = await extractPurchaseDocument(buffer, mime)
    if (result.status === 'error' || result.status === 'unreadable') throw new Error(result.message)
    evidence = normaliseEvidence(result.doc)
    original = normaliseEvidence(result.original)
    attempts = result.attempts
    warnings = result.warnings
  }
  const check = reconcileReceipt(evidence)
  let documentId: string | null = null
  const path = `${userId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, '_').slice(-150)}`
  let uploaded = false
  try {
    const { error } = await db.storage.from(PURCHASE_DOC_BUCKET).upload(path, buffer, { contentType: mime, upsert: false })
    if (error) throw error
    uploaded = true
    const { data, error: insertError } = await db.rpc('local_file_purchase_document', {
      p_actor: userId,
      p_metadata: {
        url: path, file_name: file.name, mime, kind: original.docKind,
        source: isSheet ? 'sheet' : 'ai', extracted: original, extraction_attempts: attempts,
        order_id: orderId, order_revision: orderRevision,
      },
    })
    if (insertError) throw insertError
    documentId = String(data)
  } catch {
    if (uploaded && !documentId) await db.storage.from(PURCHASE_DOC_BUCKET).remove([path])
    warnings.push('The transcription is available, but the original file could not be filed. Keep the original and retry the upload; extraction is not arithmetic verification.')
  }
  return {
    lines: evidence.lines.map((line) => ({ key: line.key!, supplierLabel: line.label, supplierCode: line.code,
      qty: line.qty, unitPriceGross: line.unitPrice, lineTotal: line.lineTotal, unit: line.unit ?? null, evidence: line })),
    supplierName: evidence.supplierName, vatNumber: evidence.vatNumber, docRef: evidence.docRef, docDate: evidence.docDate,
    declaredTotal: evidence.declaredTotal, discountPercent: evidence.discountPercent, warnings,
    suspect: check.status !== 'verified', source: isSheet ? 'sheet' : 'ai', documentId,
    documentRevision: 1, reviewRevision: 0, evidence, originalEvidence: original, check,
  }
}

export async function loadOwnedDocument(db: SupabaseClient, userId: string, id: string) {
  uuid.parse(id)
  const { data, error } = await db.from('local_purchase_documents')
    .select('id,url,file_name,mime,kind,source,extracted,extraction_attempts,created_by,purchase_id,order_id,order_revision,evidence_revision,review_revision,reviewed_document,review_result,review_hash,accepted_review')
    .eq('id', id).single()
  if (error || !data || data.created_by !== userId) throw new Error('This document is unavailable or belongs to another buyer.')
  return data
}
