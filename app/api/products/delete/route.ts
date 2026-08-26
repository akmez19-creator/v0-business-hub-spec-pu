import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { findProductReferences, PRODUCT_BLOCKING_TABLES } from '@/lib/products/references'
import { deleteProductsAtomically } from '@/lib/products/delete-tx'

/**
 * Delete products, but never at the cost of business history.
 *
 * This MUST run server-side. page_post_ads, page_comments and
 * messenger_conversations have RLS enabled with no SELECT policy, so a browser
 * client counting them always reads zero rows or an error - it cannot tell
 * "no history" from "not allowed to look". Only the service role sees the
 * truth, and guessing here means deleting purchase orders and deliveries.
 *
 * POST { productIds, dryRun }
 *  dryRun -> report what blocks deletion, delete nothing
 *  else   -> delete only the products nothing references
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const productIds: string[] = Array.isArray(body?.productIds)
      ? body.productIds.filter((id: unknown) => typeof id === 'string')
      : []
    const dryRun = body?.dryRun === true
    // Opt-in only, and never set by bulk "Clear all". Unlinks purchase orders
    // (their product_name snapshot keeps them readable) and ad/comment/
    // conversation matches, and DELETES stock count entries, which have no
    // name of their own. Deliveries and stock movements still block.
    const detach = body?.detach === true

    if (!productIds.length) {
      return NextResponse.json({ success: false, error: 'No products supplied' }, { status: 400 })
    }

    const admin = createAdminClient()

    const { references, unreadable } = await findProductReferences(admin, productIds)
    if (unreadable.length) {
      return NextResponse.json(
        {
          success: false,
          error: `Could not check whether these products are still in use (${unreadable.join(', ')}). Nothing was deleted.`,
        },
        { status: 500 },
      )
    }

    // Which individual products are referenced, split by what a forced delete
    // would DO to the reference. 'block' tables refuse outright; the rest can
    // be detached, but only when the caller has explicitly agreed.
    const blockedByPolicy = new Set<string>()
    const detachable = new Set<string>()
    const batchSize = 100
    for (const ref of PRODUCT_BLOCKING_TABLES) {
      const target = ref.removal === 'block' ? blockedByPolicy : detachable
      for (let i = 0; i < productIds.length; i += batchSize) {
        const batch = productIds.slice(i, i + batchSize)
        let scan = admin.from(ref.table).select(ref.column).in(ref.column, batch)
        if (ref.filter) scan = scan.eq(ref.filter.column, ref.filter.value)
        const { data, error } = await scan
        if (error) {
          return NextResponse.json(
            { success: false, error: `Could not check ${ref.table}. Nothing was deleted.` },
            { status: 500 },
          )
        }
        for (const row of data || []) {
          const v = (row as unknown as Record<string, unknown>)[ref.column]
          if (typeof v === 'string') target.add(v)
        }
      }
    }

    const blocked = new Set<string>([
      ...blockedByPolicy,
      ...(detach ? [] : [...detachable].filter(id => !blockedByPolicy.has(id))),
    ])
    const deletable = productIds.filter(id => !blocked.has(id))

    if (dryRun) {
      return NextResponse.json({
        success: true,
        references,
        blockedIds: [...blocked],
        deletableCount: deletable.length,
        // Lets the UI offer a forced delete only when nothing hard-blocks, and
        // spell out exactly which records go with it.
        hardBlockedCount: blockedByPolicy.size,
        detachableCount: [...detachable].filter(id => !blockedByPolicy.has(id)).length,
      })
    }

    // Forced deletes detach AND delete inside one transaction, so a refusal
    // at the final step cannot leave stock count entries already erased.
    if (detach && deletable.length) {
      const { data: named } = await admin.from('products').select('id, name').in('id', deletable)
      const productNames: Record<string, string> = {}
      for (const p of named || []) {
        const row = p as { id: string; name: string | null }
        if (row.name) productNames[row.id] = row.name
      }

      try {
        const res = await deleteProductsAtomically(deletable, productNames)
        return NextResponse.json({
          success: true,
          deleted: res.deleted,
          unlinked: res.unlinked,
          detachedRows: res.detachedRows,
          references,
          blockedIds: [...blocked],
        })
      } catch (error) {
        const message = (error as Error).message
        console.error('[v0] Atomic product delete rolled back:', message)
        const structural = /violates (foreign key|check) constraint/i.test(message)
        return NextResponse.json(
          {
            success: false,
            error: structural
              ? 'The database still has records tied to this product that can\u2019t be separated from it, so nothing was deleted or changed. Deactivate it instead.'
              : `${message}. Nothing was deleted or changed.`,
          },
          { status: 500 },
        )
      }
    }

    // Plain path: only products that nothing references at all.
    let deleted = 0
    for (let i = 0; i < deletable.length; i += batchSize) {
      const batch = deletable.slice(i, i + batchSize)
      const { error } = await admin.from('products').delete().in('id', batch)
      if (error) {
        // A raw "violates check constraint" reaching the screen means some
        // table still holds on to the product in a way the pre-flight check
        // doesn't model. Say that plainly instead of leaking Postgres, and
        // keep the detail in the log so it can be added to the policy list.
        console.error('[v0] Product delete refused by database:', error.message)
        const structural = /violates (foreign key|check) constraint/i.test(error.message)
        return NextResponse.json(
          {
            success: false,
            error: structural
              ? 'The database still has records tied to this product that can\u2019t be separated from it, so nothing was deleted. Deactivate it instead.'
              : error.message,
          },
          { status: 500 },
        )
      }
      deleted += batch.length
    }

    return NextResponse.json({
      success: true,
      deleted,
      unlinked: 0,
      detachedRows: 0,
      references,
      blockedIds: [...blocked],
    })
  } catch (error) {
    console.error('[v0] Product delete error:', error)
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 })
  }
}
