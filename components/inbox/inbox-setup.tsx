'use client'

import { ExternalLink, KeyRound, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/** The app that owns FACEBOOK_ACCESS_TOKEN, read off the live token. */
const APP_ID = '1284520097159203'

const STEPS = [
  {
    title: 'Open the Graph API Explorer',
    body: 'Pick your app in the top-right dropdown, then set "User or Page" to your own user.',
    href: `https://developers.facebook.com/tools/explorer/${APP_ID}/`,
    cta: 'Open Explorer',
  },
  {
    title: 'Add the pages_messaging permission',
    body: 'Open "Add a permission", tick pages_messaging, and keep every scope already listed so nothing else in the dashboard breaks. Then press "Generate Access Token" and approve the prompt for your Page.',
  },
  {
    title: 'Make the token long-lived',
    body: 'A freshly generated token lasts about an hour. Paste it into the Access Token Debugger and press "Extend Access Token" to get the 60-day version.',
    href: 'https://developers.facebook.com/tools/debug/accesstoken/',
    cta: 'Open Debugger',
  },
  {
    title: 'Replace FACEBOOK_ACCESS_TOKEN',
    body: 'Update the variable in Project Settings → Vars with the extended token. The inbox starts working on the next page load, and the ads dashboard keeps running because every existing scope is still attached.',
  },
]

export function InboxSetup({
  pageName,
  reason,
  pages = [],
  activePageId,
  onSelectPage,
}: {
  pageName?: string
  reason?: string
  pages?: { id: string; name: string }[]
  activePageId?: string
  onSelectPage?: (id: string) => void
}) {
  const noPage = reason === 'no-page'

  return (
    <div className="mx-auto w-full max-w-3xl py-10">
      <Card className="border-amber-500/30 bg-amber-500/5 p-8">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-amber-500/15">
            <KeyRound className="h-5 w-5 text-amber-500" aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold text-balance">
              {noPage ? 'No Facebook Page is reachable' : 'One permission away from a live inbox'}
            </h2>
            <p className="text-pretty leading-relaxed text-muted-foreground">
              {noPage ? (
                'The configured access token cannot see any Page. Re-generate it while granting access to your business Page.'
              ) : (
                <>
                  Your token can already read ads and publish posts, but Messenger conversations need the{' '}
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">pages_messaging</code> scope, which it does
                  not have yet.
                  {pageName ? (
                    <>
                      {' '}
                      Facebook can see your Page (<span className="font-medium text-foreground">{pageName}</span>) — it
                      just will not hand over the messages.
                    </>
                  ) : null}
                </>
              )}
            </p>
          </div>
        </div>

        {pages.length > 1 && onSelectPage ? (
          <div className="mt-6 flex flex-col gap-2">
            <label htmlFor="inbox-page" className="text-sm font-medium">
              Page to connect
            </label>
            <p className="text-sm leading-relaxed text-muted-foreground">
              This token manages {pages.length} Pages. Pick the one whose messages you want here — grant{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">pages_messaging</code> for that same Page in
              step 2.
            </p>
            <Select value={activePageId} onValueChange={onSelectPage}>
              <SelectTrigger id="inbox-page" className="max-w-sm">
                <SelectValue placeholder="Select a Page" />
              </SelectTrigger>
              <SelectContent>
                {pages.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="mt-8 flex flex-col gap-5">
          {STEPS.map((step, i) => (
            <div key={step.title} className="flex gap-4">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-sm font-medium tabular-nums">
                {i + 1}
              </div>
              <div className="flex flex-col items-start gap-2 pt-0.5">
                <p className="font-medium leading-snug">{step.title}</p>
                <p className="text-pretty text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                {step.href ? (
                  <Button asChild variant="outline" size="sm">
                    <a href={step.href} target="_blank" rel="noopener noreferrer">
                      {step.cta}
                      <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 flex items-start gap-3 rounded-lg border border-border/60 bg-background/40 p-4">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-pretty text-sm leading-relaxed text-muted-foreground">
            No App Review is required here. Meta only mandates it for apps that message on behalf of{' '}
            <em>other</em> businesses — an app talking to its own Page, as yours does, is exempt.
          </p>
        </div>
      </Card>
    </div>
  )
}
