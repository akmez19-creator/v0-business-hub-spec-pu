import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { DuplicateReview } from '@/components/deliveries/duplicate-review'

export default async function DuplicateReviewPage() {
  const supabase = await createClient()
  const adminDb = createAdminClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Same gate as the inventory page this is launched from: merging rewrites
  // stock and order history, so it stays with admins and managers.
  const { data: profile } = await adminDb.from('profiles').select('*').eq('id', user.id).single()
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    redirect('/dashboard')
  }

  return <DuplicateReview />
}
