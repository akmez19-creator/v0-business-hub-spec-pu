import React from "react"
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function RiderLayout({
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
  
  // Only allow riders (or admins viewing as rider)
  if (!profile || (profile.role !== 'rider' && profile.role !== 'admin')) {
    redirect('/dashboard')
  }
  
  return <>{children}</>
}
