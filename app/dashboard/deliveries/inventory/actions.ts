'use server'

import { revalidatePath } from 'next/cache'
import { requireBuyer } from '@/lib/local-purchasing/auth'
import { createInventoryProductRecord } from '@/lib/products/pricing-server'
import { PRODUCT_PRICING_COLUMNS, type NewInventoryProductInput } from '@/lib/products/pricing'
import type { Product } from '@/lib/types'

export async function createInventoryProductAction(input: NewInventoryProductInput): Promise<Product> {
  const { supabase, db } = await requireBuyer()
  const result = await createInventoryProductRecord(supabase, { ...input, unitCostNet: null })
  if (!result.created && !result.replayed) {
    throw new Error('This product already exists in Inventory. Its prices and variants were not changed. Close Add Product and edit the existing product instead.')
  }
  const { data, error } = await db.from('products')
    .select(`${PRODUCT_PRICING_COLUMNS},sku,description,is_active,created_at,remarks,sold_out,last_counted_at,shelf_code,zone,cost_price,cost_price_at`)
    .eq('id', result.productId).single()
  if (error || !data) throw new Error('The product was saved, but could not be read back. Retry without changing the form; it will not create another product.')
  revalidatePath('/dashboard/deliveries/inventory')
  revalidatePath('/dashboard/purchasing/local', 'layout')
  return data as Product
}
