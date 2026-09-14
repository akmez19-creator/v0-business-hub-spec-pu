import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requireBuyer } from '@/lib/local-purchasing/auth'
import { loadImportReorder, loadPurchaseEvents, loadReorderCatalogue } from '@/lib/purchase-orders/reorder-service'
import { ReorderEditor } from '@/components/purchase-orders/reorder-editor'

export const metadata = {
  title: 'Review Import Reorder | Business Hub',
  description: 'Buyer-controlled China supplier approval and manual import confirmation.',
}
export default async function ReorderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) notFound()
  const { db } = await requireBuyer()
  const [reorder, events, catalogue] = await Promise.all([
    loadImportReorder(db, id),
    loadPurchaseEvents(db, id),
    loadReorderCatalogue(db),
  ])
  return <ReorderEditor initial={{ reorder, events }} catalogue={catalogue} />
}
