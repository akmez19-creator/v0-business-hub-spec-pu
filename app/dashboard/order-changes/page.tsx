import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getRecentOrderChanges } from '@/lib/agent-actions'
import { OrderChangesLog } from '@/components/dashboard/order-changes-log'

const ALLOWED = ['admin', 'manager']

export default async function OrderChangesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || !ALLOWED.includes(profile.role)) redirect('/dashboard')

  const rows = await getRecentOrderChanges()

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Order changes</h2>
        <p className="text-muted-foreground">
          Every amendment or cancellation made from the order search, with who did it and why.
        </p>
      </div>
      <OrderChangesLog rows={rows} />
    </div>
  )
}
