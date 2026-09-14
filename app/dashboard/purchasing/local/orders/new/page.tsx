import { requireBuyer } from '@/lib/local-purchasing/auth'
import { loadPricingCatalogue } from '@/lib/products/pricing-server'
import { listSuppliersAction } from '../../actions'
import { LocalOrderEditor } from '@/components/local-purchasing/order-editor'

export const metadata = { title: 'New local supplier order', description: 'Reorder using the supplier’s saved descriptions, codes and dated price references.' }

export default async function NewLocalOrderPage({ searchParams }: { searchParams: Promise<{ supplier?: string }> }) {
  const { db } = await requireBuyer()
  const [{ supplier }, suppliers, products] = await Promise.all([searchParams, listSuppliersAction(), loadPricingCatalogue(db)])
  return <LocalOrderEditor suppliers={suppliers} products={products} initialSupplierId={suppliers.some((item) => item.id === supplier) ? supplier : undefined} />
}
