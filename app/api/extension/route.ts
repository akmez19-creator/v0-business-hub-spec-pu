import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'

// CORS headers for Chrome extension
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

// Handle preflight requests
export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

// Helper to get user from Authorization header token
async function getUserFromToken(request: NextRequest) {
  const authHeader = request.headers.get('Authorization')
  const refreshToken = request.headers.get('X-Refresh-Token')
  
  if (!authHeader?.startsWith('Bearer ')) {
    return null
  }
  
  const accessToken = authHeader.replace('Bearer ', '')
  
  // Create admin client for database operations
  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  
  // Create anon client and set the session to validate the token
  const anonSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  
  // Set the session on the anon client - this validates the token
  const { data: sessionData, error: sessionError } = await anonSupabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken || ''
  })
  
  if (sessionError || !sessionData.user) {
    // Try direct getUser as fallback (works with service role)
    const { data: { user }, error } = await adminSupabase.auth.getUser(accessToken)
    if (error || !user) {
      return null
    }
    return { user, supabase: adminSupabase }
  }
  
  return { user: sessionData.user, supabase: adminSupabase }
}

// GET - Fetch products and regions for extension
export async function GET(request: NextRequest) {
  try {
    // Try token auth first
    const tokenAuth = await getUserFromToken(request)
    
    let user = tokenAuth?.user ?? null
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
      for (const v of variants || []) {
        if (!variantsMap[v.product_id]) variantsMap[v.product_id] = []
        variantsMap[v.product_id].push(v)
      }
    }
    
    // Attach variants to products
    const productsWithVariantData = (products || []).map(p => ({
      ...p,
      variants: variantsMap[p.id] || []
    }))
    
    // Get localities (regions) with their assigned contractor / default rider
    const { data: localities } = await supabase
      .from('localities')
      .select('name, contractor:contractors(name), rider:riders(name)')
      .eq('is_active', true)
      .order('name', { ascending: true })
    
    const regions = (localities || []).map(l => l.name)
    // Map: region name -> { contractor, rider } for delivery display in the widget
    const regionDelivery: Record<string, { contractor: string; rider: string | null }> = {}
    for (const l of (localities || []) as any[]) {
      if (l.contractor?.name) {
        regionDelivery[l.name] = {
          contractor: l.contractor.name,
          rider: l.rider?.name || null,
        }
      }
    }
    
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
    
    // Get the user's role (controls whether they can edit shared settings)
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    const role = profile?.role || null

    // Get shared, admin-configured extension settings (single row, id=1)
    const { data: settingsRow } = await supabase
      .from('extension_settings')
      .select('name_selectors, phone_selectors, adid_selectors, cutoff_time, page_mappings, delivery_day_scheme, holidays')
      .eq('id', 1)
      .single()
    const settings = {
      nameSelectors: settingsRow?.name_selectors || [],
      phoneSelectors: settingsRow?.phone_selectors || [],
      adidSelectors: settingsRow?.adid_selectors || [],
      cutoffTime: settingsRow?.cutoff_time || '20:00',
      pageMappings: settingsRow?.page_mappings || [],
      // Per-weekday delivery-date scheme (order weekday -> target weekday)
      deliveryDayScheme: settingsRow?.delivery_day_scheme || {},
      // Admin-managed non-delivery days (public holidays, moon-based, cyclone/rain closures)
      holidays: Array.isArray(settingsRow?.holidays) ? settingsRow.holidays : [],
    }

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
      regionDelivery,
      role,
      settings,
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
    
    let user = tokenAuth?.user ?? null
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
    const { customerName, contact1, contact2, region, products, qty, amount, deliveryDate, notes, adId, pageCode, salesType, returnProduct, productLines } = body

    // Agents can log the order as Sale / Exchange / Trade In / Refund / Drop Off
    const ALLOWED_SALES_TYPES = ['sale', 'exchange', 'trade_in', 'refund', 'drop_off']
    const orderSalesType = ALLOWED_SALES_TYPES.includes(String(salesType || '').toLowerCase())
      ? String(salesType).toLowerCase()
      : 'sale'
    
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
    
    // Resolve the chosen region against the master localities list to stamp
    // the route code (RTE) and the assigned contractor/rider automatically
    const localityName = region.trim().split('/')[0].trim()
    const { data: loc } = await supabase
      .from('localities')
      .select('route_code, contractor_id, default_rider_id')
      .ilike('name', localityName)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    
    // Enforce delivery rules server-side so a stale extension can never slip an
    // order onto a Sunday or an admin-configured non-delivery day (public
    // holiday, moon-based holiday, or cyclone/rain closure). Push forward to the
    // first working day on/after the requested date.
    const { data: hSettings } = await supabase
      .from('extension_settings')
      .select('holidays')
      .eq('id', 1)
      .single()
    const holidayList: Array<{ start: string; end: string }> = Array.isArray(hSettings?.holidays) ? hSettings.holidays : []
    const ymdUTC = (d: Date) => d.toISOString().split('T')[0]
    const isNonWorkingDay = (d: Date) => {
      if (d.getUTCDay() === 0) return true // Sunday
      const s = ymdUTC(d)
      return holidayList.some(h => h.start && s >= h.start && s <= (h.end || h.start))
    }
    const requested = deliveryDate || new Date().toISOString().split('T')[0]
    const safeDate = new Date(requested + 'T00:00:00Z')
    let guard = 0
    while (isNonWorkingDay(safeDate) && guard < 60) { safeDate.setUTCDate(safeDate.getUTCDate() + 1); guard++ }
    const resolvedDeliveryDate = ymdUTC(safeDate)

    // Fields shared by every row created for this order (mirrors the import
    // sheet: INDEX and Payment Method stay blank, RTE comes from the locality)
    const nowIso = new Date().toISOString()
    const baseRow = {
      customer_name: customerName.trim(),
      contact_1: contact1.trim(),
      contact_2: contact2?.trim() || null,
      locality: localityName,
      rte: loc?.route_code || null,
      contractor_id: loc?.contractor_id || null,
      rider_id: loc?.default_rider_id || null,
      assigned_at: loc?.contractor_id ? nowIso : null,
      sales_type: orderSalesType,
      notes: notes?.trim() || null,
      // For Exchange / Trade In, the product the client is returning (what the
      // rider must collect) so stock reconciliation stays accurate.
      return_product: (typeof returnProduct === 'string' && returnProduct.trim()) ? returnProduct.trim() : null,
      ad_id: adId?.trim() || null,
      status: 'pending',
      entry_date: nowIso.split('T')[0],
      delivery_date: resolvedDeliveryDate,
      created_by: user.id,
      // MEDIUM carries the source page code (e.g. MBM / DBM) like the import
      // sheet; falls back to "Extension" when no page was detected
      medium: (typeof pageCode === 'string' && pageCode.trim()) ? pageCode.trim().slice(0, 20) : 'Extension',
    }

    // Normalise the per-product lines sent by the extension. Each valid line
    // becomes its own delivery entry. Exchange / Trade In stay as a single
    // combined row because their amount is calculated at the order level.
    const validLines = Array.isArray(productLines)
      ? productLines.filter((l: any) => l && typeof l.name === 'string' && l.name.trim())
      : []
    const splitPerProduct = validLines.length > 0 && orderSalesType !== 'exchange' && orderSalesType !== 'trade_in'

    // Each row gets its own unique reply token (one product = one entry = one reply link)
    const rows = splitPerProduct
      ? validLines.map((l: any) => ({
          ...baseRow,
          products: l.name.trim(),
          qty: Number(l.qty) > 0 ? Number(l.qty) : 1,
          amount: Number(l.amount) >= 0 ? Number(l.amount) : 0,
          reply_token: uuidv4(),
          reply_token_created_at: nowIso,
        }))
      : [{
          ...baseRow,
          products: products,
          qty: qty || 1,
          amount: amount || 0,
          reply_token: replyToken,
          reply_token_created_at: nowIso,
        }]

    const { data: inserted, error } = await supabase.from('deliveries').insert(rows).select('id')

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
      message: rows.length > 1
        ? `Order created successfully! (${rows.length} entries)`
        : 'Order created successfully!',
      orderId: inserted?.[0]?.id,
      orderIds: (inserted || []).map((d: { id: string }) => d.id),
      entryCount: rows.length,
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

// PUT - Save shared extension settings (admin only)
export async function PUT(request: NextRequest) {
  try {
    const tokenAuth = await getUserFromToken(request)
    let user = tokenAuth?.user ?? null
    let supabase = tokenAuth?.supabase
    
    if (!user) {
      const cookieSupabase = await createClient()
      const { data: { user: cookieUser } } = await cookieSupabase.auth.getUser()
      user = cookieUser
      supabase = cookieSupabase as any
    }
    
    if (!user || !supabase) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401, headers: corsHeaders })
    }
    
    // Only admins may change the shared configuration
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()
    
    if (profile?.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Only admins can change extension settings' }, { status: 403, headers: corsHeaders })
    }
    
    const body = await request.json()
    const asArray = (v: unknown) => (Array.isArray(v) ? v.filter(x => typeof x === 'string') : [])
    // Page mappings: [{ match: "Made By Moris", code: "MBM", logo?: dataURL }, ...]
    const asMappings = (v: unknown) => (Array.isArray(v)
      ? v
          .filter((m): m is { match: string; code: string; logo?: string; pageId?: string } =>
            !!m && typeof m === 'object' &&
            typeof (m as any).match === 'string' && (m as any).match.trim() !== '' &&
            typeof (m as any).code === 'string' && (m as any).code.trim() !== '')
          .map(m => {
            const entry: { match: string; code: string; logo?: string; pageId?: string } = {
              match: m.match.trim().slice(0, 120),
              code: m.code.trim().slice(0, 20),
            }
            // Logo: small image data URL only (48px PNG from the widget, cap 100KB)
            if (typeof m.logo === 'string' && m.logo.startsWith('data:image/') && m.logo.length <= 100_000) {
              entry.logo = m.logo
            }
            // Page ID: the Facebook asset_id, used for instant/reliable detection
            if (typeof m.pageId === 'string' && /^\d{1,25}$/.test(m.pageId.trim())) {
              entry.pageId = m.pageId.trim()
            }
            return entry
          })
          .slice(0, 50)
      : [])
    
    // Delivery-day scheme: { "0".."6": targetWeekday 0-6 }. Only keep valid
    // weekday->weekday pairs; anything else is dropped so the day falls back
    // to the cut-off "next working day" default.
    const asScheme = (v: unknown): Record<string, number> => {
      if (!v || typeof v !== 'object') return {}
      const out: Record<string, number> = {}
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const day = Number(k)
        const target = Number(val)
        if (Number.isInteger(day) && day >= 0 && day <= 6 &&
            Number.isInteger(target) && target >= 0 && target <= 6) {
          out[String(day)] = target
        }
      }
      return out
    }

    // Holidays: [{ id, start, end, label, type }]. Keep only well-formed entries
    // with valid ISO dates where end >= start; cap the label and total count.
    const asHolidays = (v: unknown): Array<{ id: string; start: string; end: string; label: string; type: string }> => {
      if (!Array.isArray(v)) return []
      const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
      const types = new Set(['fixed', 'variable', 'adhoc'])
      return v
        .filter((h): h is Record<string, unknown> => !!h && typeof h === 'object')
        .map(h => {
          const start = isDate(h.start) ? h.start : ''
          let end = isDate(h.end) ? h.end : start
          if (start && end < start) end = start
          const type = typeof h.type === 'string' && types.has(h.type) ? h.type : 'fixed'
          const id = typeof h.id === 'string' && h.id ? h.id.slice(0, 40) : `h-${start}-${Math.random().toString(36).slice(2, 7)}`
          const label = typeof h.label === 'string' ? h.label.trim().slice(0, 80) : ''
          return { id, start, end, label, type }
        })
        .filter(h => h.start !== '')
        .slice(0, 200)
    }

    const { error } = await supabase.from('extension_settings').upsert({
      id: 1,
      name_selectors: asArray(body.nameSelectors),
      phone_selectors: asArray(body.phoneSelectors),
      adid_selectors: asArray(body.adidSelectors),
      page_mappings: asMappings(body.pageMappings),
      cutoff_time: typeof body.cutoffTime === 'string' && body.cutoffTime ? body.cutoffTime : '20:00',
      delivery_day_scheme: asScheme(body.deliveryDayScheme),
      holidays: asHolidays(body.holidays),
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    
    if (error) {
      return NextResponse.json({ success: false, error: 'Failed to save settings: ' + error.message }, { status: 500, headers: corsHeaders })
    }
    
    return NextResponse.json({ success: true, message: 'Settings saved for all users' }, { headers: corsHeaders })
  } catch (error) {
    console.error('Extension settings save error:', error)
    return NextResponse.json({ success: false, error: 'Server error' }, { status: 500, headers: corsHeaders })
  }
}
