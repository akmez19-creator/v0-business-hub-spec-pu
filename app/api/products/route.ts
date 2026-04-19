import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const adminDb = createAdminClient()
    
    // Fetch all active products with id, name, and price
    const { data: products, error } = await adminDb
      .from('products')
      .select('id, name, price, quantity')
      .eq('is_active', true)
      .order('name')
    
    if (error) {
      console.error('[v0] Products fetch error:', error)
      return NextResponse.json([], { status: 500 })
    }
    
    return NextResponse.json(products || [])
  } catch (error) {
    console.error('[v0] Products API error:', error)
    return NextResponse.json([], { status: 500 })
  }
}
