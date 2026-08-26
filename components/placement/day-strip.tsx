"use client"

import { useState } from "react"
import { CalendarDays, ChevronLeft, ChevronRight, Copy, X } from "lucide-react"
import type { PastDay } from "@/lib/placement-actions"

export type DayMeta = { date: string; status: "draft" | "validated"; changedCount: number; orders: number }

export type DayStripProps = {
  activeDate: string
  onPick: (date: string) => void
  days: DayMeta[]
  pastDays: PastDay[]
  onCopyPastDay: (date: string) => void
  busy?: boolean
}

const fmtDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`)
  return { dow: d.toLocaleDateString("en-GB", { weekday: "short" }), day: d.getDate(), mon: d.toLocaleDateString("en-GB", { month: "short" }) }
}

/** 14 days from today - the planning window, not history. */
function upcoming(): string[] {
  const out: string[] = []
  const base = new Date()
  for (let i = 0; i < 14; i++) {
    const d = new Date(base)
    d.setDate(base.getDate() + i)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

export function DayStrip({ activeDate, onPick, days, pastDays, onCopyPastDay, busy }: DayStripProps) {
  const [showCopy, setShowCopy] = useState(false)
  const [offset, setOffset] = useState(0)
  const all = upcoming()
  const visible = all.slice(offset, offset + 7)
  const metaFor = (d: string) => days.find((x) => x.date === d)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOffset((o) => Math.max(0, o - 7))}
          disabled={offset === 0}
          aria-label="Earlier days"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>

        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
          {visible.map((d) => {
            const m = metaFor(d)
            const active = d === activeDate
            const { dow, day, mon } = fmtDay(d)
            return (
              <button
                key={d}
                type="button"
                onClick={() => onPick(d)}
                aria-current={active ? "date" : undefined}
                className={`flex min-w-[4.75rem] flex-1 flex-col items-center gap-0.5 rounded-lg border px-2 py-2 transition-colors ${
                  active ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-muted/50"
                }`}
              >
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{dow}</span>
                <span className="font-mono text-base tabular-nums leading-none text-foreground">{day}</span>
                <span className="text-[10px] text-muted-foreground">{mon}</span>
                {/* Status is stated, never implied by colour alone. */}
                {m?.status === "validated" ? (
                  <span className="mt-0.5 rounded-full bg-emerald-600/20 px-1.5 py-0.5 text-[9px] font-medium text-emerald-400">
                    live
                  </span>
                ) : m?.status === "draft" ? (
                  <span className="mt-0.5 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-medium text-amber-400">
                    draft
                  </span>
                ) : (
                  <span className="mt-0.5 text-[9px] text-muted-foreground/60">
                    {m?.orders ? `${m.orders} ord` : "standing"}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <button
          type="button"
          onClick={() => setOffset((o) => Math.min(all.length - 7, o + 7))}
          disabled={offset + 7 >= all.length}
          aria-label="Later days"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => setShowCopy((s) => !s)}
          disabled={busy}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Copy a past day</span>
        </button>
      </div>

      {showCopy && (
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                Copy a real past day
              </h3>
              {/* The size is shown BECAUSE the days differ wildly - one has 145
                  localities, another has 5 deliveries. A thin day must not be
                  mistaken for a full template, and no weekday average is
                  offered because there is not enough history to support one. */}
              <p className="mt-0.5 text-xs text-muted-foreground">
                Each day&apos;s real size is shown - a small day is not a template for a full one.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCopy(false)}
              aria-label="Close"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          {pastDays.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No past working days with riders on record yet.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-1">
              {pastDays.map((p) => {
                // Be explicit about thin days rather than letting the operator
                // discover it after copying.
                const thin = p.localities < 20
                return (
                  <li key={p.date}>
                    <button
                      type="button"
                      onClick={() => {
                        onCopyPastDay(p.date)
                        setShowCopy(false)
                      }}
                      disabled={busy}
                      className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-muted/50 disabled:opacity-50"
                    >
                      <span className="font-mono text-sm tabular-nums text-foreground">
                        {new Date(`${p.date}T00:00:00`).toLocaleDateString("en-GB", {
                          weekday: "short",
                          day: "2-digit",
                          month: "short",
                        })}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {p.localities} localities · {p.riders} riders · {p.deliveries} deliveries
                      </span>
                      {thin && (
                        <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
                          small day
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
