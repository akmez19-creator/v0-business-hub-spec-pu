import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getConfirmations } from '@/lib/payment-confirmation-actions'
import { PaymentConfirmation } from '@/components/admin/payment-confirmation'

export const metadata = {
  title: 'Payment Confirmation',
  description: 'Confirm that the transfers your team recorded actually reached the bank.',
}

export default async function PaymentConfirmationPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/sign-in')

  const adminDb = createAdminClient()
  const { data: profile } = await adminDb
    .from('profiles').select('role').eq('id', user.id).single()

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    redirect('/dashboard')
  }

  // A rolling 30-day window: the statement download always reaches further back
  // than the part actually being worked on.
  const today = new Date()
  const to = today.toISOString().slice(0, 10)
  const from = new Date(today.getTime() - 30 * 86_400_000).toISOString().slice(0, 10)

  const res = await getConfirmations(from, to)

  return (
    <div className="container mx-auto py-6">
      <PaymentConfirmation
        initialView={'view' in res ? res.view : null}
        initialError={res.error}
        dateFrom={from}
        dateTo={to}
      />
    </div>
  )
}
