import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { JuiceCollectionPage } from '@/components/storekeeper/juice-collection-page'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Store juice (MCB Juice mobile payment) collection - date-based only
export default async function JuiceCollectionRoute({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const params = await searchParams
  const supabase = await createClient()
  const adminDb = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await adminDb.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'storekeeper' && profile.role !== 'admin')) redirect('/dashboard')

  // Get contractors
  const { data: contractors } = await adminDb
    .from('contractors')
    .select('id, name, photo_url')
    .eq('is_active', true)
    .order('name')

  // Get deliveries with pending juice payments (not yet collected)
  // payment_method = 'juice' indicates Juice payment, amount holds the value
  const { data: deliveriesData } = await adminDb
    .from('deliveries')
    .select('id, index_no, customer_name, amount, delivery_date, rider_id, contractor_id, juice_collected, contractor_juice_counted, contractor_juice_counted_at, juice_transfer_screenshot, juice_transfer_reference, juice_transfer_amount, juice_transferred_at')
    .eq('status', 'delivered')
    .eq('juice_collected', false)
    .eq('payment_method', 'juice')
    .order('delivery_date', { ascending: false })

  // Get available dates with pending juice
  const availableDates = [...new Set((deliveriesData || []).map(d => d.delivery_date).filter(Boolean))].sort((a, b) => b.localeCompare(a))
  const selectedDate = params.date || availableDates[0] || new Date().toISOString().split('T')[0]

  // Get riders for names
  const { data: riders } = await adminDb.from('riders').select('id, name').eq('is_active', true)
  const riderMap = new Map((riders || []).map(r => [r.id, r.name]))

  const deliveries = (deliveriesData || []).map(d => ({
    id: d.id,
    index_no: d.index_no,
    customer_name: d.customer_name,
    payment_juice: Number(d.amount || 0), // Map amount to payment_juice for component
    delivery_date: d.delivery_date,
    rider_id: d.rider_id,
    rider_name: riderMap.get(d.rider_id) || 'Unknown',
    contractor_id: d.contractor_id,
    juice_collected: d.juice_collected ?? false,
    contractor_juice_counted: Number(d.contractor_juice_counted || 0),
    contractor_juice_counted_at: d.contractor_juice_counted_at || null,
    juice_transfer_screenshot: d.juice_transfer_screenshot || null,
    juice_transfer_reference: d.juice_transfer_reference || null,
    juice_transfer_amount: d.juice_transfer_amount ? Number(d.juice_transfer_amount) : null,
    juice_transferred_at: d.juice_transferred_at || null,
  }))

  const contractorList = (contractors || []).map(c => ({
    id: c.id,
    name: c.name,
    photo_url: c.photo_url || null,
  }))

  return (
    <JuiceCollectionPage
      userId={user.id}
      deliveries={deliveries}
      contractors={contractorList}
      availableDates={availableDates}
      selectedDate={selectedDate}
    />
  )
}
