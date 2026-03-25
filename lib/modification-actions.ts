'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { notify } from '@/lib/notifications'
import { syncContractorStock, getContractorIdFromDelivery } from '@/lib/stock-actions'

// ── Get rider's stock from contractor_daily_stock + delivery context ──
export async function getAvailableProducts(deliveryId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated', stockProducts: [] }

  const admin = createAdminClient()

  // Get the target delivery
  const { data: target } = await admin
    .from('deliveries')
    .select('id, locality, rider_id, delivery_date, contractor_id, products')
    .eq('id', deliveryId)
    .single()

  if (!target) return { error: 'Delivery not found', stockProducts: [] }

  // Get contractor_id (from delivery or lookup)
  let contractorId = target.contractor_id
  if (!contractorId && target.rider_id) {
    contractorId = await getContractorIdFromDelivery(deliveryId)
  }

  // 1. Get VALIDATED stock from contractor_daily_stock (the real stock source)
  const { data: stockRows } = contractorId
    ? await admin
        .from('contractor_daily_stock')
        .select('product, received_qty, delivered_qty, postponed_qty, returning_qty')
        .eq('contractor_id', contractorId)
        .eq('stock_date', target.delivery_date)
        .eq('is_validated', true)
    : { data: null }

  // 2. Get product prices from products table
  const { data: productPrices } = await admin
    .from('products')
    .select('name, price')

  const priceMap: Record<string, number> = {}
  for (const p of productPrices || []) {
    priceMap[p.name] = Number(p.price || 0)
  }

  // 3. Get ALL deliveries for this rider today (for context: who has what)
  const { data: allDeliveries } = await admin
    .from('deliveries')
    .select('id, customer_name, products, qty, amount, status, locality')
    .eq('rider_id', target.rider_id)
    .eq('delivery_date', target.delivery_date)
    .neq('id', deliveryId)

  // Build stock map from contractor_daily_stock
  const stockMap: Record<string, {
    productName: string
    unitPrice: number
    totalReceived: number
    availableQty: number       // received - delivered - postponed - returning
    freeQty: number            // from NWD/CMS deliveries — safe to take
    activeClientCount: number  // how many active clients have this product
    sources: {
      deliveryId: string
      customerName: string
      status: string
      locality: string | null
      qty: number
      unitPrice: number
      isFree: boolean          // true = NWD/CMS, false = active client
    }[]
  }> = {}

  // Seed from validated stock (shows all products the rider should have)
  for (const s of stockRows || []) {
    const available = (s.received_qty || 0) - (s.delivered_qty || 0) - (s.postponed_qty || 0) - (s.returning_qty || 0)
    if (available <= 0) continue
    stockMap[s.product] = {
      productName: s.product,
      unitPrice: priceMap[s.product] || 0,
      totalReceived: s.received_qty || 0,
      availableQty: available,
      freeQty: 0,
      activeClientCount: 0,
      sources: [],
    }
  }

  // Enrich with delivery-level details (who has each product)
  for (const d of allDeliveries || []) {
    if (!d.products) continue
    const qty = Number(d.qty || 0)
    const isFailed = ['nwd', 'cms'].includes(d.status)
    const isDelivered = d.status === 'delivered'

    // Skip delivered deliveries and deliveries with 0 qty (already fully taken)
    if (isDelivered) continue
    if (qty <= 0) continue

    const name = d.products.trim()
    const unitPrice = Math.round((Number(d.amount || 0) / Math.max(qty, 1)) * 100) / 100

    // If product exists in stock map, add source; otherwise create entry from delivery data
    if (!stockMap[name]) {
      stockMap[name] = {
        productName: name,
        unitPrice: priceMap[name] || unitPrice,
        totalReceived: 0,
        availableQty: isFailed ? qty : 0,
        freeQty: 0,
        activeClientCount: 0,
        sources: [],
      }
    }

    const entry = stockMap[name]
    if (isFailed) {
      entry.freeQty += qty
    } else {
      entry.activeClientCount += 1
    }

    entry.sources.push({
      deliveryId: d.id,
      customerName: d.customer_name,
      status: d.status,
      locality: d.locality,
      qty,
      unitPrice: priceMap[name] || unitPrice,
      isFree: isFailed,
    })
  }

  // Filter out products with no sources (nothing to take from)
  // and recalculate availableQty from actual sources
  for (const key of Object.keys(stockMap)) {
    const p = stockMap[key]
    // Actual takeable qty = sum of source quantities
    const sourceTotal = p.sources.reduce((sum, s) => sum + s.qty, 0)
    // If stock-level available but no sources to take from, remove
    if (p.sources.length === 0 && p.availableQty <= 0) {
      delete stockMap[key]
    }
    // Cap availableQty to actual source total if sources exist
    if (p.sources.length > 0 && sourceTotal < p.availableQty) {
      p.availableQty = sourceTotal
    }
  }

  // Sort: products with free stock first, then available stock, then by name
  const stockProducts = Object.values(stockMap).sort((a, b) => {
    if (a.freeQty > 0 && b.freeQty === 0) return -1
    if (a.freeQty === 0 && b.freeQty > 0) return 1
    if (a.availableQty > 0 && b.availableQty === 0) return -1
    if (a.availableQty === 0 && b.availableQty > 0) return 1
    return a.productName.localeCompare(b.productName)
  })

  return { stockProducts, targetLocality: target.locality }
}

