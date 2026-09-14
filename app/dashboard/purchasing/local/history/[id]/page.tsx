import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requireBuyer } from '@/lib/local-purchasing/auth'
import { loadSavedPurchase } from '@/lib/local-purchasing/history'
import { PurchaseDetail } from '@/components/local-purchasing/purchase-detail'

export const metadata = { title: 'Recorded local purchase', description: 'Read the original receipt, saved amounts and buyer-accepted differences.' }

export default async function SavedPurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const { db } = await requireBuyer()
  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) notFound()
  const purchase = await loadSavedPurchase(db, id)
  if (!purchase) notFound()
  return <PurchaseDetail purchase={purchase} />
}
