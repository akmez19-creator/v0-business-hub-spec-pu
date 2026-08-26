"use client"

import { AlertTriangle, Bike, Check } from "lucide-react"
import type { PlacementSummary, RiderLoad } from "@/lib/placement/effective"

export type RiderRailProps = {
  riders: { id: string; name: string; daily_target: number | null }[]
  loads: Map<string, RiderLoad>
  colorFor: (riderId: string | null) => string
  armedRiderId: string | null
  onArm: (riderId: string | null) => void
  summary: PlacementSummary
  /** `onMap: false` means there is no pin for it, so the map cannot assign it. */
  unassignedWithOrders: { name: string; orderCount: number; onMap: boolean }[]
  /** Assign one of these localities to the armed rider without using the map. */
  onAssignLocality: (locality: string) => void
}

export function RiderRail({
  riders,
  loads,
  colorFor,
  armedRiderId,
  onArm,
  summary,
  unassignedWithOrders,
  onAssignLocality,
}: RiderRailProps) {
  // Busiest first: the rider carrying the day should not be buried in an
  // alphabetical list.
  const sorted = [...riders].sort((a, b) => {
    const la = loads.get(a.id)
    const lb = loads.get(b.id)
    return (lb?.orders ?? 0) - (la?.orders ?? 0) || (lb?.localities ?? 0) - (la?.localities ?? 0) || a.name.localeCompare(b.name)
  })

  return (
    <aside className="flex h-full w-full flex-col gap-3 lg:w-[19rem]">
      {/* The gap that actually costs money. Shown FIRST and only when real -
          "493/493 assigned" counts localities, not work, and hides exactly
          this. */}
      {summary.unassignedWithOrders > 0 && (
        <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            <p className="text-sm font-semibold text-foreground">
              {summary.ordersUnassigned} order{summary.ordersUnassigned === 1 ? "" : "s"} with no rider
            </p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            across {summary.unassignedWithOrders} localit{summary.unassignedWithOrders === 1 ? "y" : "ies"}
          </p>
          {/* Clickable, because the map alone cannot finish the day: 5 of these
              localities have no coordinates at all, so their orders are
              unreachable from the pins. This list is the only way to place
              them. Scrolls rather than truncating at 6 for the same reason -
              a hidden "+66 more" cannot be assigned. */}
          <ul className="mt-2 flex max-h-44 flex-col gap-0.5 overflow-y-auto pr-0.5">
            {unassignedWithOrders.map((u) => (
              <li key={u.name}>
                <button
                  type="button"
                  onClick={() => onAssignLocality(u.name)}
                  disabled={!armedRiderId}
                  title={armedRiderId ? `Assign ${u.name} to the selected rider` : "Pick a rider first"}
                  className="flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-left text-xs transition-colors enabled:hover:bg-destructive/20 disabled:cursor-default"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-foreground">{u.name}</span>
                    {/* Say which ones the map cannot reach. */}
                    {!u.onMap && (
                      <span className="shrink-0 rounded bg-muted px-1 text-[9px] uppercase text-muted-foreground">
                        no pin
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono tabular-nums text-destructive">{u.orderCount}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {summary.unassignedWithOrders === 0 && summary.orders > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-600/40 bg-emerald-600/10 p-3">
          <Check className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
          <p className="text-sm text-foreground">
            All {summary.orders} order{summary.orders === 1 ? "" : "s"} have a rider
          </p>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
          <h2 className="text-sm font-semibold text-foreground">Riders</h2>
          <p className="text-[11px] text-muted-foreground">
            {armedRiderId ? "Click pins to assign" : "Pick a rider, then click pins"}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <ul className="flex flex-col gap-1">
            {sorted.map((r) => {
              const load = loads.get(r.id)
              const armed = armedRiderId === r.id
              const color = colorFor(r.id)
              const target = r.daily_target ?? 0
              const orders = load?.orders ?? 0
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onArm(armed ? null : r.id)}
                    aria-pressed={armed}
                    className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                      armed ? "border-primary bg-primary/10" : "border-transparent hover:border-border hover:bg-muted/50"
                    }`}
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-full ring-2 ring-inset ring-background/40"
                      style={{ background: color }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{r.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {load?.localities ?? 0} localities
                        {/* What THIS DAY moved on and off them - otherwise a
                            rider emptied out by today looks untouched. */}
                        {load?.gained ? ` · +${load.gained}` : ""}
                        {load?.lost ? ` · -${load.lost}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-sm tabular-nums text-foreground">{orders}</span>
                      {target > 0 && <span className="block text-[10px] text-muted-foreground">of {target}</span>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="border-t border-border p-2">
          <button
            type="button"
            onClick={() => onArm(null)}
            aria-pressed={armedRiderId === null}
            className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
              armedRiderId === null ? "border-primary bg-primary/10" : "border-transparent hover:bg-muted/50"
            }`}
          >
            <Bike className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm text-muted-foreground">Clear rider from pins</span>
          </button>
        </div>
      </div>
    </aside>
  )
}
