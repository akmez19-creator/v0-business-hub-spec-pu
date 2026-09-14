'use server'

import { revalidatePath } from 'next/cache'
import { requireBuyer } from '@/lib/local-purchasing/auth'
import {
  createImportReorders,
  mutateImportReorder,
  loadImportReorder,
  loadPurchaseEvents,
  loadReorderCatalogue,
  loadReorderWorkspace,
  saveReorderItem,
  saveReorderSettings,
  type CreateReordersInput,
  type ReorderMutation,
  type SavedItemInput,
} from '@/lib/purchase-orders/reorder-service'
import type { ReorderSnapshot, ReorderSettings } from '@/lib/purchase-orders/workflow'
import { supplierRequestRows } from '@/lib/purchase-orders/reorder-export'
import { cancelSourcingSelection, confirmSourcingSelection, getSourcingWorkspace, prepareSourcingPhotos, saveSourcingSelection } from '@/lib/purchase-orders/1688-sourcing-service'
import type { SourcingInput, SourcingTerms } from '@/lib/purchase-orders/1688-sourcing-types'

function refreshPurchasing(id?: string) {
  revalidatePath('/dashboard/purchasing')
  revalidatePath('/dashboard/purchasing/suppliers')
  revalidatePath('/dashboard/purchasing/reorders')
  if (id) revalidatePath(`/dashboard/purchasing/reorders/${id}`)
}
export async function getSourcingWorkspaceAction(itemId: string) {
  const { db } = await requireBuyer()
  return getSourcingWorkspace(db, itemId)
}
export async function saveSourcingSelectionAction(input: SourcingInput) {
  const { db, userId } = await requireBuyer()
  const result = await saveSourcingSelection(db, userId, input)
  refreshPurchasing()
  return result
}
export async function prepareSourcingPhotosAction(input: { id: string; revision: number; requestKey: string; skuIds: string[] }) {
  const { db, userId } = await requireBuyer()
  return prepareSourcingPhotos(db, userId, input)
}
export async function confirmSourcingSelectionAction(input: { id: string; revision: number; requestKey: string; terms: SourcingTerms; accepted: boolean }) {
  const { db, userId } = await requireBuyer()
  const result = await confirmSourcingSelection(db, userId, input)
  refreshPurchasing(result.id)
  revalidatePath('/dashboard/deliveries/inventory')
  return result
}
export async function cancelSourcingSelectionAction(input: { id: string; revision: number; requestKey: string }) {
  const { db, userId } = await requireBuyer()
  const result = await cancelSourcingSelection(db, userId, input)
  refreshPurchasing()
  return result
}
export async function getReorderCatalogueAction() {
  const { db } = await requireBuyer()
  return loadReorderCatalogue(db)
}
export async function getReorderWorkspaceAction() {
  const { db } = await requireBuyer()
  const catalogue = await loadReorderCatalogue(db)
  return loadReorderWorkspace(db, catalogue)
}
export async function getImportReorderAction(id: string) {
  const { db } = await requireBuyer()
  const [reorder, events] = await Promise.all([loadImportReorder(db, id), loadPurchaseEvents(db, id)])
  return { reorder, events }
}
export async function createImportReordersAction(input: CreateReordersInput) {
  const { db, userId } = await requireBuyer()
  const result = await createImportReorders(db, userId, input)
  refreshPurchasing()
  return result
}
export async function changeImportReorderAction(
  operation: 'save' | 'approve' | 'response' | 'confirm' | 'reopen' | 'cancel',
  input: ReorderMutation & { snapshot?: ReorderSnapshot; accepted?: boolean; reason?: string },
) {
  const { db, userId } = await requireBuyer()
  const result = await mutateImportReorder(db, userId, operation, input)
  refreshPurchasing(input.id)
  return result
}
export async function saveReorderItemAction(input: SavedItemInput) {
  const { db, userId } = await requireBuyer()
  const result = await saveReorderItem(db, userId, input)
  refreshPurchasing()
  return result
}
export async function saveReorderSettingsAction(input: ReorderSettings & { requestKey: string }) {
  const { db, userId } = await requireBuyer()
  const result = await saveReorderSettings(db, userId, input)
  refreshPurchasing()
  return result
}
export async function exportImportReorderAction(id: string) {
  const { db } = await requireBuyer()
  const reorder = await loadImportReorder(db, id)
  if (!reorder.requestedSnapshot) throw new Error('Approve the buyer request before exporting it.')
  return {
    name: `${reorder.number}-buyer-request.xlsx`,
    rows: supplierRequestRows(reorder.number, reorder.requestedSnapshot),
  }
}
