import 'server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { CHECK_COLUMNS, resolveContext } from './1688-check-service'
import { sameBaseContext, stableEvidence } from './1688-comparison'
import { aggregateSkuReviews, reviewSourcing, sourcingPurchasePreview, supplierPhoto } from './1688-sourcing-review'
import { sourcingGuard } from './1688-preferences'
import { legacyConfirmedAmounts } from './reorder-calculations'
import { safeImageBytes } from './1688-provider'
import { attemptUuid } from './1688-queue'
import type { SavedCheck1688 } from './1688-types'
import type { PreparedPhoto, SourcingConfirmation, SourcingInput, SourcingSelection, SourcingTerms, SourcingWorkspace } from './1688-sourcing-types'

export const SELECTION_COLUMNS = 'id,item_id,product_id,revision,status,preference_revision,snapshot,guard,photos,result,created_by,created_at,updated_at'
const uuid = z.string().uuid()
const revision = z.number().int().nonnegative()
const reviewSchema = z.object({ skuId: z.string().min(1).max(500), include: z.boolean(), reviewed: z.boolean(), destination: z.enum(['review', 'parent', 'existing', 'new']), variantId: uuid.nullable(), attributeName: z.string().trim().max(1000), attributeValue: z.string().trim().max(2000), qty: z.number().int().min(0).max(10_000_000).nullable(), keepPhoto: z.boolean(), samePreviousUnit: z.boolean() }).strict()
export const sourcingSchema = z.object({ itemId: uuid, itemRevision: revision, generation: revision, checkVersion: revision, offerId: z.string().regex(/^\d{6,}$/), guardHash: z.string().regex(/^[a-f0-9]{64}$/), selectionId: uuid, selectionRevision: revision, preferenceRevision: revision, convertToVariants: z.boolean(), quantityDifferenceAccepted: z.boolean(), unverifiedTermsAccepted: z.boolean(), reviews: z.array(reviewSchema).min(1).max(5000), requestKey: uuid }).strict()
const termsSchema = z.object({ orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value }).nullable(), chinaFreight: z.number().finite().min(0).max(99_999_999).nullable(), fxRate: z.number().finite().positive().max(100000).nullable() }).strict()
const mutationSchema = z.object({ id: uuid, revision, requestKey: uuid }).strict()
const requestHash = (actor: string, operation: string, input: unknown) => createHash('sha256').update(stableEvidence({ actor, operation, input })).digest('hex')
async function replay<T>(db: SupabaseClient, actor: string, key: string, hash: string): Promise<T | null> {
  const { data, error } = await db.from('import_purchase_events').select('actor_id,request_hash,result').eq('request_key', key).maybeSingle()
  if (error) throw new Error('Could not verify the previous save. Retry the same request.')
  if (!data) return null
  if (data.actor_id !== actor || data.request_hash !== hash) throw new Error('Request key already used with different content.')
  return data.result as T
}
async function mutate<T>(db: SupabaseClient, actor: string, operation: string, id: string, expected: number, key: string, hash: string, payload: unknown): Promise<T> {
  const { data, error } = await db.rpc('import_1688_selection', { p_actor: actor, p_operation: operation, p_id: id, p_revision: expected, p_key: key, p_hash: hash, p_payload: payload })
  if (error) {
    if (['PGRST202', '42883'].includes(error.code)) throw new Error('Sourcing confirmation is not yet enabled in the database. Nothing was purchased or changed in Inventory.')
    throw new Error(['40001', 'P0001', '42501'].includes(error.code) ? error.message : 'The selection could not be saved. No partial Inventory or purchase changes were applied.')
  }
  return data as T
}
export { loadSourcingSelections }

