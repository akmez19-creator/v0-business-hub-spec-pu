import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// GET - Fetch all POIs
export async function GET() {
  try {
    const supabase = await createClient()
    
    const { data: pois, error } = await supabase
      .from('rider_pois')
      .select('*')
      .order('created_at', { ascending: false })
    
    if (error) throw error
    
    return NextResponse.json({ pois: pois || [] })
  } catch (error) {
    console.error('Error fetching POIs:', error)
    return NextResponse.json({ pois: [], error: 'Failed to fetch POIs' }, { status: 500 })
  }
}

// POST - Add new POI (rider crowdsourced)
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const body = await request.json()
    
    const { name, category, latitude, longitude, locality, added_by } = body
    
    if (!name || !latitude || !longitude) {
      return NextResponse.json({ error: 'Name, latitude, and longitude are required' }, { status: 400 })
    }
    
    const { data: poi, error } = await supabase
      .from('rider_pois')
      .insert({
        name: name.trim(),
        category: category || 'landmark',
        latitude,
        longitude,
        locality: locality || null,
        added_by: added_by || 'rider',
        verified: false
      })
      .select()
      .single()
    
    if (error) throw error
    
    return NextResponse.json({ poi, success: true })
  } catch (error) {
    console.error('Error adding POI:', error)
    return NextResponse.json({ error: 'Failed to add POI' }, { status: 500 })
  }
}

// PATCH - Update POI name/category
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const body = await request.json()
    
    const { id, name, category } = body
    
    if (!id) {
      return NextResponse.json({ error: 'POI ID is required' }, { status: 400 })
    }
    
    const updates: { name?: string; category?: string; updated_at: string } = { updated_at: new Date().toISOString() }
    if (name) updates.name = name.trim()
    if (category) updates.category = category
    
    const { data: poi, error } = await supabase
      .from('rider_pois')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    
    if (error) throw error
    
    return NextResponse.json({ poi, success: true })
  } catch (error) {
    console.error('Error updating POI:', error)
    return NextResponse.json({ error: 'Failed to update POI' }, { status: 500 })
  }
}

// DELETE - Remove POI (admin only)
export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json({ error: 'POI ID is required' }, { status: 400 })
    }
    
    const { error } = await supabase
      .from('rider_pois')
      .delete()
      .eq('id', id)
    
    if (error) throw error
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting POI:', error)
    return NextResponse.json({ error: 'Failed to delete POI' }, { status: 500 })
  }
}
