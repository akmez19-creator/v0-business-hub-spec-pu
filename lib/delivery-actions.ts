'use server'

import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { revalidatePath } from 'next/cache'
import type { DeliveryStatus } from './types'
import { createRegionResolver } from './region-resolver'
import { syncContractorStock, getContractorIdFromDelivery } from '@/lib/stock-actions'

/** Revalidate all delivery-related pages so data stays in sync */
function revalidateAllDeliveryPaths() {
  revalidatePath('/dashboard/deliveries')
  revalidatePath('/dashboard/deliveries/all')
  revalidatePath('/dashboard/deliveries/collections')
  revalidatePath('/dashboard/riders')
  revalidatePath('/dashboard/riders/deliveries')
  revalidatePath('/dashboard/contractors')
  revalidatePath('/dashboard/contractors/deliveries')
  revalidatePath('/dashboard/contractors/map')
  revalidatePath('/dashboard/contractors/my-deliveries')
  revalidatePath('/dashboard/contractors/stock')
  revalidatePath('/dashboard/contractors/collections')
  revalidatePath('/dashboard/contractors/partner-deliveries')
}

async function normalizeLocality(input: string | null): Promise<string | null> {
  if (!input) return null
  const resolver = await createRegionResolver()
  const resolved = resolver.resolve(input)
  return resolved ? resolved.locality : input
}

export async function createDelivery(formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) return { error: 'Not authenticated' }

  const rawLocality = formData.get('locality') as string || null

  const delivery = {
    rte: formData.get('rte') as string || null,
    entry_date: formData.get('entry_date') as string || new Date().toISOString().split('T')[0],
    delivery_date: formData.get('delivery_date') as string || null,
    index_no: formData.get('index_no') as string || null,
    customer_name: formData.get('customer_name') as string,
    contact_1: formData.get('contact_1') as string || null,
    contact_2: formData.get('contact_2') as string || null,
    locality: await normalizeLocality(rawLocality),
    qty: parseInt(formData.get('qty') as string) || 1,
    products: formData.get('products') as string || null,
    amount: parseFloat(formData.get('amount') as string) || 0,
    payment_method: formData.get('payment_method') as string || null,
    payment_juice: parseFloat(formData.get('payment_juice') as string) || 0,
    payment_cash: parseFloat(formData.get('payment_cash') as string) || 0,
    payment_bank: parseFloat(formData.get('payment_bank') as string) || 0,
    payment_status: formData.get('payment_status') as string || 'unpaid',
    sales_type: formData.get('sales_type') as string || null,
    return_product: formData.get('return_product') as string || null,
    notes: formData.get('notes') as string || null,
    medium: formData.get('medium') as string || null,
    rider_fee: parseFloat(formData.get('rider_fee') as string) || 50,
    created_by: user.id,
  }

  const { error } = await supabase.from('deliveries').insert(delivery)

  if (error) {
    return { error: error.message }
  }

  revalidateAllDeliveryPaths()
  return { success: true }
}

export async function updateDelivery(id: string, formData: FormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) return { error: 'Not authenticated' }

  const rawLocalityUpdate = formData.get('locality') as string || null

  const delivery = {
    rte: formData.get('rte') as string || null,
    delivery_date: formData.get('delivery_date') as string || null,
    index_no: formData.get('index_no') as string || null,
    customer_name: formData.get('customer_name') as string,
    contact_1: formData.get('contact_1') as string || null,
    contact_2: formData.get('contact_2') as string || null,
    locality: await normalizeLocality(rawLocalityUpdate),
    qty: parseInt(formData.get('qty') as string) || 1,
    products: formData.get('products') as string || null,
    amount: parseFloat(formData.get('amount') as string) || 0,
    payment_method: formData.get('payment_method') as string || null,
    payment_juice: parseFloat(formData.get('payment_juice') as string) || 0,
    payment_cash: parseFloat(formData.get('payment_cash') as string) || 0,
    payment_bank: parseFloat(formData.get('payment_bank') as string) || 0,
    payment_status: formData.get('payment_status') as string || 'unpaid',
    sales_type: formData.get('sales_type') as string || null,
    return_product: formData.get('return_product') as string || null,
    notes: formData.get('notes') as string || null,
    medium: formData.get('medium') as string || null,
    rider_fee: parseFloat(formData.get('rider_fee') as string) || 50,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('deliveries')
    .update(delivery)
    .eq('id', id)

  if (error) {
    return { error: error.message }
  }

  revalidateAllDeliveryPaths()
  return { success: true }
}

