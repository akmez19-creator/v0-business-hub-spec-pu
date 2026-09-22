import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { InboxWorkspace } from '@/components/inbox/inbox-workspace'
import { AutopilotLauncher } from '@/components/inbox/autopilot-launcher'
import { ReplyPromptLauncher } from '@/components/inbox/reply-prompt-launcher'

export const metadata = {
  title: 'Inbox | AKMEZ Business Hub',
  description: 'Messenger, comments and WhatsApp across all your Facebook Pages.',
}

export default async function InboxPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = user ? await supabase.from('profiles').select('name, email').eq('id', user.id).maybeSingle() : { data: null }
  const viewer = user ? { id: user.id, name: profile?.name || profile?.email || user.email || 'Someone' } : null
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
      <InboxWorkspace origin={origin} viewer={viewer} />
    </main>
  )
}
