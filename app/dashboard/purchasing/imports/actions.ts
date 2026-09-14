'use server'

import { revalidatePath } from 'next/cache'
import { requireBuyer } from '@/lib/local-purchasing/auth'
import {
  correctImportRecord,
  loadImportForCorrection,
  type ImportCorrectionInput,
} from '@/lib/purchase-orders/import-correction-service'
import { loadPurchaseEvents } from '@/lib/purchase-orders/reorder-service'

export async function getImportCorrectionAction(id: string) {
  const { db } = await requireBuyer()
  const [record, events] = await Promise.all([loadImportForCorrection(db, id), loadPurchaseEvents(db, id, 'import')])
  return { record, events }
}
export async function correctImportAction(input: ImportCorrectionInput) {
  const { db, userId } = await requireBuyer()
  const result = await correctImportRecord(db, userId, input)
  for (const path of [
    '/dashboard/purchasing',
    '/dashboard/purchasing/suppliers',
    '/dashboard/purchasing/reorders',
    `/dashboard/purchasing/imports/${input.id}`,
    '/dashboard/deliveries/inventory',
    '/dashboard/purchasing/local',
  ])
    revalidatePath(path)
  return result
}
