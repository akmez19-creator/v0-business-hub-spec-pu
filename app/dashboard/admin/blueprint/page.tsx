import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SystemBlueprintPage } from '@/components/admin/system-blueprint-page'

export const dynamic = 'force-dynamic'

export default async function BlueprintPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (error || profile?.role !== 'admin') redirect('/dashboard')

  return <SystemBlueprintPage />
}
