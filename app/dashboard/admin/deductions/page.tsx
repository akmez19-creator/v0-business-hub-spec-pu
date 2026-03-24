import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { AdminDeductionsContent } from '@/components/admin/deductions-content'

export default async function AdminDeductionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) redirect('/auth/sign-in')
  
  const adminDb = createAdminClient()
  const { data: profile } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    redirect('/dashboard')
  }

  const { data: contractors } = await adminDb
    .from('contractors')
    .select('id, name')
    .order('name')

  const { data: riders } = await adminDb
    .from('riders')
    .select('id, name')
    .order('name')

  return (
    <div className="container mx-auto py-6">
      <AdminDeductionsContent 
        contractors={contractors || []} 
        riders={riders || []} 
      />
    </div>
  )
}
