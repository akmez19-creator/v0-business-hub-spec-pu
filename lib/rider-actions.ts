'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { syncContractorStock, getContractorIdFromDelivery } from '@/lib/stock-actions'

export async function updateDeliveryStatus(
  deliveryId: string,
  status: string,
  notes?: string
) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }

  // Verify the rider owns this delivery
  const { data: rider } = await supabase
    .from('riders')
    .select('id')
    .eq('profile_id', user.id)
    .single()

  if (!rider) {
    return { error: 'Rider not found' }
  }

  const { data: delivery } = await supabase
    .from('deliveries')
    .select('rider_id, status')
    .eq('id', deliveryId)
    .single()

  if (!delivery || delivery.rider_id !== rider.id) {
    return { error: 'Delivery not found or not assigned to you' }
  }

  // Build update data
  const updateData: any = {
    status,
    status_updated_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }

  // Add specific timestamps based on status
  if (status === 'picked_up') {
    updateData.picked_up_at = new Date().toISOString()
  } else if (status === 'delivered') {
    updateData.delivered_at = new Date().toISOString()
  }

  // Add notes for failed deliveries
  if (notes && (status === 'nwd' || status === 'cms')) {
    updateData.delivery_notes = notes
  }

  const { error } = await supabase
    .from('deliveries')
    .update(updateData)
    .eq('id', deliveryId)

  if (error) {
    console.error('Failed to update delivery status:', error)
    return { error: 'Failed to update delivery status' }
  }

  // If delivered, update stock and earnings (this would typically be handled by a database trigger)
  if (status === 'delivered') {
    // Update rider stock
    const today = new Date().toISOString().split('T')[0]
    
    const { data: existingStock } = await supabase
      .from('rider_stock')
      .select('*')
      .eq('rider_id', rider.id)
      .eq('stock_date', today)
      .single()

    if (existingStock) {
      await supabase
        .from('rider_stock')
        .update({
          delivered: (existingStock.delivered || 0) + 1,
          in_transit: Math.max(0, (existingStock.in_transit || 0) - 1),
          closing_stock: Math.max(0, (existingStock.closing_stock || 0) - 1),
          updated_at: new Date().toISOString()
        })
        .eq('id', existingStock.id)
    }
  }

  // Update stock for picked up
  if (status === 'picked_up') {
    const today = new Date().toISOString().split('T')[0]
    
    const { data: existingStock } = await supabase
      .from('rider_stock')
      .select('*')
      .eq('rider_id', rider.id)
      .eq('stock_date', today)
      .single()

    if (existingStock) {
      await supabase
        .from('rider_stock')
        .update({
          in_transit: (existingStock.in_transit || 0) + 1,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingStock.id)
    }
  }

  // Update stock for failed deliveries (returns)
  if (status === 'nwd' || status === 'cms') {
    const today = new Date().toISOString().split('T')[0]
    
    const { data: existingStock } = await supabase
      .from('rider_stock')
      .select('*')
      .eq('rider_id', rider.id)
      .eq('stock_date', today)
      .single()

    if (existingStock) {
      await supabase
        .from('rider_stock')
        .update({
          returns: (existingStock.returns || 0) + 1,
          in_transit: Math.max(0, (existingStock.in_transit || 0) - 1),
          updated_at: new Date().toISOString()
        })
        .eq('id', existingStock.id)
    }
  }

  revalidatePath('/dashboard/riders')
  revalidatePath('/dashboard/riders/deliveries')
  revalidatePath('/dashboard/riders/stock')
  revalidatePath('/dashboard/contractors')
  revalidatePath('/dashboard/contractors/deliveries')
  revalidatePath('/dashboard/contractors/stock')

  // Sync contractor stock on any delivery status change
  try {
    const contractorId = await getContractorIdFromDelivery(deliveryId)
    if (contractorId) {
      await syncContractorStock(contractorId)
    }
  } catch {
    // Don't block the status update if stock sync fails
  }
  
  return { success: true }
}