export async function deleteDelivery(id: string) {
  const supabase = await createClient()
  
  const { error } = await supabase
    .from('deliveries')
    .delete()
    .eq('id', id)

  if (error) {
    return { error: error.message }
  }

  revalidateAllDeliveryPaths()
  return { success: true }
}

export async function assignDelivery(deliveryId: string, riderId: string, _contractorId?: string | null) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) return { error: 'Not authenticated' }

  // Look up the rider's contractor_id from the DB to avoid FK issues
  const { data: rider } = await supabase.from('riders').select('contractor_id').eq('id', riderId).single()

  const updateData: Record<string, unknown> = {
    rider_id: riderId,
    assigned_by: user.id,
    assigned_at: new Date().toISOString(),
    status: 'assigned',
    status_updated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  // Only set contractor_id if the rider actually has one
  if (rider?.contractor_id) {
    updateData.contractor_id = rider.contractor_id
  }

  const { error } = await supabase
    .from('deliveries')
    .update(updateData)
    .eq('id', deliveryId)

  if (error) {
    return { error: error.message }
  }

  revalidateAllDeliveryPaths()

  // Auto-sync contractor stock on any status change
  try {
    const cId = await getContractorIdFromDelivery(deliveryId)
    if (cId) await syncContractorStock(cId)
  } catch { /* don't block */ }

  return { success: true }
}

