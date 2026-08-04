import { NextResponse } from 'next/server'
import { del } from '@vercel/blob'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// Saved source clips for the Reels Studio feed. The video itself lives in Blob
// storage (uploaded straight from the browser); this route only handles the
// small metadata row that makes a clip survive a page reload.

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
      .from('product_clips')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(100)

    // Older clips were saved before products carried an id through, so fall
    // back to the name to avoid orphaning them in the UI
    if (productId) query = query.eq('product_id', productId)
    else if (productName) query = query.eq('product_name', productName)

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ success: true, clips: data ?? [] })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Could not load clips' },
      { status: 500 },
    )
  }
}

// Called after the browser has finished streaming the file to Blob storage
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await request.json()
    const { blobUrl, blobPathname, name, productId, productName, duration, width, height, sizeBytes, source } = body

    if (!blobUrl || !name) {
      return NextResponse.json({ success: false, error: 'Missing blobUrl or name' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('product_clips')
      .insert({
        product_id: productId || null,
        product_name: productName || '',
        name,
        blob_url: blobUrl,
        blob_pathname: blobPathname || null,
        duration: Number(duration) || 0,
        width: Number(width) || 0,
        height: Number(height) || 0,
        size_bytes: Number(sizeBytes) || 0,
        source: source || 'upload',
        created_by: user.id,
      })
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ success: true, clip: data })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Could not save clip' },
      { status: 500 },
    )
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
    const { data: row } = await admin.from('product_clips').select('blob_url').eq('id', id).single()

    const { error } = await admin.from('product_clips').delete().eq('id', id)
    if (error) throw error

    // Drop the file too, so removing a clip does not leave the video behind
    // as billable storage nobody can reach
    if (row?.blob_url) {
      try {
        await del(row.blob_url)
      } catch {
        // Row is already gone; a stranded blob is not worth failing the request
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Could not delete clip' },
      { status: 500 },
    )
  }
}
