import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { buildPlan, UPDATABLE_FIELDS, type DbRow, type FileRow, type ReconcilePlan } from '@/lib/deliveries/reconcile'

/**
 * Delivery reconciliation: preview and commit.
 *
 * A route handler rather than a server action on purpose - the monthly COMPILE
 * file is ~5,400 rows (a couple of MB of JSON) and server actions cap the body
 * at 1MB by default.
 *
 * Every commit is recorded in delivery_imports and every destructive step
 * (an update or a removal) snapshots the previous row into delivery_archive
 * first, so the whole batch can be reverted.
 */

export const maxDuration = 300

const SAMPLE = 250

interface ReconcileRequest {
  filename?: string
  month?: string
  rows?: FileRow[]
  mode?: 'preview' | 'commit'
  options?: {
    insertNew?: boolean
    applyUpdates?: boolean
    /** Remove rows that exist in the system but not in the file. Archived first. */
    removeDbOnly?: boolean
    /** 'exact' ignores variant-suffix matches when setting product_id. */
    productLinking?: 'exact' | 'exact+variant' | 'none'
    /** Only apply changes to these fields. Defaults to all updatable fields. */
    fields?: string[]
  }
}

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, 1))
  const end = new Date(Date.UTC(y, m, 1))
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

async function loadDbRows(db: ReturnType<typeof createAdminClient>, start: string, end: string) {
  const cols =
    'id,delivery_date,customer_name,contact_1,contact_2,products,amount,qty,sales_type,medium,notes,rte,locality,entry_date,payment_method,rider_id,contractor_id,status'
  const out: DbRow[] = []
  // PostgREST caps a plain select at 1,000 rows - paging is mandatory here or
  // the plan silently reconciles against a truncated view of the month.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('deliveries')
      .select(cols)
      .gte('delivery_date', start)
      .lt('delivery_date', end)
      .order('id')
      .range(from, from + 999)
    if (error) throw new Error(`loading existing deliveries: ${error.message}`)
    if (!data?.length) break
    out.push(...(data as unknown as DbRow[]))
    if (data.length < 1000) break
  }
  return out
}

function summarise(plan: ReconcilePlan) {
  const productWarnings = new Map<string, number>()
  const warningCounts: Record<string, number> = {}
  const fieldCounts: Record<string, number> = {}
  for (const r of [...plan.inserts, ...plan.updates, ...plan.unchanged]) {
    for (const w of r.warnings) warningCounts[w] = (warningCounts[w] ?? 0) + 1
    if (r.productMatch === 'none' && r.resolved.products) {
      productWarnings.set(r.resolved.products, (productWarnings.get(r.resolved.products) ?? 0) + 1)
    }
  }
  for (const u of plan.updates) for (const d of u.diffs) fieldCounts[d.field] = (fieldCounts[d.field] ?? 0) + 1

  return {
    stats: plan.stats,
    warningCounts,
    fieldCounts,
    unmatchedProducts: [...productWarnings.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, rows]) => ({ name, rows })),
    variantMatched: [
      ...new Set(
        [...plan.inserts, ...plan.updates, ...plan.unchanged]
          .filter((r) => r.productMatch === 'variant' && r.resolved.products)
          .map((r) => r.resolved.products as string),
      ),
    ].slice(0, 400),
    samples: {
      inserts: plan.inserts.slice(0, SAMPLE).map((r) => ({
        rowNumber: r.rowNumber,
        date: r.resolved.delivery_date,
        customer: r.resolved.customer_name,
        contact: r.resolved.contact_1,
        product: r.resolved.products,
        amount: r.resolved.amount,
        rte: r.resolved.rte,
        productMatch: r.productMatch,
        warnings: r.warnings,
      })),
      updates: plan.updates.slice(0, SAMPLE).map((r) => ({
        rowNumber: r.rowNumber,
        dbId: r.dbId,
        tier: r.tier,
        customer: r.resolved.customer_name,
        date: r.resolved.delivery_date,
        diffs: r.diffs,
      })),
      duplicates: plan.duplicates.slice(0, SAMPLE).map((r) => ({
        rowNumber: r.rowNumber,
        duplicateOf: r.duplicateOf,
        customer: r.resolved.customer_name,
        product: r.resolved.products,
        amount: r.resolved.amount,
        date: r.resolved.delivery_date,
      })),
      dbOnly: plan.dbOnly.slice(0, SAMPLE),
      skipped: plan.skipped.slice(0, SAMPLE),
    },
  }
}

