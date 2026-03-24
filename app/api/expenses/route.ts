import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// GET - Fetch expenses for a contractor/rider
export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const ownerType = searchParams.get('ownerType') || 'contractor'
    const ownerId = searchParams.get('ownerId')
    const month = searchParams.get('month') // YYYY-MM format

    const adminDb = createAdminClient()
    
    let query = adminDb
      .from('expenses')
      .select('*')
      .eq('owner_type', ownerType)
      .order('expense_date', { ascending: false })

    if (ownerId) {
      query = query.eq('owner_id', ownerId)
    }

    if (month) {
      const startDate = `${month}-01`
      const endDate = new Date(parseInt(month.split('-')[0]), parseInt(month.split('-')[1]), 0)
        .toISOString().split('T')[0]
      query = query.gte('expense_date', startDate).lte('expense_date', endDate)
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching expenses:', error)
      return NextResponse.json({ error: 'Failed to fetch expenses' }, { status: 500 })
    }

    return NextResponse.json(data || [])
  } catch (error) {
    console.error('Expenses GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - Create a new expense
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { expense_type, category, owner_type, owner_id, vehicle_id, amount, description, expense_date, receipt_url } = body

    if (!expense_type || !category || !owner_type || !owner_id || !amount || !expense_date) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const adminDb = createAdminClient()
    
    const { data, error } = await adminDb
      .from('expenses')
      .insert({
        expense_type,
        category,
        owner_type,
        owner_id,
        vehicle_id: vehicle_id || null,
        amount: parseFloat(amount),
        description: description || null,
        expense_date,
        receipt_url: receipt_url || null,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating expense:', error)
      return NextResponse.json({ error: 'Failed to create expense' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Expenses POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE - Delete an expense
export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Expense ID required' }, { status: 400 })
    }

    const adminDb = createAdminClient()
    
    const { error } = await adminDb
      .from('expenses')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting expense:', error)
      return NextResponse.json({ error: 'Failed to delete expense' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Expenses DELETE error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
