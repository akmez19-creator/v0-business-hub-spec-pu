import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  
  // Get all campaign-product links with product info
  const { data, error } = await supabase
    .from('campaign_product_links')
    .select(`
      *,
      products (
        id,
        name,
        price,
        quantity
      )
    `)
  
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  
  return NextResponse.json({ data })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const body = await request.json()
  
  const { campaign_id, campaign_name, product_id, account_id } = body
  
  if (!campaign_id) {
    return NextResponse.json({ error: 'Campaign ID is required' }, { status: 400 })
  }
  
  // Upsert the link (update if exists, insert if not)
  const { data, error } = await supabase
    .from('campaign_product_links')
    .upsert({
      campaign_id,
      campaign_name,
      product_id: product_id || null,
      account_id,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'campaign_id'
    })
    .select()
  
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  
  return NextResponse.json({ data })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const campaignId = searchParams.get('campaignId')
  
  if (!campaignId) {
    return NextResponse.json({ error: 'Campaign ID is required' }, { status: 400 })
  }
  
  const { error } = await supabase
    .from('campaign_product_links')
    .delete()
    .eq('campaign_id', campaignId)
  
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  
  return NextResponse.json({ success: true })
}
