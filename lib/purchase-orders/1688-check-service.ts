import 'server-only'

import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { IMPORT_REFERENCE_COLUMNS, type ImportReference, type SavedReorderItem } from './workflow'
import { reviewImportReferences } from './reorder-reference'
import { COMPARISON_VERSION, type CheckCommand1688, type CheckStage1688, type ComparisonContext1688, type Evidence1688, type Listing1688, type SavedCheck1688, type Shop1688 } from './1688-types'
import { confirmTarget, emptyEvidence, latestReorderReference, offerIdFrom, recomputeFindings, sameBaseContext, shortlistOffers, stableEvidence } from './1688-comparison'
import { Provider1688Error, researchProvider, type ResearchProvider1688 } from './1688-provider'
import { interpretOffer, interpretTarget } from './1688-analysis'
import { loadSupplierQuality, observeSupplier } from './supplier-quality'
import { loadSourcingPreferences, purchasingSource, PREFERENCE_COLUMNS } from './1688-preferences'
import type { SourcingPreference } from './1688-sourcing-types'

export const CHECK_COLUMNS = 'item_id,item_revision,generation,version,context_hash,context,run_key,actor_id,status,cursor,evidence,previous_success,started_at,updated_at,finished_at,lease_key,lease_until,stop_requested,last_control_key,last_control_hash,last_stage_key'
const ITEM_COLUMNS = 'id,product_id,variant_id,source_import_id,supplier_name,item,status,priority,review_date,revision,updated_at'
const PRODUCT_COLUMNS = 'id,name,image_url,description,sku,updated_at,is_active'
const VARIANT_COLUMNS = 'id,product_id,attribute_name,attribute_value,image_url,updated_at,is_active'
type ProductRow = { id: string; name: string; image_url: string | null; description: string | null; sku: string | null; updated_at: string | null; is_active: boolean }
type VariantRow = { id: string; product_id: string; attribute_name: string; attribute_value: string; image_url: string | null; updated_at: string | null; is_active: boolean }
export const hashContext1688 = (context: ComparisonContext1688) => createHash('sha256').update(stableEvidence(context)).digest('hex')

function makeContext(saved: SavedReorderItem, product: ProductRow | undefined, variant: VariantRow | undefined, references: ImportReference[], preference?: SourcingPreference | null): ComparisonContext1688 {
  const reference = saved.item.productId ? latestReorderReference(saved.item.productId, references, saved.item.variantId) : null
  const source = saved.item.sourceImportId ? references.find(value => value.id === saved.item.sourceImportId) ?? null : null
  const selected = purchasingSource({ ...saved.item, sourceSnapshot: source ?? saved.item.sourceSnapshot }, reference, preference)
  return {
    comparisonVersion: COMPARISON_VERSION, itemId: saved.id, itemRevision: saved.revision,
    productId: saved.item.productId, variantId: saved.item.variantId,
    productName: product?.name ?? saved.item.productName, productImage: product?.image_url ?? null,
    productDescription: product?.description ?? null, productSku: product?.sku ?? null, productUpdatedAt: product?.updated_at ?? null,
    variantLabel: variant ? `${variant.attribute_name}: ${variant.attribute_value}` : saved.item.variantLabel,
    variantImage: variant?.image_url ?? null, variantUpdatedAt: variant?.updated_at ?? null,
    sourceLink: selected.url,
    ...(selected.preference ? { sourcePreference: { offerId: selected.preference.offer_id, revision: selected.preference.revision } } : {}),
    reference, savedItem: { ...saved.item, sourceSnapshot: source ?? saved.item.sourceSnapshot },
    supplierName: selected.supplier || saved.supplierName || reference?.supplier_name || '', qty: saved.item.qty, comparisonTarget: null,
  }
}

export { loadResearchContexts, loadSavedResearch }

async function loadResearchContexts(db: SupabaseClient, items: SavedReorderItem[], references: ImportReference[]) {
  const [products, variants, preferences] = await Promise.all([
    fetchAll<ProductRow>((from, to) => db.from('products').select(PRODUCT_COLUMNS).order('id').range(from, to)),
    fetchAll<VariantRow>((from, to) => db.from('product_variants').select(VARIANT_COLUMNS).order('id').range(from, to)),
    loadSourcingPreferences(db),
  ])
  const byProduct = new Map(products.map(product => [product.id, product]))
  const byVariant = new Map(variants.map(variant => [variant.id, variant]))
  return Object.fromEntries(items.map(item => [item.id, makeContext(item, byProduct.get(item.item.productId ?? ''), byVariant.get(item.item.variantId ?? ''), references, preferences.find(value => value.product_id === item.item.productId))]))
}

