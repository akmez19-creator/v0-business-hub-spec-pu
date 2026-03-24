import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// GET - Fetch work days for riders
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const riderId = searchParams.get('riderId')
    const month = searchParams.get('month') // 1-12
    const year = searchParams.get('year') // YYYY

    const adminDb = createAdminClient()
    
    let query = adminDb
      .from('rider_work_days')
      .select('*, riders(id, name)')
      .order('work_date', { ascending: false })

    if (riderId) {
      query = query.eq('rider_id', riderId)
    }

    if (month && year) {
      const startDate = `${year}-${month.padStart(2, '0')}-01`
      const endDate = new Date(parseInt(year), parseInt(month), 0).toISOString().split('T')[0]
      query = query.gte('work_date', startDate).lte('work_date', endDate)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching work days:', error)
      return NextResponse.json({ error: 'Failed to fetch work days' }, { status: 500 })
    }

    return NextResponse.json(data || [])
  } catch (error) {
    console.error('Work days GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create or update work day record
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { rider_id, work_date, status, hours_worked, notes } = body

    if (!rider_id || !work_date) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const adminDb = createAdminClient()
    
    // Upsert - insert or update if exists
    const { data, error } = await adminDb
      .from('rider_work_days')
      .upsert({
        rider_id,
        work_date,
        status: status || 'present',
        hours_worked: hours_worked || null,
        notes: notes || null,
        recorded_by: user.id,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'rider_id,work_date',
      })
      .select()
      .single()

    if (error) {
      console.error('Error saving work day:', error)
      return NextResponse.json({ error: 'Failed to save work day' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Work days POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT - Bulk update work days
export async function PUT(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { workDays } = body // Array of { rider_id, work_date, status }

    if (!workDays || !Array.isArray(workDays)) {
      return NextResponse.json({ error: 'Invalid work days data' }, { status: 400 })
    }

    const adminDb = createAdminClient()
    
    const upsertData = workDays.map(wd => ({
      rider_id: wd.rider_id,
      work_date: wd.work_date,
      status: wd.status || 'present',
      recorded_by: user.id,
      updated_at: new Date().toISOString(),
    }))

    const { data, error } = await adminDb
      .from('rider_work_days')
      .upsert(upsertData, {
        onConflict: 'rider_id,work_date',
      })
      .select()

    if (error) {
      console.error('Error bulk updating work days:', error)
      return NextResponse.json({ error: 'Failed to save work days' }, { status: 500 })
    }

    return NextResponse.json(data || [])
  } catch (error) {
    console.error('Work days PUT error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
