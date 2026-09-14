import 'server-only'

import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase/fetch-all'
import type { QualityNote, QualityNoteInput, QualityPage, Shop1688, SupplierQualitySummary } from './1688-types'

export const QUALITY_COLUMNS = 'id,display_name,member_id,internal_rating,quality_revision,note_count,defect_count,latest_note,latest_note_at,latest_note_author,platform_rating,platform_ratings,platform_observed_at,platform_attempt_at,platform_status,platform_error'
export const QUALITY_NOTE_COLUMNS = 'id,body,kind,author_name,created_at,product_caption,import_caption,rating_before,rating_after,rating_changed'
type ProfileRow = {
  id: string; display_name: string; member_id: string | null; internal_rating: number | null; quality_revision: number
  note_count: number; defect_count: number; latest_note: string | null; latest_note_at: string | null; latest_note_author: string | null
  platform_rating: number | null; platform_ratings: Shop1688['ratings']; platform_observed_at: string | null
  platform_attempt_at: string | null; platform_status: SupplierQualitySummary['platformStatus']; platform_error: string | null
}

export { loadSupplierQuality }

async function loadSupplierQuality(db: SupabaseClient): Promise<SupplierQualitySummary[]> {
  const [profiles, aliases] = await Promise.all([
    fetchAll<ProfileRow>((from, to) => db.from('foreign_supplier_profiles').select(QUALITY_COLUMNS).order('id').range(from, to)),
    fetchAll<{ legacy_name: string; profile_id: string }>((from, to) => db.from('foreign_supplier_aliases').select('legacy_name,profile_id').order('legacy_name').range(from, to)),
  ])
  return profiles.map(profile => ({
    id: profile.id, name: profile.display_name, memberId: profile.member_id,
    aliases: aliases.filter(alias => alias.profile_id === profile.id).map(alias => alias.legacy_name),
    internalRating: profile.internal_rating, revision: profile.quality_revision,
    noteCount: profile.note_count, defectCount: profile.defect_count,
    latestNote: profile.latest_note, latestNoteAt: profile.latest_note_at, latestNoteAuthor: profile.latest_note_author,
    platformRating: profile.platform_rating == null ? null : Number(profile.platform_rating),
    platformRatings: profile.platform_ratings ?? [], platformObservedAt: profile.platform_observed_at,
    platformAttemptAt: profile.platform_attempt_at, platformStatus: profile.platform_status, platformError: profile.platform_error,
  }))
}

export async function readQualityPage(db: SupabaseClient, name: string, cursor: string | null): Promise<QualityPage> {
  const supplierName = z.string().trim().min(1).max(500).parse(name)
  const summary = (await loadSupplierQuality(db)).find(profile => profile.aliases.includes(supplierName)) ?? null
  if (!summary) return { summary: null, notes: [], nextCursor: null }
  let query = db.from('foreign_supplier_quality_notes').select(QUALITY_NOTE_COLUMNS).eq('profile_id', summary.id)
  if (cursor) {
    const [at, id] = cursor.split('|')
    z.string().datetime({ offset: true }).parse(at)
    z.string().uuid().parse(id)
    query = query.or(`created_at.lt.${at},and(created_at.eq.${at},id.lt.${id})`)
  }
  const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(26)
  if (error) throw new Error('Could not read supplier notes. Please retry.')
  const visible = (data ?? []).slice(0, 25)
  const notes: QualityNote[] = visible.map(note => ({
    id: note.id, body: note.body, kind: note.kind, authorName: note.author_name, createdAt: note.created_at,
    productCaption: note.product_caption, importCaption: note.import_caption,
    ratingBefore: note.rating_before, ratingAfter: note.rating_after, ratingChanged: note.rating_changed,
  }))
  const last = visible.at(-1)
  return { summary, notes, nextCursor: data && data.length > 25 && last ? `${last.created_at}|${last.id}` : null }
}

