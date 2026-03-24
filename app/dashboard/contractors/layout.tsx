import React from "react"
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function ContractorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  
  // Only allow contractors (or admins viewing as contractor)
  if (!profile || (profile.role !== 'contractor' && profile.role !== 'admin')) {
    redirect('/dashboard')
  }
  
  return <>{children}</>
}
