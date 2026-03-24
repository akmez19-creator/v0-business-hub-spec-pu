import { createClient } from '@/lib/supabase/server'

export interface ResolvedLocation {
  locality: string
  region: string
}

export interface RegionResolver {
  resolve: (input: string) => ResolvedLocation | null
  localities: string[]
  regions: string[]
}

/**
 * Loads localities table from the DB and returns a resolver.
 * 
 * The resolver takes raw input (e.g. from an import spreadsheet) and returns:
 * - locality: the normalized locality name (e.g. "Grand Bay")
 * - region: the delivery zone (e.g. "GOODLANDS") from the localities table
 * 
 * Resolution order:
 * 1. Exact match against localities table
 * 2. Strip extra detail and re-check
 * 3. Substring matching (locality name in input or vice versa)
 */
export async function createRegionResolver(): Promise<RegionResolver> {
  const supabase = await createClient()

  const { data: localities } = await supabase
    .from('localities')
    .select('name, region')
    .eq('is_active', true)

  const localityList = localities || []

  // Build lookup: lowercase name -> { name, region }
  const localityMap = new Map<string, { name: string; region: string }>()
  for (const loc of localityList) {
    localityMap.set(loc.name.toLowerCase().trim(), { name: loc.name, region: loc.region })
  }

  const uniqueRegions = [...new Set(localityList.map(l => l.region))].sort()
  const allLocalityNames = localityList.map(l => l.name).sort()

  const resolve = (input: string): ResolvedLocation | null => {
    if (!input) return null
    const lower = input.trim().toLowerCase()

    // 1. Exact match
    const exact = localityMap.get(lower)
    if (exact) return { locality: exact.name, region: exact.region }

    // 2. Strip extra detail (after comma, slash, parens) and re-check
    const stripped = lower.replace(/[,\/\(].*/g, '').trim()
    if (stripped !== lower) {
      const match = localityMap.get(stripped)
      if (match) return { locality: match.name, region: match.region }
    }

    // 3. Check if input contains any locality name (>= 4 chars)
    for (const [key, val] of localityMap) {
      if (key.length >= 4 && lower.includes(key)) {
        return { locality: val.name, region: val.region }
      }
    }

    // 4. Check if any locality name contains the input (>= 4 chars)
    if (lower.length >= 4) {
      for (const [key, val] of localityMap) {
        if (key.includes(lower)) {
          return { locality: val.name, region: val.region }
        }
      }
    }

    return null
  }

  return {
    resolve,
    localities: allLocalityNames,
    regions: uniqueRegions,
  }
}
