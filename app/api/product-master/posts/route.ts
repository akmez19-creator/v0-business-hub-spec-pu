import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// Post management for Product Master: every AI-generated (or manually saved)
// post is attributed to a product and persisted here, so it can be managed
// across pages and fed back into the AI knowledge centre.

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const productId = searchParams.get('productId')

    const admin = createAdminClient()
    let query = admin
      .from('product_posts')
      .select('id, product_id, product_name, post_type, tone, language, content, offers_used, created_at')
      .order('created_at', { ascending: false })
      .limit(200)
    if (productId) query = query.eq('product_id', productId)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ success: true, posts: data ?? [] })
  } catch (error) {
    console.error('posts GET error:', error)
    return NextResponse.json({ success: false, error: 'Failed to load posts' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await request.json()
    const id: string = String(body?.id || '')
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })

    const admin = createAdminClient()
    const { error } = await admin.from('product_posts').delete().eq('id', id)
    if (error) throw error

    return NextResponse.json({ success: true, id })
  } catch (error) {
    console.error('posts DELETE error:', error)
    return NextResponse.json({ success: false, error: 'Failed to delete post' }, { status: 500 })
  }
}
