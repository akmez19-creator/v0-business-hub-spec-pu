import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { UserManagementTable } from '@/components/admin/user-management-table'
import type { Profile } from '@/lib/types'

export default async function UserManagementPage() {
  const supabase = await createClient()
  const adminDb = createAdminClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  
  const { data: currentProfile } = await adminDb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()
  
  if (!currentProfile || currentProfile.role !== 'admin') {
    redirect('/dashboard')
  }
  
  const { data: users } = await adminDb
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })
  
  const { data: contractors } = await adminDb
    .from('profiles')
    .select('*')
    .eq('role', 'contractor')
  
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">User Management</h2>
        <p className="text-muted-foreground">
          Manage user accounts, roles, and approval status
        </p>
      </div>
      
      <UserManagementTable 
        users={(users || []) as Profile[]} 
        contractors={(contractors || []) as Profile[]}
        currentUserId={user.id}
      />
    </div>
  )
}
