import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { SettingsPage } from '@/components/storekeeper/settings-page'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function StorekeeperSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const adminDb = await createAdminClient()
  const { data: profile } = await adminDb
    .from('profiles')
    .select('id, name, email, phone, role, avatar_url, created_at')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'storekeeper') redirect('/dashboard')

  return <SettingsPage profile={profile} />
}
