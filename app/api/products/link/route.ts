import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { linkProducts, unlinkProduct, LinkBlockedError } from '@/lib/products/link-tx'

/**
 * Link a duplicate product to the real one without deleting it.
 *
 * POST { survivorId, retiredId, moveStock, finalName? }  -> link
 * POST { unlinkId }                           -> undo
 *
 * The caller names both sides explicitly; this route never infers which row
 * should survive, exactly as the merge route does not.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await request.json().catch(() => null)

    const unlinkId = typeof body?.unlinkId === 'string' ? body.unlinkId : ''
    if (unlinkId) {
      const result = await unlinkProduct(unlinkId)
      return NextResponse.json({ success: true, ...result })
    }

    const survivorId = typeof body?.survivorId === 'string' ? body.survivorId : ''
    const retiredId = typeof body?.retiredId === 'string' ? body.retiredId : ''
    if (!survivorId || !retiredId) {
      return NextResponse.json({ success: false, error: 'Both products must be supplied' }, { status: 400 })
    }

    const finalName = typeof body?.finalName === 'string' ? body.finalName.trim() : ''
    const result = await linkProducts(
      survivorId,
      retiredId,
      body?.moveStock === true,
      finalName || undefined,
    )
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = (error as Error).message
    if (error instanceof LinkBlockedError) {
      console.log('[v0] Link refused:', message)
      return NextResponse.json({ success: false, error: `${message} Nothing was changed.` }, { status: 409 })
    }
    // One transaction, so a failure here leaves the database exactly as it was.
    console.error('[v0] Product link rolled back:', message)
    return NextResponse.json(
      { success: false, error: `${message}. The link was rolled back and nothing was changed.` },
      { status: 500 },
    )
  }
}
