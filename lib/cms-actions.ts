'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function checkAdminOrManagerAccess() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { error: 'Not authenticated', authorized: false }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Not authorized', authorized: false }
  }

  return { error: null, authorized: true, userId: user.id }
}

// Reset a CMS delivery back to assigned status
export async function resetCmsDelivery(deliveryId: string, newRiderId?: string) {
  const { error: authError, authorized } = await checkAdminOrManagerAccess()
  if (!authorized) return { error: authError }

  const adminDb = createAdminClient()
  
  // Get current delivery
  const { data: delivery, error: fetchError } = await adminDb
    .from('deliveries')
    .select('*')
    .eq('id', deliveryId)
    .single()
  
  if (fetchError || !delivery) {
    return { error: 'Delivery not found' }
  }
  
  // Update delivery status to assigned
  const updateData: Record<string, unknown> = {
    status: 'assigned',
    delivery_notes: null,
    status_updated_at: new Date().toISOString(),
  }
  
  // Optionally reassign rider
  if (newRiderId) {
    updateData.rider_id = newRiderId
  }
  
  const { error: updateError } = await adminDb
    .from('deliveries')
    .update(updateData)
    .eq('id', deliveryId)
  
  if (updateError) {
    return { error: 'Failed to reset delivery: ' + updateError.message }
  }
  
  revalidatePath('/dashboard/admin/cms')
  revalidatePath('/dashboard/deliveries')
  return { success: true }
}

// Update CMS delivery details
export async function updateCmsDelivery(
  deliveryId: string, 
  data: {
    locality?: string
    qty?: number
    amount?: number
    products?: string
    rider_id?: string | null
  }
) {
  const { error: authError, authorized } = await checkAdminOrManagerAccess()
  if (!authorized) return { error: authError }

  const adminDb = createAdminClient()
  
  const updateData: Record<string, unknown> = {}
  
  if (data.locality !== undefined) updateData.locality = data.locality
  if (data.qty !== undefined) updateData.qty = data.qty
  if (data.amount !== undefined) updateData.amount = data.amount
  if (data.products !== undefined) updateData.products = data.products
  if (data.rider_id !== undefined) updateData.rider_id = data.rider_id
  
  const { error: updateError } = await adminDb
    .from('deliveries')
    .update(updateData)
    .eq('id', deliveryId)
  
  if (updateError) {
    return { error: 'Failed to update delivery: ' + updateError.message }
  }
  
  revalidatePath('/dashboard/admin/cms')
  revalidatePath('/dashboard/deliveries')
  return { success: true }
}

// Add a new product line for the same customer (creates new delivery entry)
export async function addProductToCmsDelivery(
  sourceDeliveryId: string,
  data: {
    customer_name: string
    contact_1: string
    contact_2?: string
    locality: string
    delivery_date: string
    rider_id?: string
    product_name: string
    qty: number
    price: number
  }
) {
  const { error: authError, authorized, userId } = await checkAdminOrManagerAccess()
  if (!authorized) return { error: authError }

  const adminDb = createAdminClient()
  
  // Get source delivery to copy relevant fields
  const { data: sourceDelivery, error: fetchError } = await adminDb
    .from('deliveries')
    .select('*')
    .eq('id', sourceDeliveryId)
    .single()
  
  if (fetchError || !sourceDelivery) {
    return { error: 'Source delivery not found' }
  }
  
  // Create new delivery entry for the additional product
  const { data: newDelivery, error: insertError } = await adminDb
    .from('deliveries')
    .insert({
      customer_name: data.customer_name,
      contact_1: data.contact_1,
      contact_2: data.contact_2 || null,
      locality: data.locality,
      delivery_date: data.delivery_date,
      products: data.product_name,
      qty: data.qty,
      amount: data.price,
      status: 'cms', // Keep same CMS status
      delivery_notes: sourceDelivery.delivery_notes, // Copy CMS reason
      rider_id: data.rider_id || sourceDelivery.rider_id,
      contractor_id: sourceDelivery.contractor_id,
      sales_type: sourceDelivery.sales_type,
      medium: sourceDelivery.medium,
      created_by: userId,
      created_at: new Date().toISOString(),
      status_updated_at: new Date().toISOString(),
    })
    .select()
    .single()
  
  if (insertError) {
    return { error: 'Failed to add product: ' + insertError.message }
  }
  
  revalidatePath('/dashboard/admin/cms')
  revalidatePath('/dashboard/deliveries')
  return { success: true, delivery: newDelivery }
}

// Mark CMS delivery as reviewed by admin (does NOT change delivery status)
// This is for admin tracking purposes - to know which CMS entries have been handled
export async function markCmsAsReviewed(deliveryId: string, reviewed: boolean = true) {
  const { error: authError, authorized } = await checkAdminOrManagerAccess()
  if (!authorized) return { error: authError }

  const adminDb = createAdminClient()
  
  // First get the current delivery to check the notes
  const { data: delivery, error: fetchError } = await adminDb
    .from('deliveries')
    .select('delivery_notes')
    .eq('id', deliveryId)
    .single()
  
  if (fetchError) {
    return { error: 'Failed to fetch delivery: ' + fetchError.message }
  }
  
  // Add or remove the [REVIEWED] prefix from delivery_notes
  let updatedNotes = delivery?.delivery_notes || ''
  const reviewedPrefix = '[REVIEWED] '
  
  if (reviewed) {
    // Add prefix if not already there
    if (!updatedNotes.startsWith(reviewedPrefix)) {
      updatedNotes = reviewedPrefix + updatedNotes
    }
  } else {
    // Remove prefix if present
    if (updatedNotes.startsWith(reviewedPrefix)) {
      updatedNotes = updatedNotes.replace(reviewedPrefix, '')
    }
  }
  
  const { error: updateError } = await adminDb
    .from('deliveries')
    .update({
      delivery_notes: updatedNotes,
    })
    .eq('id', deliveryId)
  
  if (updateError) {
    return { error: 'Failed to mark as reviewed: ' + updateError.message }
  }
  
  revalidatePath('/dashboard/admin/cms')
  return { success: true }
}

// Delete/Cancel CMS delivery
export async function deleteCmsDelivery(deliveryId: string) {
  const { error: authError, authorized } = await checkAdminOrManagerAccess()
  if (!authorized) return { error: authError }

  const adminDb = createAdminClient()
  
  const { error: deleteError } = await adminDb
    .from('deliveries')
    .delete()
    .eq('id', deliveryId)
  
  if (deleteError) {
    return { error: 'Failed to delete delivery: ' + deleteError.message }
  }
  
  revalidatePath('/dashboard/admin/cms')
  revalidatePath('/dashboard/deliveries')
  return { success: true }
}

// Bulk reset multiple CMS deliveries
export async function bulkResetCmsDeliveries(deliveryIds: string[], newRiderId?: string) {
  const { error: authError, authorized } = await checkAdminOrManagerAccess()
  if (!authorized) return { error: authError }

  const adminDb = createAdminClient()
  
  const updateData: Record<string, unknown> = {
    status: 'assigned',
    delivery_notes: null,
    status_updated_at: new Date().toISOString(),
  }
  
  if (newRiderId) {
    updateData.rider_id = newRiderId
  }
  
  const { error: updateError } = await adminDb
    .from('deliveries')
    .update(updateData)
    .in('id', deliveryIds)
  
  if (updateError) {
    return { error: 'Failed to reset deliveries: ' + updateError.message }
  }
  
  revalidatePath('/dashboard/admin/cms')
  revalidatePath('/dashboard/deliveries')
  return { success: true, count: deliveryIds.length }
}
