import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ToolsDownloadPage } from '@/components/tools/tools-download-page'

export default async function ToolsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) redirect('/auth/sign-in')
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  
  // Only allow admin, manager, and marketing roles
  const allowedRoles = ['admin', 'manager', 'marketing_agent', 'marketing_back_office', 'marketing_front_office']
  if (!profile || !allowedRoles.includes(profile.role)) {
    redirect('/dashboard')
  }
  
  return <ToolsDownloadPage />
}
