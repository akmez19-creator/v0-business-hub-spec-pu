import { requireBuyer } from '@/lib/local-purchasing/auth'
import { listLocalPurchases } from '@/lib/local-purchasing/history'
import { PurchaseHistory } from '@/components/local-purchasing/purchase-history'

export const metadata = { title: 'Saved local purchases', description: 'Recorded supplier receipts, accepted differences and links to supplier reorders.' }

export default async function LocalPurchaseHistoryPage() {
  const { db } = await requireBuyer()
  return <PurchaseHistory purchases={await listLocalPurchases(db)} />
}
