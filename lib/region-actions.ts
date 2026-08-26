'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

/**
 * Get all localities for client-side resolution.
 * Returns localities with their region (delivery zone) mappings.
 */
export async function getRegionResolverData() {
  const supabase = await createClient()

  // `district` is the zone column; `localities` has no `region` column. The old
  // select errored out and `|| []` reported "no localities" instead of failing.
  const { data: localities, error } = await supabase
    .from('localities')
    .select('name, district')
    .eq('is_active', true)
    .order('name')

  if (error) {
    throw new Error(`Could not load localities: ${error.message}`)
  }

  // Output key stays `region` - it maps onto `deliveries.region` downstream.
  return {
    localities: (localities || []).map(l => ({ name: l.name, region: l.district })),
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
  const { data, error } = await supabase
    .from('localities')
    .select('district')
    .eq('is_active', true)

  if (error) {
    throw new Error(`Could not load zones: ${error.message}`)
  }

  const regions = new Set((data || []).map(l => l.district).filter(Boolean))
  return Array.from(regions).sort()
}

/**
 * Admin: add a new locality.
 */
/**
 * `district` IS the zone - there is no separate `region` column on this table,
 * so the old four-argument form could never insert: Postgres rejected the
 * unknown `region` key and every add failed. `district` and `route_code` are
 * both NOT NULL, so they are validated here rather than surfacing as a raw
 * constraint violation.
 */
export async function addLocality(name: string, district: string, routeCode: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  if (!name.trim()) return { error: 'Locality name is required.' }
  if (!district.trim()) return { error: 'District is required.' }
  if (!routeCode.trim()) return { error: 'Route code is required.' }

  const { error } = await supabase.from('localities').insert({
    name: name.trim(),
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
