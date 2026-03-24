'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

const REVALIDATE_PATH = '/dashboard/contractors/stock'

/**
 * Sync contractor daily stock quantities from actual delivery statuses.
 * Called automatically whenever a delivery status changes.
 * 
 * Status mapping:
 * - "delivered" / "picked_up" => delivered_qty  (done, left stock)
 * - "nwd" => postponed_qty  (Next Working Day, still needs to go out)
 * - "cms" => returning_qty  (Customer Missed, product returns to contractor)
 */
export async function syncContractorStock(contractorId: string) {
  const supabase = await createClient()

  // Get the latest stock date for this contractor
  const { data: latestStock } = await supabase
    .from('contractor_daily_stock')
    .select('stock_date')
    .eq('contractor_id', contractorId)
    .order('stock_date', { ascending: false })
    .limit(1)

  if (!latestStock || latestStock.length === 0) return

  const stockDate = latestStock[0].stock_date

  // Get all stock items for this date
  const { data: stockItems } = await supabase
    .from('contractor_daily_stock')
    .select('id, product, source')
    .eq('contractor_id', contractorId)
    .eq('stock_date', stockDate)

  if (!stockItems || stockItems.length === 0) return

  // Get contractor's riders
  const { data: riders } = await supabase
    .from('riders')
    .select('id')
    .eq('contractor_id', contractorId)
    .eq('is_active', true)

  const riderIds = (riders || []).map(r => r.id)
  if (riderIds.length === 0) return

  // Fetch ALL main deliveries for the stock date with current statuses
  const { data: mainDeliveries } = await supabase
    .from('deliveries')
    .select('products, qty, status, sales_type, return_product')
    .in('rider_id', riderIds)
    .eq('delivery_date', stockDate)

  // Fetch partner deliveries for the stock date with current statuses
  const { data: partnerDeliveries } = await supabase
    .from('partner_deliveries')
    .select('product, qty, status')
    .eq('contractor_id', contractorId)
    .in('rider_id', riderIds)
    .eq('order_date', stockDate)

  // Build counts per product+source: delivered, postponed (NWD), returning (CMS)
  const counts = new Map<string, { delivered: number; postponed: number; returning: number }>()

  const RETURN_TYPES = ['exchange', 'trade_in', 'refund']

  for (const d of mainDeliveries || []) {
    const product = (d.products || '').trim()
    if (!product) continue
    const qty = Number(d.qty || 1)
    const key = `main:${product}`
    if (!counts.has(key)) counts.set(key, { delivered: 0, postponed: 0, returning: 0 })
    const entry = counts.get(key)!
    if (d.status === 'delivered' || d.status === 'picked_up') {
      entry.delivered += qty
    } else if (d.status === 'nwd') {
      entry.postponed += qty
    } else if (d.status === 'cms') {
      entry.returning += qty
    }

    // Note: For exchange/trade_in/refund, the return_product collected by the rider
    // goes back to the contractor. It does NOT affect today's delivery stock counts
    // because it's a separate product being returned, not part of the outgoing stock.
  }

  for (const d of partnerDeliveries || []) {
    const product = (d.product || '').trim()
    if (!product) continue
    const qty = Number(d.qty || 1)
    const key = `partner:${product}`
    if (!counts.has(key)) counts.set(key, { delivered: 0, postponed: 0, returning: 0 })
    const entry = counts.get(key)!
    if (d.status === 'delivered' || d.status === 'picked_up') {
      entry.delivered += qty
    } else if (d.status === 'nwd') {
      entry.postponed += qty
    } else if (d.status === 'cms') {
      entry.returning += qty
    }
  }

  // Update each stock item with current counts
  for (const item of stockItems) {
    const key = `${item.source}:${item.product}`
    const c = counts.get(key) || { delivered: 0, postponed: 0, returning: 0 }
    await supabase
      .from('contractor_daily_stock')
      .update({
        delivered_qty: c.delivered,
        postponed_qty: c.postponed,
        returning_qty: c.returning,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id)
  }

  revalidatePath(REVALIDATE_PATH)
}

/**
 * Helper: Find contractor ID from a delivery ID (main deliveries).
 * Deliveries link to contractors via rider_id -> riders.contractor_id
 */
export async function getContractorIdFromDelivery(deliveryId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('deliveries')
    .select('rider_id, contractor_id')
    .eq('id', deliveryId)
    .single()

  // First try direct contractor_id if it exists
  if (data?.contractor_id) return data.contractor_id

  // Otherwise look up through the rider
  if (data?.rider_id) {
    const { data: rider } = await supabase
      .from('riders')
      .select('contractor_id')
      .eq('id', data.rider_id)
      .single()
    return rider?.contractor_id || null
  }

  return null
}

/**
 * Helper: Find contractor ID from a partner delivery ID.
 */
export async function getContractorIdFromPartnerDelivery(deliveryId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('partner_deliveries')
    .select('contractor_id')
    .eq('id', deliveryId)
    .single()
  return data?.contractor_id || null
}

/**
 * Find the latest delivery date that has assigned deliveries for a contractor's riders.
 */
async function getActiveDeliveryDate(supabase: any, riderIds: string[], contractorId: string): Promise<string> {
  const today = new Date().toISOString().split('T')[0]

  // Check main deliveries - find latest date with assigned riders
  const { data: latestMain } = await supabase
    .from('deliveries')
    .select('delivery_date')
    .in('rider_id', riderIds)
    .not('products', 'is', null)
    .order('delivery_date', { ascending: false })
    .limit(1)

  const mainDate = latestMain?.[0]?.delivery_date || null

  // Check partner deliveries - find latest date with assigned riders
  const { data: latestPartner } = await supabase
    .from('partner_deliveries')
    .select('order_date')
    .eq('contractor_id', contractorId)
    .in('rider_id', riderIds)
    .not('product', 'is', null)
    .order('order_date', { ascending: false })
    .limit(1)

  const partnerDate = latestPartner?.[0]?.order_date || null

  // Use the most recent date, or today as fallback
  if (mainDate && partnerDate) {
    return mainDate >= partnerDate ? mainDate : partnerDate
  }
  return mainDate || partnerDate || today
}

/**
 * Generate stock from assigned deliveries (main + partner) for the active delivery date.
 * Called when the contractor taps "Generate Stock" on the stock page.
 */
export async function generateDailyStock(contractorId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Get rider IDs for this contractor
  const { data: riders } = await supabase
    .from('riders')
    .select('id')
    .eq('contractor_id', contractorId)
    .eq('is_active', true)

  const riderIds = (riders || []).map(r => r.id)

  // Also check if contractor is a rider
  const { data: selfRider } = await supabase
    .from('riders')
    .select('id')
    .eq('profile_id', user.id)
    .single()

  if (selfRider && !riderIds.includes(selfRider.id)) {
    riderIds.push(selfRider.id)
  }

  if (riderIds.length === 0) return { error: 'No riders found' }

  // Find the active delivery date (latest date with assigned deliveries)
  const activeDate = await getActiveDeliveryDate(supabase, riderIds, contractorId)

  // Check if already generated for this date
  const { data: existing } = await supabase
    .from('contractor_daily_stock')
    .select('id')
    .eq('contractor_id', contractorId)
    .eq('stock_date', activeDate)
    .limit(1)

  if (existing && existing.length > 0) {
    return { success: true, alreadyExists: true, stockDate: activeDate }
  }

  // Aggregate main deliveries by product for the active date
  const { data: mainDeliveries } = await supabase
    .from('deliveries')
    .select('products, qty, sales_type, return_product')
    .in('rider_id', riderIds)
    .eq('delivery_date', activeDate)

  const productMap = new Map<string, { qty: number; source: string }>()

  for (const d of mainDeliveries || []) {
    const product = (d.products || '').trim()
    if (!product) continue
    const qty = Number(d.qty || 1)
    const key = `main:${product}`
    if (!productMap.has(key)) {
      productMap.set(key, { qty: 0, source: 'main' })
    }
    productMap.get(key)!.qty += qty
  }

  // Aggregate partner deliveries by product for the active date
  const { data: partnerDeliveries } = await supabase
    .from('partner_deliveries')
    .select('product, qty')
    .eq('contractor_id', contractorId)
    .in('rider_id', riderIds)
    .eq('order_date', activeDate)

  for (const d of partnerDeliveries || []) {
    const product = (d.product || '').trim()
    if (!product) continue
    const qty = Number(d.qty || 1)
    const key = `partner:${product}`
    if (!productMap.has(key)) {
      productMap.set(key, { qty: 0, source: 'partner' })
    }
    productMap.get(key)!.qty += qty
  }

  if (productMap.size === 0) {
    return { error: 'No products found in assigned deliveries' }
  }

  // Insert stock rows
  const rows = Array.from(productMap.entries()).map(([key, val]) => ({
    contractor_id: contractorId,
    stock_date: activeDate,
    product: key.replace(/^(main|partner):/, ''),
    expected_qty: val.qty,
    received_qty: val.qty, // default to expected
    is_validated: false,
    source: val.source,
  }))

  if (rows.length > 0) {
    const { error } = await supabase
      .from('contractor_daily_stock')
      .upsert(rows, { onConflict: 'contractor_id,stock_date,product,source' })
    if (error) return { error: error.message }
  }

  revalidatePath(REVALIDATE_PATH)
  return { success: true, count: rows.length, stockDate: activeDate }
}

/**
 * Update received quantity for a single stock item.
 */
export async function updateStockReceived(stockId: string, receivedQty: number) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('contractor_daily_stock')
    .update({
      received_qty: receivedQty,
      updated_at: new Date().toISOString(),
    })
    .eq('id', stockId)

  if (error) return { error: error.message }
  revalidatePath(REVALIDATE_PATH)
  return { success: true }
}

