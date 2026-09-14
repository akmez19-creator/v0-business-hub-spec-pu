import { requireBuyer } from '@/lib/local-purchasing/auth'
import { listLocalOrders } from '@/lib/local-purchasing/order-service'
import { LocalOrderList } from '@/components/local-purchasing/order-list'

export const metadata = { title: 'Local supplier orders', description: 'Prepare supplier-specific reorders and cross-check returned documents before recording purchases.' }

export default async function LocalOrdersPage() {
  const { db } = await requireBuyer()
  return <LocalOrderList orders={await listLocalOrders(db)} />
}
