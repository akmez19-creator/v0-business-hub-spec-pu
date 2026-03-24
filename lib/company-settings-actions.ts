'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type CompanySettings = {
  id: string
  company_name: string
  company_address: string
  brn: string
  vat_number: string
  vat_rate: number
  phone: string
  email: string
  logo_url: string
  stamp_url: string | null
  warehouse_name: string | null
  warehouse_lat: number | null
  warehouse_lng: number | null
  updated_at: string
}

export async function getCompanySettings(): Promise<CompanySettings | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('company_settings')
    .select('*')
    .limit(1)
    .single()
  return data as CompanySettings | null
}

export async function updateCompanySettings(formData: FormData): Promise<{ error?: string }> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const adminDb = createAdminClient()
  const { data: profile } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') return { error: 'Not authorized' }

  const updates = {
    company_name: formData.get('company_name') as string,
    company_address: formData.get('company_address') as string,
    brn: formData.get('brn') as string,
    vat_number: formData.get('vat_number') as string,
    vat_rate: parseFloat(formData.get('vat_rate') as string) || 15,
    phone: formData.get('phone') as string,
    email: formData.get('email') as string,
    updated_at: new Date().toISOString(),
  }

  // Get the single row
  const { data: existing } = await adminDb
    .from('company_settings')
    .select('id')
    .limit(1)
    .single()

  if (!existing) return { error: 'Settings not found' }

  const { error } = await adminDb
    .from('company_settings')
    .update(updates)
    .eq('id', existing.id)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/admin/settings')
  return {}
}

export async function updateWarehouseLocation(warehouseName: string, lat: number, lng: number): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const adminDb = createAdminClient()
  const { data: profile } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') return { error: 'Not authorized' }

  const { data: existing } = await adminDb
    .from('company_settings')
    .select('id')
    .limit(1)
    .single()

  if (!existing) return { error: 'Settings not found' }

  const { error } = await adminDb
    .from('company_settings')
    .update({
      warehouse_name: warehouseName,
      warehouse_lat: lat,
      warehouse_lng: lng,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/admin/settings')
  return {}
}

export async function updateStampUrl(stampUrl: string): Promise<{ error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const adminDb = createAdminClient()
  const { data: profile } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') return { error: 'Not authorized' }

  const { data: existing } = await adminDb
    .from('company_settings')
    .select('id')
    .limit(1)
    .single()

  if (!existing) return { error: 'Settings not found' }

  const { error } = await adminDb
    .from('company_settings')
    .update({
      stamp_url: stampUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/admin/settings')
  return {}
}