export async function updateDeliveryStatus(deliveryId: string, status: DeliveryStatus, notes?: string) {
  const supabase = await createClient()

  const updateData: Record<string, unknown> = {
    status,
    status_updated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  if (status === 'picked_up') {
    updateData.picked_up_at = new Date().toISOString()
  } else if (status === 'delivered') {
    updateData.delivered_at = new Date().toISOString()
  }

  if (notes) {
    updateData.delivery_notes = notes
  }

  const { error } = await supabase
    .from('deliveries')
    .update(updateData)
    .eq('id', deliveryId)

  if (error) {
    return { error: error.message }
  }

  revalidateAllDeliveryPaths()

  // Auto-sync contractor stock on any status change
  try {
    const cId = await getContractorIdFromDelivery(deliveryId)
    if (cId) await syncContractorStock(cId)
  } catch { /* don't block */ }

  return { success: true }
}

export async function updateDeliveryStatusBulk(deliveryIds: string[], status: DeliveryStatus, notes?: string, paymentMethod?: string, paymentProofUrl?: string) {
  const supabase = await createClient()
  
  const updateData: Record<string, unknown> = {
    status,
    status_updated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  if (status === 'picked_up') {
    updateData.picked_up_at = new Date().toISOString()
  } else if (status === 'delivered') {
    updateData.delivered_at = new Date().toISOString()
  }

  if (notes) {
    updateData.delivery_notes = notes
  }

  if (paymentMethod) {
    updateData.payment_method = paymentMethod
  }

  // If a payment method is set, we need to update each delivery's payment split
  // based on its individual amount
  if (paymentMethod && status === 'delivered') {
    // Fetch the amounts for all deliveries
    const { data: deliveriesData } = await supabase
      .from('deliveries')
      .select('id, amount')
      .in('id', deliveryIds)

    if (deliveriesData && deliveriesData.length > 0) {
      for (const del of deliveriesData) {
        const amt = Number(del.amount || 0)
        const paymentSplit: Record<string, unknown> = {
          ...updateData,
          payment_juice: 0,
          payment_cash: 0,
          payment_bank: 0,
          payment_status: amt > 0 ? 'paid' : 'unpaid',
        }
        if (paymentProofUrl) {
          paymentSplit.payment_proof_url = paymentProofUrl
        }
        if (paymentMethod === 'juice' || paymentMethod === 'juice_to_rider') {
          paymentSplit.payment_juice = amt
        } else if (paymentMethod === 'cash') {
          paymentSplit.payment_cash = amt
        } else if (paymentMethod === 'bank') {
          paymentSplit.payment_bank = amt
        } else if (paymentMethod === 'already_paid') {
          paymentSplit.payment_status = 'already_paid'
        }

        await supabase
          .from('deliveries')
          .update(paymentSplit)
          .eq('id', del.id)
      }
    }
  } else {
    // No payment method, just do a bulk update
    const { error: err } = await supabase
      .from('deliveries')
      .update(updateData)
      .in('id', deliveryIds)
    if (err) return { error: err.message }
  }

  // Skip the old bulk update since we handled it above
  const error = null as any

  if (error) {
    return { error: error.message }
  }

  revalidateAllDeliveryPaths()

  // Auto-sync contractor stock on any bulk status change
  if (deliveryIds.length > 0) {
    try {
      const cId = await getContractorIdFromDelivery(deliveryIds[0])
      if (cId) await syncContractorStock(cId)
    } catch { /* don't block */ }
  }

  return { success: true }
}

export async function markRiderPaid(deliveryIds: string[]) {
  const supabase = await createClient()
  
  const { error } = await supabase
    .from('deliveries')
    .update({
      rider_paid: true,
      rider_paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in('id', deliveryIds)

  if (error) {
    return { error: error.message }
  }

  revalidateAllDeliveryPaths()
  return { success: true }
}

export async function bulkAssignDeliveries(deliveryIds: string[], riderId: string, contractorId: string | null) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('deliveries')
    .update({
      rider_id: riderId,
      contractor_id: contractorId,
      assigned_by: user.id,
      assigned_at: new Date().toISOString(),
      status: 'assigned',
      status_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in('id', deliveryIds)

  if (error) {
    return { error: error.message }
  }

  revalidateAllDeliveryPaths()
  return { success: true }
}

// ── Rider Region Defaults ──

export async function getRiderRegionDefaults(contractorId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('rider_region_defaults')
    .select('rider_id, locality, sort_order')
    .eq('contractor_id', contractorId)
    .order('sort_order', { ascending: true })
  if (error) return { error: error.message, data: [] }
  return { data: data || [] }
}

export async function saveRiderRegionDefaults(
  contractorId: string,
  riderId: string,
  regions: string[]
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Delete existing defaults for this rider under this contractor
  await supabase
    .from('rider_region_defaults')
    .delete()
    .eq('rider_id', riderId)
    .eq('contractor_id', contractorId)

  // Insert new ones with sort_order preserved from array index
  if (regions.length > 0) {
    const rows = regions.map((locality, idx) => ({
      rider_id: riderId,
      contractor_id: contractorId,
      locality,
      sort_order: idx + 1,
    }))
    const { error } = await supabase.from('rider_region_defaults').insert(rows)
    if (error) return { error: error.message }
  }

  revalidateAllDeliveryPaths()
  return { success: true }
}

export async function clearAllRiderRegionDefaults(contractorId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('rider_region_defaults')
    .delete()
    .eq('contractor_id', contractorId)

  if (error) return { error: error.message }

  revalidateAllDeliveryPaths()
  return { success: true }
}

// Shared helper: build locality->rider map and process deliveries
async function applyRegionDefaults(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  contractorId: string,
  deliveries: { id: string; locality: string | null }[]
) {
  // Get defaults
  const { data: defaults } = await supabase
    .from('rider_region_defaults')
    .select('rider_id, locality')
    .eq('contractor_id', contractorId)

  if (!defaults || defaults.length === 0) {
    return { error: 'No rider-region defaults set.' }
  }

  // Build locality -> rider map (case-insensitive, trimmed)
  const localityToRider = new Map<string, string>()
  for (const d of defaults) {
    localityToRider.set(d.locality.toLowerCase().trim(), d.rider_id)
  }

  // Match deliveries to riders
  const riderBatch = new Map<string, string[]>()
  let matched = 0
  const unmatchedLocalities = new Set<string>()

  for (const del of deliveries) {
    const rawLocality = (del.locality || '').trim()
    const locality = rawLocality.toLowerCase()
    const riderId = localityToRider.get(locality)
    if (riderId) {
      if (!riderBatch.has(riderId)) riderBatch.set(riderId, [])
      riderBatch.get(riderId)!.push(del.id)
      matched++
    } else if (rawLocality) {
      unmatchedLocalities.add(rawLocality)
    }
  }

  // Bulk update in batches of 200 (supabase .in() limit)
  const now = new Date().toISOString()
  for (const [riderId, ids] of riderBatch) {
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200)
      await supabase
        .from('deliveries')
        .update({
          rider_id: riderId,
          assigned_by: userId,
          assigned_at: now,
          status: 'assigned',
          status_updated_at: now,
          updated_at: now,
        })
        .in('id', batch)
    }
  }

  revalidateAllDeliveryPaths()

  return {
    success: true,
    matched,
    unmatched: unmatchedLocalities.size,
    unmatchedLocalities: Array.from(unmatchedLocalities).slice(0, 10),
    total: deliveries.length,
  }
}

export async function autoAssignByDefaults(
  contractorId: string,
  riderIds: string[],
  deliveryDate: string
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Get unassigned deliveries: via contractor_id (unassigned) 
  // Deliveries with rider_id set are already assigned, skip them
  const { data: unassignedByContractor } = await supabase
    .from('deliveries')
    .select('id, locality')
    .eq('contractor_id', contractorId)
    .eq('delivery_date', deliveryDate)
    .is('rider_id', null)

  // Also check for rider_id-linked deliveries that have status pending (re-assignable)
  let pendingByRider: typeof unassignedByContractor = []
  if (riderIds.length > 0) {
    const { data } = await supabase
      .from('deliveries')
      .select('id, locality')
      .in('rider_id', riderIds)
      .eq('delivery_date', deliveryDate)
      .is('rider_id', null)
    pendingByRider = data || []
  }

  // Merge and dedupe
  const seen = new Set<string>()
  const deliveries: { id: string; locality: string | null }[] = []
  for (const d of [...(unassignedByContractor || []), ...pendingByRider]) {
    if (!seen.has(d.id)) {
      seen.add(d.id)
      deliveries.push(d)
    }
  }

  if (deliveries.length === 0) {
    return { error: 'No unassigned deliveries to auto-assign.' }
  }

  return applyRegionDefaults(supabase, user.id, contractorId, deliveries)
}

export async function syncDefaultsToAll(
  contractorId: string,
  riderIds: string[],
  deliveryDate: string
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Get ALL deliveries for this date:
  // 1. Assigned deliveries linked via rider_id
  // 2. Unassigned deliveries linked via contractor_id
  let assignedDeliveries: { id: string; locality: string | null }[] = []
  if (riderIds.length > 0) {
    const { data } = await supabase
      .from('deliveries')
      .select('id, locality')
      .in('rider_id', riderIds)
      .eq('delivery_date', deliveryDate)
    assignedDeliveries = data || []
  }

  const { data: unassignedDeliveries } = await supabase
    .from('deliveries')
    .select('id, locality')
    .eq('contractor_id', contractorId)
    .is('rider_id', null)
    .eq('delivery_date', deliveryDate)

  // Merge and dedupe
  const seen = new Set<string>()
  const deliveries: { id: string; locality: string | null }[] = []
  for (const d of [...assignedDeliveries, ...(unassignedDeliveries || [])]) {
    if (!seen.has(d.id)) {
      seen.add(d.id)
      deliveries.push(d)
    }
  }

  if (deliveries.length === 0) {
    return { error: 'No deliveries for this date.' }
  }

  return applyRegionDefaults(supabase, user.id, contractorId, deliveries)
}

export async function updateClientResponse(deliveryIds: string[], response: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('deliveries')
    .update({ client_response: response, updated_at: new Date().toISOString() })
    .in('id', deliveryIds)

  if (error) return { error: error.message }
  revalidateAllDeliveryPaths()
  return { success: true }
}

export async function updateDeliveryNote(deliveryId: string, note: string) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('deliveries')
    .update({ delivery_notes: note, updated_at: new Date().toISOString() })
    .eq('id', deliveryId)

  if (error) return { error: error.message }
  revalidateAllDeliveryPaths()
  return { success: true }
}

export async function updatePaymentSplit(
  deliveryId: string,
  data: { payment_juice: number; payment_cash: number; payment_bank: number; payment_status: string; payment_method?: string }
) {
  const supabase = await createClient()
  const { error } = await supabase
    .from('deliveries')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', deliveryId)

  if (error) return { error: error.message }
  revalidateAllDeliveryPaths()
  return { success: true }
}

export async function clearAllDeliveries() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) return { error: 'Not authenticated' }

  // Check if user is admin or manager
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Unauthorized - only admins and managers can clear all deliveries' }
  }

  // Delete all deliveries
  const { error } = await supabase
    .from('deliveries')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000') // This matches all rows

  if (error) {
    return { error: error.message }
  }

  // Also clear delivery imports log
  await supabase
    .from('delivery_imports')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')

  revalidateAllDeliveryPaths()
  return { success: true }
}

