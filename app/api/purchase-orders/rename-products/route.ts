import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface RenameItem {
  productId: string
  newName: string
  /** The PO spelling, kept as an alias so future imports still match. */
  oldName?: string
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { items?: RenameItem[] }
    const items = (body.items || []).filter(i => i?.productId && i?.newName?.trim())
    if (!items.length) {
      return NextResponse.json({ success: false, error: 'No renames supplied' }, { status: 400 })
    }

    const db = createAdminClient()
    let renamed = 0
    const failed: { productId: string; error: string }[] = []

    for (const item of items) {
      const newName = item.newName.trim()

      // Read the current name first: it becomes an alias, and it tells us
      // whether anything actually needs to change.
      const { data: existing, error: readError } = await db
        .from('products')
        .select('id, name')
        .eq('id', item.productId)
        .maybeSingle()

      if (readError || !existing) {
        failed.push({ productId: item.productId, error: readError?.message || 'Product not found' })
        continue
      }
      if (existing.name === newName) continue

      const { error: updateError } = await db
        .from('products')
        .update({ name: newName })
        .eq('id', item.productId)

      if (updateError) {
        failed.push({ productId: item.productId, error: updateError.message })
        continue
      }
      renamed++

      // Preserve every spelling this product has been known by, so the next PO
      // using the old name still maps straight back to it.
      const aliasNames = Array.from(
        new Set(
          [existing.name, item.oldName]
            .filter((n): n is string => !!n && n.trim() !== '' && n.trim() !== newName)
            .map(n => n.trim()),
        ),
      )

      for (const aliasName of aliasNames) {
        const { error: aliasError } = await db
          .from('product_aliases')
          .insert({ alias_name: aliasName, product_id: item.productId, source: 'rename' })
        // A duplicate just means we already knew this alias - not a failure.
        if (aliasError && !aliasError.message?.includes('duplicate')) {
          console.error('[v0] rename-products alias insert failed:', aliasError.message)
        }
      }
    }

    return NextResponse.json({ success: true, renamed, failed })
  } catch (err) {
    console.error('[v0] rename-products route error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Rename failed' },
      { status: 500 },
    )
  }
}
