import { headers } from 'next/headers'
import { InboxWorkspace } from '@/components/inbox/inbox-workspace'
import { AutopilotLauncher } from '@/components/inbox/autopilot-launcher'
import { ReplyPromptLauncher } from '@/components/inbox/reply-prompt-launcher'

export const metadata = {
  title: 'Inbox | AKMEZ Business Hub',
  description: 'Messenger, comments and WhatsApp across all your Facebook Pages.',
}

export default async function InboxPage() {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  const origin = host ? `${proto}://${host}` : ''
  return (
    <main className="flex flex-col">
      {/* One thin row: the conversation columns below are the work surface. */}
      <header className="flex flex-wrap items-center justify-between gap-2 px-3 pb-2 pt-1 md:px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold">Inbox</h1>
          <p className="hidden text-xs text-muted-foreground sm:block">Messenger, comments and WhatsApp across all your Facebook Pages</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ReplyPromptLauncher />
          <AutopilotLauncher />
        </div>
      </header>
      <InboxWorkspace origin={origin} />
    </main>
  )
}
