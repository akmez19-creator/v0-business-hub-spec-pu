'use client'

import { AlertTriangle, Copy, ExternalLink, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

/**
 * The state shown when a channel cannot run.
 *
 * Deliberately specific: it names the exact scopes missing and the exact step
 * that fixes them. A generic "something went wrong" would send the user to
 * re-tick permissions they have already ticked - the real failure is that
 * selecting scopes in the Graph Explorer does not change the live token until
 * it is regenerated and the env var replaced.
 */
export function ChannelUnavailable({
  title,
  description,
  missing = [],
  steps,
  children,
}: {
  title: string
  description?: string
  missing?: string[]
  steps?: string[]
  children?: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)

  const copyScopes = async () => {
    try {
      await navigator.clipboard.writeText(missing.join(','))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be blocked; the scopes are visible on screen regardless.
    }
  }

  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto p-8">
      <div className="flex w-full max-w-[720px] flex-col gap-6 rounded-xl border border-border bg-card p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
            <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="text-lg font-semibold text-balance">{title}</h3>
            {description ? (
              <p className="text-sm leading-relaxed text-muted-foreground text-pretty">{description}</p>
            ) : null}
          </div>
        </div>

        {missing.length > 0 ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-sm font-medium">Missing permissions</span>
              </div>
              <Button variant="ghost" size="sm" onClick={copyScopes} className="h-7 gap-1.5 text-xs">
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {missing.map((m) => (
                <Badge key={m} variant="outline" className="border-amber-500/40 font-mono text-xs text-amber-500">
                  {m}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}

        {steps?.length ? (
          <ol className="flex flex-col gap-3">
            {steps.map((s, i) => (
              <li key={s} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums">
                  {i + 1}
                </span>
                <span className="pt-0.5 text-sm leading-relaxed text-muted-foreground text-pretty">{s}</span>
              </li>
            ))}
          </ol>
        ) : null}

        {children}

        <div className="flex flex-wrap gap-2 border-t border-border pt-5">
          <Button variant="outline" size="sm" asChild>
            <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noreferrer noopener">
              Graph API Explorer
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href="https://business.facebook.com/settings" target="_blank" rel="noreferrer noopener">
              Business settings
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </Button>
        </div>
      </div>
    </div>
  )
}
