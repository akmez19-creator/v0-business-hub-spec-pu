'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireBuyer } from '@/lib/local-purchasing/auth'
import { loadSupplierCatalogue } from '@/lib/local-purchasing/supplier-catalogue'
import { loadLocalOrder } from '@/lib/local-purchasing/order-service'
import { supplierOrderRows } from '@/lib/local-purchasing/order-export'
import { changeLocalOrder, saveLocalOrder, loadOrderBundle, loadOrderDocument, saveOrderReview, recordOrderPurchase, type SaveOrderInput, type OrderMutationInput, type ReviewRequest, type RecordOrderRequest } from '@/lib/local-purchasing/order-service'

const refreshOrders = (id: string) => {
  revalidatePath('/dashboard/purchasing/local/orders')
  revalidatePath(`/dashboard/purchasing/local/orders/${id}`)
  revalidatePath('/dashboard/purchasing/local/history')
}

export async function exportLocalOrderAction(id: string, revision: number) {
  const { db } = await requireBuyer()
  z.number().int().positive().parse(revision)
  const order = await loadLocalOrder(db, id)
  const snapshot = order.revisionHistory.find((item) => item.revision === revision)
  if (!snapshot) throw new Error('Only issued order revisions can be exported.')
  return { fileName: `${snapshot.orderNumber}-r${snapshot.revision}.xlsx`, rows: supplierOrderRows(snapshot) }
}

export async function getSupplierCatalogueAction(supplierId: string) {
  const { db } = await requireBuyer()
  return loadSupplierCatalogue(db, z.string().uuid().parse(supplierId))
}

export async function getLocalOrderAction(id: string) {
  const { db, userId } = await requireBuyer()
  return loadOrderBundle(db, userId, id)
}

export async function saveLocalOrderAction(input: SaveOrderInput) {
  const { db, userId } = await requireBuyer()
  const result = await saveLocalOrder(db, userId, input)
  refreshOrders(result.id)
  return result
}

export async function issueLocalOrderAction(input: OrderMutationInput) {
  const { db, userId } = await requireBuyer()
  const result = await changeLocalOrder(db, userId, 'issue', input)
  refreshOrders(result.id)
  return result
}

export async function cancelLocalOrderAction(input: OrderMutationInput & { reason: string }) {
  const { db, userId } = await requireBuyer()
  const result = await changeLocalOrder(db, userId, 'cancel', input)
  refreshOrders(result.id)
  return result
}

export async function getOrderDocumentAction(orderId: string, documentId: string) {
  const { db, userId } = await requireBuyer()
  return loadOrderDocument(db, userId, orderId, documentId)
}

export async function saveOrderReviewAction(input: ReviewRequest, accept: boolean) {
  const { db, userId } = await requireBuyer()
  const result = await saveOrderReview(db, userId, input, accept === true)
  refreshOrders(input.orderId)
  return result
}

export async function recordOrderPurchaseAction(input: RecordOrderRequest) {
  const { db, userId } = await requireBuyer()
  const result = await recordOrderPurchase(db, userId, input)
  refreshOrders(input.orderId)
  return result
}
