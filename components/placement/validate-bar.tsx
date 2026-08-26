"use client"

import { useState } from "react"
import { ArrowRight, CheckCircle2, Loader2, Save, ShieldCheck, Unlock } from "lucide-react"
import type { DiffRow, PlacementSummary } from "@/lib/placement/effective"

export type ValidateBarProps = {
  status: "draft" | "validated" | "untouched"
  summary: PlacementSummary
  diff: DiffRow[]
  riderNames: Map<string, string>
  colorFor: (riderId: string | null) => string
  dirty: boolean
  saving: boolean
  validating: boolean
  onSaveDraft: () => void
  onValidate: () => void
  onReopen: () => void
  /** Open orders on this day that already carry a rider and may be re-pointed. */
  stampedOrders: number
  totalOrders: number
  validatedAt: string | null
}

export function ValidateBar({
  status,
  summary,
  diff,
  riderNames,
  colorFor,
  dirty,
  saving,
  validating,
  onSaveDraft,
  onValidate,
  onReopen,
  stampedOrders,
  totalOrders,
  validatedAt,
}: ValidateBarProps) {
  const [showDiff, setShowDiff] = useState(false)
  // From the summary, NOT from `diff`. The restamp compares every order on the
  // day against the effective map, so an order can be stale (its locality's
  // standing rider changed after the order was taken) without appearing in the
  // hand-moved diff at all. Deriving this from `diff` would quietly promise
  // fewer changes than validation actually makes.
  const ordersMoving = summary.ordersToRestamp

  if (status === "validated") {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-600/40 bg-emerald-600/10 p-3">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">This day is live</p>
          <p className="text-xs text-muted-foreground">
            {summary.changed} localit{summary.changed === 1 ? "y" : "ies"} moved off the standing plan
            {validatedAt && ` · validated ${new Date(validatedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`}
          </p>
        </div>
        <button
          type="button"
          onClick={onReopen}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm text-foreground transition-colors hover:bg-muted"
        >
          <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
          Re-open to edit
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3">
      {/* `basis-full` on the text below 640px, so the buttons wrap UNDERNEATH
          instead of competing for the same line - at 390px they squeezed the
          summary to 316px and broke it to one word per line. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-foreground">
              {summary.changed === 0
                ? "Nothing moved yet - this day follows the standing plan"
                : `${summary.changed} localit${summary.changed === 1 ? "y" : "ies"} moved`}
            </p>
            {status === "draft" && (
              <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                draft - not live
              </span>
            )}
            {dirty && (
              <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-medium text-primary">
                unsaved
              </span>
            )}
          </div>
          {/* Say plainly what validating will DO to existing orders. An order
              taken weeks ago still carries whoever the standing map named then,
              and that is the whole reason this restamp exists. */}
          <p className="mt-0.5 text-xs text-muted-foreground">
            {totalOrders} order{totalOrders === 1 ? "" : "s"} on this day
            {stampedOrders > 0 && ` · ${stampedOrders} already carry a rider`}
            {ordersMoving > 0 && ` · ${ordersMoving} will be re-pointed on validating`}
          </p>
        </div>

        {summary.changed > 0 && (
          <button
            type="button"
            onClick={() => setShowDiff((s) => !s)}
            className="h-9 shrink-0 rounded-lg border border-border px-3 text-sm text-foreground transition-colors hover:bg-muted"
          >
            {showDiff ? "Hide" : "Review"} changes
          </button>
        )}

        <button
          type="button"
          onClick={onSaveDraft}
          disabled={saving || validating || !dirty}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="h-3.5 w-3.5" aria-hidden="true" />}
          Save draft
        </button>

        <button
          type="button"
          onClick={onValidate}
          disabled={validating || saving || dirty || status === "untouched"}
          title={dirty ? "Save the draft first" : status === "untouched" ? "Nothing to validate yet" : undefined}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {validating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />}
          Validate &amp; go live
        </button>
      </div>

      {showDiff && diff.length > 0 && (
        <div className="max-h-56 overflow-y-auto rounded-lg border border-border/70 bg-background/50">
          <ul className="divide-y divide-border/60">
            {diff.map((d) => (
              <li key={d.locality} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{d.name}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full" style={{ background: colorFor(d.fromRiderId) }} aria-hidden="true" />
                    <span className="text-muted-foreground">
                      {d.fromRiderId ? (riderNames.get(d.fromRiderId) ?? "Unknown") : "Nobody"}
                    </span>
                  </span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground/70" aria-hidden="true" />
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full" style={{ background: colorFor(d.toRiderId) }} aria-hidden="true" />
                    <span className="font-medium text-foreground">
                      {d.toRiderId ? (riderNames.get(d.toRiderId) ?? "Unknown") : "Nobody"}
                    </span>
                  </span>
                </span>
                {d.orderCount > 0 && (
                  <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 font-mono tabular-nums text-primary">
                    {d.orderCount} ord
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
