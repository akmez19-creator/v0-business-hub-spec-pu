import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { PaymentsPage } from '@/components/storekeeper/payments-page'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function PaymentsRoute({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const params = await searchParams
  const supabase = await createClient()
  const adminDb = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await adminDb.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || (profile.role !== 'storekeeper' && profile.role !== 'admin')) redirect('/dashboard')

  // Get last 30 days of delivered orders
  const today = new Date().toISOString().split('T')[0]
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0]

  // Get contractors with photos
  const { data: contractors } = await adminDb
    .from('contractors')
    .select('id, name, photo_url')
    .eq('is_active', true)

  const contractorMap = new Map((contractors || []).map(c => [c.id, { name: c.name, photoUrl: c.photo_url }]))

  // Get riders
  const { data: riders } = await adminDb
    .from('riders')
    .select('id, name, contractor_id')
    .eq('is_active', true)

  const riderMap = new Map((riders || []).map(r => [r.id, { name: r.name, contractorId: r.contractor_id }]))

  // Get deliveries
  const { data: deliveries } = await adminDb
    .from('deliveries')
    .select('id, index_no, customer_name, amount, payment_method, payment_cash, payment_bank, payment_juice, delivery_date, rider_id, contractor_id')
    .eq('status', 'delivered')
    .gte('delivery_date', thirtyDaysAgoStr)
    .lte('delivery_date', today)
    .order('delivery_date', { ascending: false })

  // Map deliveries with contractor/rider info
  const deliveryList = (deliveries || []).map(d => {
    const rider = riderMap.get(d.rider_id)
    const contractorId = d.contractor_id || rider?.contractorId || ''
    const contractor = contractorMap.get(contractorId)

    // Normalize payment method
    let method = d.payment_method || ''
    if (method === 'juice_to_rider') method = 'juice'
    if (method === 'already_paid' || method === 'bank') method = 'paid'

    const amt = Number(d.amount || 0)
    let paymentCash = Number(d.payment_cash || 0)
    let paymentBank = Number(d.payment_bank || 0)
    let paymentJuice = Number(d.payment_juice || 0)

    // Calculate payment amounts based on method if not set
    if (method === 'cash' && paymentCash === 0 && amt > 0) paymentCash = amt
    if (method === 'paid' && paymentBank === 0 && amt > 0) paymentBank = amt
    if (method === 'juice' && paymentJuice === 0 && amt > 0) paymentJuice = amt

    return {
      id: d.id,
      index_no: d.index_no || '',
      customer_name: d.customer_name || 'Unknown',
      amount: amt,
      payment_method: method,
      payment_cash: paymentCash,
      payment_bank: paymentBank,
      payment_juice: paymentJuice,
      delivery_date: d.delivery_date,
      rider_id: d.rider_id || '',
      rider_name: rider?.name || 'Unknown',
      contractor_id: contractorId,
      contractor_name: contractor?.name || 'Unknown',
      contractor_photo_url: contractor?.photoUrl || null,
    }
  })

  // Get unique dates
  const availableDates = [...new Set(deliveryList.map(d => d.delivery_date))].sort((a, b) => b.localeCompare(a))
  const selectedDate = params.date || availableDates[0] || today

  const contractorList = (contractors || []).map(c => ({
    id: c.id,
    name: c.name,
    photoUrl: c.photo_url || null,
  }))

  return (
    <PaymentsPage
      deliveries={deliveryList}
      contractors={contractorList}
      selectedDate={selectedDate}
      availableDates={availableDates}
    />
  )
}
