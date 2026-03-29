import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET - fetch all region coordinate overrides
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('region_coordinate_overrides')
      .select('locality, lat, lng')
    
    if (error) {
      // Table might not exist, return empty
      if (error.code === '42P01') {
        return NextResponse.json({ overrides: {} })
      }
      throw error
    }
    
    // Convert array to object for easy lookup
    const overrides: Record<string, { lat: number; lng: number }> = {}
    for (const row of data || []) {
      overrides[row.locality] = { lat: row.lat, lng: row.lng }
    }
    
    return NextResponse.json({ overrides })
  } catch (error) {
    console.error('Error fetching region overrides:', error)
    return NextResponse.json({ overrides: {} })
  }
}

// POST - save a region coordinate override
export async function POST(request: Request) {
  try {
    const { locality, lat, lng } = await request.json()
    
    if (!locality || typeof lat !== 'number' || typeof lng !== 'number') {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 })
    }
    
    const { error } = await supabase
      .from('region_coordinate_overrides')
      .upsert(
        { locality, lat, lng, updated_at: new Date().toISOString() },
        { onConflict: 'locality' }
      )
    
    if (error) {
      console.error('Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json({ success: true, locality, lat, lng })
  } catch (error) {
    console.error('Error saving region override:', error)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
}