/**
 * Validate the full daily stock - contractor confirms they received everything.
 */
export async function validateDailyStock(contractorId: string, notes?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const now = new Date().toISOString()

  // Find the latest stock date for this contractor
  const { data: latestStock } = await supabase
    .from('contractor_daily_stock')
    .select('stock_date')
    .eq('contractor_id', contractorId)
    .order('stock_date', { ascending: false })
    .limit(1)

  const stockDate = latestStock?.[0]?.stock_date
  if (!stockDate) return { error: 'No stock found to validate' }

  // Mark all stock items as validated
  const { error: stockError } = await supabase
    .from('contractor_daily_stock')
    .update({
      is_validated: true,
      validated_at: now,
      updated_at: now,
    })
    .eq('contractor_id', contractorId)
    .eq('stock_date', stockDate)

  if (stockError) return { error: stockError.message }

  // Get totals
  const { data: stockItems } = await supabase
    .from('contractor_daily_stock')
    .select('expected_qty, received_qty')
    .eq('contractor_id', contractorId)
    .eq('stock_date', stockDate)

  const totalExpected = (stockItems || []).reduce((s, i) => s + (i.expected_qty || 0), 0)
  const totalReceived = (stockItems || []).reduce((s, i) => s + (i.received_qty || 0), 0)

  // Upsert validation record
  const { error: valError } = await supabase
    .from('contractor_stock_validation')
    .upsert({
      contractor_id: contractorId,
      stock_date: stockDate,
      is_validated: true,
      validated_at: now,
      validated_by: user.id,
      total_expected: totalExpected,
      total_received: totalReceived,
      notes: notes || null,
    }, { onConflict: 'contractor_id,stock_date' })

  if (valError) return { error: valError.message }

  revalidatePath(REVALIDATE_PATH)
  return { success: true, totalExpected, totalReceived }
}