async function loadSavedResearch(db: SupabaseClient, contexts: Record<string, ComparisonContext1688>) {
  const checks = await fetchAll<SavedCheck1688>((from, to) => db.from('import_reorder_1688_checks').select(CHECK_COLUMNS).order('item_id').range(from, to))
  return checks.filter(check => contexts[check.item_id]).map(check => {
    const base = contexts[check.item_id]
    const isCurrent = check.item_revision === base.itemRevision && sameBaseContext(check.context, base)
    if (isCurrent) contexts[check.item_id] = { ...base, comparisonTarget: check.context.comparisonTarget }
    return { ...check, isCurrent }
  })
}

export async function resolveContext(db: SupabaseClient, id: string): Promise<ComparisonContext1688> {
  const { data: row, error } = await db.from('import_reorder_items').select(ITEM_COLUMNS).eq('id', id).maybeSingle()
  if (error || !row || row.status === 'excluded' || !row.product_id) throw new ResearchError('This saved reorder item is no longer available.', 404, 'item')
  const saved: SavedReorderItem = { id: row.id, item: { ...row.item, productId: row.product_id, variantId: row.variant_id, sourceImportId: row.source_import_id }, supplierName: row.supplier_name, status: row.status, priority: row.priority, reviewDate: row.review_date, revision: row.revision, updatedAt: row.updated_at }
  const [product, variant, references, source, preference] = await Promise.all([
    db.from('products').select(PRODUCT_COLUMNS).eq('id', row.product_id).maybeSingle(),
    row.variant_id ? db.from('product_variants').select(VARIANT_COLUMNS).eq('id', row.variant_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    fetchAll<ImportReference>((from, to) => db.from('purchase_orders').select(IMPORT_REFERENCE_COLUMNS).eq('product_id', row.product_id).order('order_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).order('id').range(from, to)),
    row.source_import_id ? db.from('purchase_orders').select(IMPORT_REFERENCE_COLUMNS).eq('id', row.source_import_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from('product_1688_preferences').select(PREFERENCE_COLUMNS).eq('product_id', row.product_id).maybeSingle(),
  ])
  if (preference.error) throw new ResearchError('The preferred purchasing source could not be loaded. No historical fallback was used.', 503, 'storage')
  if (product.error || !product.data?.is_active || variant.error || source.error) throw new ResearchError('Product/reference evidence could not be loaded. No paid check was started.', 409, 'context')
  if (row.variant_id && (!variant.data || variant.data.product_id !== row.product_id || !variant.data.is_active)) throw new ResearchError('The saved variant is no longer valid for this product.', 409, 'context')
  const reviewed = reviewImportReferences(references)
  const sourceRow = source.data as ImportReference | null
  if (sourceRow && !reviewed.some(value => value.id === sourceRow.id)) reviewed.push(sourceRow)
  return makeContext(saved, product.data as ProductRow, variant.data as VariantRow | undefined, reviewed, preference.data as SourcingPreference | null)
}

export class ResearchError extends Error {
  constructor(message: string, public status: number, public reason: string, public check?: SavedCheck1688, public checkedButNotSaved = false) { super(message) }
}
const commandSchema = z.object({
  operation: z.enum(['start', 'next', 'stop', 'confirm-target']), itemId: z.string().uuid(), revision: z.number().int().positive(),
  generation: z.number().int().nonnegative(), version: z.number().int().nonnegative(), requestKey: z.string().uuid(), runKey: z.string().uuid(),
  mode: z.enum(['fresh', 'resume']).optional(),
  target: z.object({ sourceSku: z.object({ offerId: z.string().regex(/^\d{6,}$/), skuId: z.string().min(1).max(250) }).strict().nullable(), specification: z.string().trim().max(2000), unit: z.enum(['piece', 'set', 'pair', 'box', 'pack', 'meter']), packSize: z.number().int().positive().max(100000) }).strict().optional(),
}).strict()

export type StagePorts = {
  provider: ResearchProvider1688
  target: typeof interpretTarget
  interpret: typeof interpretOffer
  observe: (shop: Shop1688) => Promise<void>
}
function failedShop(memberId: string, name: string | null, message: string): Shop1688 {
  return { memberId, names: name ? [name] : [], rating: null, ratings: [], observedAt: new Date().toISOString(), error: message, years: null, isFactory: false, location: null }
}

export async function executeResearchStage(check: SavedCheck1688, stage: CheckStage1688, ports: StagePorts) {
  let evidence = structuredClone(check.evidence)
  const context = check.context
  let stopReason: string | undefined
  const outcome = (status: 'ok' | 'skipped' | 'error', message: string | null = null, terminal = false) => { evidence.outcomes[stage] = { status, message, at: new Date().toISOString(), terminal } }
  const cached = evidence.outcomes[stage]
  if (cached?.status === 'ok') return { evidence, stopReason, status: 'running' as const }

  async function shopFor(offer: Listing1688 | null) {
    const member = offer?.supplier.memberId
    if (!member || !offer) { outcome('skipped', 'No seller member ID published'); return }
    let shop = evidence.shops[member]
    if (shop?.error) { outcome('error', `Previous attempt for this seller at ${shop.observedAt}: ${shop.error}`); return }
    if (!shop) {
      evidence.paid.tmapi++
      try { shop = await ports.provider.shop(member); shop.names = [...new Set([...shop.names, ...[offer.supplier.name].filter((name): name is string => !!name)])]; evidence.shops[member] = shop }
      catch (cause) {
        const message = cause instanceof Error ? cause.message : 'Shop lookup unavailable'
        evidence.shops[member] = failedShop(member, offer.supplier.name, message)
        await ports.observe(evidence.shops[member]).catch(() => undefined)
        throw cause
      }
    }
    await ports.observe(shop)
    outcome('ok')
  }
  try {
    if (stage === 'listing') {
      const id = offerIdFrom(context.sourceLink)
      if (!id) { evidence.currentStatus = 'missing-link'; outcome('skipped', 'No valid original listing link') }
      else {
        evidence.paid.tmapi++
        try { evidence.current = await ports.provider.listing(id); evidence.currentStatus = 'available'; outcome('ok') }
        catch (cause) { if (cause instanceof Provider1688Error && cause.reason === 'gone') { evidence.currentStatus = 'gone'; outcome('ok', cause.message) } else { evidence.currentStatus = 'failed'; throw cause } }
      }
    } else if (stage === 'current-shop') await shopFor(evidence.current)
    else if (stage === 'target') {
      evidence.paid.ai++
      const result = await ports.target(context)
      evidence.query = result.query
      if (!evidence.target.confirmedBy) evidence.target = result.target
      outcome('ok')
    } else if (stage === 'current-interpret') {
      if (!evidence.current) outcome('skipped', 'No original SKU evidence')
      else {
        const id = evidence.current.offerId
        if (!evidence.interpretations[id]) { evidence.paid.ai++; evidence.interpretations[id] = await ports.interpret(evidence.current, evidence.target) }
        outcome('ok')
      }
    } else if (stage === 'image-prepare') {
      const image = context.variantImage || context.productImage || context.savedItem.imageUrl || context.reference?.image_url || evidence.current?.imageUrl
      if (!image) outcome('skipped', 'No product photo available; keyword search remains available')
      else {
        try { const result = await ports.provider.prepareImage(image); evidence.imageRef = result.ref; if (result.paid) evidence.paid.tmapi++; outcome('ok') }
        catch (cause) { if (cause instanceof Provider1688Error) evidence.paid.tmapi++; throw cause }
      }
    } else if (stage === 'image-search' || stage === 'keyword-search') {
      const mode = stage === 'image-search' ? 'image' : 'keyword'
      const value = mode === 'image' ? evidence.imageRef : evidence.query
      if (!value) outcome('skipped', `No ${mode} search evidence available`)
      else { evidence.paid.tmapi++; const hits = await ports.provider.search(mode, value); evidence.searchHits = [...evidence.searchHits.filter(hit => hit.source !== mode), ...hits.slice(0, 20)]; outcome('ok') }
    } else if (stage === 'shortlist') {
      const candidates = shortlistOffers(evidence.searchHits, evidence.current?.offerId ?? offerIdFrom(context.sourceLink), evidence.query)
      evidence.shortlist = [...evidence.shortlist, ...candidates.filter(hit => !evidence.shortlist.some(saved => saved.offerId === hit.offerId))].slice(0, 5)
      const extra = evidence.shortlist.flatMap((_, index): CheckStage1688[] => [`detail:${index}`, `interpret:${index}`, `shop:${index}`])
      evidence.stages = [...evidence.stages.filter(value => !/^(detail|interpret|shop):/.test(value) && value !== 'finish'), ...extra, 'finish']
      outcome('ok')
    } else if (stage.startsWith('detail:')) {
      const hit = evidence.shortlist[Number(stage.split(':')[1])]
      if (!hit) outcome('skipped', 'No candidate in this slot')
      else { if (!evidence.offers[hit.offerId]) { evidence.paid.tmapi++; evidence.offers[hit.offerId] = await ports.provider.listing(hit.offerId) }; outcome('ok') }
    } else if (stage.startsWith('interpret:')) {
      const hit = evidence.shortlist[Number(stage.split(':')[1])]
      const offer = hit && evidence.offers[hit.offerId]
      if (!offer) outcome('skipped', 'Candidate details unavailable')
      else { if (!evidence.interpretations[offer.offerId]) { evidence.paid.ai++; evidence.interpretations[offer.offerId] = await ports.interpret(offer, evidence.target) }; outcome('ok') }
    } else if (stage.startsWith('shop:')) {
      const hit = evidence.shortlist[Number(stage.split(':')[1])]
      await shopFor(hit ? evidence.offers[hit.offerId] ?? null : null)
    } else if (stage === 'finish') outcome('ok')
    else throw new Error('Unknown research stage')
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'This stage could not be completed'
    const terminal = cause instanceof Provider1688Error && cause.terminal
    outcome('error', message, terminal)
    if (terminal) stopReason = message
  }
  evidence = recomputeFindings(evidence, context)
  const hasError = Object.values(evidence.outcomes).some(value => value?.status === 'error')
  const status: SavedCheck1688['status'] = stopReason ? (evidence.current || Object.keys(evidence.offers).length ? 'partial' : 'failed') : stage === 'finish' ? hasError ? 'partial' : 'complete' : 'running'
  return { evidence, status, stopReason }
}

async function transition(db: SupabaseClient, actor: string, command: CheckCommand1688, operation: string, payload: unknown) {
  const { data, error } = await db.rpc('import_reorder_1688_transition', { p_actor: actor, p_item: command.itemId, p_revision: command.revision, p_generation: command.generation, p_version: command.version, p_key: command.requestKey, p_run: command.runKey, p_operation: operation, p_payload: payload })
  if (error) throw new ResearchError(['40001', '55P03'].includes(error.code) ? error.message : 'Research state could not be saved. No further paid work was dispatched.', ['40001', '55P03'].includes(error.code) ? 409 : 503, ['40001', '55P03'].includes(error.code) ? 'conflict' : 'storage')
  return data as { check: SavedCheck1688; claimed: boolean; busy?: boolean }
}

export async function processResearchCommand(db: SupabaseClient, actor: string, input: unknown, injected?: StagePorts) {
  const parsed = commandSchema.safeParse(input)
  if (!parsed.success) throw new ResearchError('Supply only a saved item ID, expected revisions and a valid research command.', 400, 'validation')
  const command = parsed.data
  if (command.operation === 'stop') return { success: true, ...(await transition(db, actor, command, 'stop', {})) }
  const base = await resolveContext(db, command.itemId)
  if (base.itemRevision !== command.revision) throw new ResearchError('The saved row changed. Reload before starting paid work.', 409, 'conflict')
  const { data: raw, error } = await db.from('import_reorder_1688_checks').select(CHECK_COLUMNS).eq('item_id', command.itemId).maybeSingle()
  if (error) throw new ResearchError('Could not load the last saved research. No paid work was started.', 503, 'storage')
  const existing = raw as SavedCheck1688 | null
  const sameContext = !!existing && sameBaseContext(existing.context, base)
  const context = { ...base, comparisonTarget: sameContext ? existing!.context.comparisonTarget : null }
  const expectedHash = hashContext1688(context)
  if (command.operation === 'start') {
    if (!command.mode) throw new ResearchError('Choose a fresh check or an explicit resume.', 400, 'validation')
    if (command.mode === 'resume' && (!existing || !sameContext)) throw new ResearchError('Source evidence changed. Start a fresh check instead of resuming old results.', 409, 'context')
    let evidence = command.mode === 'resume' ? structuredClone(existing!.evidence) : emptyEvidence(context)
    if (command.mode === 'fresh' && sameContext && existing!.evidence.target.confirmedBy) evidence.target = structuredClone(existing!.evidence.target)
    if (command.mode === 'resume') {
      const refreshShortlist = ['image-search', 'keyword-search'].some(stage => evidence.outcomes[stage as CheckStage1688]?.status === 'error')
      evidence.outcomes = Object.fromEntries(Object.entries(evidence.outcomes).filter(([stage, outcome]) => outcome?.status === 'ok' && stage !== 'finish' && !(refreshShortlist && stage === 'shortlist')))
      evidence.shops = Object.fromEntries(Object.entries(evidence.shops).filter(([, shop]) => !shop.error))
      evidence = recomputeFindings(evidence, context)
    }
    const result = await transition(db, actor, command, 'start', { context, contextHash: expectedHash, evidence, requestHash: createHash('sha256').update(stableEvidence({ actor, command })).digest('hex') })
    return { success: true, ...result }
  }
  if (!existing || !sameContext || existing.context_hash !== expectedHash) throw new ResearchError('Product, variant or import evidence changed. Saved findings are stale; start a fresh check.', 409, 'context')
  if (existing.generation !== command.generation) throw new ResearchError('A newer check exists. Reload before continuing.', 409, 'conflict')
  if (command.operation === 'confirm-target') {
    if (!command.target || (!command.target.sourceSku && !command.target.specification)) throw new ResearchError('Choose a saved SKU or provide the target specifications.', 400, 'validation')
    const nextContext = { ...context, comparisonTarget: command.target }
    const target = confirmTarget(existing.evidence, context, command.target, actor)
    const evidence = recomputeFindings({ ...existing.evidence, target }, nextContext)
    const result = await transition(db, actor, command, 'target', { expectedHash, context: nextContext, contextHash: hashContext1688(nextContext), evidence, requestHash: createHash('sha256').update(stableEvidence({ actor, command })).digest('hex') })
    return { success: true, ...result, quality: await loadSupplierQuality(db) }
  }
  const stage = existing.evidence.stages[existing.cursor]
  if (!stage) return { success: true, check: existing, claimed: false }
  const claim = await transition(db, actor, command, 'claim', { expectedHash, stage })
  if (!claim.claimed) return { success: true, ...claim }
  let names: string[] | null = null
  const ports = injected ?? {
    provider: researchProvider(db), target: interpretTarget, interpret: interpretOffer,
    observe: async (shop: Shop1688) => {
      if (!names) names = [...new Set((await fetchAll<{ supplier_name: string | null }>((from, to) => db.from('purchase_orders').select('supplier_name').order('id').range(from, to))).map(row => row.supplier_name?.trim()).filter((name): name is string => !!name))]
      await observeSupplier(db, actor, shop, names)
    },
  }
  const completed = await executeResearchStage(claim.check, stage, ports)
  const after = await resolveContext(db, command.itemId)
  if (!sameBaseContext(context, after)) throw new ResearchError('Inputs changed while checking. The older result was discarded.', 409, 'context')
  let result: Awaited<ReturnType<typeof transition>>
  try { result = await transition(db, actor, { ...command, version: claim.check.version }, 'complete', { expectedHash, evidence: completed.evidence, status: completed.status }) }
  catch (cause) {
    if (cause instanceof ResearchError && cause.reason === 'conflict') throw cause
    throw new ResearchError('Checked but not saved. Reload the last stored stage before any further paid work.', 503, 'storage', { ...claim.check, evidence: completed.evidence }, true)
  }
  return { success: true, ...result, stopReason: completed.stopReason, quality: await loadSupplierQuality(db) }
}
