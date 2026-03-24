// Stock page v2.2 — CMS / Returns split in classification
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ContractorMobileLayout } from '@/components/contractor/mobile-layout'
import { StockValidation } from '@/components/contractor/stock-validation'
import { RiderStockCards } from '@/components/contractor/rider-stock-cards'

export default async function ContractorStockPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/auth/login')

  // Get contractor record
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

  // Get riders under this contractor
  const { data: riders } = await supabase
    .from('riders')
    .select('id, name')
    .eq('contractor_id', contractor.id)
    .eq('is_active', true)
    .order('name')

  // Also check if contractor is a rider
  const { data: selfRider } = await supabase
    .from('riders')
    .select('id, name')
    .eq('profile_id', user.id)
    .single()

  const allRiders = [...(riders || [])]
  if (selfRider && !allRiders.find(r => r.id === selfRider.id)) {
    allRiders.unshift(selfRider)
  }

  const riderIds = allRiders.map(r => r.id)

  // Find the active delivery date (latest date with assigned deliveries)
  let activeDate = new Date().toISOString().split('T')[0]
  if (riderIds.length > 0) {
    const { data: latestMain } = await supabase
      .from('deliveries')
      .select('delivery_date')
      .in('rider_id', riderIds)
      .not('products', 'is', null)
      .order('delivery_date', { ascending: false })
      .limit(1)

    const { data: latestPartner } = await supabase
      .from('partner_deliveries')
      .select('order_date')
      .eq('contractor_id', contractor.id)
      .in('rider_id', riderIds)
      .not('product', 'is', null)
      .order('order_date', { ascending: false })
      .limit(1)

    const mainDate = latestMain?.[0]?.delivery_date || null
    const partnerDate = latestPartner?.[0]?.order_date || null
    if (mainDate && partnerDate) {
      activeDate = mainDate >= partnerDate ? mainDate : partnerDate
    } else if (mainDate) {
      activeDate = mainDate
    } else if (partnerDate) {
      activeDate = partnerDate
    }
  }

  // Fetch daily stock items for the active date
  const { data: stockItems } = await supabase
    .from('contractor_daily_stock')
    .select('*')
    .eq('contractor_id', contractor.id)
    .eq('stock_date', activeDate)
    .order('source')
    .order('product')

  // Fetch validation record
  const { data: validation } = await supabase
    .from('contractor_stock_validation')
    .select('*')
    .eq('contractor_id', contractor.id)
    .eq('stock_date', activeDate)
    .single()

  // Build per-rider product breakdown from both main + partner deliveries
  let mainDeliveries: any[] = []
  let partnerDeliveries: any[] = []
  if (riderIds.length > 0) {
    const { data: md } = await supabase
      .from('deliveries')
      .select('id, products, qty, status, rider_id, locality, customer_name, sales_type, return_product')
      .in('rider_id', riderIds)
      .eq('delivery_date', activeDate)
    mainDeliveries = md || []

    const { data: pd } = await supabase
      .from('partner_deliveries')
      .select('id, product, qty, status, rider_id, locality, supplier, address')
      .eq('contractor_id', contractor.id)
      .in('rider_id', riderIds)
      .eq('order_date', activeDate)
    partnerDeliveries = pd || []
  }

  const riderProducts = allRiders.map(rider => {
    const riderMain = mainDeliveries.filter(d => d.rider_id === rider.id)
    const riderPartner = partnerDeliveries.filter(d => d.rider_id === rider.id)
    const productMap = new Map<string, {
      product: string
      totalQty: number
      deliveredQty: number
      pendingQty: number
      postponedQty: number
      returningQty: number
      cmsQty: number
      exchangeReturnQty: number
      returnType?: string
      source: string
    }>()

    const RETURN_TYPES = ['exchange', 'trade_in', 'refund']

    for (const d of riderMain) {
      const product = (d.products || 'Unknown Product').trim()
      const qty = Number(d.qty || 1)
      const key = `main:${product}`
      if (!productMap.has(key)) {
        productMap.set(key, { product, totalQty: 0, deliveredQty: 0, pendingQty: 0, postponedQty: 0, returningQty: 0, cmsQty: 0, exchangeReturnQty: 0, source: 'main' })
      }
      const entry = productMap.get(key)!
      entry.totalQty += qty
      if (d.status === 'delivered' || d.status === 'picked_up') entry.deliveredQty += qty
      else if (d.status === 'nwd') entry.postponedQty += qty
      else if (d.status === 'cms') { entry.returningQty += qty; entry.cmsQty += qty }
      else entry.pendingQty += qty

      // Track return products for exchange/trade_in/refund (collected from customer)
      if (d.status === 'delivered' && RETURN_TYPES.includes(d.sales_type || '')) {
        const returnProduct = (d.return_product || '').trim()
        if (returnProduct) {
          const returnKey = `return:${d.sales_type}:${returnProduct}`
          if (!productMap.has(returnKey)) {
            productMap.set(returnKey, { product: returnProduct, totalQty: 0, deliveredQty: 0, pendingQty: 0, postponedQty: 0, returningQty: 0, cmsQty: 0, exchangeReturnQty: 0, returnType: d.sales_type, source: 'main' })
          }
          const re = productMap.get(returnKey)!
          re.returningQty += qty
          re.exchangeReturnQty += qty
        }
      }
    }

    for (const d of riderPartner) {
      const product = (d.product || 'Unknown Product').trim()
      const qty = Number(d.qty || 1)
      const key = `partner:${product}`
      if (!productMap.has(key)) {
        productMap.set(key, { product, totalQty: 0, deliveredQty: 0, pendingQty: 0, postponedQty: 0, returningQty: 0, cmsQty: 0, exchangeReturnQty: 0, source: 'partner' })
      }
      const entry = productMap.get(key)!
      entry.totalQty += qty
      if (d.status === 'delivered' || d.status === 'picked_up') entry.deliveredQty += qty
      else if (d.status === 'nwd') entry.postponedQty += qty
      else if (d.status === 'cms') { entry.returningQty += qty; entry.cmsQty += qty }
      else entry.pendingQty += qty
    }

    const products = Array.from(productMap.values()).sort((a, b) => a.product.localeCompare(b.product))

    // Build individual delivery records grouped by status
    const deliveryRecords = [
      ...riderMain.map(d => ({
        id: d.id,
        product: (d.products || 'Unknown').trim(),
        qty: Number(d.qty || 1),
        status: d.status as string,
        region: d.locality || '',
        source: 'main' as const,
      })),
      ...riderPartner.map(d => ({
        id: d.id,
        product: (d.product || 'Unknown').trim(),
        qty: Number(d.qty || 1),
        status: d.status as string,
        region: d.locality || '',
        source: 'partner' as const,
      })),
    ]

    return {
      riderId: rider.id,
      riderName: rider.name,
      products,
      deliveries: deliveryRecords,
      totalItems: products.filter(p => !p.returnType).reduce((s, p) => s + p.totalQty, 0),
      delivered: products.filter(p => !p.returnType).reduce((s, p) => s + p.deliveredQty, 0),
      pending: products.filter(p => !p.returnType).reduce((s, p) => s + p.pendingQty, 0),
      postponed: products.filter(p => !p.returnType).reduce((s, p) => s + p.postponedQty, 0),
      returning: products.filter(p => !p.returnType).reduce((s, p) => s + p.returningQty, 0),
      cms: products.filter(p => !p.returnType).reduce((s, p) => s + p.cmsQty, 0),
      exchangeReturns: products.filter(p => !!p.returnType).reduce((s, p) => s + p.exchangeReturnQty, 0),
      returnProducts: products.filter(p => !!p.returnType),
    }
  })

  return (
    <ContractorMobileLayout
      profile={profile}
      companyName={contractor.name}
      photoUrl={contractor.photo_url}
      riderCount={riders?.length || 0}
    >
      <div className="space-y-4 pb-4">
        {/* Header */}
        <div className="px-1">
          <h1 className="text-lg font-bold text-foreground">Stock</h1>
          <p className="text-xs text-muted-foreground">
            {new Date(activeDate + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>

        <StockValidation
          contractorId={contractor.id}
          stockItems={(stockItems || []).map(s => ({
            id: s.id,
            product: s.product,
            expected_qty: s.expected_qty,
            received_qty: s.received_qty,
            delivered_qty: s.delivered_qty || 0,
            postponed_qty: s.postponed_qty || 0,
            returning_qty: s.returning_qty || 0,
            is_validated: s.is_validated,
            source: s.source,
            notes: s.notes,
          }))}
          validation={validation ? {
            is_validated: validation.is_validated,
            validated_at: validation.validated_at,
            total_expected: validation.total_expected,
            total_received: validation.total_received,
            notes: validation.notes,
          } : null}
          riderProducts={riderProducts}
          today={activeDate}
        />


        <RiderStockCards riderProducts={riderProducts} />
      </div>
    </ContractorMobileLayout>
  )
}
