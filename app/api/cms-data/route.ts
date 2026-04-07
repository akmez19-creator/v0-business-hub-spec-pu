import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET() {
  try {
    const adminDb = createAdminClient()
    
    // Fetch active products
    const { data: products, error: productsError } = await adminDb
      .from('products')
      .select('name')
      .eq('is_active', true)
      .order('name')
    
    if (productsError) {
      console.error('[v0] Products fetch error:', productsError)
    }
    
    // Fetch unique regions from deliveries
    const { data: regions, error: regionsError } = await adminDb
      .from('deliveries')
      .select('locality')
      .not('locality', 'is', null)
    
    if (regionsError) {
      console.error('[v0] Regions fetch error:', regionsError)
    }
    
    // Get unique region names
    const uniqueRegions = [...new Set((regions || []).map(r => r.locality).filter(Boolean))].sort()
    
    return NextResponse.json({
      products: products || [],
      regions: uniqueRegions
    })
  } catch (error) {
    console.error('[v0] CMS data API error:', error)
    return NextResponse.json({ products: [], regions: [] }, { status: 500 })
  }
}