/**
 * Reset validation for today (unvalidate).
 */
export async function resetDailyStockValidation(contractorId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Find the latest stock date
  const { data: latestStock } = await supabase
    .from('contractor_daily_stock')
    .select('stock_date')
    .eq('contractor_id', contractorId)
    .order('stock_date', { ascending: false })
    .limit(1)

  const stockDate = latestStock?.[0]?.stock_date
  if (!stockDate) return { error: 'No stock found' }

  await supabase
    .from('contractor_daily_stock')
    .update({ is_validated: false, validated_at: null })
    .eq('contractor_id', contractorId)
    .eq('stock_date', stockDate)

  await supabase
    .from('contractor_stock_validation')
    .update({ is_validated: false, validated_at: null })
    .eq('contractor_id', contractorId)
    .eq('stock_date', stockDate)

  revalidatePath(REVALIDATE_PATH)
  return { success: true }
}

/**
 * Regenerate stock (delete and recreate) - useful after re-assigning deliveries.
 */
export async function regenerateDailyStock(contractorId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Delete ALL existing stock for this contractor (any date)
  await supabase
    .from('contractor_daily_stock')
    .delete()
    .eq('contractor_id', contractorId)

  await supabase
    .from('contractor_stock_validation')
    .delete()
    .eq('contractor_id', contractorId)

  // Re-generate using the active delivery date
  return generateDailyStock(contractorId)
}

export async function clearDailyStock(contractorId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Delete all stock items for this contractor
  const { error: stockErr } = await supabase
    .from('contractor_daily_stock')
    .delete()
    .eq('contractor_id', contractorId)

  if (stockErr) return { error: stockErr.message }

  // Delete the validation record too
  await supabase
    .from('contractor_stock_validation')
    .delete()
    .eq('contractor_id', contractorId)

  revalidatePath(REVALIDATE_PATH)
  return { success: true }
}
