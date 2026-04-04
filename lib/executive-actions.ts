'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

interface ExecutiveData {
  first_name: string
  last_name: string
  date_of_birth?: string | null
  sex?: string | null
  marital_status?: string | null
  nationality?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  nic?: string | null
  tan?: string | null
  employee_code?: string | null
  department?: string | null
  position?: string | null
  employment_type?: string | null
  date_joined?: string | null
  pay_type?: string | null
  base_salary?: number | null
  bank_name?: string | null
  bank_account?: string | null
  bank_branch?: string | null
  emergency_contact_name?: string | null
  emergency_contact_phone?: string | null
  emergency_contact_relation?: string | null
  notes?: string | null
}

export async function createExecutive(data: ExecutiveData) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }
  
  const adminDb = createAdminClient()
  
  const { data: profile } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Unauthorized' }
  }
  
  const { error } = await adminDb
    .from('executives')
    .insert({
      ...data,
      created_by: user.id,
    })
  
  if (error) {
    console.error('Error creating executive:', error)
    return { error: error.message }
  }
  
  revalidatePath('/dashboard/admin/executives')
  return { success: true }
}

export async function updateExecutive(id: string, data: Partial<ExecutiveData>) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }
  
  const adminDb = createAdminClient()
  
  const { data: profile } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Unauthorized' }
  }
  
  const { error } = await adminDb
    .from('executives')
    .update({
      ...data,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  
  if (error) {
    console.error('Error updating executive:', error)
    return { error: error.message }
  }
  
  revalidatePath('/dashboard/admin/executives')
  return { success: true }
}

export async function deleteExecutive(id: string) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }
  
  const adminDb = createAdminClient()
  
  const { data: profile } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Unauthorized' }
  }
  
  const { error } = await adminDb
    .from('executives')
    .delete()
    .eq('id', id)
  
  if (error) {
    console.error('Error deleting executive:', error)
    return { error: error.message }
  }
  
  revalidatePath('/dashboard/admin/executives')
  return { success: true }
}

export async function updateContractorDetails(id: string, data: {
  first_name?: string | null
  last_name?: string | null
  date_of_birth?: string | null
  sex?: string | null
  marital_status?: string | null
  nationality?: string | null
  address?: string | null
  city?: string | null
  nic?: string | null
  tan?: string | null
  employee_code?: string | null
  department?: string | null
  position?: string | null
  date_joined?: string | null
  bank_name?: string | null
  bank_account?: string | null
  bank_branch?: string | null
  emergency_contact_name?: string | null
  emergency_contact_phone?: string | null
  emergency_contact_relation?: string | null
  notes?: string | null
}) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }
  
  const adminDb = createAdminClient()
  
  const { data: profile } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Unauthorized' }
  }
  
  const { error } = await adminDb
    .from('contractors')
    .update({
      ...data,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  
  if (error) {
    console.error('Error updating contractor details:', error)
    return { error: error.message }
  }
  
  revalidatePath('/dashboard/admin/executives')
  revalidatePath('/dashboard/admin/team')
  return { success: true }
}
