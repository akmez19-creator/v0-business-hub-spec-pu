import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requireBuyer } from '@/lib/local-purchasing/auth'
import { loadImportForCorrection } from '@/lib/purchase-orders/import-correction-service'
import { loadPurchaseEvents, loadReorderCatalogue } from '@/lib/purchase-orders/reorder-service'
import { ImportCorrectionEditor } from '@/components/purchase-orders/import-correction-editor'

export const metadata = {
  title: 'Review China Import | Business Hub',
  description: 'Review and correct an original China import with a reason and permanent purchasing audit history.',
}
export default async function ImportReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) notFound()
  const { db } = await requireBuyer()
  const [record, events, catalogue] = await Promise.all([
    loadImportForCorrection(db, id),
    loadPurchaseEvents(db, id, 'import'),
    loadReorderCatalogue(db),
  ])
  return <ImportCorrectionEditor initial={{ record, events }} catalogue={catalogue} />
}