export async function resetContractorDeliveries(contractorId: string, date: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return { error: 'Not authenticated' }

  // Verify the user is linked to this contractor
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, contractor_id')
    .eq('id', user.id)
    .single()

  if (!profile) return { error: 'Profile not found' }

  // Allow admin/manager or the contractor themselves
  const isAdmin = ['admin', 'manager'].includes(profile.role)
  let isOwner = false

  if (profile.role === 'contractor') {
    const { data: c } = await supabase
      .from('contractors')
      .select('id')
      .eq('profile_id', user.id)
      .single()
    if (c?.id === contractorId) isOwner = true
    if (!isOwner && profile.contractor_id === contractorId) isOwner = true
  }

  if (!isAdmin && !isOwner) return { error: 'Unauthorized' }

  // Get rider IDs for this contractor
  const { data: riders } = await supabase
    .from('riders')
    .select('id')
    .eq('contractor_id', contractorId)
    .eq('is_active', true)

  const riderIds = (riders || []).map(r => r.id)
  if (riderIds.length === 0) return { success: true, reset: 0 }

  // Reset all deliveries back to "assigned" status
  const { data: updated, error } = await supabase
    .from('deliveries')
    .update({ status: 'assigned' })
    .in('rider_id', riderIds)
    .eq('delivery_date', date)
    .neq('status', 'assigned')
    .select('id')

  if (error) return { error: error.message }

  // Also reset partner deliveries back to "assigned"
  await supabase
    .from('partner_deliveries')
    .update({ status: 'assigned' })
    .eq('contractor_id', contractorId)
    .eq('order_date', date)
    .neq('status', 'assigned')

  // Reset stock: zero out all delivery counts and unvalidate
  await supabase
    .from('contractor_daily_stock')
    .update({
      is_validated: false,
      validated_at: null,
      delivered_qty: 0,
      postponed_qty: 0,
      returning_qty: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('contractor_id', contractorId)
    .eq('stock_date', date)

  // Also reset the validation record
  await supabase
    .from('contractor_stock_validation')
    .update({ is_validated: false, validated_at: null })
    .eq('contractor_id', contractorId)
    .eq('stock_date', date)

  revalidateAllDeliveryPaths()
  return { success: true, reset: updated?.length || 0 }
}

export async function toggleRiderActive(riderId: string, isActive: boolean) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Verify caller is the contractor who owns this rider
  const { data: rider } = await supabase
    .from('riders')
    .select('id, contractor_id')
    .eq('id', riderId)
    .single()

  if (!rider) return { error: 'Rider not found' }

  const { data: contractor } = await supabase
    .from('contractors')
    .select('id')
    .eq('profile_id', user.id)
    .single()

  if (!contractor || contractor.id !== rider.contractor_id) {
    return { error: 'Not authorized' }
  }

  const adminDb = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { error } = await adminDb
    .from('riders')
    .update({ is_active: isActive })
    .eq('id', riderId)

  if (error) return { error: error.message }

  revalidateAllDeliveryPaths()
  return { success: true }
}

export async function createRiderAsContractor(
  name: string,
  phone?: string,
  email?: string,
  password?: string,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) return { error: 'Not authenticated' }

  // Check contractor role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, contractor_id')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'contractor') {
    return { error: 'Only contractors can add riders to their team' }
  }

  // Find contractor record
  let contractorId: string | null = null

  const { data: contractorByProfile } = await supabase
    .from('contractors')
    .select('id')
    .eq('profile_id', user.id)
    .single()
  
  if (contractorByProfile) {
    contractorId = contractorByProfile.id
  } else if (profile.contractor_id) {
    contractorId = profile.contractor_id
  }

  if (!contractorId) return { error: 'Contractor profile not found' }

  // If credentials provided, create Supabase auth user + profile
  let riderProfileId: string | null = null

  if (email && password) {
    if (password.length < 6) return { error: 'Password must be at least 6 characters' }

    const { createAdminClient } = await import('@/lib/supabase/server')
    const adminClient = createAdminClient()

    // Create auth user via admin API (auto-confirms email)
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
    })

    if (authError) {
      if (authError.message?.includes('already been registered')) {
        return { error: 'A user with this email already exists' }
      }
      return { error: authError.message }
    }

    riderProfileId = authData.user.id

    // Update the auto-created profile (trigger handle_new_user creates it on auth.users INSERT)
    const { error: profileError } = await adminClient
      .from('profiles')
      .update({
        name: name.trim(),
        role: 'rider',
        approved: true,
        email_verified: true,
        contractor_id: contractorId,
        phone: phone || null,
        password_plain: password,
        updated_at: new Date().toISOString(),
      })
      .eq('id', riderProfileId)

    if (profileError) {
      await adminClient.auth.admin.deleteUser(riderProfileId)
      return { error: 'Failed to update rider profile: ' + profileError.message }
    }
  }

  // Create rider record
  const { data, error } = await supabase
    .from('riders')
    .insert({
      name: name.trim(),
      phone: phone || null,
      contractor_id: contractorId,
      profile_id: riderProfileId,
      is_active: true,
      created_by: user.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  // If we created a profile, link back profiles.rider_id
  if (riderProfileId) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const adminClient = createAdminClient()
    await adminClient
      .from('profiles')
      .update({ rider_id: data.id })
      .eq('id', riderProfileId)
  }

  revalidateAllDeliveryPaths()
  return { success: true, riderId: data.id }
}

