import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { ContractorMobileLayout } from '@/components/contractor/mobile-layout'
import { ContractorReturnsPage } from '@/components/contractor/returns-page'

export default async function Page() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/sign-in')

  // Get contractor
  let contractor = null
  const { data: contractorByProfile } = await supabase
    .from('contractors')
    .select('*')
    .eq('profile_id', user.id)
    .single()

  if (contractorByProfile) {
    contractor = contractorByProfile
  } else if (profile?.contractor_id) {
    const { data: contractorById } = await supabase
      .from('contractors')
      .select('*')
      .eq('id', profile.contractor_id)
      .single()
    contractor = contractorById
  }

  if (!contractor) redirect('/dashboard')

  const adminDb = createAdminClient()

  // Get riders for this contractor
  const { data: riders } = await adminDb
    .from('riders')
    .select('id, name')
    .eq('contractor_id', contractor.id)
    .eq('is_active', true)

  const riderIds = (riders || []).map(r => r.id)
  const riderMap: Record<string, string> = {}
  for (const r of riders || []) {
    riderMap[r.id] = r.name
  }

  // Get this month's returns from BOTH return_collections AND deliveries tables
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  // 1. From return_collections table - pending
  const { data: pendingReturnCollections } = await adminDb
    .from('return_collections')
    .select('id, rider_id, collection_date, product_name, qty, condition, verified, notes, created_at')
    .in('rider_id', riderIds.length > 0 ? riderIds : ['none'])
    .eq('verified', false)
    .gte('collection_date', startOfMonth.toISOString().split('T')[0])
    .order('collection_date', { ascending: false })

  // 2. From return_collections table - verified by store
  const { data: verifiedReturnCollections } = await adminDb
    .from('return_collections')
    .select('id, rider_id, collection_date, product_name, qty, condition, verified, verified_at, verified_by, notes, created_at')
    .in('rider_id', riderIds.length > 0 ? riderIds : ['none'])
    .eq('verified', true)
    .gte('collection_date', startOfMonth.toISOString().split('T')[0])
    .order('verified_at', { ascending: false })

  // 3. From deliveries table - CMS/exchange/refund items pending verification
  const { data: pendingDeliveryReturns } = await adminDb
    .from('deliveries')
    .select('id, rider_id, delivery_date, products, return_product, qty, sales_type, status, stock_verified')
    .in('rider_id', riderIds.length > 0 ? riderIds : ['none'])
    .or('status.eq.cms,sales_type.in.(exchange,trade_in,refund)')
    .eq('stock_verified', false)
    .gte('delivery_date', startOfMonth.toISOString().split('T')[0])
    .order('delivery_date', { ascending: false })

  // 4. From deliveries table - CMS/exchange/refund items verified by store
  const { data: verifiedDeliveryReturns } = await adminDb
    .from('deliveries')
    .select('id, rider_id, delivery_date, products, return_product, qty, sales_type, status, stock_verified, stock_verified_at')
    .in('rider_id', riderIds.length > 0 ? riderIds : ['none'])
    .or('status.eq.cms,sales_type.in.(exchange,trade_in,refund)')
    .eq('stock_verified', true)
    .gte('delivery_date', startOfMonth.toISOString().split('T')[0])
    .order('stock_verified_at', { ascending: false })

  // Combine pending items from both sources
  const pending = [
    // From return_collections
    ...(pendingReturnCollections || []).map(d => ({
      id: d.id,
      product_name: d.product_name || 'Unknown',
      quantity: Number(d.qty || 1),
      condition: d.condition || 'return',
      collection_date: d.collection_date,
      rider_id: d.rider_id,
      rider_name: d.rider_id ? riderMap[d.rider_id] || null : null,
      notes: d.notes,
      source: 'return_collection' as const,
    })),
    // From deliveries (CMS/exchange/refund)
    ...(pendingDeliveryReturns || []).map(d => {
      const isReturnType = d.sales_type && ['exchange', 'trade_in', 'refund'].includes(d.sales_type)
      return {
        id: d.id,
        product_name: isReturnType ? (d.return_product || d.products || 'Unknown') : (d.products || 'Unknown'),
        quantity: Number(d.qty || 1),
        condition: d.sales_type || (d.status === 'cms' ? 'CMS' : 'return'),
        collection_date: d.delivery_date,
        rider_id: d.rider_id,
        rider_name: d.rider_id ? riderMap[d.rider_id] || null : null,
        notes: null,
        source: 'delivery' as const,
      }
    }),
  ]

  // Combine verified items from both sources
  const verified = [
    // From return_collections
    ...(verifiedReturnCollections || []).map(d => ({
      id: d.id,
      product_name: d.product_name || 'Unknown',
      quantity: Number(d.qty || 1),
      condition: d.condition || 'return',
      collection_date: d.collection_date,
      rider_id: d.rider_id,
      rider_name: d.rider_id ? riderMap[d.rider_id] || null : null,
      verified_at: d.verified_at,
      notes: d.notes,
      source: 'return_collection' as const,
    })),
    // From deliveries (CMS/exchange/refund)
    ...(verifiedDeliveryReturns || []).map(d => {
      const isReturnType = d.sales_type && ['exchange', 'trade_in', 'refund'].includes(d.sales_type)
      return {
        id: d.id,
        product_name: isReturnType ? (d.return_product || d.products || 'Unknown') : (d.products || 'Unknown'),
        quantity: Number(d.qty || 1),
        condition: d.sales_type || (d.status === 'cms' ? 'CMS' : 'return'),
        collection_date: d.delivery_date,
        rider_id: d.rider_id,
        rider_name: d.rider_id ? riderMap[d.rider_id] || null : null,
        verified_at: d.stock_verified_at,
        notes: null,
        source: 'delivery' as const,
      }
    }),
  ]

  return (
    <ContractorMobileLayout
      profile={profile}
      companyName={contractor.name}
      photoUrl={contractor.photo_url}
      riderCount={riders?.length || 0}
    >
      <ContractorReturnsPage
        pendingReturns={pending}
        verifiedByStore={verified}
      />
    </ContractorMobileLayout>
  )
}
