import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { StockDispatchContent } from '@/components/storekeeper/stock-dispatch-content'

// Force dynamic rendering - no caching - v5 unified header
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface PageProps {
  searchParams: Promise<{ date?: string }>
}

export default async function StockOutPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const { data: { user: authUser } } = await supabase.auth.getUser()
  if (!authUser) redirect('/auth/login')

  const adminDb = createAdminClient()
  
  // Get profile with role
  const { data: profile } = await adminDb
    .from('profiles')
    .select('*')
    .eq('id', authUser.id)
    .single()

  // Allow admin, manager, and storekeeper roles
  const allowedRoles = ['admin', 'manager', 'storekeeper']
  if (!profile || !allowedRoles.includes(profile.role || '')) {
    redirect('/dashboard')
  }

  const params = await searchParams
  const today = new Date().toISOString().split('T')[0]
  const selectedDate = params.date || today

  // Run all queries in parallel for faster loading
  const [deliveriesResult, contractorsResult, sessionsResult, productsResult] = await Promise.all([
    // Fetch all deliveries for selected date (assigned or not) to show opening stock
    adminDb
      .from('deliveries')
      .select('id, delivery_date, contractor_id, product_id, products, qty, status, stock_out')
      .eq('delivery_date', selectedDate)
      .in('status', ['pending', 'assigned'])
      .order('contractor_id'),
    // Fetch contractors with photos
    adminDb
      .from('contractors')
      .select('id, name, photo_url')
      .order('name'),
    // Fetch existing dispatch sessions for this date
    adminDb
      .from('stock_dispatch_sessions')
      .select(`
        id,
        contractor_id,
        dispatch_date,
        dispatched_by,
        total_items,
        total_products,
        status,
        created_at
      `)
      .eq('dispatch_date', selectedDate)
      .eq('status', 'dispatched'),
    // Fetch products with images
    adminDb
      .from('products')
      .select('id, name, image_url')
  ])

  const deliveries = deliveriesResult.data
  const contractors = contractorsResult.data
  const sessions = sessionsResult.data || []
  const products = productsResult.data || []

  // Build product image map
  const productImageMap = new Map(products.map(p => [p.name, p.image_url]))

  // Build contractor name map
  const contractorMap = new Map((contractors || []).map(c => [c.id, c.name]))

  // Map deliveries with contractor names and product images
  const deliveryList = (deliveries || []).map(d => ({
    id: d.id,
    delivery_date: d.delivery_date,
    contractor_id: d.contractor_id || '',
    contractor_name: d.contractor_id ? (contractorMap.get(d.contractor_id) || 'Unknown') : 'Unassigned',
    product_id: d.product_id,
    products: d.products || 'Unknown Product',
    product_image: productImageMap.get(d.products || '') || null,
    qty: d.qty || 1,
    status: d.status || 'pending',
    stock_out: d.stock_out ?? false,
  }))

  return (
    <div className="max-w-4xl mx-auto px-3 space-y-4">
      <StockDispatchContent
        userId={profile.id}
        today={today}
        selectedDate={selectedDate}
        deliveries={deliveryList}
        contractors={contractors || []}
        sessions={sessions}
      />
    </div>
  )
}
