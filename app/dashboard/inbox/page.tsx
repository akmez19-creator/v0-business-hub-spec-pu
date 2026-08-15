import { headers } from 'next/headers'
import { InboxWorkspace } from '@/components/inbox/inbox-workspace'

export const metadata = {
  title: 'Inbox | AKMEZ Business Hub',
  description: 'Messenger, comments and WhatsApp across all your Facebook Pages.',
}

export default async function InboxPage() {
  // The WhatsApp setup panel has to show the exact webhook URL to paste into
  // Meta, so resolve the real deployment origin rather than guessing.
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  const origin = host ? `${proto}://${host}` : ''

  return (
    <main className="flex flex-col">
      <header className="flex flex-col gap-1 p-6">
        <h1 className="text-2xl font-semibold">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Messenger, comments and WhatsApp across all your Facebook Pages
        </p>
      </header>
      <InboxWorkspace origin={origin} />
    </main>
  )
}
