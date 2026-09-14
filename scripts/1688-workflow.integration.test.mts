import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { start } from 'workflow/api'
import { waitForSleep } from '@workflow/vitest'
import { reorder1688Workflow } from '#research-workflow'
import { ACTOR, ResearchFixture, clone, interop } from './1688-research-fixtures.mts'
import * as queueModule from '../lib/purchase-orders/1688-queue.ts'

const queue = interop(queueModule)
const fixture = await new ResearchFixture().init()
const tables = (await fixture.sql.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by table_name")).rows.map(row => row.table_name)
const originals = await Promise.all(['profiles', 'products', 'product_variants', 'product_links', 'purchase_orders', 'import_reorder_items'].map(async table => ({ table, rows: (await fixture.sql.query(`select to_jsonb(t) value from public.${table} t`)).rows.map(row => row.value) })))
const catalogue = clone(fixture.catalogue)
const previousFetch = globalThis.fetch
let pauseAfterFirstLookup = false
let throwOnAdvance = false
let advanceCalls = 0

beforeAll(() => {
  globalThis.fetch = async () => { throw new Error('External requests disabled in Workflow replay verification') }
  Object.assign(globalThis, { [Symbol.for('1688-workflow-test-port')]: {
    db: fixture.db,
    attemptUuid: queue.attemptUuid,
    queueMutation: queue.queueMutation,
    advance: async (db: typeof fixture.db, jobId: string, workflowId: string, key: string) => {
      advanceCalls++
      if (throwOnAdvance) throw new Error('Isolated unexpected step failure')
      if (pauseAfterFirstLookup && fixture.providerCalls.length > 0) return 'wait'
      return queue.advanceResearchJob(db, jobId, workflowId, key, fixture.ports)
    },
  } })
})
beforeEach(async () => {
  await fixture.sql.exec(`reset role; truncate ${tables.map(table => `public.${table}`).join(',')} restart identity cascade`)
  for (const { table, rows } of originals) if (rows.length) await fixture.sql.query(`insert into public.${table} select * from jsonb_populate_recordset(null::public.${table},$1::jsonb)`, [JSON.stringify(rows)])
  fixture.catalogue = clone(catalogue); fixture.providerCalls = []; fixture.providerActive = 0; fixture.maxProviderActive = 0; fixture.failRead = null; fixture.failRpc = null; fixture.delay = 15
  pauseAfterFirstLookup = false; throwOnAdvance = false; advanceCalls = 0
})
afterAll(async () => { globalThis.fetch = previousFetch; delete (globalThis as any)[Symbol.for('1688-workflow-test-port')]; await fixture.close() })
async function submit(indices = [0]) {
  const items = await Promise.all(indices.map(async index => { const command = await fixture.command(index); return { itemId: command.itemId, revision: command.revision, generation: command.generation, version: command.version, mode: 'fresh' as const } }))
  return queue.enqueueResearch(fixture.db, ACTOR, { operation: 'enqueue', requestKey: randomUUID(), items })
}

describe('Actual compiled reorder workflow with isolated database and providers', () => {
  it('finishes six accepted rows without a browser and enforces three global paid slots', async () => {
    const before = await fixture.businessHash()
    const a = await submit([0, 1, 2]); const b = await submit([3, 4, 5])
    const runs = await Promise.all([start(reorder1688Workflow, [a.id]), start(reorder1688Workflow, [b.id])])
    await Promise.all(runs.map(run => run.returnValue))
    const state = await queue.loadResearchQueue(fixture.db)
    expect(state.jobs.filter(job => job.status === 'complete')).toHaveLength(6)
    expect(state.runs.every(run => run.status === 'complete')).toBe(true)
    expect(fixture.maxProviderActive).toBeLessThanOrEqual(3)
    expect(fixture.maxProviderActive).toBeGreaterThan(1)
    expect(await fixture.businessHash()).toBe(before)
  })
  it('replays a durable sleep and duplicate start without repeating the saved lookup', async () => {
    const accepted = await submit(); pauseAfterFirstLookup = true
    const run = await start(reorder1688Workflow, [accepted.id])
    const sleepId = await waitForSleep(run)
    expect(fixture.providerCalls).toEqual(['listing:888888000000'])
    const duplicate = await start(reorder1688Workflow, [accepted.id]); await duplicate.returnValue
    expect(fixture.providerCalls).toHaveLength(1)
    pauseAfterFirstLookup = false
    await run.wakeUp({ correlationIds: [sleepId] }); await run.returnValue
    expect(fixture.providerCalls.filter(call => call === 'listing:888888000000')).toHaveLength(1)
    expect((await queue.loadResearchQueue(fixture.db)).runs[0].status).toBe('complete')
  })
  it('does not automatically retry a failing paid-step function', async () => {
    const accepted = await submit(); throwOnAdvance = true
    const run = await start(reorder1688Workflow, [accepted.id]); await run.returnValue
    expect(advanceCalls).toBe(1)
    expect(fixture.providerCalls).toHaveLength(0)
    expect((await queue.loadResearchQueue(fixture.db)).runs[0].stop_requested).toBe(true)
  })
  it('honours persisted stop while the workflow is durably sleeping', async () => {
    const accepted = await submit(); pauseAfterFirstLookup = true
    const run = await start(reorder1688Workflow, [accepted.id]); const sleepId = await waitForSleep(run)
    await queue.queueMutation(fixture.db, ACTOR, 'stop', accepted.id)
    pauseAfterFirstLookup = false
    await run.wakeUp({ correlationIds: [sleepId] }); await run.returnValue
    expect(fixture.providerCalls).toEqual(['listing:888888000000'])
    expect((await queue.loadResearchQueue(fixture.db)).runs[0].status).toBe('paused')
  })
})
