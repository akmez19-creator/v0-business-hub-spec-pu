'use client'

import { useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import type { ResearchQueueStatus } from '@/lib/purchase-orders/1688-sourcing-types'
import type { Check1688Progress } from './check-1688-cell'

const key = '/api/purchase-orders/1688-check'
async function readQueue(): Promise<ResearchQueueStatus> {
  const response = await fetch(key, { cache: 'no-store' })
  const result = await response.json()
  if (!response.ok || !result.success) throw new Error(result.error || 'Background status could not be loaded. Submitted work has not been cancelled.')
  return result
}
async function controlQueue(input: unknown) {
  const response = await fetch(key, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  const result = await response.json()
  if (!response.ok || !result.success) throw new Error(result.error || 'The request was not acknowledged. Reload status before retrying.')
  return result
}
export function useResearchQueue(initial?: ResearchQueueStatus) {
  const { data, error, mutate } = useSWR<ResearchQueueStatus>(key, readQueue, { fallbackData: initial, refreshInterval: 4000, revalidateOnFocus: true, shouldRetryOnError: false })
  const [submitting, setSubmitting] = useState(false)
  const inFlight = useRef(false)
  const request = useRef<{ fingerprint: string; requestKey: string } | null>(null)
  const jobs = useMemo(() => { const map = new Map<string, ResearchQueueStatus['jobs'][number]>(); for (const job of data?.jobs ?? []) if (!map.has(job.item_id)) map.set(job.item_id, job); return map }, [data?.jobs])
  const activeRuns = (data?.runs ?? []).filter(run => (data?.jobs ?? []).some(job => job.run_id === run.id && ['queued', 'running'].includes(job.status)))
  const currentRuns = activeRuns.length ? activeRuns : data?.runs.slice(0, 1) ?? []
  const currentJobs = (data?.jobs ?? []).filter(job => currentRuns.some(run => run.id === job.run_id))
  const count = (...states: string[]) => currentJobs.filter(job => states.includes(job.status)).length
  const progress: Check1688Progress | null = currentJobs.length ? {
    rowIds: currentJobs.map(job => job.item_id), total: currentJobs.length, processed: count('complete', 'partial', 'failed', 'interrupted', 'stale'), checked: count('complete'), unavailable: 0,
    failed: count('partial', 'failed', 'interrupted'), discarded: count('stale'), skipped: count('stopped'), queued: count('queued'),
    running: currentRuns.some(run => ['accepted', 'running', 'stopping'].includes(run.status)) && count('queued', 'running') > 0,
    stopping: currentRuns.some(run => run.stop_requested), message: currentRuns.map(run => run.reason).filter(Boolean).join(' · ') || 'Accepted checks run in the background. You can leave this page; reopening only restores saved status.',
  } : null
  const submit = async (items: { itemId: string; revision: number; generation: number; version: number; mode: 'fresh' | 'resume' }[]) => {
    if (inFlight.current) return
    inFlight.current = true; setSubmitting(true)
    const fingerprint = JSON.stringify(items)
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, requestKey: crypto.randomUUID() }
    try {
      await controlQueue({ operation: 'enqueue', requestKey: request.current.requestKey, items })
      request.current = null
    } finally { inFlight.current = false; setSubmitting(false); await mutate() }
  }
  const stop = async () => { for (const run of activeRuns) await controlQueue({ operation: 'stop-batch', runId: run.id, requestKey: crypto.randomUUID() }); await mutate() }
  const redispatch = async (runId: string) => { await controlQueue({ operation: 'retry-dispatch', runId, requestKey: crypto.randomUUID() }); await mutate() }
  return { data, error, mutate, jobs, progress, submit, stop, redispatch, submitting }
}
