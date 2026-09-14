'use server'

import { revalidatePath } from 'next/cache'
import { requireBuyer } from '@/lib/local-purchasing/auth'
import { appendSupplierNote, confirmSupplierIdentity, loadSupplierQuality, readQualityPage } from '@/lib/purchase-orders/supplier-quality'
import type { QualityNoteInput } from '@/lib/purchase-orders/1688-types'

export async function loadSupplierQualitySummariesAction() {
  const { db } = await requireBuyer()
  return loadSupplierQuality(db)
}

export async function loadSupplierQualityAction(name: string, cursor: string | null) {
  const { db } = await requireBuyer()
  return readQualityPage(db, name, cursor)
}

export async function saveSupplierQualityAction(input: QualityNoteInput) {
  const { db, userId } = await requireBuyer()
  const result = await appendSupplierNote(db, userId, input)
  revalidatePath('/dashboard/purchasing/suppliers')
  revalidatePath('/dashboard/purchasing/reorders')
  return result
}

export async function confirmSupplierIdentityAction(input: unknown) {
  const { db, userId } = await requireBuyer()
  const result = await confirmSupplierIdentity(db, userId, input)
  revalidatePath('/dashboard/purchasing/suppliers')
  revalidatePath('/dashboard/purchasing/reorders')
  return result
}
