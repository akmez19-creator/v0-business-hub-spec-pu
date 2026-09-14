import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requireBuyer } from '@/lib/local-purchasing/auth'
import { loadLocalOrder } from '@/lib/local-purchasing/order-service'
import { LocalOrderPrint } from '@/components/local-purchasing/order-print'

export const metadata = { title: 'Print local purchase order', robots: { index: false, follow: false } }

export default async function PrintLocalOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ revision?: string }> }) {
  const { db } = await requireBuyer()
  const [{ id }, { revision }] = await Promise.all([params, searchParams])
  if (!z.string().uuid().safeParse(id).success) notFound()
  const order = await loadLocalOrder(db, id)
  const snapshot = revision ? order.revisionHistory.find((item) => item.revision === Number(revision)) : order.issuedSnapshot
  if (!snapshot?.calculation.totals) notFound()
  return <LocalOrderPrint snapshot={snapshot} status={order.status} latestRevision={order.revision} />
}
