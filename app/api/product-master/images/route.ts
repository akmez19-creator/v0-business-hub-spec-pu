import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

/**
 * The saved photo gallery for a product.
 *
 * `products.image_url` only ever holds the single cover photo, so every other
 * picture the reviewer kept off a listing used to be thrown away. This table
 * is the image counterpart to product_clips: it keeps the whole set, which is
 * what Poster Studio scores and picks from.
 */

export async function GET(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const productId = searchParams.get('productId')
    const productName = searchParams.get('productName')

    const admin = createAdminClient()
    let query = admin
      .from('product_images')
      .select('*')
      .order('is_primary', { ascending: false })
      .order('position', { ascending: true })
      .limit(60)

    // Same fallback as clips: rows saved before a product id existed are found
    // by name rather than orphaned.
    if (productId) query = query.eq('product_id', productId)
    else if (productName) query = query.eq('product_name', productName)
    else return NextResponse.json({ success: false, error: 'productId or productName is required' }, { status: 400 })

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ success: true, images: data ?? [] })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Could not load images' },
      { status: 500 },
    )
  }
}

/**
 * POST { productId, productName, images: [url], primaryUrl?, source?, sourceUrl? }
 *
 * Saves the whole selection in one call. The cover is mirrored onto
 * products.image_url so every existing screen that reads a single photo keeps
 * working untouched.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await request.json()
    const productId = String(body?.productId || '').trim()
    const productName = String(body?.productName || '').trim()
    const source = String(body?.source || '1688')
    const sourceUrl = body?.sourceUrl ? String(body.sourceUrl) : null
    const images: string[] = Array.isArray(body?.images)
      ? [...new Set((body.images as unknown[]).map(v => String(v)))].filter(u => /^https?:\/\//i.test(u))
      : []

    if (!productId) {
      return NextResponse.json({ success: false, error: 'productId is required' }, { status: 400 })
    }
    if (images.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid image urls supplied' }, { status: 400 })
    }

    // Default the cover to the first picked photo when none was nominated.
    const primaryUrl = images.includes(String(body?.primaryUrl)) ? String(body.primaryUrl) : images[0]

    const admin = createAdminClient()

    // Clear the old cover first: the partial unique index allows only one
    // primary row per product, so flipping the new one in without this would
    // trip the constraint.
    await admin.from('product_images').update({ is_primary: false }).eq('product_id', productId).eq('is_primary', true)

    const rows = images.map((url, i) => ({
      product_id: productId,
      product_name: productName,
      image_url: url,
      source,
      source_id: url,
      source_url: sourceUrl,
      is_primary: url === primaryUrl,
      position: i,
      created_by: user.id,
    }))

    // Re-reviewing a product re-saves the same photos, so conflicts update the
    // ordering and cover rather than erroring.
    const { data, error } = await admin
      .from('product_images')
      .upsert(rows, { onConflict: 'product_id,image_url' })
      .select()
    if (error) throw error

    // Keep the single-photo column in step with the chosen cover.
    const { error: coverError } = await admin
      .from('products')
      .update({ image_url: primaryUrl })
      .eq('id', productId)
    if (coverError) throw coverError

    return NextResponse.json({ success: true, images: data ?? [], primaryUrl, saved: rows.length })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Could not save images'
    console.error('[v0] product images save error:', msg)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 })

    const admin = createAdminClient()
    const { data: row } = await admin
      .from('product_images')
      .select('product_id, image_url, is_primary')
      .eq('id', id)
      .single()

    const { error } = await admin.from('product_images').delete().eq('id', id)
    if (error) throw error

    // Removing the cover would leave the product pointing at a photo that is no
    // longer in its gallery, so promote whatever remains.
    if (row?.is_primary && row.product_id) {
      const { data: next } = await admin
        .from('product_images')
        .select('id, image_url')
        .eq('product_id', row.product_id)
        .order('position', { ascending: true })
        .limit(1)
      const promoted = next?.[0]
      if (promoted) {
        await admin.from('product_images').update({ is_primary: true }).eq('id', promoted.id)
        await admin.from('products').update({ image_url: promoted.image_url }).eq('id', row.product_id)
      } else {
        await admin.from('products').update({ image_url: null }).eq('id', row.product_id)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Could not delete image' },
      { status: 500 },
    )
  }
}
