import { notFound } from 'next/navigation'
import { z } from 'zod'
import { requireBuyer } from '@/lib/local-purchasing/auth'
import { loadOrderBundle } from '@/lib/local-purchasing/order-service'
import { loadPricingCatalogue } from '@/lib/products/pricing-server'
import { listSuppliersAction } from '../../actions'
import { LocalOrderDetail } from '@/components/local-purchasing/order-detail'

export const metadata = { title: 'Local supplier order', description: 'Review an issued supplier order, compare returned invoices and record partial purchases safely.' }

export default async function LocalOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { db, userId } = await requireBuyer()
  const { id } = await params
  if (!z.string().uuid().safeParse(id).success) notFound()
  const [initial, suppliers, products] = await Promise.all([loadOrderBundle(db, userId, id), listSuppliersAction(), loadPricingCatalogue(db)])
  return <LocalOrderDetail initial={initial} suppliers={suppliers} products={products} />
}