export async function POST(request: Request) {
  let body: ReconcileRequest
  try {
    body = (await request.json()) as ReconcileRequest
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { rows, month, mode = 'preview', filename = 'reconcile.xlsx', options = {} } = body
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'No rows supplied' }, { status: 400 })
  }
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'A target month (YYYY-MM) is required' }, { status: 400 })
  }

  // Session first: an expired login must read as a session problem, not as a
  // data problem (middleware answers unauthenticated /api/* with a bare 401).
  const auth = await createClient()
  const {
    data: { user },
  } = await auth.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Your session has expired. Please sign in again.', reason: 'session' }, { status: 401 })
  }
  const { data: profile } = await auth.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['admin', 'owner', 'manager'].includes(profile.role)) {
    return NextResponse.json({ error: 'Only a manager, owner or admin can reconcile deliveries.' }, { status: 403 })
  }

  const db = createAdminClient()
  const { start, end } = monthBounds(month)

  let plan: ReconcilePlan
  try {
    const [dbRows, productsResult] = await Promise.all([
      loadDbRows(db, start, end),
      db.from('products').select('id,name'),
    ])
    if (productsResult.error) throw new Error(`loading products: ${productsResult.error.message}`)
    plan = buildPlan(rows, dbRows, (productsResult.data ?? []) as { id: string; name: string }[])
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error'
    console.log('[v0] reconcile: plan failed -', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  if (mode === 'preview') {
    return NextResponse.json({ month, mode, ...summarise(plan) })
  }

  /* ---------------- commit ---------------- */

  const insertNew = options.insertNew !== false
  const applyUpdates = options.applyUpdates !== false
  const removeDbOnly = options.removeDbOnly === true
  const productLinking = options.productLinking ?? 'exact+variant'
  const allowedFields = new Set(options.fields?.length ? options.fields : UPDATABLE_FIELDS)

  const { data: log, error: logError } = await db
    .from('delivery_imports')
    .insert({
      filename,
      total_rows: plan.stats.fileRows,
      status: 'processing',
      mode: 'reconcile',
      target_month: `${month}-01`,
      imported_by: user.id,
    })
    .select()
    .single()
  if (logError || !log) {
    return NextResponse.json({ error: `Could not open an import log: ${logError?.message}` }, { status: 500 })
  }

  const errors: string[] = []
  let inserted = 0
  let updated = 0
  let archived = 0
  let removed = 0

  const linkedProductId = (r: { product_id: string | null }, match: string) => {
    if (productLinking === 'none') return null
    if (productLinking === 'exact' && match !== 'exact') return null
    return r.product_id
  }

  try {
    // ---- 1. inserts ----
    if (insertNew && plan.inserts.length) {
      const payload = plan.inserts.map((r) => ({
        rte: r.resolved.rte,
        entry_date: r.resolved.entry_date ?? r.resolved.delivery_date,
        delivery_date: r.resolved.delivery_date,
        customer_name: r.resolved.customer_name,
        contact_1: r.resolved.contact_1,
        contact_2: r.resolved.contact_2,
        locality: r.resolved.locality,
        qty: r.resolved.qty,
        products: r.resolved.products,
        product_id: linkedProductId(r.resolved, r.productMatch),
        amount: r.resolved.amount,
        sales_type: r.resolved.sales_type,
        notes: r.resolved.notes,
        medium: r.resolved.medium,
        payment_method: r.resolved.payment_method,
        status: 'pending',
        import_batch_id: log.id,
        created_by: user.id,
      }))
      for (let i = 0; i < payload.length; i += 400) {
        const chunk = payload.slice(i, i + 400)
        const { error } = await db.from('deliveries').insert(chunk)
        if (error) errors.push(`insert rows ${i + 1}-${i + chunk.length}: ${error.message}`)
        else inserted += chunk.length
      }
    }

    // ---- 2. updates (snapshot first, so the batch can be reverted) ----
    if (applyUpdates && plan.updates.length) {
      const ids = plan.updates.map((u) => u.dbId)
      const before = new Map<string, Record<string, unknown>>()
      for (let i = 0; i < ids.length; i += 400) {
        const { data, error } = await db.from('deliveries').select('*').in('id', ids.slice(i, i + 400))
        if (error) {
          errors.push(`snapshot ${i + 1}: ${error.message}`)
          continue
        }
        for (const row of data ?? []) before.set(row.id as string, row as Record<string, unknown>)
      }

      const snapshots = plan.updates
        .filter((u) => before.has(u.dbId))
        .map((u) => ({
          delivery_id: u.dbId,
          import_id: log.id,
          reason: 'pre-update snapshot',
          delivery_date: u.resolved.delivery_date,
          snapshot: before.get(u.dbId)!,
          archived_by: user.id,
        }))
      for (let i = 0; i < snapshots.length; i += 300) {
        const chunk = snapshots.slice(i, i + 300)
        const { error } = await db.from('delivery_archive').insert(chunk)
        if (error) errors.push(`archive ${i + 1}-${i + chunk.length}: ${error.message}`)
        else archived += chunk.length
      }

      // An update whose snapshot failed is NOT applied - otherwise the change
      // would be irreversible, which defeats the point of the batch log.
      const archivedIds = new Set(snapshots.map((s) => s.delivery_id))
      for (const u of plan.updates) {
        if (!archivedIds.has(u.dbId)) continue
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
        for (const d of u.diffs) {
          if (!allowedFields.has(d.field as (typeof UPDATABLE_FIELDS)[number])) continue
          patch[d.field] = d.to
        }
        if (u.productMatch !== 'none') {
          const pid = linkedProductId(u.resolved, u.productMatch)
          if (pid) patch.product_id = pid
        }
        if (Object.keys(patch).length === 1) continue
        const { error } = await db.from('deliveries').update(patch).eq('id', u.dbId)
        if (error) errors.push(`update ${u.dbId}: ${error.message}`)
        else updated++
      }
    }

    // ---- 3. optional removal of rows absent from the file ----
    if (removeDbOnly && plan.dbOnly.length) {
      const ids = plan.dbOnly.map((d) => d.id)
      for (let i = 0; i < ids.length; i += 300) {
        const slice = ids.slice(i, i + 300)
        const { data, error: selError } = await db.from('deliveries').select('*').in('id', slice)
        if (selError) {
          errors.push(`read before removal ${i + 1}: ${selError.message}`)
          continue
        }
        const snaps = (data ?? []).map((row) => ({
          delivery_id: row.id as string,
          import_id: log.id,
          reason: 'removed - absent from reconciled file',
          delivery_date: (row.delivery_date as string)?.slice(0, 10) ?? null,
          snapshot: row as Record<string, unknown>,
          archived_by: user.id,
        }))
        const { error: arcError } = await db.from('delivery_archive').insert(snaps)
        if (arcError) {
          errors.push(`archive before removal ${i + 1}: ${arcError.message} (rows kept)`)
          continue
        }
        archived += snaps.length
        const { error: delError } = await db
          .from('deliveries')
          .delete()
          .in('id', snaps.map((s) => s.delivery_id))
        if (delError) errors.push(`remove ${i + 1}: ${delError.message}`)
        else removed += snaps.length
      }
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : 'unknown error')
  }

  const { error: closeError } = await db
    .from('delivery_imports')
    .update({
      successful_rows: inserted + updated,
      failed_rows: errors.length,
      skipped_rows: plan.stats.duplicates + plan.stats.skipped + plan.stats.unchanged,
      archived_rows: archived,
      deleted_rows: removed,
      status: errors.length ? 'completed_with_errors' : 'completed',
      completed_at: new Date().toISOString(),
      error_message: errors.length ? errors.slice(0, 10).join('; ') : null,
      warnings: errors.slice(0, 50),
    })
    .eq('id', log.id)
  if (closeError) {
    // delivery_imports had no UPDATE policy for a long time and this write
    // failed silently for 192 imports. Never swallow it again.
    console.log('[v0] reconcile: could not close import log -', closeError.message)
    errors.push(`import log not closed: ${closeError.message}`)
  }

  return NextResponse.json({
    month,
    mode,
    importId: log.id,
    inserted,
    updated,
    archived,
    removed,
    unchanged: plan.stats.unchanged,
    duplicates: plan.stats.duplicates,
    skipped: plan.stats.skipped,
    errors: errors.slice(0, 25),
  })
}
