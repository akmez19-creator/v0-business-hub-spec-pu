import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'

// CORS headers for Chrome extension
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// Handle preflight requests
export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

// Helper to get user from Authorization header token
async function getUserFromToken(request: NextRequest) {
  const authHeader = request.headers.get('Authorization')
  console.log('[Extension API] Auth header present:', !!authHeader)
  
  if (!authHeader?.startsWith('Bearer ')) {
    console.log('[Extension API] No Bearer token found')
    return null
  }
  
  const token = authHeader.replace('Bearer ', '')
  console.log('[Extension API] Token length:', token.length, 'starts with:', token.substring(0, 20))
  
  const supabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  
  const { data: { user }, error } = await supabase.auth.getUser(token)
  console.log('[Extension API] getUser result:', user?.id || 'no user', 'error:', error?.message || 'none')
  
  if (error || !user) {
    return null
  }
  
  return { user, supabase }
}

// GET - Fetch products and regions for extension
export async function GET(request: NextRequest) {
  try {
    // Try token auth first
    const tokenAuth = await getUserFromToken(request)
    
    let user = tokenAuth?.user
    let supabase = tokenAuth?.supabase
    
    // Fallback to cookie auth
    if (!user) {
      const cookieSupabase = await createClient()
      const { data: { user: cookieUser } } = await cookieSupabase.auth.getUser()
      user = cookieUser
      supabase = cookieSupabase as any
    }
    
    if (!user || !supabase) {
      return NextResponse.json({ 
        authenticated: false,
        products: [],
        regions: []
      }, { headers: corsHeaders })
    }
    
    // Get products with images, pricing, and variants
    const { data: products } = await supabase
      .from('products')
      .select('id, name, price, image_url, bundle_prices, is_b1g1, has_variants')
      .eq('is_active', true)
      .order('name', { ascending: true })
    
    // Get variants for products that have them
    const productsWithVariants = products?.filter(p => p.has_variants).map(p => p.id) || []
    let variantsMap: Record<string, any[]> = {}
    
    if (productsWithVariants.length > 0) {
      const { data: variants } = await supabase
        .from('product_variants')
        .select('id, product_id, attribute_name, attribute_value, quantity, price_override')
        .in('product_id', productsWithVariants)
        .eq('is_active', true)
        .order('attribute_name', { ascending: true })
      
      // Group variants by product_id
      (variants || []).forEach(v => {
        if (!variantsMap[v.product_id]) variantsMap[v.product_id] = []
        variantsMap[v.product_id].push(v)
      })
    }
    
    // Attach variants to products
    const productsWithVariantData = (products || []).map(p => ({
      ...p,
      variants: variantsMap[p.id] || []
    }))
    
    // Get localities (regions)
    const { data: localities } = await supabase
      .from('localities')
      .select('name')
      .eq('is_active', true)
      .order('name', { ascending: true })
    
    const regions = (localities || []).map(l => l.name)
    
    // Get worktime data for the user
    const today = new Date().toISOString().split('T')[0]
    const { data: todayShift } = await supabase
      .from('staff_shifts')
      .select('*')
      .eq('staff_id', user.id)
      .eq('staff_type', 'profile')
      .eq('shift_date', today)
      .single()
    
    // Get recent history (last 7 days)
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)
    
    const { data: history } = await supabase
      .from('staff_shifts')
      .select('shift_date, actual_clock_in, actual_clock_out, status')
      .eq('staff_id', user.id)
      .eq('staff_type', 'profile')
      .gte('shift_date', weekAgo.toISOString().split('T')[0])
      .order('shift_date', { ascending: false })
      .limit(7)
    
    const isClockedIn = todayShift?.status === 'in_progress' && todayShift?.actual_clock_in
    const clockInTime = todayShift?.actual_clock_in || null
    
    // Calculate today's hours
    let todayHours = 0
    if (todayShift?.actual_clock_in && todayShift?.actual_clock_out) {
      const start = new Date(todayShift.actual_clock_in)
      const end = new Date(todayShift.actual_clock_out)
      todayHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60)
    }
    
    // Format history
    const formattedHistory = (history || []).map(h => {
      let hours = '0.00'
      if (h.actual_clock_in && h.actual_clock_out) {
        const start = new Date(h.actual_clock_in)
        const end = new Date(h.actual_clock_out)
        hours = ((end.getTime() - start.getTime()) / (1000 * 60 * 60)).toFixed(2)
      }
      return {
        date: new Date(h.shift_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        hours,
        status: h.status
      }
    })
    
return NextResponse.json({
  authenticated: true,
  products: productsWithVariantData || [],
      regions,
      worktime: {
        isClockedIn,
        clockInTime,
        todayHours,
        history: formattedHistory
      }
    }, { headers: corsHeaders })
  } catch (error) {
    console.error('Extension API error:', error)
    return NextResponse.json({ 
      authenticated: false, 
      error: 'Failed to fetch data' 
    }, { 
      status: 500, 
      headers: corsHeaders 
    })
  }
}

