/**
 * Client-side locality/region resolver builder.
 * Takes the data from getRegionResolverData() and returns a resolve function.
 * Returns both locality name and delivery region for each input.
 */

export interface ResolvedLocation {
  locality: string
  region: string
}

export function buildClientRegionResolver(
  regionData: {
    localities: { name: string; region: string }[]
  }
) {
  // Locality -> region mapping (source of truth)
  const localityLookup = new Map<string, { name: string; region: string }>()
  for (const loc of regionData.localities) {
    localityLookup.set(loc.name.toLowerCase().trim(), { name: loc.name, region: loc.region })
  }

  return (input: string): ResolvedLocation | null => {
    if (!input) return null
    const lower = input.trim().toLowerCase()

    // 1. Direct match in localities
    const exact = localityLookup.get(lower)
    if (exact) return { locality: exact.name, region: exact.region }

    // 2. Strip detail (after comma, slash, parens) and re-check
    const stripped = lower.replace(/[,\/\(].*/g, '').trim()
    if (stripped !== lower) {
      const match = localityLookup.get(stripped)
      if (match) return { locality: match.name, region: match.region }
    }

    // 3. Substring match (input contains locality name >= 4 chars)
    for (const [key, val] of localityLookup) {
      if (key.length >= 4 && lower.includes(key)) {
        return { locality: val.name, region: val.region }
      }
    }

    // 4. Reverse substring (locality contains input >= 4 chars)
    if (lower.length >= 4) {
      for (const [key, val] of localityLookup) {
        if (key.includes(lower)) {
          return { locality: val.name, region: val.region }
        }
      }
    }

    return null
  }
}
