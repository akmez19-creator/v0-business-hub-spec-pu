'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

/**
 * Get all localities for client-side resolution.
 * Returns localities with their region (delivery zone) mappings.
 */
export async function getRegionResolverData() {
  const supabase = await createClient()

  const { data: localities } = await supabase
    .from('localities')
    .select('name, region')
    .eq('is_active', true)
    .order('name')

  return {
    localities: (localities || []).map(l => ({ name: l.name, region: l.region })),
  }
}

/**
 * Get just the locality names.
 */
export async function getLocalityNames() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('localities')
    .select('name')
    .eq('is_active', true)
    .order('name')
  return (data || []).map(l => l.name)
}

/**
 * Get distinct region (delivery zone) names.
 */
export async function getRegionNames() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('localities')
    .select('region')
    .eq('is_active', true)
  const regions = new Set((data || []).map(l => l.region))
  return Array.from(regions).sort()
}

/**
 * Admin: add a new locality.
 */
export async function addLocality(name: string, region: string, district: string, routeCode: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase.from('localities').insert({
    name: name.trim(),
    region: region.trim(),
    district: district.trim(),
    route_code: routeCode.trim(),
  })
  if (error) return { error: error.message }

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/admin/regions')
  return { success: true }
}

/**
 * Admin: remove a locality.
 */
export async function removeLocality(name: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase.from('localities').delete().eq('name', name)
  if (error) return { error: error.message }

  revalidatePath('/dashboard')
  revalidatePath('/dashboard/admin/regions')
  return { success: true }
}
