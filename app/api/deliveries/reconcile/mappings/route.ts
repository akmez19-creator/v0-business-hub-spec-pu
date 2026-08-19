import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { SYSTEM_STATUSES } from '@/lib/deliveries/reconcile'

/**
 * Read and write the reconcile importer's saved mappings.
 *
 * These live in `import_mappings`, the same table the older delivery importer
 * writes, so a name mapped in either place is understood by both and survives
 * to next month's file. That shared table is the reason this is a small route
 * of its own rather than more options on the reconcile POST: mappings outlive a
 * single preview, so saving one must not require re-uploading the spreadsheet.
 *
 * `mapping_type` vocabulary (UNIQUE on mapping_type + source_value):
 *   status            source_value = raw file status, target_value = system status
 *   rider             source_value = raw file rider name, target_id = riders.id
 *   product           source_value = raw file product name, target_id = products.id
 *   rider_contractor  source_value = riders.id, target_id = contractors.id
 */

type MappingType = 'status' | 'rider' | 'product'

const WRITABLE: MappingType[] = ['status', 'rider', 'product']

interface SaveBody {
  mappings?: { type: MappingType; source: string; target: string }[]
}

/** Manager and up, mirroring the reconcile route so both agree on who may map. */
async function requireManager() {
  const auth = await createClient()
  const {
    data: { user },
  } = await auth.auth.getUser()
  if (!user) {
    return {
      error: NextResponse.json(
        { error: 'Your session has expired. Please sign in again.', reason: 'session' },
        { status: 401 },
      ),
    }
  }
  const { data: profile } = await auth.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !['admin', 'owner', 'manager'].includes(profile.role)) {
    return { error: NextResponse.json({ error: 'Only a manager, owner or admin can edit mappings.' }, { status: 403 }) }
  }
  return { userId: user.id }
}

export async function GET() {
  const gate = await requireManager()
  if (gate.error) return gate.error

  const db = createAdminClient()
  const [ridersResult, contractorsResult, productsResult, mappingsResult] = await Promise.all([
    db.from('riders').select('id,name,contractor_id').order('name'),
    db.from('contractors').select('id,name').order('name'),
    db.from('products').select('id,name').order('name'),
    db.from('import_mappings').select('mapping_type,source_value,target_id,target_value'),
  ])
  const failed = [ridersResult, contractorsResult, productsResult, mappingsResult].find((r) => r.error)
  if (failed?.error) {
    console.log('[v0] reconcile/mappings: load failed -', failed.error.message)
    return NextResponse.json({ error: failed.error.message }, { status: 500 })
  }

  return NextResponse.json({
    statuses: SYSTEM_STATUSES,
    riders: ridersResult.data ?? [],
    contractors: contractorsResult.data ?? [],
    products: productsResult.data ?? [],
    existing: (mappingsResult.data ?? [])
      .filter((m) => WRITABLE.includes(m.mapping_type as MappingType))
      .map((m) => ({
        type: m.mapping_type as MappingType,
        source: m.source_value as string,
        target: (m.target_id ?? m.target_value ?? '') as string,
      })),
  })
}

export async function POST(request: Request) {
  const gate = await requireManager()
  if (gate.error) return gate.error

  let body: SaveBody
  try {
    body = (await request.json()) as SaveBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const incoming = Array.isArray(body.mappings) ? body.mappings : []
  if (incoming.length === 0) return NextResponse.json({ error: 'No mappings supplied' }, { status: 400 })

  // Validate before touching the table: a bad status would be written happily
  // here and then rejected by the deliveries CHECK constraint at commit time,
  // which is a much harder error to trace back to this screen.
  const rows: {
    mapping_type: string
    source_value: string
    target_id: string | null
    target_value: string | null
    created_by: string
    updated_at: string
  }[] = []
  for (const m of incoming) {
    const source = typeof m?.source === 'string' ? m.source.trim() : ''
    const target = typeof m?.target === 'string' ? m.target.trim() : ''
    if (!source || !target) continue
    if (!WRITABLE.includes(m.type)) {
      return NextResponse.json({ error: `Unsupported mapping type "${m.type}".` }, { status: 400 })
    }
    if (m.type === 'status' && !(SYSTEM_STATUSES as readonly string[]).includes(target)) {
      return NextResponse.json({ error: `"${target}" is not a system status.` }, { status: 400 })
    }
    rows.push({
      mapping_type: m.type,
      source_value: source,
      target_id: m.type === 'status' ? null : target,
      target_value: m.type === 'status' ? target : null,
      created_by: gate.userId!,
      updated_at: new Date().toISOString(),
    })
  }
  if (rows.length === 0) return NextResponse.json({ error: 'No usable mappings supplied' }, { status: 400 })

  const db = createAdminClient()
  // Remapping a value that was already mapped must replace it, not fail, hence
  // upsert on the table's UNIQUE (mapping_type, source_value).
  const { error } = await db.from('import_mappings').upsert(rows, { onConflict: 'mapping_type,source_value' })
  if (error) {
    console.log('[v0] reconcile/mappings: save failed -', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ saved: rows.length })
}
