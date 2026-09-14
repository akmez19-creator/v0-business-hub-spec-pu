import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { CHECK_COLUMNS, executeResearchStage, hashContext1688, loadResearchContexts, loadSavedResearch, resolveContext, ResearchError, type StagePorts } from './1688-check-service'
import { emptyEvidence, offerIdFrom, recomputeFindings, sameBaseContext, stableEvidence } from './1688-comparison'
import { Provider1688Error, researchProvider } from './1688-provider'
import { interpretOffer, interpretTarget } from './1688-analysis'
import { observeSupplier } from './supplier-quality'
import { sourcingGuard } from './1688-preferences'
import { loadSavedReorderItems } from './reorder-service'
import { IMPORT_REFERENCE_COLUMNS, type ImportReference } from './workflow'
import { reviewImportReferences } from './reorder-reference'
import type { CheckStage1688, SavedCheck1688 } from './1688-types'
import type { ResearchJob, ResearchQueueStatus, ResearchRun } from './1688-sourcing-types'

export const RUN_COLUMNS = 'id,request_key,actor_id,workflow_id,status,stop_requested,reason,created_at,updated_at'
export const JOB_COLUMNS = 'id,run_id,item_id,position,status,mode,item_revision,generation,version,context,guard,check_generation,lease_key,lease_until,tmapi_reserved,ai_reserved,tmapi_actual,ai_actual,attempts,reason,created_at,updated_at'
const selectionSchema = z.object({ itemId: z.string().uuid(), revision: z.number().int().positive(), generation: z.number().int().nonnegative(), version: z.number().int().nonnegative(), mode: z.enum(['fresh', 'resume']) }).strict()
export const enqueueSchema = z.object({ operation: z.literal('enqueue'), requestKey: z.string().uuid(), items: z.array(selectionSchema).min(1).max(200) }).strict()
export function queueDatabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Background research database configuration is unavailable')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}
export async function queueMutation(db: SupabaseClient, actor: string | null, operation: string, id: string | null, payload: unknown = {}, key: string = randomUUID()) {
  const { data, error } = await db.rpc('import_1688_queue', { p_actor: actor, p_operation: operation, p_id: id, p_key: key, p_payload: payload })
  if (error) throw new ResearchError(['40001', '55P03'].includes(error.code) ? error.message : error.code === '42501' ? 'Not allowed' : 'Background research state could not be saved. Reload before retrying.', ['40001', '55P03'].includes(error.code) ? 409 : error.code === '42501' ? 403 : 503, ['40001', '55P03'].includes(error.code) ? 'conflict' : 'storage')
  return data as { action?: 'execute' | 'next' | 'done' | 'wait'; check?: SavedCheck1688; run?: ResearchRun; owned?: boolean; jobs?: string[] }
}
export async function enqueueResearch(db: SupabaseClient, actor: string, input: unknown) {
  const command = enqueueSchema.parse(input)
  if (new Set(command.items.map(item => item.itemId)).size !== command.items.length) throw new ResearchError('Select each saved product only once.', 400, 'validation')
  const hash = createHash('sha256').update(stableEvidence({ actor, command })).digest('hex')
  const replay = await db.from('import_reorder_1688_runs').select(`${RUN_COLUMNS},request_hash`).eq('request_key', command.requestKey).maybeSingle()
  if (replay.error) throw new ResearchError('Could not verify the previous submission. Retry the same request.', 503, 'storage')
  if (replay.data) {
    if (replay.data.request_hash !== hash || replay.data.actor_id !== actor) throw new ResearchError('Request key already used with different rows.', 409, 'conflict')
    return replay.data as ResearchRun
  }
  const jobs = []
  for (const item of command.items) {
    const [base, guard, saved] = await Promise.all([resolveContext(db, item.itemId), sourcingGuard(db, item.itemId), db.from('import_reorder_1688_checks').select(CHECK_COLUMNS).eq('item_id', item.itemId).maybeSingle()])
    if (saved.error) throw new ResearchError('Could not restore existing research.', 503, 'storage')
    const check = saved.data as SavedCheck1688 | null
    if (base.itemRevision !== item.revision || (check?.generation ?? 0) !== item.generation || (check?.version ?? 0) !== item.version) throw new ResearchError('A selected row or its research changed. Reload before submitting.', 409, 'conflict')
    const same = !!check && sameBaseContext(check.context, base)
    if (item.mode === 'resume' && !same) throw new ResearchError('Saved evidence changed. Choose an explicit fresh check.', 409, 'context')
    jobs.push({ ...item, guard, context: { ...base, comparisonTarget: same ? check!.context.comparisonTarget : null } })
  }
  const result = await queueMutation(db, actor, 'enqueue', null, { hash, jobs }, command.requestKey)
  return result.run!
}
export function stageReservation(check: SavedCheck1688, stage: CheckStage1688) {
  const e = check.evidence
  let tmapi = 0; let ai = 0
  if (e.outcomes[stage]?.status === 'ok') return { tmapi, ai }
  if (stage === 'listing') tmapi = offerIdFrom(check.context.sourceLink) ? 1 : 0
  else if (stage === 'target') ai = 1
  else if (stage === 'current-interpret') ai = e.current && !e.interpretations[e.current.offerId] ? 1 : 0
  else if (stage === 'image-prepare') {
    const image = check.context.variantImage || check.context.productImage || check.context.savedItem.imageUrl || check.context.reference?.image_url || e.current?.imageUrl
    tmapi = image && !/^https?:\/\/[^/]*\.(?:alicdn|alibaba|1688)\.com\//i.test(image) ? 1 : 0
  } else if (stage === 'image-search') tmapi = e.imageRef ? 1 : 0
  else if (stage === 'keyword-search') tmapi = e.query ? 1 : 0
  else if (stage.startsWith('detail:')) { const hit = e.shortlist[Number(stage.split(':')[1])]; tmapi = hit && !e.offers[hit.offerId] ? 1 : 0 }
  else if (stage.startsWith('interpret:')) { const hit = e.shortlist[Number(stage.split(':')[1])]; ai = hit && e.offers[hit.offerId] && !e.interpretations[hit.offerId] ? 1 : 0 }
  else if (stage === 'current-shop' || stage.startsWith('shop:')) {
    const hit = stage === 'current-shop' ? null : e.shortlist[Number(stage.split(':')[1])]
    const offer = stage === 'current-shop' ? e.current : hit ? e.offers[hit.offerId] : null
    tmapi = offer?.supplier.memberId && !e.shops[offer.supplier.memberId] ? 1 : 0
  }
  return { tmapi, ai }
}
function portsFor(db: SupabaseClient, actor: string): StagePorts {
  return { provider: researchProvider(db), target: interpretTarget, interpret: interpretOffer, observe: async shop => {
    try {
      const names = (await fetchAll<{ supplier_name: string | null }>((from, to) => db.from('purchase_orders').select('supplier_name').order('id').range(from, to))).flatMap(row => row.supplier_name ? [row.supplier_name] : [])
      await observeSupplier(db, actor, shop, [...new Set(names)])
    } catch { throw new Provider1688Error('Supplier evidence could not be saved. Remaining paid dispatch has been stopped.', 'storage', true) }
  } }
}
export async function advanceResearchJob(db: SupabaseClient, jobId: string, workflowId: string, attemptKey: string, injected?: StagePorts): Promise<'next' | 'done' | 'wait'> {
  const loaded = await db.from('import_reorder_1688_jobs').select(JOB_COLUMNS).eq('id', jobId).single()
  if (loaded.error) throw new Error('Background job could not be read')
  const job = loaded.data as ResearchJob
  const runResult = await db.from('import_reorder_1688_runs').select(RUN_COLUMNS).eq('id', job.run_id).single()
  if (runResult.error) throw new Error('Background run could not be read')
  const run = runResult.data as ResearchRun
  if (!['queued', 'running'].includes(job.status) || run.workflow_id !== workflowId) return 'done'
  const payload = { workflowId }
  try {
    const raw = await db.from('import_reorder_1688_checks').select(CHECK_COLUMNS).eq('item_id', job.item_id).maybeSingle()
    if (raw.error) throw new Error('Research could not be read')
    const current = raw.data as SavedCheck1688 | null
    if (job.lease_key) return (await queueMutation(db, run.actor_id, 'reserve', jobId, { ...payload, version: current?.version, contextHash: current?.context_hash, stage: current?.evidence.stages[current.cursor], tmapi: 0, ai: 0 }, attemptKey)).action as 'next' | 'done' | 'wait'
    const base = await resolveContext(db, job.item_id)
    if (!sameBaseContext(job.context, base)) {
      await queueMutation(db, run.actor_id, 'stale', jobId, payload, attemptKey)
      return 'done'
    }
    if (job.check_generation == null) {
      let evidence = job.mode === 'resume' && current ? structuredClone(current.evidence) : emptyEvidence(job.context)
      if (job.mode === 'fresh' && current && sameBaseContext(current.context, base) && current.evidence.target.confirmedBy) evidence.target = structuredClone(current.evidence.target)
      if (job.mode === 'resume') {
        if (!current || !sameBaseContext(current.context, base)) throw new Error('Original research context changed')
        const refresh = ['image-search', 'keyword-search'].some(stage => evidence.outcomes[stage as CheckStage1688]?.status === 'error')
        evidence.outcomes = Object.fromEntries(Object.entries(evidence.outcomes).filter(([stage, outcome]) => outcome?.status === 'ok' && stage !== 'finish' && !(refresh && stage === 'shortlist')))
        evidence.shops = Object.fromEntries(Object.entries(evidence.shops).filter(([, shop]) => !shop.error))
        evidence = recomputeFindings(evidence, job.context)
      }
      return (await queueMutation(db, run.actor_id, 'initialize', jobId, { ...payload, context: job.context, contextHash: hashContext1688(job.context), evidence, requestHash: job.id }, attemptKey)).action as 'next' | 'done'
    }
    if (!current) throw new Error('Research evidence is unavailable')
    const stage = current.evidence.stages[current.cursor]
    if (!stage) return 'done'
    const reserve = stageReservation(current, stage)
    const claimed = await queueMutation(db, run.actor_id, 'reserve', jobId, { ...payload, version: current.version, contextHash: current.context_hash, stage, ...reserve }, attemptKey)
    if (claimed.action !== 'execute' || !claimed.check) return claimed.action as 'next' | 'done' | 'wait'
    const before = claimed.check.evidence.paid
    const completed = await executeResearchStage(claimed.check, stage, injected ?? portsFor(db, run.actor_id!))
    const actualTmapi = Math.max(0, completed.evidence.paid.tmapi - before.tmapi)
    const actualAi = Math.max(0, completed.evidence.paid.ai - before.ai)
    if (actualTmapi > reserve.tmapi || actualAi > reserve.ai) throw new Error('Provider exceeded its reserved attempt budget')
    return (await queueMutation(db, run.actor_id, 'complete', jobId, { ...payload, ...completed, actualTmapi, actualAi }, attemptKey)).action as 'next' | 'done'
  } catch (cause) {
    const stale = cause instanceof ResearchError && ['item', 'context', 'conflict'].includes(cause.reason)
    await queueMutation(db, run.actor_id, stale ? 'stale' : 'interrupt', jobId, { ...payload, reason: stale ? 'The saved product changed; no fresh lookup was started.' : 'Research was interrupted or could not be saved. Reserved attempts are retained; resume explicitly.' }, attemptKey)
    return 'done'
  }
}
export { loadResearchQueue }

