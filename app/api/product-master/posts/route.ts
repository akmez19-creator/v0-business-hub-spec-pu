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

// POST: manually add an existing post (e.g. one written outside the AI tool)
// and attribute it to a product so it joins the AI knowledge centre
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await request.json()
    const productId: string | null = body?.productId ? String(body.productId) : null
    const productName: string = String(body?.productName || '').slice(0, 200)
    const postType: string = String(body?.postType || 'fb_ad').slice(0, 40)
    const content = {
      hook: String(body?.content?.hook || '').slice(0, 500),
      body: String(body?.content?.body || '').slice(0, 4000),
      cta: String(body?.content?.cta || '').slice(0, 500),
      hashtags: String(body?.content?.hashtags || '').slice(0, 500),
      raw: [body?.content?.hook, body?.content?.body, body?.content?.cta, body?.content?.hashtags]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 6000),
    }

    if (!productName || !content.raw) {
      return NextResponse.json({ success: false, error: 'productName and content are required' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('product_posts')
      .insert({
        product_id: productId,
        product_name: productName,
        post_type: postType,
        tone: body?.tone ? String(body.tone).slice(0, 40) : 'manual',
        language: body?.language ? String(body.language).slice(0, 10) : 'en',
        content,
        offers_used: [],
        created_by: user.id,
      })
      .select('id')
      .single()
    if (error) throw error

    return NextResponse.json({ success: true, id: data.id })
  } catch (error) {
    console.error('posts POST error:', error)
    return NextResponse.json({ success: false, error: 'Failed to create post' }, { status: 500 })
  }
}

// PUT: edit an existing post's content
export async function PUT(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await request.json()
    const id: string = String(body?.id || '')
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })

    const content = {
      hook: String(body?.content?.hook || '').slice(0, 500),
      body: String(body?.content?.body || '').slice(0, 4000),
      cta: String(body?.content?.cta || '').slice(0, 500),
      hashtags: String(body?.content?.hashtags || '').slice(0, 500),
      raw: [body?.content?.hook, body?.content?.body, body?.content?.cta, body?.content?.hashtags]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 6000),
    }

    const admin = createAdminClient()
    const updates: Record<string, unknown> = { content }
    if (body?.postType) updates.post_type = String(body.postType).slice(0, 40)
    if (body?.productId !== undefined) updates.product_id = body.productId ? String(body.productId) : null
    if (body?.productName) updates.product_name = String(body.productName).slice(0, 200)

    const { error } = await admin.from('product_posts').update(updates).eq('id', id)
    if (error) throw error

    return NextResponse.json({ success: true, id })
  } catch (error) {
    console.error('posts PUT error:', error)
    return NextResponse.json({ success: false, error: 'Failed to update post' }, { status: 500 })
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
