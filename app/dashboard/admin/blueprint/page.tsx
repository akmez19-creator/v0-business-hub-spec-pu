import { createAdminClient } from '@/lib/supabase/server'
import { SystemBlueprintPage } from '@/components/admin/system-blueprint-page'

export const dynamic = 'force-dynamic'

export default async function BlueprintPage() {
  const adminDb = createAdminClient()
  
  // Get system stats
  const [
    { count: totalDeliveries },
    { count: totalRiders },
    { count: totalContractors },
    { count: totalClients },
    { count: totalProducts },
    { count: totalUsers },
  ] = await Promise.all([
    adminDb.from('deliveries').select('*', { count: 'exact', head: true }),
    adminDb.from('riders').select('*', { count: 'exact', head: true }),
    adminDb.from('contractors').select('*', { count: 'exact', head: true }),
    adminDb.from('clients').select('*', { count: 'exact', head: true }),
    adminDb.from('products').select('*', { count: 'exact', head: true }),
    adminDb.from('profiles').select('*', { count: 'exact', head: true }),
  ])

  // Get table info
  const { data: tableInfo } = await adminDb.rpc('get_table_counts')

  const stats = {
    deliveries: totalDeliveries || 0,
    riders: totalRiders || 0,
    contractors: totalContractors || 0,
    clients: totalClients || 0,
    products: totalProducts || 0,
    users: totalUsers || 0,
    tables: 45,
    pages: 50,
    apiRoutes: 16,
  }

  return <SystemBlueprintPage stats={stats} />
}