async function loadSourcingSelections(db: SupabaseClient) {
  return fetchAll<SourcingSelection>((from, to) => db.from('import_reorder_1688_selections').select(SELECTION_COLUMNS).order('created_at', { ascending: false }).order('id').range(from, to))
}
export async function getSourcingWorkspace(db: SupabaseClient, itemId: string): Promise<SourcingWorkspace> {
  uuid.parse(itemId)
  const [guard, selections] = await Promise.all([sourcingGuard(db, itemId), fetchAll<SourcingSelection>((from, to) => db.from('import_reorder_1688_selections').select(SELECTION_COLUMNS).eq('item_id', itemId).order('created_at', { ascending: false }).order('id').range(from, to))])
  return { guard, guardHash: createHash('sha256').update(stableEvidence(guard)).digest('hex'), preference: guard.preference ?? null, selection: selections.find(row => row.status === 'pending') ?? selections.find(row => row.status === 'confirmed') ?? null }
}
async function getSelection(db: SupabaseClient, id: string) {
  const { data, error } = await db.from('import_reorder_1688_selections').select(SELECTION_COLUMNS).eq('id', id).maybeSingle()
  if (error || !data) throw new Error('The saved replacement is unavailable. Reload its review.')
  return data as SourcingSelection
}
export async function saveSourcingSelection(db: SupabaseClient, actor: string, raw: SourcingInput) {
  const input = sourcingSchema.parse(raw)
  const hash = requestHash(actor, 'save', input)
  const prior = await replay<SourcingSelection>(db, actor, input.requestKey, hash)
  if (prior) return prior
  const workspace = await getSourcingWorkspace(db, input.itemId)
  if (workspace.guardHash !== input.guardHash) throw new Error('Inventory or previous purchase details changed after this preview. Reload and review the new values before saving.')
  const existing = workspace.selection?.id === input.selectionId && workspace.selection.status === 'pending' ? workspace.selection : null
  if (workspace.selection?.status === 'pending' && !existing) throw new Error('Another pending replacement already exists. Reload it before saving.')
  if (workspace.guard.item.revision !== input.itemRevision || (existing?.revision ?? 0) !== input.selectionRevision) throw new Error('The saved row or replacement changed. Reload before saving.')
  let check: SavedCheck1688
  if (existing && existing.snapshot.check.generation === input.generation && existing.snapshot.check.version === input.checkVersion) {
    check = existing.snapshot.check
  } else {
    const [rawCheck, context] = await Promise.all([db.from('import_reorder_1688_checks').select(CHECK_COLUMNS).eq('item_id', input.itemId).maybeSingle(), resolveContext(db, input.itemId)])
    if (rawCheck.error || !rawCheck.data) throw new Error('Save research before choosing a replacement.')
    check = rawCheck.data as SavedCheck1688
    if (check.generation !== input.generation || check.version !== input.checkVersion || !sameBaseContext(check.context, context)) throw new Error('The research is stale. Use current saved evidence before choosing a new source.')
    if (check.status === 'running' || check.lease_key && new Date(check.lease_until ?? '').getTime() > Date.now()) throw new Error('Finish or stop the background check before saving a replacement.')
  }
  input.reviews = aggregateSkuReviews(input.reviews).map(review => ({ ...review, variantId: review.destination === 'new' ? attemptUuid(`variant:${input.selectionId}:${review.skuId}`) : review.destination === 'parent' ? null : review.variantId }))
  const snapshot = reviewSourcing(input, check, workspace.guard, existing?.photos)
  if (!snapshot.rows.some(row => row.review.include)) throw new Error('Include at least one reviewed supplier SKU.')
  const blockers = snapshot.rows.filter(row => row.review.include).flatMap(row => row.blockers)
  if (blockers.length) throw new Error(blockers[0])
  return mutate<SourcingSelection>(db, actor, 'save', input.selectionId, input.selectionRevision, input.requestKey, hash, { snapshot, guard: workspace.guard })
}
export async function prepareSourcingPhotos(db: SupabaseClient, actor: string, raw: { id: string; revision: number; requestKey: string; skuIds: string[] }, download = safeImageBytes) {
  const input = mutationSchema.extend({ skuIds: z.array(z.string().min(1).max(500)).min(1).max(4) }).strict().parse(raw)
  const hash = requestHash(actor, 'photo', input)
  const prior = await replay<SourcingSelection>(db, actor, input.requestKey, hash)
  if (prior) return prior
  const selection = await getSelection(db, input.id)
  if (selection.revision !== input.revision || selection.status !== 'pending') throw new Error('Selection changed. Reload before preparing photos.')
  const guard = await sourcingGuard(db, selection.item_id)
  if (stableEvidence(guard) !== stableEvidence(selection.guard)) throw new Error('Inventory changed. Reload the review before preparing photos.')
  const photos: Record<string, PreparedPhoto> = {}
  const bySource = new Map<string, PreparedPhoto>()
  for (const photo of Object.values(selection.photos)) if (photo.status === 'ready' && photo.source) bySource.set(photo.source, photo)
  for (const skuId of new Set(input.skuIds)) {
    const row = selection.snapshot.rows.find(row => row.sku.id === skuId && row.review.include)
    if (!row) throw new Error('Prepare only reviewed SKUs from this saved replacement.')
    const source = supplierPhoto(selection.snapshot.source, row.sku)
    if (!source) { photos[skuId] = { source: null, url: null, status: 'failed', error: 'No SKU-specific photo. Choose to retain the existing / missing image.' }; continue }
    const cached = bySource.get(source)
    if (cached) { photos[skuId] = cached; continue }
    try {
      const bytes = await download(source)
      const hash = createHash('sha256').update(bytes).digest('hex')
      const path = `sourcing/${hash}.jpg`
      const bucket = db.storage.from('product-images')
      const { error } = await bucket.upload(path, bytes, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false })
      if (error) {
        const duplicate = 'statusCode' in error && String(error.statusCode) === '409' || /already exists|duplicate/i.test(error.message)
        if (!duplicate) throw error
        const stored = await bucket.download(path)
        if (stored.error || !stored.data || createHash('sha256').update(Buffer.from(await stored.data.arrayBuffer())).digest('hex') !== hash) throw new Error('Existing immutable image could not be verified')
      }
      const photo: PreparedPhoto = { source, url: bucket.getPublicUrl(path).data.publicUrl, status: 'ready', error: null }
      photos[skuId] = photo; bySource.set(source, photo)
    } catch { photos[skuId] = { source, url: null, status: 'failed', error: 'Photo could not be safely copied. The current Inventory image was not changed.' } }
  }
  return mutate<SourcingSelection>(db, actor, 'photo', input.id, input.revision, input.requestKey, hash, { photos })
}
export async function confirmSourcingSelection(db: SupabaseClient, actor: string, raw: { id: string; revision: number; requestKey: string; terms: SourcingTerms; accepted: boolean }) {
  const input = mutationSchema.extend({ terms: termsSchema, accepted: z.literal(true) }).strict().parse(raw)
  const hash = requestHash(actor, 'confirm', input)
  const prior = await replay<SourcingConfirmation>(db, actor, input.requestKey, hash)
  if (prior) return prior
  const selection = await getSelection(db, input.id)
  if (selection.status === 'confirmed' && selection.result) return selection.result
  if (selection.status !== 'pending' || selection.revision !== input.revision) throw new Error('Saved replacement changed. Reload and review before confirming.')
  const guard = await sourcingGuard(db, selection.item_id)
  if (stableEvidence(guard) !== stableEvidence(selection.guard)) throw new Error('Inventory, the previous purchase or preferred source changed. Review the saved replacement again.')
  const preview = sourcingPurchasePreview(selection, input.terms)
  if (preview.blockers.length) throw new Error(preview.blockers[0])
  preview.snapshot.lines = preview.snapshot.lines.map(line => {
    const row = preview.rows.find(row => row.sku.id === line.id)!
    return { ...line, id: attemptUuid(`line:${selection.id}:${line.id}`), sourcing: { selectionId: selection.id, offerId: selection.snapshot.source.offerId, skuId: row.sku.id, providerId: row.sku.providerId, specId: row.sku.specId, attributes: row.sku.attributes, unit: row.sku.unit, packSize: row.sku.packSize } }
  })
  return mutate<SourcingConfirmation>(db, actor, 'confirm', input.id, input.revision, input.requestKey, hash, { snapshot: preview.snapshot, imports: legacyConfirmedAmounts(preview.snapshot), accepted: true })
}
export async function cancelSourcingSelection(db: SupabaseClient, actor: string, raw: { id: string; revision: number; requestKey: string }) {
  const input = mutationSchema.parse(raw)
  const hash = requestHash(actor, 'cancel', input)
  return mutate<SourcingSelection>(db, actor, 'cancel', input.id, input.revision, input.requestKey, hash, {})
}
