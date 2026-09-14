'use client'

/**
 * The inbox is one screen now.
 *
 * It used to be five tabs - Leads, All messages, Messenger, Comments,
 * WhatsApp - which meant an agent answering one customer moved between a list
 * view, a channel view and a separate tool to raise the order. Everything the
 * channel tabs did (read, reply, filter) is inside Leads, which merges all
 * three channels, so the rail is gone.
 *
 * The one thing Leads cannot absorb is WhatsApp *setup*: pasting a webhook URL
 * into Meta is not lead work. It stays behind a toggle, and only announces
 * itself when a channel is actually unavailable.
 */

import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { ArrowLeft, Settings2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LeadsChannel } from './leads-channel'
import { WhatsAppChannel } from './whatsapp-channel'
import { readInbox } from './inbox-session'

type ChannelId = 'leads' | 'all' | 'messenger' | 'comments' | 'whatsapp'

type CapabilityState = {
  id: string
  label: string
  available: boolean
  missing: string[]
  reason?: string
}

type CapabilitiesResponse = {
  success: boolean
  channels?: Record<ChannelId, CapabilityState>
  whatsappConfigured?: boolean
  error?: string
}

const fetcher = readInbox

export function InboxWorkspace({ origin }: { origin: string }) {
  const [setupOpen, setSetupOpen] = useState(false)
  const [healthOpen, setHealthOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number | null>(null)
  useEffect(() => {
    const measure = () => {
      if (panelRef.current) setHeight(Math.max(360, window.innerHeight - panelRef.current.getBoundingClientRect().top - 16))
    }
    measure()
    window.addEventListener('resize', measure)
    const observer = new ResizeObserver(measure)
    if (panelRef.current?.parentElement) observer.observe(panelRef.current.parentElement)
    return () => { window.removeEventListener('resize', measure); observer.disconnect() }
  }, [])
  const { data: health, error: healthError } = useSWR<{
    success: boolean
    pages: { id: string; name: string; lastMessageAt: string | null; lastWebhookAt: string | null; conversationCount: number; lastWebhookError?: string | null; lastSyncError?: string | null }[]
    messenger?: { lastSyncAt: string | null; lastError: string | null }
    checkedAt: string
  }>('/api/inbox/health', fetcher, { refreshInterval: 60_000, refreshWhenHidden: false })

  const { data: caps } = useSWR<CapabilitiesResponse>('/api/inbox/capabilities', fetcher, {
    refreshInterval: 5 * 60_000,
  })

  // Only claim a channel is broken once capabilities have loaded - "unknown"
  // must never render as "needs permission".
  const degraded = Object.values(caps?.channels ?? {}).filter(
    (c) => c && !c.available && c.id !== 'leads' && c.id !== 'all',
  )

  return (
    <div ref={panelRef} style={{ height: height ?? '70dvh' }} className="flex min-h-0 flex-col gap-2 px-3 pb-1 md:px-6">
      {healthOpen ? <div className="grid shrink-0 gap-2 rounded-lg border bg-card p-3 text-xs sm:grid-cols-2">
        {health?.pages.map((page) => <div key={page.id}><p className="font-medium">{page.name}</p><p className="mt-1 text-muted-foreground">{page.conversationCount} conversations in history</p><p className="text-muted-foreground">Last received event: {page.lastWebhookAt ? new Date(page.lastWebhookAt).toLocaleString() : 'Not recorded'}</p>{page.lastWebhookError || page.lastSyncError ? <p className="mt-1 text-amber-600 dark:text-amber-400">{page.lastWebhookError || page.lastSyncError}</p> : null}</div>)}
        {health?.messenger?.lastError ? <p className="text-amber-600 dark:text-amber-400 sm:col-span-2">Facebook updates delayed: {health.messenger.lastError}</p> : null}
        <p className="text-muted-foreground sm:col-span-2">This shows received activity, not a live connection test.</p>
      </div> : null}
      {degraded.length > 0 ? (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          <p className="flex-1 text-xs leading-relaxed text-pretty">
            {degraded
              .map((c) =>
                c.missing.length
                  ? `${c.label} needs the ${c.missing.join(' and ')} permission`
                  : `${c.label}: ${c.reason ?? 'unavailable'}`,
              )
              .join('. ')}
            . Some actions may be unavailable. Previously loaded conversations remain visible.
          </p>
        </div>
      ) : null}

      <div className={setupOpen ? 'hidden' : 'flex min-h-0 flex-1 overflow-hidden'}><LeadsChannel active={!setupOpen} /></div>
      <div className={setupOpen ? 'flex min-h-0 flex-1 overflow-hidden' : 'hidden'}>
        {setupOpen ? <WhatsAppChannel origin={origin} initialWaId={null} /> : null}
      </div>

      {/* Status and setup share one footer line so the columns above get the height. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <span>{healthError ? 'Page activity check unavailable' : health ? `${health.pages.length} Pages in inbox history` : 'Checking Page activity…'}</span>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setHealthOpen((value) => !value)} aria-expanded={healthOpen}>{healthOpen ? 'Hide Page activity' : 'Page activity'}</Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSetupOpen((v) => !v)}
          className="h-7 gap-1.5 text-xs text-muted-foreground"
        >
          {setupOpen ? (
            <>
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Back to leads
            </>
          ) : (
            <>
              <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
              WhatsApp setup
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