// Create login credentials for an existing rider (no profile yet)
export async function createCredentialsForRider(
  riderId: string,
  email: string,
  password: string,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Verify contractor role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, contractor_id')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'contractor') {
    return { error: 'Only contractors can create rider credentials' }
  }

  // Find contractor
  let contractorId: string | null = null
  const { data: contractorByProfile } = await supabase
    .from('contractors')
    .select('id')
    .eq('profile_id', user.id)
    .single()
  if (contractorByProfile) contractorId = contractorByProfile.id
  else if (profile.contractor_id) contractorId = profile.contractor_id
  if (!contractorId) return { error: 'Contractor profile not found' }

  // Verify rider belongs to this contractor and has no profile yet
  const { data: rider } = await supabase
    .from('riders')
    .select('id, name, phone, profile_id, contractor_id')
    .eq('id', riderId)
    .single()

  if (!rider) return { error: 'Rider not found' }
  if (rider.contractor_id !== contractorId) return { error: 'This rider is not in your team' }
  if (rider.profile_id) return { error: 'This rider already has login credentials' }

  if (password.length < 6) return { error: 'Password must be at least 6 characters' }

  const { createAdminClient } = await import('@/lib/supabase/server')
  const adminClient = createAdminClient()

  // Create auth user
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password,
    email_confirm: true,
  })

  if (authError) {
    if (authError.message?.includes('already been registered')) {
      return { error: 'A user with this email already exists' }
    }
    return { error: authError.message }
  }

  const riderProfileId = authData.user.id

  // Update the auto-created profile (trigger handle_new_user creates it on auth.users INSERT)
  const { error: profileError } = await adminClient
    .from('profiles')
    .update({
      name: rider.name,
      role: 'rider',
      approved: true,
      email_verified: true,
      contractor_id: contractorId,
      rider_id: riderId,
      phone: rider.phone || null,
      password_plain: password,
      updated_at: new Date().toISOString(),
    })
    .eq('id', riderProfileId)

  if (profileError) {
    await adminClient.auth.admin.deleteUser(riderProfileId)
    return { error: 'Failed to update profile: ' + profileError.message }
  }

  // Link rider to profile
  const { error: linkError } = await adminClient
    .from('riders')
    .update({ profile_id: riderProfileId, updated_at: new Date().toISOString() })
    .eq('id', riderId)

  if (linkError) return { error: 'Credentials created but failed to link: ' + linkError.message }

  revalidateAllDeliveryPaths()
  return { success: true }
}

