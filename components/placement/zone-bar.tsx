"use client"

import { useMemo } from "react"
import { Layers } from "lucide-react"
import { cn } from "@/lib/utils"
import { ZONE_ORDER, zoneForLocality } from "@/lib/ads-region-zones"
import type { EffectiveEntry } from "@/lib/placement/effective"

/**
 * Whole-zone assignment for a single day, using the SAME zone presets as the
 * Regions page (`ZONE_ORDER` / `zoneForLocality`) rather than a second grouping
 * invented here - riders already think in these zones, and two sources of
 * "which localities belong together" would be two chances to disagree.
 *
 * Clicking one zone replaces up to 56 individual pin clicks. All 76 currently
 * riderless localities resolve to a zone, so this can finish a day on its own.
 */
export interface ZoneStat {
  zone: string
  localities: string[]
  /** Localities in the zone with nobody on them right now. */
  gaps: string[]
  /** Open orders sitting on those gap localities - the cost of leaving it. */
  gapOrders: number
  /** Distinct riders currently covering part of this zone. */
  riderCount: number
  /**
   * Of the gaps, how many are unresolved only because their contractor has
   * SEVERAL active riders. Named separately so the chip can say "needs a
   * choice" instead of implying nobody covers the area at all.
   */
  ambiguous: number
}

export function zoneStats(entries: EffectiveEntry[]): ZoneStat[] {
  const byZone = new Map<string, EffectiveEntry[]>()
  for (const e of entries) {
    // 'UNGROUPED' is kept as a real bucket, never dropped: a locality with no
    // zone still has orders, and silently hiding it is how a day looks finished
    // while orders have no rider.
    const zone = zoneForLocality(e.name) ?? "UNGROUPED"
    const arr = byZone.get(zone)
    if (arr) arr.push(e)
    else byZone.set(zone, [e])
  }

  const order = [...ZONE_ORDER, "UNGROUPED"]
  return Array.from(byZone.entries())
    .map(([zone, locs]) => {
      const gaps = locs.filter((l) => !l.riderId)
      return {
        zone,
        localities: locs.map((l) => l.locality),
        gaps: gaps.map((l) => l.locality),
        gapOrders: gaps.reduce((n, l) => n + l.orderCount, 0),
        riderCount: new Set(locs.filter((l) => l.riderId).map((l) => l.riderId)).size,
        ambiguous: gaps.filter((l) => l.standingSource === "ambiguous").length,
      }
    })
    .sort((a, b) => {
      const ai = order.indexOf(a.zone)
      const bi = order.indexOf(b.zone)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
}

interface ZoneBarProps {
  entries: EffectiveEntry[]
  armedRiderId: string | null
  armedRiderName: string | null
  armedColor: string
  onAssign: (localities: string[], riderId: string) => void
}

export function ZoneBar({ entries, armedRiderId, armedRiderName, armedColor, onAssign }: ZoneBarProps) {
  const stats = useMemo(() => zoneStats(entries), [entries])
  const totalGaps = stats.reduce((n, s) => n + s.gaps.length, 0)

  return (
    <section aria-labelledby="zone-bar-heading" className="rounded-xl border border-border/60 bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Layers className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <h2 id="zone-bar-heading" className="text-xs font-semibold text-foreground">
          Assign a whole zone
        </h2>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {armedRiderName ? (
            <>
              <span className="font-semibold text-foreground">{armedRiderName}</span> is selected {"\u00b7"} click{" "}
              <span className="font-semibold">Gaps</span> to take only what nobody covers, or{" "}
              <span className="font-semibold">All</span> to take the whole zone
            </>
          ) : (
            "Pick a rider on the right first, then click a zone."
          )}
        </p>
        {totalGaps > 0 && (
          <span className="ml-auto shrink-0 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-destructive">
            {totalGaps} localities with no rider
          </span>
        )}
      </div>

      <ul className="flex flex-wrap gap-1.5">
        {stats.map((s) => {
          const covered = s.gaps.length === 0
          return (
            <li
              key={s.zone}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-2 py-1.5",
                covered ? "border-border/50 bg-muted/20" : "border-destructive/30 bg-destructive/5",
              )}
            >
              <span className="flex flex-col">
                <span className="text-[11px] font-semibold leading-tight text-foreground">
                  {s.zone === "UNGROUPED" ? "Ungrouped" : s.zone}
                </span>
                <span className="text-[9px] leading-tight text-muted-foreground tabular-nums">
                  {s.localities.length} loc
                  {/* State the cost of the gap in ORDERS, not just localities -
                      a locality with no orders today is not urgent. */}
                  {covered
                    ? s.riderCount > 1
                      ? ` \u00b7 ${s.riderCount} riders`
                      : " \u00b7 covered"
                    : ` \u00b7 ${s.gaps.length} ${
                        // "open" implied nobody covers the area. When the
                        // contractor has several riders the area IS covered -
                        // we just cannot tell which rider, which is a choice,
                        // not a hole.
                        s.ambiguous === s.gaps.length ? "to pick" : "open"
                      }${s.gapOrders > 0 ? `, ${s.gapOrders} ord` : ""}`}
                </span>
              </span>

              <span className="flex items-center gap-1">
                {/* Gaps first and styled as the primary action: assigning the
                    whole zone would STEAL localities another rider already
                    covers, which is rarely what is wanted mid-day. */}
                {!covered && (
                  <button
                    type="button"
                    disabled={!armedRiderId}
                    onClick={() => armedRiderId && onAssign(s.gaps, armedRiderId)}
                    title={
                      armedRiderId
                        ? `Give ${armedRiderName} the ${s.gaps.length} unassigned localities in ${s.zone}`
                        : "Pick a rider first"
                    }
                    style={armedRiderId ? { backgroundColor: armedColor } : undefined}
                    className="rounded px-1.5 py-0.5 text-[10px] font-bold text-background transition-opacity disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground enabled:hover:opacity-85"
                  >
                    Gaps
                  </button>
                )}
                <button
                  type="button"
                  disabled={!armedRiderId}
                  onClick={() => armedRiderId && onAssign(s.localities, armedRiderId)}
                  title={
                    armedRiderId
                      ? `Give ${armedRiderName} ALL ${s.localities.length} localities in ${s.zone}, including any another rider covers`
                      : "Pick a rider first"
                  }
                  className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground transition-colors disabled:cursor-not-allowed enabled:hover:border-primary/50 enabled:hover:text-foreground"
                >
                  All
                </button>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
