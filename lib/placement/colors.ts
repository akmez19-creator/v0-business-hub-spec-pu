// A rider's colour has to be STABLE: the same person must be the same colour in
// the map pins, the rider rail and the legend, and must not change when someone
// is added or goes inactive. So the colour is derived from the rider id, never
// from their position in a list.

// Chosen to stay distinguishable on the app's near-black surface, and to keep
// adjacent hues far enough apart to tell apart in a dense cluster of pins.
const PALETTE = [
  "#f59e0b", // amber - the app's own accent
  "#38bdf8", // sky
  "#a3e635", // lime
  "#f472b6", // pink
  "#c084fc", // violet
  "#2dd4bf", // teal
  "#fb923c", // orange
  "#60a5fa", // blue
  "#facc15", // yellow
  "#4ade80", // green
  "#f87171", // red
  "#e879f9", // fuchsia
  "#22d3ee", // cyan
  "#fbbf24", // gold
  "#818cf8", // indigo
  "#34d399", // emerald
  "#fda4af", // rose
  "#bef264", // yellow-green
] as const

/** Deterministic 32-bit hash so a given rider id always lands on one colour. */
function hash(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Unassigned is deliberately grey - it must never look like a rider. */
export const UNASSIGNED_COLOR = "#52525b"

export function riderColor(riderId: string | null | undefined): string {
  if (!riderId) return UNASSIGNED_COLOR
  return PALETTE[hash(riderId) % PALETTE.length]
}

/**
 * Colours for a known set of riders, nudged so no two riders on screen share
 * one. Hashing alone can collide, and two riders in the same colour on a map is
 * worse than a slightly less pretty palette.
 */
export function riderColorMap(riderIds: string[]): Map<string, string> {
  const out = new Map<string, string>()
  const used = new Set<string>()

  // Sort for determinism: the same rider set always resolves the same way,
  // regardless of the order the caller happened to pass them in.
  for (const id of [...riderIds].sort()) {
    const start = hash(id) % PALETTE.length
    let picked = PALETTE[start]
    if (used.has(picked)) {
      for (let step = 1; step < PALETTE.length; step++) {
        const cand = PALETTE[(start + step) % PALETTE.length]
        if (!used.has(cand)) {
          picked = cand
          break
        }
      }
    }
    used.add(picked)
    out.set(id, picked)
  }
  return out
}