// ── Update Delivery Location (drag pin on map) ──
export async function updateDeliveryLocation(deliveryId: string, latitude: number, longitude: number, locationSource?: string) {
  'use server'
  const supabase = await createClient()

  const { error } = await supabase
    .from('deliveries')
    .update({
      latitude,
      longitude,
      client_lat: latitude,
      client_lng: longitude,
      location_source: locationSource || 'manual_pin',
      updated_at: new Date().toISOString(),
    })
    .eq('id', deliveryId)

  if (error) return { error: error.message }
  return { success: true }
}

// ── Update Delivery Sequence (reorder within region) ──
export async function updateDeliverySequence(updates: { deliveryIds: string[]; sequence: number }[]) {
  'use server'
  const supabase = await createClient()

  for (const { deliveryIds, sequence } of updates) {
    await supabase
      .from('deliveries')
      .update({ delivery_sequence: sequence })
      .in('id', deliveryIds)
  }

  revalidatePath('/dashboard/deliveries')
  revalidatePath('/dashboard/riders')
  revalidatePath('/dashboard/contractors')
  revalidatePath('/dashboard/contractors/deliveries')
  return { success: true }
}

// ── Generate reply tokens for batch messaging ──
export async function generateReplyTokens(deliveryIds: string[]): Promise<{ tokens: Record<string, string>; error?: string }> {
  'use server'
  const supabase = await createClient()
  const tokens: Record<string, string> = {}
  const now = new Date().toISOString()

  for (const id of deliveryIds) {
    // Check if token already exists and is still fresh (within 7 days)
    const { data: existing } = await supabase
      .from('deliveries')
      .select('reply_token, reply_token_created_at')
      .eq('id', id)
      .single()

    if (existing?.reply_token) {
      const created = existing.reply_token_created_at ? new Date(existing.reply_token_created_at) : null
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      if (created && created > sevenDaysAgo) {
        tokens[id] = existing.reply_token
        continue
      }
    }

    // Generate a short token: 8 char alphanumeric
    const token = Array.from(crypto.getRandomValues(new Uint8Array(6)))
      .map(b => b.toString(36).padStart(2, '0'))
      .join('')
      .slice(0, 8)

    const { error } = await supabase
      .from('deliveries')
      .update({ reply_token: token, reply_token_created_at: now })
      .eq('id', id)

    if (!error) {
      tokens[id] = token
    }
  }

  return { tokens }
}

