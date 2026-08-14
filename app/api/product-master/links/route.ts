import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

/**
 * Supplier listing links for a product.
 *
 * The 1688 URL used to live only in the imported spreadsheet column and was
 * discarded once the import finished, so a delisted listing left nothing to
 * update. Sellers rotate constantly: the same product gets re-sourced from a
 * new listing again and again, so the whole set is kept with one marked
 * active.
 */

/**
 * Real 1688 links arrive in several shapes (detail.1688.com/offer/<id>.html,
 * m.1688.com links, plain ?offerId=). Matching the id means the same listing
 * reached by a different query string is recognised as the same offer.
 */
function offerIdFrom(link: string): string | null {
  const m = link.match(/\/offer\/(\d{6,})/) || link.match(/(?:id|offerId)=(\d{6,})/i)
  return m ? m[1] : null
}

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
      .from('product_links')
      .select('*')
      .order('is_active', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(30)

    // Same fallback as images and clips: links saved before the product row
    // existed are found by name rather than orphaned.
    if (productId) query = query.eq('product_id', productId)
    else if (productName) query = query.eq('product_name', productName)
    else return NextResponse.json({ success: false, error: 'productId or productName is required' }, { status: 400 })

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ success: true, links: data ?? [] })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Could not load links' },
      { status: 500 },
    )
  }
}

/**
 * POST { productId, productName, url, label?, status?, makeActive? }
 *
 * Saves a listing link. Re-saving a URL already on file updates it instead of
 * stacking duplicates, which matters because every successful media load
 * records the link it came from.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await request.json()
    const productId = String(body?.productId || '').trim() || null
    const productName = String(body?.productName || '').trim()
    const url = String(body?.url || '').trim()
    const label = body?.label ? String(body.label).trim() : null
    const status = String(body?.status || 'unknown')
    const makeActive = body?.makeActive !== false

    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json({ success: false, error: 'That does not look like a link' }, { status: 400 })
    }
    if (!productId && !productName) {
      return NextResponse.json({ success: false, error: 'productId or productName is required' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Only one seller is current, so clear the flag before setting the new one.
    if (makeActive && productId) {
      await admin.from('product_links').update({ is_active: false }).eq('product_id', productId)
    }

    const row = {
      product_id: productId,
      product_name: productName,
      url,
      offer_id: offerIdFrom(url),
      label,
      status,
      is_active: makeActive,
      last_checked_at: status === 'unknown' ? null : new Date().toISOString(),
      created_by: user.id,
    }

    // The unique index only covers rows that have a product_id, so a link
    // captured before the product exists is inserted plainly.
    const query = productId
      ? admin.from('product_links').upsert(row, { onConflict: 'product_id,url' })
      : admin.from('product_links').insert(row)

    const { data, error } = await query.select().single()
    if (error) throw error

    return NextResponse.json({ success: true, link: data })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Could not save link'
    console.error('[v0] product link save error:', msg)
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

/** PATCH { id, productId?, isActive?, status?, label? } */
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await request.json()
    const id = String(body?.id || '').trim()
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })

    const admin = createAdminClient()
    const patch: Record<string, unknown> = {}

    if (typeof body?.isActive === 'boolean') {
      patch.is_active = body.isActive
      const productId = String(body?.productId || '').trim()
      if (body.isActive && productId) {
        await admin.from('product_links').update({ is_active: false }).eq('product_id', productId)
      }
    }
    if (body?.status) {
      patch.status = String(body.status)
      patch.last_checked_at = new Date().toISOString()
    }
    if (body?.label !== undefined) patch.label = body.label ? String(body.label).trim() : null

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: false, error: 'Nothing to update' }, { status: 400 })
    }

    const { data, error } = await admin.from('product_links').update(patch).eq('id', id).select().single()
    if (error) throw error

    return NextResponse.json({ success: true, link: data })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Could not update link'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}

/** DELETE ?id= — drop a link that is no longer worth keeping. */
export async function DELETE(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const id = new URL(request.url).searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 })

    const admin = createAdminClient()
    const { error } = await admin.from('product_links').delete().eq('id', id)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Could not delete link'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
