import { createAdminClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const adminDb = createAdminClient()
  
  const { data, error } = await adminDb
    .from('company_settings')
    .select('orders_module_enabled')
    .limit(1)
    .single()
    
  if (error) {
    return NextResponse.json({ orders_module_enabled: true })
  }
  
  return NextResponse.json(data)
}
