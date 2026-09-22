'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { CheckCircle2, Loader2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { readInbox } from './inbox-session'
import type { CoverageReport, BehindThread } from '@/lib/messenger/coverage'

type Response = CoverageReport & { success: boolean }

function clock(iso: string | null) {
  if (!iso) return '—'
  const date = new Date(iso)
  const today = new Date().toDateString() === date.toDateString()
  return today
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function gapLabel(minutes: number | null) {
  if (minutes === null) return 'nothing held yet'
  if (minutes < 60) return `${minutes} min behind`
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h behind`
  return `${Math.round(minutes / 1440)} days behind`
}

function recoveryLabel(thread: BehindThread) {
  const { status, retryAt } = thread.recovery
  if (status === 'pending' && retryAt && Date.parse(retryAt) > Date.now()) return `recovery retries at ${clock(retryAt)}`
  if (status === 'pending') return 'queued for the next recovery pass'
  if (status === 'blocked') return 'recovery gave up on this thread'
  if (status === 'complete') return 'recovery will re-open it on the next pass'
  return 'not queued yet — next recovery pass picks it up'
}

export function CoverageCheck() {
  const [requestedAt, setRequestedAt] = useState<number | null>(null)
  const { data, error, isLoading } = useSWR<Response>(
    requestedAt ? `/api/inbox/coverage?hours=24&t=${requestedAt}` : null,
    readInbox,
    { revalidateOnFocus: false, revalidateOnReconnect: false, shouldRetryOnError: false },
  )
  const behindTotal = data?.pages.reduce((sum, page) => sum + page.behind.length, 0) ?? 0
  const checking = isLoading || (requestedAt !== null && !data && !error)

  return (
    <div className="sm:col-span-2 flex flex-col gap-2 border-t pt-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-pretty">
          <span className="font-medium">Are all messages reaching us?</span>{' '}
          <span className="text-muted-foreground">Asks Meta which threads were active in the last 24h and checks each against what we hold. Costs a few Facebook reads, so it runs only when you press it.</span>
        </p>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setRequestedAt(Date.now())} disabled={checking}>
          {checking ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />Checking with Meta…</> : data ? 'Check again' : 'Check against Meta'}
        </Button>
      </div>

      {error ? <p className="text-amber-600 dark:text-amber-400">{(error as Error).message}</p> : null}

      {data ? (
        <div className="flex flex-col gap-3">
          <p className={behindTotal === 0 ? 'flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400' : 'flex items-center gap-1.5 text-amber-600 dark:text-amber-400'}>
            {behindTotal === 0
              ? <><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />Everything Meta lists for the last 24h is in the system (checked {clock(data.checkedAt)}).</>
              : <><TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />{behindTotal} thread{behindTotal === 1 ? '' : 's'} where Meta holds something newer than we do (checked {clock(data.checkedAt)}).</>}
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {data.pages.map((page) => (
              <div key={page.id} className="flex flex-col gap-1 rounded-md border bg-background/60 p-2">
                <p className="font-medium">{page.name}</p>
                {page.error ? <p className="text-amber-600 dark:text-amber-400">{page.error}</p> : (
                  <>
                    <p className="text-muted-foreground">
                      Meta: {page.metaActive} active thread{page.metaActive === 1 ? '' : 's'} · we hold {page.held} fully{page.behind.length ? `, ${page.behind.length} behind` : ''}
                    </p>
                    <p className="text-muted-foreground">
                      {page.inbound.total} customer message{page.inbound.total === 1 ? '' : 's'} in 24h: {page.inbound.live} arrived live, {page.inbound.recovered} filled in by the recovery
                      {page.inbound.recovered > 0 ? ' (Meta never delivered those to the webhook)' : ''}
                    </p>
                    <p className="text-muted-foreground">
                      Recovery last ran {clock(page.recovery.lastRunAt)} · {page.recovery.pending} queued{page.recovery.blocked ? `, ${page.recovery.blocked} blocked` : ''}
                    </p>
                    {page.behind.length ? (
                      <ul className="mt-1 flex flex-col gap-1 border-t pt-1">
                        {page.behind.slice(0, 12).map((thread) => (
                          <li key={thread.psid} className="flex flex-col">
                            <span className="font-medium">{thread.name} <span className="font-normal text-muted-foreground">· {gapLabel(thread.minutesBehind)}</span></span>
                            <span className="text-muted-foreground">Meta {clock(thread.metaUpdatedAt)} · ours {clock(thread.ourLastAt)} · {recoveryLabel(thread)}</span>
                          </li>
                        ))}
                        {page.behind.length > 12 ? <li className="text-muted-foreground">and {page.behind.length - 12} more</li> : null}
                      </ul>
                    ) : null}
                  </>
                )}
              </div>
            ))}
          </div>
          <p className="text-muted-foreground text-pretty">
            &ldquo;Arrived live&rdquo; means the webhook delivered it within a minute. &ldquo;Filled in by the recovery&rdquo; means Meta skipped the webhook and the 5-minute recovery pass fetched it - that is the normal path for those, not an error, but it means a delay of up to ~10 minutes before an agent sees them.
          </p>
        </div>
      ) : null}
    </div>
  )
}
