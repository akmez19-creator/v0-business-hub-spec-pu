import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { connect } from '@/lib/products/pg'

/**
 * Which products have been through duplicate review, for the inventory list.
 *
 * Server-side on purpose: product_review has RLS enabled with no select policy,
 * so a browser query returns an empty set rather than an error. Reading it from
 * the client would silently show every product as unchecked - the same shape of
 * bug as a filter that quietly hides rows.
 */
export async function GET() {
  let client
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    client = await connect()
    await client.query(`set statement_timeout='30s'`)
    const rows = (await client.query(`select product_id, status from product_review`)).rows

    const statuses: Record<string, string> = {}
    for (const r of rows) statuses[r.product_id] = r.status
    return NextResponse.json({ success: true, statuses })
  } catch (error) {
    console.error('[v0] Review status error:', error)
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 })
  } finally {
    await client?.end().catch(() => {})
  }
}
