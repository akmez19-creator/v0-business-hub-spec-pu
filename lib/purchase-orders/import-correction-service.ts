import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PO_STATUSES } from './workflow'
import { IMPORT_CORRECTION_FIELDS, type ImportRecord } from './import-correction-fields'
import { reorderRequestHash } from './reorder-service'
import { safeImportLink } from './reorder-reference'

const uuid = z.string().uuid()
export async function loadImportForCorrection(db: SupabaseClient, id: string): Promise<ImportRecord> {
  const { data, error } = await db.from('purchase_orders').select('*').eq('id', uuid.parse(id)).maybeSingle()
  if (error || !data) throw new Error('This import record could not be loaded. It may have been removed.')
  return data as ImportRecord
}
export interface ImportCorrectionInput {
  id: string
  requestKey: string
  expected: ImportRecord
  patch: Record<string, unknown>
  reason: string
  acknowledged: boolean
}
export async function correctImportRecord(db: SupabaseClient, actor: string, raw: ImportCorrectionInput) {
  const input = z
    .object({
      id: uuid,
      requestKey: uuid,
      expected: z.record(z.unknown()),
      patch: z.record(z.unknown()),
      reason: z.string().trim().min(5).max(4000),
      acknowledged: z.literal(true),
    })
    .parse(raw)
  if (input.expected.id !== input.id) throw new Error('The reviewed import ID does not match the correction.')
  if (!Object.keys(input.patch).length) throw new Error('There are no changes to save.')
  for (const [key, value] of Object.entries(input.patch)) {
    if (['product_id', 'variant_id'].includes(key)) {
      uuid.nullable().parse(value)
      continue
    }
    const field = IMPORT_CORRECTION_FIELDS.find((field) => field.key === key)
    if (!field) throw new Error('Unsupported correction field.')
    if (field.kind === 'number') {
      let schema = z
        .number()
        .finite()
        .min(key === 'discounted_percentage' ? -100 : 0)
        .max(key === 'discounted_percentage' ? 100 : key === 'cbm' ? 9_999.9999 : key === 'weight_kg' ? 999_999.99 : ['unit_price','discounted_unit_price','shipment_to_warehouse','discounted_shipment_to_warehouse','cbm_cost','import_cp'].includes(key) ? 99_999_999.99 : 999_999_999.99)
      if (['qty', 'boxes'].includes(key)) schema = schema.int()
      schema.nullable().parse(value)
    } else if (field.kind === 'date') {
      if (value !== null) {
        const day = z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .parse(value)
        const parsed = new Date(`${day}T00:00:00Z`)
        if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day)
          throw new Error('Enter a real calendar date.')
      }
    } else if (field.kind === 'status') {
      z.enum(['pending', 'Cancelled', ...PO_STATUSES])
        .nullable()
        .parse(value)
    } else {
      z.string().max(4000).nullable().parse(value)
      if (field.kind === 'url' && value && !safeImportLink(String(value)))
        throw new Error('Use a valid HTTP or HTTPS link.')
    }
  }
  const hash = reorderRequestHash(actor, 'correction', input)
  const { data, error } = await db.rpc('import_correct_purchase', {
    p_actor: actor,
    p_id: input.id,
    p_key: input.requestKey,
    p_hash: hash,
    p_expected: input.expected,
    p_patch: input.patch,
    p_reason: input.reason,
  })
  if (error) throw new Error(error.message)
  return data as { id: string; updatedAt: string }
}
