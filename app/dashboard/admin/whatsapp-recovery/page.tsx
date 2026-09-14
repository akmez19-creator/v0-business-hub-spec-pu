import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { requireWhatsAppInboxUser } from '@/lib/whatsapp/number-scope'
import { WhatsAppCentral } from '@/components/admin/whatsapp-central'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'WhatsApp connections | AKMEZ', robots: { index: false, follow: false } }

export default async function WhatsAppRecoveryPage() {
  const user = await requireWhatsAppInboxUser()
  const { data: profile, error } = await createAdminClient().from('profiles')
    .select('role,approved').eq('id', user.id).maybeSingle()
  if (error) throw new Error('Recovery access could not be verified. Please try again.')
  if (profile?.role !== 'admin' || !profile.approved) redirect('/dashboard/inbox')
  return <WhatsAppCentral />
}
