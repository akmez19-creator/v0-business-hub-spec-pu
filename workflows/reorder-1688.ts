import { getStepMetadata, getWorkflowMetadata, sleep } from 'workflow'
import { advanceResearchJob, attemptUuid, queueDatabase, queueMutation, RUN_COLUMNS } from '@/lib/purchase-orders/1688-queue'

async function ownRun(runId: string, workflowId: string) {
  'use step'
  const db = queueDatabase()
  const { data, error } = await db.from('import_reorder_1688_runs').select(RUN_COLUMNS).eq('id', runId).single()
  if (error) throw new Error('Accepted research could not be restored')
  const result = await queueMutation(db, data.actor_id, 'claim-run', runId, { workflowId })
  return result.owned ? result.jobs ?? [] : []
}
async function advance(jobId: string, workflowId: string) {
  'use step'
  const status = await advanceResearchJob(queueDatabase(), jobId, workflowId, attemptUuid(`${jobId}:${getStepMetadata().stepId}`))
  // Persist the wake time with the step result so concurrent replays never recalculate a relative deadline.
  return { status, resumeAt: status === 'wait' ? new Date(Date.now() + 3000) : null }
}
advance.maxRetries = 0

async function finishRun(runId: string, workflowId: string, failed: boolean) {
  'use step'
  const db = queueDatabase()
  const { data, error } = await db.from('import_reorder_1688_runs').select(RUN_COLUMNS).eq('id', runId).single()
  if (error) throw new Error('Research completion could not be saved')
  if (failed) await queueMutation(db, data.actor_id, 'abort-run', runId, { workflowId })
  await queueMutation(db, data.actor_id, 'finish-run', runId, { workflowId })
}
export async function reorder1688Workflow(runId: string) {
  'use workflow'
  const workflowId = getWorkflowMetadata().workflowRunId
  const jobs = await ownRun(runId, workflowId)
  if (!jobs.length) return
  let failed = false
  try {
    await Promise.all([0, 1, 2].map(async lane => {
      for (let index = lane; index < jobs.length; index += 3) {
        for (;;) {
          const result = await advance(jobs[index], workflowId)
          if (result.status === 'done') break
          if (result.resumeAt) await sleep(result.resumeAt)
        }
      }
    }))
  } catch {
    failed = true
  }
  await finishRun(runId, workflowId, failed)
}