async function loadResearchQueue(db: SupabaseClient): Promise<ResearchQueueStatus> {
  const [runs, jobs, items, references] = await Promise.all([
    fetchAll<ResearchRun>((from, to) => db.from('import_reorder_1688_runs').select(RUN_COLUMNS).order('created_at', { ascending: false }).order('id').range(from, to)),
    fetchAll<ResearchJob>((from, to) => db.from('import_reorder_1688_jobs').select(JOB_COLUMNS).order('created_at', { ascending: false }).order('id').range(from, to)),
    loadSavedReorderItems(db),
    fetchAll<ImportReference>((from, to) => db.from('purchase_orders').select(IMPORT_REFERENCE_COLUMNS).order('id').range(from, to)),
  ])
  const contexts = await loadResearchContexts(db, items.filter(item => item.status !== 'excluded'), reviewImportReferences(references))
  const checks = await loadSavedResearch(db, contexts)
  const now = Date.now()
  const interrupted = new Set(runs.filter(run => ['running', 'stopping'].includes(run.status) && (now - new Date(run.updated_at).getTime() > 180_000 || jobs.some(job => job.run_id === run.id && job.lease_until && new Date(job.lease_until).getTime() < now && ['running', 'interrupted'].includes(job.status)))).map(run => run.id))
  return {
    runs: runs.map(run => interrupted.has(run.id) ? { ...run, status: 'paused', stop_requested: true, reason: 'Background work was interrupted. Saved evidence and reserved attempts are retained; resume explicitly.' } : run.status === 'accepted' && now - new Date(run.created_at).getTime() > 60_000 ? { ...run, status: 'dispatch_unknown', reason: 'Background start has not been acknowledged. Retry dispatch explicitly.' } : run),
    jobs: jobs.map(job => interrupted.has(job.run_id) && ['queued', 'running'].includes(job.status) ? { ...job, status: job.lease_key ? 'interrupted' : 'stopped', reason: 'Background run interrupted. No automatic paid retry.' } : job),
    checks,
  }
}
export function attemptUuid(value: string) {
  const hex = createHash('sha256').update(value).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
