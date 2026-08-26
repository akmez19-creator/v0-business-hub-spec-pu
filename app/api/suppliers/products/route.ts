import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

/**
 * Attach a product to a supplier by hand.
 *
 * Only ever writes rows with source='manual'. Products derived from purchase
 * orders are computed on read and never stored, so a manual link can never
 * overwrite or contradict real order history.
 */
export async function POST(request: NextRequest) {
  if (!(await requireUser())) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const supplierName = typeof body?.supplierName === 'string' ? body.supplierName.trim() : ''
  const productId = typeof body?.productId === 'string' ? body.productId : ''
  if (!supplierName || !productId) {
    return NextResponse.json({ success: false, error: 'Supplier and product are both required.' }, { status: 400 })
  }

  const db = createAdminClient()
  const { error } = await db
    .from('supplier_products')
    .upsert({ supplier_name: supplierName, product_id: productId, source: 'manual' }, { onConflict: 'supplier_name,product_id' })

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}

/** Remove a hand-attached product. Never touches purchase-order history. */
export async function DELETE(request: NextRequest) {
  if (!(await requireUser())) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const supplierName = (searchParams.get('supplierName') || '').trim()
  const productId = searchParams.get('productId') || ''
  if (!supplierName || !productId) {
    return NextResponse.json({ success: false, error: 'Supplier and product are both required.' }, { status: 400 })
  }

  const db = createAdminClient()
  const { error } = await db
    .from('supplier_products')
    .delete()
    .eq('supplier_name', supplierName)
    .eq('product_id', productId)
    .eq('source', 'manual')

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
