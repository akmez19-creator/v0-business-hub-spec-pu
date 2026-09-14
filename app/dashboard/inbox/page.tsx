import { headers } from 'next/headers'
import { InboxWorkspace } from '@/components/inbox/inbox-workspace'
import { AutopilotLauncher } from '@/components/inbox/autopilot-launcher'

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
      <header className="flex flex-wrap items-start justify-between gap-3 p-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Inbox</h1>
          <p className="text-sm text-muted-foreground">Messenger, comments and WhatsApp across all your Facebook Pages</p>
        </div>
        <AutopilotLauncher />
      </header>
      <InboxWorkspace origin={origin} />
    </main>
  )
}