// POST - Create a new order from extension
export async function POST(request: NextRequest) {
  try {
    // Try token auth first
    const tokenAuth = await getUserFromToken(request)
    
    let user = tokenAuth?.user
    let supabase = tokenAuth?.supabase
    
    // Fallback to cookie auth
    if (!user) {
      const cookieSupabase = await createClient()
      const { data: { user: cookieUser } } = await cookieSupabase.auth.getUser()
      user = cookieUser
      supabase = cookieSupabase as any
    }
    
    if (!user || !supabase) {
      return NextResponse.json({ 
        success: false, 
        error: 'Not authenticated. Please login to Akmez first.' 
      }, { 
        status: 401, 
        headers: corsHeaders 
      })
    }
    
    // Get user profile to verify they can create orders
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, name')
      .eq('id', user.id)
      .single()
    
    if (!profile || !['admin', 'manager', 'marketing_agent', 'marketing_back_office', 'marketing_front_office'].includes(profile.role)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Not authorized to create orders' 
      }, { 
        status: 403, 
        headers: corsHeaders 
      })
    }
    
    const body = await request.json()
    const { customerName, contact1, contact2, region, products, qty, amount, deliveryDate, notes } = body
    
    // Validate required fields
    if (!customerName?.trim()) {
      return NextResponse.json({ success: false, error: 'Customer name is required' }, { status: 400, headers: corsHeaders })
    }
    if (!contact1?.trim()) {
      return NextResponse.json({ success: false, error: 'Contact 1 is required' }, { status: 400, headers: corsHeaders })
    }
    if (!region?.trim()) {
      return NextResponse.json({ success: false, error: 'Region is required' }, { status: 400, headers: corsHeaders })
    }
    if (!products) {
      return NextResponse.json({ success: false, error: 'At least one product is required' }, { status: 400, headers: corsHeaders })
    }
    
    // Generate reply token
    const replyToken = uuidv4()
    
    // Insert delivery
    const { data: delivery, error } = await supabase.from('deliveries').insert({
      customer_name: customerName.trim(),
      contact_1: contact1.trim(),
      contact_2: contact2?.trim() || null,
      region: region.trim().split('/')[0].trim(),
      locality: region.trim().split('/')[0].trim(),
      products: products,
      qty: qty || 1,
      amount: amount || 0,
      notes: notes?.trim() || null,
      status: 'pending',
      entry_date: new Date().toISOString().split('T')[0],
      delivery_date: deliveryDate || new Date().toISOString().split('T')[0],
      reply_token: replyToken,
      reply_token_created_at: new Date().toISOString(),
      created_by: user.id,
      medium: 'Extension',
    }).select('id').single()
    
    if (error) {
      console.error('Insert error:', error)
      return NextResponse.json({ 
        success: false, 
        error: 'Failed to create order: ' + error.message 
      }, { 
        status: 500, 
        headers: corsHeaders 
      })
    }
    
    return NextResponse.json({
      success: true,
      message: 'Order created successfully!',
      orderId: delivery?.id,
      createdBy: profile.name
    }, { headers: corsHeaders })
  } catch (error) {
    console.error('Extension API error:', error)
    return NextResponse.json({ 
      success: false, 
      error: 'Server error' 
    }, { 
      status: 500, 
      headers: corsHeaders 
    })
  }
}