const noteSchema = z.object({
  name: z.string().trim().min(1).max(500), revision: z.number().int().nonnegative(),
  rating: z.number().int().min(1).max(5).nullable(), body: z.string().trim().min(1).max(4000),
  kind: z.enum(['general', 'defect']), productId: z.string().uuid().nullable(), importId: z.string().uuid().nullable(),
  requestKey: z.string().uuid(),
}).strict()

export async function appendSupplierNote(db: SupabaseClient, actor: string, input: QualityNoteInput): Promise<SupplierQualitySummary> {
  const { requestKey, ...payload } = noteSchema.parse(input)
  const hash = createHash('sha256').update(JSON.stringify({ actor, payload })).digest('hex')
  const { data: id, error } = await db.rpc('foreign_supplier_save_note', { p_actor: actor, p_key: requestKey, p_hash: hash, p_payload: payload })
  if (error) {
    if (error.code === '40001') throw new Error('Supplier changed. Review the latest rating and notes before saving.')
    if (/another supplier|does not match|no longer exists|Request key/.test(error.message)) throw new Error(error.message)
    throw new Error('Could not save the quality note. Your rating and history were not changed; retry with your text intact.')
  }
  const summary = (await loadSupplierQuality(db)).find(profile => profile.id === id)
  if (!summary) throw new Error('The note was submitted, but its summary could not be reloaded. Retry safely with the same request.')
  return summary
}

export async function observeSupplier(db: SupabaseClient, actor: string, shop: Shop1688, knownNames: string[]) {
  const profiles = await loadSupplierQuality(db)
  const existing = profiles.find(profile => profile.memberId === shop.memberId)
  const exactNames = [...new Set(knownNames.filter(name => shop.names.includes(name.trim())).map(name => name.trim()))]
  let id = existing?.id ?? null
  if (!id && exactNames.length === 1) {
    const { data, error } = await db.rpc('foreign_supplier_identity', { p_actor: actor, p_name: exactNames[0], p_member: shop.memberId, p_names: shop.names, p_confirmed: false })
    if (error) throw new Error(/Identity conflict/.test(error.message) ? error.message : 'Supplier identity could not be saved. No quality records were merged.')
    id = data
  }
  if (!id) return
  const { error } = await db.rpc('foreign_supplier_observe', { p_actor: actor, p_profile: id, p_member: shop.memberId, p_observation: shop })
  if (error) throw new Error('Shop checked, but its platform observation was not saved. Internal notes are unchanged.')
}

export async function confirmSupplierIdentity(db: SupabaseClient, actor: string, input: unknown) {
  const value = z.object({ itemId: z.string().uuid(), generation: z.number().int().positive(), offerId: z.string().regex(/^\d{6,}$/), supplierName: z.string().trim().min(1).max(500), confirmed: z.literal(true) }).strict().parse(input)
  const { data, error } = await db.from('import_reorder_1688_checks').select('generation,evidence').eq('item_id', value.itemId).single()
  if (error || data.generation !== value.generation) throw new Error('The saved check changed. Reload before linking a supplier.')
  const evidence = data.evidence as import('./1688-types').Evidence1688
  const offer = evidence.current?.offerId === value.offerId ? evidence.current : evidence.offers[value.offerId]
  const memberId = offer?.supplier.memberId
  if (!memberId) throw new Error('This saved listing has no verified shop ID to link.')
  const { error: bindError } = await db.rpc('foreign_supplier_identity', { p_actor: actor, p_name: value.supplierName, p_member: memberId, p_names: evidence.shops[memberId]?.names ?? [], p_confirmed: true })
  if (bindError) throw new Error(/Identity conflict/.test(bindError.message) ? bindError.message : 'Could not confirm supplier identity. Existing records were not merged.')
  const shop = evidence.shops[memberId]
  if (shop) await observeSupplier(db, actor, shop, [value.supplierName])
  return loadSupplierQuality(db)
}