// ── Anonymous Supabase client for public pages (no cookies needed) ──
function createAnonClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}

  // ── Get delivery by reply token (public, no auth needed) ──
  export async function getDeliveryByToken(token: string) {
  'use server'
  const supabase = createAnonClient()
  const { data, error } = await supabase
    .from('deliveries')
    .select('id, customer_name, locality, products, qty, amount, status, client_response, delivery_notes, contact_1, reply_token, latitude, longitude')
    .eq('reply_token', token)
    .single()

  if (error || !data) return { error: 'Delivery not found or link expired.' }

  // Get company settings for invoice
  const { data: company } = await supabase
    .from('company_settings')
    .select('*')
    .limit(1)
    .single()

  // Get region center by geocoding the locality name via Mapbox
  let regionCenter: { lat: number; lng: number } | null = null
  if (data.locality) {
    const mapboxToken = process.env.MAPBOX_TOKEN
    if (mapboxToken) {
      try {
        const query = encodeURIComponent(`${data.locality}, Mauritius`)
        const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${mapboxToken}&limit=1&country=MU`)
        const geo = await res.json()
        if (geo.features && geo.features.length > 0) {
          const [lng, lat] = geo.features[0].center
          regionCenter = { lat, lng }
        }
      } catch {
        // Geocoding failed - leave null
      }
    }
  }

  return { delivery: data, company, regionCenter }
}

// ── Submit client reply via token (public, no auth needed) ──
  export async function submitClientReply(
    token: string,
    response: string,
    locationUrl?: string,
    rawCoords?: { lat: number; lng: number },
    locationSource?: 'gps' | 'pin' | 'manual',
    regionCenter?: { lat: number; lng: number } | null
  ) {
  'use server'
  const supabase = createAnonClient()

  // Build the full response: text + optional location
  const parts: string[] = []
  if (response.trim()) parts.push(response.trim())
  if (locationUrl?.trim()) parts.push(locationUrl.trim())
  const fullResponse = parts.join('\n')

  if (!fullResponse) return { error: 'Please enter a reply or share your location.' }

  // Save lat/lng so the pin appears on the map immediately
  const updateData: Record<string, unknown> = {
    client_response: fullResponse,
    updated_at: new Date().toISOString()
  }

  // Determine final coordinates
  let finalLat: number | null = null
  let finalLng: number | null = null

  if (rawCoords) {
    finalLat = rawCoords.lat
    finalLng = rawCoords.lng
  } else if (locationUrl?.trim()) {
    const coords = extractCoordsFromLocationUrl(locationUrl.trim())
    if (coords) {
      finalLat = coords.lat
      finalLng = coords.lng
    }
  }

  if (finalLat !== null && finalLng !== null) {
    updateData.latitude = finalLat
    updateData.longitude = finalLng
    updateData.client_lat = finalLat
    updateData.client_lng = finalLng
    updateData.location_source = locationSource || 'gps'

    // Check if location is outside the delivery region (>5km from region center)
    if (regionCenter) {
      const dist = haversineDistance(finalLat, finalLng, regionCenter.lat, regionCenter.lng)
      updateData.location_flagged = dist > 5000 // 5km threshold
    }
  }

  const { error } = await supabase
    .from('deliveries')
    .update(updateData)
    .eq('reply_token', token)

  if (error) return { error: error.message }
  return { success: true, flagged: !!updateData.location_flagged }
}

/** Update the juice_policy setting for a rider (contractor can set this) */
export async function updateRiderJuicePolicy(riderId: string, policy: 'rider' | 'contractor') {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('riders')
    .update({ juice_policy: policy, updated_at: new Date().toISOString() })
    .eq('id', riderId)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/contractors/riders')
  revalidatePath('/dashboard/contractors/collections')
  return { success: true }
}

/** Upload payment proof image and return the public URL */
export async function uploadPaymentProof(formData: FormData): Promise<{ url?: string; error?: string }> {
  const supabase = await createClient()
  const file = formData.get('file') as File | null
  if (!file) return { error: 'No file provided' }

  const timestamp = Date.now()
  const ext = file.name.split('.').pop() || 'jpg'
  const filePath = `proofs/${timestamp}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  const { error } = await supabase.storage
    .from('payment-proofs')
    .upload(filePath, file, { contentType: file.type, upsert: false })

  if (error) return { error: error.message }

  const { data: urlData } = supabase.storage
    .from('payment-proofs')
    .getPublicUrl(filePath)

  return { url: urlData.publicUrl }
}

/** Haversine distance between two lat/lng points in meters */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Extract lat/lng from a Google Maps URL */
function extractCoordsFromLocationUrl(url: string): { lat: number; lng: number } | null {
  // ?q=LAT,LNG
  const qMatch = url.match(/[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/)
  if (qMatch) return { lat: parseFloat(qMatch[1]), lng: parseFloat(qMatch[2]) }
  // @LAT,LNG
  const atMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)/)
  if (atMatch) return { lat: parseFloat(atMatch[1]), lng: parseFloat(atMatch[2]) }
  // /LAT,LNG
  const dirMatch = url.match(/\/(-?\d+\.?\d*),(-?\d+\.?\d*)/)
  if (dirMatch) return { lat: parseFloat(dirMatch[1]), lng: parseFloat(dirMatch[2]) }
  return null
}