// ── Get modification history for a delivery ──
export async function getModificationHistory(deliveryId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated', modifications: [] }

  const { data, error } = await supabase
    .from('order_modifications')
    .select(`
      id, product_name, qty, unit_price, total_price, reason, notes, status,
      created_at, reviewed_at,
      target_delivery:target_delivery_id(id, customer_name),
      source_delivery:source_delivery_id(id, customer_name, status)
    `)
    .eq('target_delivery_id', deliveryId)
    .order('created_at', { ascending: false })

  if (error) return { error: error.message, modifications: [] }
  return { modifications: data || [] }
}

// ── Modify an order (add product from available stock / manual entry) ──
export async function modifyOrder(params: {
  targetDeliveryId: string
  sourceDeliveryId?: string | null
  productName: string
  qty: number
  unitPrice: number
  reason: 'client_request' | 'nwd_available' | 'cms_available' | 'stock_available' | 'active_transfer'
  notes?: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { targetDeliveryId, sourceDeliveryId, productName, qty, unitPrice, reason, notes } = params
  const totalPrice = Math.round(qty * unitPrice * 100) / 100

  // Use admin client for all DB operations (rider profiles may not have full RLS access to deliveries)
  const admin = createAdminClient()

  // Get the target delivery
  const { data: target } = await admin
    .from('deliveries')
    .select('id, customer_name, products, qty, amount, rider_id, contractor_id, delivery_date, is_modified, modification_count, original_amount')
    .eq('id', targetDeliveryId)
    .single()

  if (!target) return { error: 'Target delivery not found' }

  // Determine rider_id and contractor_id
  let riderId = target.rider_id
  let contractorId = target.contractor_id

  if (!contractorId && riderId) {
    contractorId = await getContractorIdFromDelivery(targetDeliveryId)
  }

  // Get the user's role to determine approval status
  const { data: profile } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const { data: modification, error: modError } = await admin
    .from('order_modifications')
    .insert({
      target_delivery_id: targetDeliveryId,
      source_delivery_id: sourceDeliveryId || null,
      modified_by: user.id,
      rider_id: riderId,
      contractor_id: contractorId,
      product_name: productName,
      qty,
      unit_price: unitPrice,
      total_price: totalPrice,
      reason,
      notes: notes || null,
      delivery_date: target.delivery_date,
      status: profile?.role === 'rider' ? 'pending' : 'approved',
    })
    .select()
    .single()

  if (modError) return { error: modError.message }

  // Update the target delivery
  const currentAmount = Number(target.amount || 0)
  const originalAmount = currentAmount // save before modifying
  const newAmount = currentAmount + totalPrice
  const currentQty = Number(target.qty || 1)
  const newQty = currentQty + qty
  
  // Parse existing products and aggregate same product quantities
  const currentProducts = target.products || ''
  const productMap = new Map<string, number>()
  
  // Parse existing products (format: "2x Product A, 1x Product B")
  if (currentProducts) {
    const items = currentProducts.split(',').map(s => s.trim())
    for (const item of items) {
      const match = item.match(/^(\d+)\s*x\s*(.+)$/i)
      if (match) {
        const itemQty = parseInt(match[1], 10)
        const itemName = match[2].trim()
        productMap.set(itemName, (productMap.get(itemName) || 0) + itemQty)
      } else if (item) {
        // Handle "Product Name" without qty prefix (assume 1)
        productMap.set(item, (productMap.get(item) || 0) + 1)
      }
    }
  }
  
  // Add the new product
  productMap.set(productName, (productMap.get(productName) || 0) + qty)
  
  // Build aggregated products string
  const newProducts = Array.from(productMap.entries())
    .map(([name, q]) => `${q}x ${name}`)
    .join(', ')

  const { error: updateError } = await admin
    .from('deliveries')
    .update({
      products: newProducts,
      qty: newQty,
      amount: newAmount,
      ...(target.is_modified ? {} : { original_amount: originalAmount }),
      is_modified: true,
      modification_count: (target.modification_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', targetDeliveryId)

  if (updateError) return { error: updateError.message }

  // Track affected client info for UI feedback
  let affectedClient: { deliveryId: string; name: string; markedNwd: boolean; remainingQty: number } | null = null

  // If source delivery exists, reduce its qty/amount (product was taken from it)
  if (sourceDeliveryId) {
    const { data: source } = await admin
      .from('deliveries')
      .select('id, customer_name, qty, amount, products, modification_count, status, notes')
      .eq('id', sourceDeliveryId)
      .single()

    if (source) {
      const srcQty = Math.max(Number(source.qty || 1) - qty, 0)
      const srcAmount = Math.max(Number(source.amount || 0) - totalPrice, 0)
      const isActiveSource = ['pending', 'assigned', 'picked_up'].includes(source.status)
      const allProductsTaken = srcQty === 0

      // If active client lost ALL their products → auto-mark as NWD
      // If they still have items → shortage note + continue delivery
      const shortageNote = isActiveSource
        ? allProductsTaken
          ? `${source.notes ? source.notes + ' | ' : ''}NWD: All products taken for ${target.customer_name}`
          : `${source.notes ? source.notes + ' | ' : ''}SHORTAGE: ${qty}x ${productName} taken for ${target.customer_name}`
        : source.notes

      await admin
        .from('deliveries')
        .update({
          qty: srcQty,
          amount: srcAmount,
          is_modified: true,
          modification_count: (source.modification_count || 0) + 1,
          // Auto-NWD if active client lost everything
          ...(isActiveSource && allProductsTaken ? { status: 'nwd', notes: shortageNote } : {}),
          ...(isActiveSource && !allProductsTaken ? { notes: shortageNote } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', sourceDeliveryId)

      // Track for UI
      if (isActiveSource) {
        affectedClient = { deliveryId: sourceDeliveryId, name: source.customer_name, markedNwd: allProductsTaken, remainingQty: srcQty }
      }

      // Notify contractor about impact on source client
      if (isActiveSource && contractorId) {
        await notify({
          userId: contractorId,
          type: allProductsTaken ? 'error' : 'warning',
          title: allProductsTaken ? 'Delivery Cancelled (NWD)' : 'Delivery Shortage',
          message: allProductsTaken
            ? `${source.customer_name} marked NWD — all products given to ${target.customer_name}. Re-delivery needed.`
            : `${source.customer_name} lost ${qty}x ${productName} (given to ${target.customer_name}). Partial delivery continues.`,
          link: '/dashboard/contractors/my-deliveries',
        })
      }
    }
  }

  // Sync contractor stock so availableQty reflects the modification
  if (contractorId) {
    try { await syncContractorStock(contractorId) } catch {}
  }

  // Notify contractor about the modification
  if (contractorId && contractorId !== user.id) {
    await notify({
      userId: contractorId,
      type: 'info',
      title: 'Order Modified',
      message: `${target.customer_name}: +${qty}x ${productName} (Rs ${totalPrice}). Reason: ${reason.replace(/_/g, ' ')}`,
      link: '/dashboard/contractors/my-deliveries',
    })
  }

  // Sync contractor stock
  if (contractorId) {
    try { await syncContractorStock(contractorId) } catch {}
  }

  revalidatePath('/dashboard/deliveries')
  revalidatePath('/dashboard/riders')
  revalidatePath('/dashboard/contractors')
  revalidatePath('/dashboard/contractors/map')
  revalidatePath('/dashboard/contractors/my-deliveries')
  revalidatePath('/dashboard/contractors/stock')
  revalidatePath('/dashboard/contractors/collections')

  return {
    success: true,
    modification,
    newAmount,
    newQty,
    newProducts,
    affectedClient,
  }
}

// ── Review modification (approve/reject by contractor/admin) ──
export async function reviewModification(modificationId: string, action: 'approved' | 'rejected') {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: mod } = await supabase
    .from('order_modifications')
    .select('*, target_delivery:target_delivery_id(customer_name)')
    .eq('id', modificationId)
    .single()

  if (!mod) return { error: 'Modification not found' }

  // Update modification status
  const { error } = await supabase
    .from('order_modifications')
    .update({
      status: action,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', modificationId)

  if (error) return { error: error.message }

  // If rejected, reverse the delivery changes
  if (action === 'rejected') {
    const { data: target } = await supabase
      .from('deliveries')
      .select('amount, qty, modification_count')
      .eq('id', mod.target_delivery_id)
      .single()

    if (target) {
      const revertAmount = Math.max(Number(target.amount || 0) - Number(mod.total_price), 0)
      const revertQty = Math.max(Number(target.qty || 1) - Number(mod.qty), 0)
      const modCount = Math.max((target.modification_count || 1) - 1, 0)

      await supabase
        .from('deliveries')
        .update({
          amount: revertAmount,
          qty: revertQty,
          modification_count: modCount,
          is_modified: modCount > 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', mod.target_delivery_id)
    }

    // If there was a source delivery, restore its qty/amount
    if (mod.source_delivery_id) {
      const { data: source } = await supabase
        .from('deliveries')
        .select('qty, amount')
        .eq('id', mod.source_delivery_id)
        .single()

      if (source) {
        await supabase
          .from('deliveries')
          .update({
            qty: Number(source.qty || 0) + Number(mod.qty),
            amount: Number(source.amount || 0) + Number(mod.total_price),
            updated_at: new Date().toISOString(),
          })
          .eq('id', mod.source_delivery_id)
      }
    }
  }

  // Notify rider about the review
  if (mod.rider_id) {
    await notify({
      userId: mod.rider_id,
      type: 'info',
      title: `Order Modification ${action === 'approved' ? 'Approved' : 'Rejected'}`,
      message: `${mod.target_delivery?.customer_name}: ${mod.qty}x ${mod.product_name}`,
      link: '/dashboard/riders/my-deliveries',
    })
  }

  revalidatePath('/dashboard/deliveries')
  revalidatePath('/dashboard/riders')
  revalidatePath('/dashboard/contractors')
  revalidatePath('/dashboard/contractors/my-deliveries')

  return { success: true }
}

// ── Reduce or remove item from current order ──
export async function reduceOrderItem(params: {
  deliveryId: string
  productName: string
  reduceBy: number  // How many to reduce (if reduceBy >= current qty, removes entirely)
  reason?: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { deliveryId, productName, reduceBy, reason } = params
  const admin = createAdminClient()

  // Get the delivery
  const { data: delivery } = await admin
    .from('deliveries')
    .select('id, customer_name, products, qty, amount, rider_id, contractor_id, delivery_date, is_modified, modification_count, original_amount')
    .eq('id', deliveryId)
    .single()

  if (!delivery) return { error: 'Delivery not found' }

  // Parse current products
  const productMap = new Map<string, { qty: number; unitPrice: number }>()
  const totalAmount = Number(delivery.amount || 0)
  const totalQty = Number(delivery.qty || 1)
  const avgUnitPrice = totalQty > 0 ? totalAmount / totalQty : 0

  if (delivery.products) {
    const items = delivery.products.split(',').map((s: string) => s.trim())
    for (const item of items) {
      const match = item.match(/^(\d+)\s*x\s*(.+)$/i)
      if (match) {
        const itemQty = parseInt(match[1], 10)
        const itemName = match[2].trim()
        productMap.set(itemName, { qty: itemQty, unitPrice: avgUnitPrice })
      } else if (item) {
        productMap.set(item, { qty: 1, unitPrice: avgUnitPrice })
      }
    }
  }

  // Find the product to reduce
  const existing = productMap.get(productName)
  if (!existing) return { error: `Product "${productName}" not found in order` }

  const actualReduce = Math.min(reduceBy, existing.qty)
  const newQtyForProduct = existing.qty - actualReduce

  if (newQtyForProduct <= 0) {
    // Remove entirely
    productMap.delete(productName)
  } else {
    productMap.set(productName, { ...existing, qty: newQtyForProduct })
  }

  // Calculate new totals
  let newTotalQty = 0
  for (const [, v] of productMap) {
    newTotalQty += v.qty
  }
  const priceReduction = actualReduce * avgUnitPrice
  const newAmount = Math.max(0, Math.round((totalAmount - priceReduction) * 100) / 100)

  // Build new products string
  const newProducts = productMap.size > 0
    ? Array.from(productMap.entries()).map(([name, v]) => `${v.qty}x ${name}`).join(', ')
    : ''

  // If no products left, we should handle this case (maybe mark as CMS?)
  if (productMap.size === 0) {
    return { error: 'Cannot remove all products. Use CMS to cancel the delivery.' }
  }

  // Store original amount if first modification
  const originalAmount = delivery.is_modified ? delivery.original_amount : totalAmount

  // Update delivery
  const { error: updateError } = await admin
    .from('deliveries')
    .update({
      products: newProducts,
      qty: newTotalQty,
      amount: newAmount,
      original_amount: originalAmount,
      is_modified: true,
      modification_count: (delivery.modification_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', deliveryId)

  if (updateError) return { error: updateError.message }

  // Log the modification
  const contractorId = delivery.contractor_id || await getContractorIdFromDelivery(deliveryId)
  
  await admin
    .from('order_modifications')
    .insert({
      target_delivery_id: deliveryId,
      source_delivery_id: null,
      modified_by: user.id,
      rider_id: delivery.rider_id,
      contractor_id: contractorId,
      product_name: productName,
      qty: -actualReduce, // Negative to indicate reduction
      unit_price: avgUnitPrice,
      total_price: -priceReduction,
      reason: 'client_reduction',
      notes: reason || `Reduced ${actualReduce}x ${productName}`,
      delivery_date: delivery.delivery_date,
      status: 'approved', // Auto-approved since it's client choice
    })

  // Notify contractor
  if (contractorId) {
    await notify({
      userId: contractorId,
      type: 'info',
      title: 'Order Reduced',
      message: `${delivery.customer_name}: -${actualReduce}x ${productName} (Rs -${Math.round(priceReduction)})`,
      link: '/dashboard/contractors/my-deliveries',
    })

    // Sync stock
    try { await syncContractorStock(contractorId) } catch {}
  }

  revalidatePath('/dashboard/deliveries')
  revalidatePath('/dashboard/riders')
  revalidatePath('/dashboard/contractors')
  revalidatePath('/dashboard/contractors/map')
  revalidatePath('/dashboard/contractors/my-deliveries')

  return {
    success: true,
    newAmount,
    newQty: newTotalQty,
    newProducts,
    reducedQty: actualReduce,
  }
}

// ── Get all pending modifications for contractor/admin ──
export async function getPendingModifications(contractorId?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated', modifications: [] }

  let query = supabase
    .from('order_modifications')
    .select(`
      id, product_name, qty, unit_price, total_price, reason, notes, status, created_at,
      target_delivery:target_delivery_id(id, customer_name, locality, amount),
      source_delivery:source_delivery_id(id, customer_name, status),
      rider:rider_id(id, full_name:profiles(full_name))
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  if (contractorId) {
    query = query.eq('contractor_id', contractorId)
  }

  const { data, error } = await query

  if (error) return { error: error.message, modifications: [] }
  return { modifications: data || [] }
}
