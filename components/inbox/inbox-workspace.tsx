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

import { useState } from 'react'
import useSWR from 'swr'
import { ArrowLeft, Settings2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LeadsChannel } from './leads-channel'
import { WhatsAppChannel } from './whatsapp-channel'

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

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function InboxWorkspace({ origin }: { origin: string }) {
  const [setupOpen, setSetupOpen] = useState(false)

  const { data: caps } = useSWR<CapabilitiesResponse>('/api/inbox/capabilities', fetcher, {
    refreshInterval: 5 * 60_000,
  })

  // Only claim a channel is broken once capabilities have loaded - "unknown"
  // must never render as "needs permission".
  const degraded = Object.values(caps?.channels ?? {}).filter(
    (c) => c && !c.available && c.id !== 'leads' && c.id !== 'all',
  )

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col gap-3 p-6 pt-0">
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
            . Those leads are missing from the list until it is granted.
          </p>
        </div>
      ) : null}

      <div className="flex flex-1 overflow-hidden">
        {setupOpen ? <WhatsAppChannel origin={origin} initialWaId={null} /> : <LeadsChannel />}
      </div>

      <div className="flex justify-end">
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
