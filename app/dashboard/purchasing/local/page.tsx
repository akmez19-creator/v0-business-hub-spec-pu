import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { PurchaseEntry } from '@/components/local-purchasing/purchase-entry'
import { loadPricingCatalogue } from '@/lib/products/pricing-server'
import { listSuppliersAction } from './actions'

export const metadata = {
  title: 'Local purchases',
  description:
    'Record local supplier purchases from the receipt and compare them against import cost.',
}

export default async function LocalPurchasingPage() {
  const supabase = await createClient()
  const adminDb = createAdminClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Same guard as the China purchasing page: supplier pricing is not for
  // storekeepers or agents.
  const { data: profile } = await adminDb.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    redirect('/dashboard')
  }

  // Pricing, supplier and variant-price coverage must be complete, not the first 1,000 rows.
  const [options, products] = await Promise.all([listSuppliersAction(), loadPricingCatalogue(adminDb)])

  return <PurchaseEntry suppliers={options} products={products} />
}
