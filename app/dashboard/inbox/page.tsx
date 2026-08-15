import { InboxContent } from '@/components/inbox/inbox-content'

export const metadata = {
  title: 'Inbox | AKMEZ Business Hub',
  description: 'Messenger conversations for the business Page.',
}

export default function InboxPage() {
  return (
    <main className="flex flex-col">
      <header className="flex flex-col gap-1 p-6">
        <h1 className="text-2xl font-semibold">Inbox</h1>
        <p className="text-sm text-muted-foreground">Messenger conversations from your Facebook Page</p>
      </header>
      <InboxContent />
    </main>
  )
}
