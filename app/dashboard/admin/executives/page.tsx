import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { ExecutivesContent } from '@/components/admin/executives-content'

export default async function ExecutivesPage() {
  const supabase = await createClient()
  const adminDb = createAdminClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  
  const { data: currentProfile } = await adminDb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()
  
  if (!currentProfile || !['admin', 'manager'].includes(currentProfile.role)) {
    redirect('/dashboard')
  }
  
  // Get all executives
  const { data: executives } = await adminDb
    .from('executives')
    .select('*')
    .order('created_at', { ascending: false })
  
  // Get all contractors with personal details
  const { data: contractors } = await adminDb
    .from('contractors')
    .select('*')
    .order('created_at', { ascending: false })
  
  return (
    <ExecutivesContent 
      executives={executives || []} 
      contractors={contractors || []} 
    />
  )
}
