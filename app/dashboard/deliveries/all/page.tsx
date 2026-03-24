import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { DeliveriesTable } from '@/components/deliveries/deliveries-table'
import { DeliveryFilters } from '@/components/deliveries/delivery-filters'
import { ImportDeliveriesDialog } from '@/components/deliveries/import-dialog'
import { ExportDeliveriesDialog } from '@/components/deliveries/export-dialog'
import { AddDeliveryDialog } from '@/components/deliveries/add-delivery-dialog'
import { ClearDeliveriesDialog } from '@/components/deliveries/clear-deliveries-dialog'
import type { Profile, Delivery, Rider } from '@/lib/types'

const DEFAULT_PAGE_SIZE = 100
const ALLOWED_PAGE_SIZES = [50, 100, 500, 1000, 5000]

interface Props {
  searchParams: Promise<{
    status?: string
    region?: string
    rider?: string
    entry_date?: string
    delivery_date?: string
    search?: string
    page?: string
    pageSize?: string
  }>
}

export default async function AllDeliveriesPage({ searchParams }: Props) {
  const params = await searchParams
  const currentPage = parseInt(params.page || '1')
  const requestedPageSize = parseInt(params.pageSize || String(DEFAULT_PAGE_SIZE))
  const pageSize = ALLOWED_PAGE_SIZES.includes(requestedPageSize) ? requestedPageSize : DEFAULT_PAGE_SIZE
  const supabase = await createClient()
  const adminDb = createAdminClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  
  const { data: profile } = await adminDb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()
  
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    redirect('/dashboard')
  }
  
  // Fetch localities for filtering
  const { data: localitiesData } = await adminDb
    .from('localities')
    .select('name')
    .eq('is_active', true)
  
  const regions = (localitiesData || []).map(l => l.name).sort()

  // Build base query for count
  let countQuery = adminDb
    .from('deliveries')
    .select('*', { count: 'exact', head: true })
  
  // Build query with filters
  let query = adminDb
    .from('deliveries')
    .select('*')
    .order('entry_date', { ascending: false })
    .order('delivery_date', { ascending: false })
    .range((currentPage - 1) * pageSize, currentPage * pageSize - 1)
  
  // Apply filters to both queries
  if (params.status && params.status !== 'all') {
    query = query.eq('status', params.status)
    countQuery = countQuery.eq('status', params.status)
  }
  
  if (params.region && params.region !== 'all') {
  // Filter by locality name directly
  query = query.eq('locality', params.region)
  countQuery = countQuery.eq('locality', params.region)
  }
  
  if (params.rider) {
    if (params.rider === 'unassigned') {
      query = query.is('rider_id', null)
      countQuery = countQuery.is('rider_id', null)
    } else if (params.rider !== 'all') {
      query = query.eq('rider_id', params.rider)
      countQuery = countQuery.eq('rider_id', params.rider)
    }
  }
  
  if (params.entry_date) {
    query = query.eq('entry_date', params.entry_date)
    countQuery = countQuery.eq('entry_date', params.entry_date)
  }
  
  if (params.delivery_date) {
    query = query.eq('delivery_date', params.delivery_date)
    countQuery = countQuery.eq('delivery_date', params.delivery_date)
  }
  
  if (params.search) {
    const searchFilter = `customer_name.ilike.%${params.search}%,contact_1.ilike.%${params.search}%,locality.ilike.%${params.search}%,products.ilike.%${params.search}%,index_no.ilike.%${params.search}%`
    query = query.or(searchFilter)
    countQuery = countQuery.or(searchFilter)
  }
  
  // Execute queries
  const [{ data: deliveries }, { count: totalCount }] = await Promise.all([
    query,
    countQuery
  ])
  
  const totalPages = Math.ceil((totalCount || 0) / pageSize)
  
  // regions (locality names) already fetched above
  
  // Get riders from riders table
  const { data: riders } = await adminDb
    .from('riders')
    .select('*')
    .eq('is_active', true)
    .order('name')
  
  const { data: contractors } = await adminDb
    .from('profiles')
    .select('*')
    .eq('role', 'contractor')
    .eq('approved', true)
  
  const ridersForFilter = (riders || []).map(r => ({ id: r.id, name: r.name }))

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">All Deliveries</h2>
          <p className="text-muted-foreground">
            View and manage all delivery records ({(totalCount || 0).toLocaleString()} total)
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ClearDeliveriesDialog />
          <ExportDeliveriesDialog />
          <ImportDeliveriesDialog />
          <AddDeliveryDialog />
        </div>
      </div>

      <DeliveryFilters 
        regions={regions as string[]} 
        riders={ridersForFilter}
      />
      
      <DeliveriesTable 
        deliveries={(deliveries || []) as Delivery[]}
        riders={(riders || []) as Rider[]}
        contractors={(contractors || []) as Profile[]}
        currentPage={currentPage}
        totalPages={totalPages}
        totalCount={totalCount || 0}
        pageSize={pageSize}
        allowedPageSizes={ALLOWED_PAGE_SIZES}
      />
    </div>
  )
}
