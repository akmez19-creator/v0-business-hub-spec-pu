import { createClient, createAdminClient } from '@/lib/supabase/server'

export { requireBuyer }

async function requireBuyer() {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) throw new Error('Not signed in')
  const db = createAdminClient()
  const { data: profile, error: profileError } = await db.from('profiles').select('role').eq('id', user.id).single()
  if (profileError || !profile || !['admin', 'manager'].includes(profile.role)) throw new Error('Not allowed')
  return { db, supabase, userId: user.id }
}
