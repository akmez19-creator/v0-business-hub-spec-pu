import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import {
  buildPlan,
  normDate,
  UPDATABLE_FIELDS,
  LINK_FIELDS,
  type ContractorPolicy,
  type DbRow,
  type FileRow,
  type ProductPolicy,
  type ReconcileLookups,
  type ReconcilePlan,
  type StatusPolicy,
} from '@/lib/deliveries/reconcile'

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
    /**
     * Reconcile only these delivery dates (YYYY-MM-DD). Omit for every date in
     * the file. Days not listed are left completely untouched.
     */
    dates?: string[]
    /**
     * How the file's Status column is applied. 'forward' (default) never moves a
     * row backwards, so a delivered row cannot be reset to pending.
     */
    statusPolicy?: StatusPolicy
    /**
     * How the file's Rider column is applied. 'fill' (default) only populates an
     * empty rider/contractor and never reassigns existing dispatch work.
     */
    contractorPolicy?: ContractorPolicy
  }
}

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, 1))
  const end = new Date(Date.UTC(y, m, 1))
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

/** Exclusive upper bound for a YYYY-MM-DD day. */
function dayAfter(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * The window of existing entries to compare against is taken from the DELIVERY
 * DATES IN THE FILE, not from the calendar month.
 *
 * Entry date is useless for this: in the real August file every single row has
 * an entry date in July (the order was taken weeks before it shipped), so
 * anything keyed on entry date would look like a different month entirely.
 *
 * Scoping to the file's own dates also closes a real hole - a row whose
 * delivery date falls outside the chosen month used to be compared against a
 * window that had never been loaded, so it could only ever be inserted as new
 * even when it already existed.
 */
function dbWindow(dates: string[], month: string): { start: string; end: string } {
  if (!dates.length) return monthBounds(month)
  const sorted = [...dates].sort()
  const monthWin = monthBounds(month)
  // Union with the month so a date the file omits is still visible as an
  // existing entry the file did not mention.
  const start = sorted[0] < monthWin.start ? sorted[0] : monthWin.start
  const endExclusive = dayAfter(sorted[sorted.length - 1])
  const end = endExclusive > monthWin.end ? endExclusive : monthWin.end
  return { start, end }
}

async function loadDbRows(db: ReturnType<typeof createAdminClient>, start: string, end: string) {
  const cols =
    'id,delivery_date,customer_name,contact_1,contact_2,products,amount,qty,sales_type,medium,notes,rte,locality,entry_date,payment_method,rider_id,contractor_id,status,product_id'
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

/**
 * Build the name->id lookups from the tables the app already maintains, so a
 * reconcile resolves names exactly like the importer does.
 *
 * - import_mappings(status)           raw status text  -> system status
 * - import_mappings(rider)            rider name       -> rider id
 * - import_mappings(rider_contractor) rider id         -> contractor id
 * - riders.name / riders.contractor_id are the fallbacks for both
 *
 * Saved mappings win over the name match, because they are the operator's
 * explicit decision about an ambiguous spelling.
 */
async function loadLookups(db: ReturnType<typeof createAdminClient>): Promise<ReconcileLookups> {
  const [mappingsResult, ridersResult] = await Promise.all([
    db.from('import_mappings').select('mapping_type,source_value,target_id,target_value'),
    db.from('riders').select('id,name,contractor_id'),
  ])
  if (mappingsResult.error) throw new Error(`loading import mappings: ${mappingsResult.error.message}`)
  if (ridersResult.error) throw new Error(`loading riders: ${ridersResult.error.message}`)

  const statusByRaw = new Map<string, string>()
  const riderByName = new Map<string, string>()
  const contractorByRider = new Map<string, string>()

  // Rider names first so an explicit mapping can overwrite them below.
  for (const r of ridersResult.data ?? []) {
    const name = (r.name as string | null)?.trim().toLowerCase()
    if (name) riderByName.set(name, r.id as string)
    if (r.contractor_id) contractorByRider.set(r.id as string, r.contractor_id as string)
  }
  for (const m of mappingsResult.data ?? []) {
    const src = (m.source_value as string | null)?.trim()
    if (!src) continue
    if (m.mapping_type === 'status' && m.target_value) {
      statusByRaw.set(src.toLowerCase(), String(m.target_value).trim().toLowerCase())
    } else if (m.mapping_type === 'rider' && m.target_id) {
      riderByName.set(src.toLowerCase(), m.target_id as string)
    } else if (m.mapping_type === 'rider_contractor' && m.target_id) {
      // source_value is a rider id here, not a name.
      contractorByRider.set(src, m.target_id as string)
    }
  }
  return { statusByRaw, riderByName, contractorByRider }
}

/**
 * Split the file's ambiguous "Rider" column into a person and a route label.
 *
 * COMPILE files reuse one column for both: some months list route labels
 * (WEST, TRIOLET), others list people (DIVESH, MOON). A value counts as a person
 * only when it matches a known rider name; everything else falls through to
 * `zone`, which is how that column behaved before. This is what stops a route
 * label from ever being written into `rider_id`.
 */
function classifyRiderColumn(rows: FileRow[], lookups: ReconcileLookups): void {
  for (const row of rows) {
    const raw = (row as unknown as Record<string, unknown>).rider_raw
    const value = raw === null || raw === undefined ? '' : String(raw).trim()
    if (!value) continue
    if (lookups.riderByName?.has(value.toLowerCase())) row.rider = value
    else if (!row.zone) row.zone = value
  }
}

function summarise(plan: ReconcilePlan) {
  const productWarnings = new Map<string, number>()
  const warningCounts: Record<string, number> = {}
  const fieldCounts: Record<string, number> = {}
  for (const r of [...plan.inserts, ...plan.updates, ...plan.unchanged, ...plan.flagged]) {
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
      // Product mismatches on an identical name+number+date. Review only -
      // these are never written by a commit.
      flagged: plan.flagged.slice(0, SAMPLE).map((r) => ({
        rowNumber: r.rowNumber,
        dbId: r.dbId,
        tier: r.tier,
        customer: r.resolved.customer_name,
        contact: r.resolved.contact_1,
        date: r.resolved.delivery_date,
        fileProduct: r.resolved.products,
        dbProduct: r.dbProducts,
        fileAmount: r.resolved.amount,
        dbAmount: r.dbAmount,
        otherDiffs: r.diffs.filter((d) => d.field !== 'products'),
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
      // Status rewinds and contractor reassignments that were withheld.
      blocked: plan.blocked.slice(0, SAMPLE),
    },
    blockedByReason: plan.blocked.reduce<Record<string, number>>((acc, b) => {
      const key = `${b.field}: ${b.reason}`
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {}),
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

  // Every distinct delivery date the spreadsheet actually contains.
  const fileDates = [...new Set(rows.map((r) => normDate(r.delivery_date)).filter(Boolean))].sort()
  const requestedDates = options.dates?.length ? options.dates.filter((d) => fileDates.includes(d)) : null
  if (options.dates && options.dates.length > 0 && requestedDates!.length === 0) {
    return NextResponse.json(
      { error: 'None of the selected dates appear in this file.' },
      { status: 400 },
    )
  }
  const { start, end } = dbWindow(requestedDates ?? fileDates, month)

  // 'exact+variant' would let "Auto Door Closer - Set of 3" set the id of
  // "Auto Door Closer", so the product policy is exact-only unless the operator
  // widens it. Anything unmatched is mappable by hand instead of guessed.
  const productLinking = options.productLinking ?? 'exact'
  const productPolicy: ProductPolicy =
    productLinking === 'none' ? 'off' : productLinking === 'exact+variant' ? 'variant' : 'exact'
  const statusPolicy: StatusPolicy = options.statusPolicy ?? 'forward'
  const contractorPolicy: ContractorPolicy = options.contractorPolicy ?? 'fill'

  let plan: ReconcilePlan
  try {
    const [dbRows, productsResult, lookups] = await Promise.all([
      loadDbRows(db, start, end),
      db.from('products').select('id,name'),
      loadLookups(db),
    ])
    if (productsResult.error) throw new Error(`loading products: ${productsResult.error.message}`)
    // Needs the rider names, so it can only run once the lookups are loaded.
    classifyRiderColumn(rows, lookups)
    plan = buildPlan(rows, dbRows, (productsResult.data ?? []) as { id: string; name: string }[], {
      dates: requestedDates ?? undefined,
      month,
      lookups,
      policies: { status: statusPolicy, contractor: contractorPolicy, product: productPolicy },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error'
    console.log('[v0] reconcile: plan failed -', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  // The dates this run actually covers - all of the file's dates unless the
  // operator narrowed it down.
  const scopedDates = requestedDates ?? fileDates

  if (mode === 'preview') {
    return NextResponse.json({ month, mode, fileDates, scopedDates, ...summarise(plan) })
  }

  /* ---------------- commit ---------------- */

  const insertNew = options.insertNew !== false
  const applyUpdates = options.applyUpdates !== false
  const removeDbOnly = options.removeDbOnly === true
  const allowedFields = new Set<string>(options.fields?.length ? options.fields : UPDATABLE_FIELDS)
  // Link columns are reachable only while their policy is on. The plan has
  // already applied the guards, so this is the second of two gates.
  for (const f of LINK_FIELDS) {
    const on =
      f === 'status'
        ? statusPolicy !== 'off'
        : f === 'product_id'
          ? productPolicy !== 'off'
          : contractorPolicy !== 'off' && contractorPolicy !== 'report'
    if (on) allowedFields.add(f)
    else allowedFields.delete(f)
  }

  // A partial run is labelled in the filename so the import history shows which
  // days were applied. delivery_imports has no column for this and the label is
  // worth more than a migration here.
  const partial = requestedDates !== null && requestedDates.length < fileDates.length
  const loggedName = partial
    ? `${filename} [${requestedDates!.length === 1 ? requestedDates![0] : `${requestedDates!.length} dates: ${requestedDates![0]}..${requestedDates![requestedDates!.length - 1]}`}]`
    : filename

  const { data: log, error: logError } = await db
    .from('delivery_imports')
    .insert({
      filename: loggedName,
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
        // Already gated by the product policy inside the plan.
        product_id: r.resolved.product_id,
        amount: r.resolved.amount,
        sales_type: r.resolved.sales_type,
        notes: r.resolved.notes,
        medium: r.resolved.medium,
        payment_method: r.resolved.payment_method,
        // A brand new row has no history to protect, so the file's own status
        // stands. Falls back to pending when the file has none or it is unmapped.
        status: statusPolicy === 'off' ? 'pending' : (r.resolved.status ?? 'pending'),
        // Only on inserts: cash/bank splits on an EXISTING row are collection
        // facts and are never rewritten from a file.
        payment_cash: r.resolved.payment_method === 'cash' ? r.resolved.amount : 0,
        payment_bank: r.resolved.payment_method === 'paid' ? r.resolved.amount : 0,
        ...(contractorPolicy === 'off' || contractorPolicy === 'report'
          ? {}
          : {
              rider_id: r.resolved.rider_id,
              contractor_id: r.resolved.contractor_id,
              assigned_at: r.resolved.rider_id ? new Date().toISOString() : null,
              assigned_by: r.resolved.rider_id ? user.id : null,
            }),
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
        // The plan is the only thing that decides what changes; every diff has
        // already passed the status/contractor/product guards.
        for (const d of u.diffs) {
          if (!allowedFields.has(d.field)) continue
          patch[d.field] = d.to
        }
        // Stamp the assignment trail when this run is what linked the rider.
        if (patch.rider_id) {
          patch.assigned_at = new Date().toISOString()
          patch.assigned_by = user.id
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
      // flagged rows are intentionally held back for review, so they count as
      // "not applied" rather than as failures.
      skipped_rows:
        plan.stats.duplicates + plan.stats.skipped + plan.stats.unchanged + plan.stats.flagged,
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
    scopedDates,
    outOfScope: plan.stats.outOfScope,
    inserted,
    updated,
    archived,
    removed,
    unchanged: plan.stats.unchanged,
    flagged: plan.stats.flagged,
    duplicates: plan.stats.duplicates,
    skipped: plan.stats.skipped,
    errors: errors.slice(0, 25),
  })
}
