import 'server-only'
import { start } from 'workflow/api'
import type { SupabaseClient } from '@supabase/supabase-js'
import { reorder1688Workflow } from '@/workflows/reorder-1688'
import { queueMutation } from './1688-queue'
import type { ResearchRun } from './1688-sourcing-types'

export async function dispatchResearch(db: SupabaseClient, actor: string, run: ResearchRun) {
  if (run.workflow_id || run.stop_requested || !['accepted', 'dispatch_unknown'].includes(run.status)) return
  try {
    await start(reorder1688Workflow, [run.id])
  } catch {
    await queueMutation(db, actor, 'dispatch-failed', run.id)
  }
}
