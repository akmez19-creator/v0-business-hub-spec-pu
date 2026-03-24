import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// GET - Fetch deductions
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const targetType = searchParams.get('targetType')
    const targetId = searchParams.get('targetId')
    const status = searchParams.get('status')

    const adminDb = createAdminClient()
    
    let query = adminDb
      .from('deductions')
      .select('*')
      .order('created_at', { ascending: false })

    if (targetType) {
      query = query.eq('target_type', targetType)
    }

    if (targetId) {
      query = query.eq('target_id', targetId)
    }

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching deductions:', error)
      return NextResponse.json({ error: 'Failed to fetch deductions' }, { status: 500 })
    }

    return NextResponse.json(data || [])
  } catch (error) {
    console.error('Deductions GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create a new deduction (admin only)
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    const adminDb = createAdminClient()
    const { data: profile } = await adminDb
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { deduction_type, target_type, target_id, amount, reason, proof_url } = body

    if (!deduction_type || !target_type || !target_id || !amount || !reason) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const { data, error } = await adminDb
      .from('deductions')
      .insert({
        deduction_type,
        target_type,
        target_id,
        amount: parseFloat(amount),
        reason,
        proof_url: proof_url || null,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating deduction:', error)
      return NextResponse.json({ error: 'Failed to create deduction' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Deductions POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH - Reverse a deduction (admin only)
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminDb = createAdminClient()
    
    // Check if user is admin
    const { data: profile } = await adminDb
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const { id, reversed_reason } = body

    if (!id || !reversed_reason) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const { data, error } = await adminDb
      .from('deductions')
      .update({
        status: 'reversed',
        reversed_at: new Date().toISOString(),
        reversed_by: user.id,
        reversed_reason,
      })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error reversing deduction:', error)
      return NextResponse.json({ error: 'Failed to reverse deduction' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Deductions PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
