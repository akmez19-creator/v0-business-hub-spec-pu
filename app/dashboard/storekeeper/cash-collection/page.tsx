import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { CashCollectionPage } from '@/components/storekeeper/cash-collection-page'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Store cash collection - date-based only (v2)
export default async function CashCollectionRoute({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
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

  // Get available dates with pending cash
  const { data: summaryData } = await adminDb
    .from('cash_collection_summary')
    .select('contractor_id, delivery_date, pending_cash, pending_count')
    .gt('pending_count', 0)

  const availableDates = [...new Set((summaryData || []).map(s => s.delivery_date))].sort((a, b) => b.localeCompare(a))
  const selectedDate = params.date || availableDates[0] || new Date().toISOString().split('T')[0]

  // Fetch deliveries for selected date only
  const { data: deliveriesData } = await adminDb
    .from('deliveries')
    .select('id, index_no, customer_name, payment_cash, delivery_date, rider_id, contractor_id, cash_collected, contractor_cash_denoms, contractor_cash_counted, contractor_cash_counted_at')
    .eq('status', 'delivered')
    .eq('cash_collected', false)
    .gt('payment_cash', 0)
    .order('delivery_date', { ascending: false })

  // Get riders for names
  const { data: riders } = await adminDb.from('riders').select('id, name').eq('is_active', true)
  const riderMap = new Map((riders || []).map(r => [r.id, r.name]))

  const deliveries = (deliveriesData || []).map(d => ({
    id: d.id,
    index_no: d.index_no,
    customer_name: d.customer_name,
    payment_cash: Number(d.payment_cash || 0),
    delivery_date: d.delivery_date,
    rider_id: d.rider_id,
    rider_name: riderMap.get(d.rider_id) || 'Unknown',
    contractor_id: d.contractor_id,
    cash_collected: d.cash_collected ?? false,
    contractor_cash_denoms: d.contractor_cash_denoms || null,
    contractor_cash_counted: Number(d.contractor_cash_counted || 0),
    contractor_cash_counted_at: d.contractor_cash_counted_at || null,
  }))

  const contractorList = (contractors || []).map(c => ({
    id: c.id,
    name: c.name,
    photo_url: c.photo_url || null,
  }))

  return (
    <CashCollectionPage
      userId={user.id}
      deliveries={deliveries}
      contractors={contractorList}
      availableDates={availableDates}
      selectedDate={selectedDate}
    />
  )
}
