"use client"

import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { ArrowLeft, Info, Loader2, MapPin, RotateCcw } from "lucide-react"
import {
  getDayPlacement,
  getPastDayAllocation,
  reopenDayPlacement,
  saveDayDraft,
  validateDayPlacement,
  type PastDay,
} from "@/lib/placement-actions"
import { ZoneBar } from "./zone-bar"
import {
  countToRestamp,
  diffRows,
  normLocality,
  riderLoads,
  summarise,
  type EffectiveEntry,
} from "@/lib/placement/effective"
import { riderColorMap, UNASSIGNED_COLOR } from "@/lib/placement/colors"
import { DayStrip, type DayMeta } from "./day-strip"
import { PlacementMap } from "./placement-map"
import { RiderRail } from "./rider-rail"
import { ValidateBar } from "./validate-bar"

type Rider = { id: string; name: string; daily_target: number | null }

export type PlacementContentProps = {
  initialDate: string
  initialDays: DayMeta[]
  pastDays: PastDay[]
}

export function PlacementContent({ initialDate, initialDays, pastDays }: PlacementContentProps) {
  const [date, setDate] = useState(initialDate)
  const [days, setDays] = useState<DayMeta[]>(initialDays)
  const [entries, setEntries] = useState<EffectiveEntry[]>([])
  const [riders, setRiders] = useState<Rider[]>([])
  const [status, setStatus] = useState<"draft" | "validated" | "untouched">("untouched")
  const [validatedAt, setValidatedAt] = useState<string | null>(null)
  const [stampedOrders, setStampedOrders] = useState(0)
  const [totalOrders, setTotalOrders] = useState(0)

  const [armedRiderId, setArmedRiderId] = useState<string | null>(null)
  /** Local edits not yet saved. locality -> riderId (null = cleared). */
  const [pending, setPending] = useState<Map<string, string | null>>(new Map())
  const [copiedFrom, setCopiedFrom] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [validating, setValidating] = useState(false)
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null)
  const [, startTransition] = useTransition()

  const load = useCallback(async (d: string) => {
    setLoading(true)
    const res = await getDayPlacement(d)
    setLoading(false)
    if ("error" in res) {
      setNotice({ kind: "err", text: res.error as string })
      return
    }
    setEntries(res.entries)
    setRiders(res.riders as Rider[])
    setStatus(res.status)
    setValidatedAt(res.validatedAt)
    setStampedOrders(res.stampedOrders)
    setTotalOrders(res.totalOrders)
    setCopiedFrom(res.copiedFrom)
    setPending(new Map())
  }, [])

  useEffect(() => {
    load(date)
  }, [date, load])

  // Apply unsaved edits on top of what the server gave us, so the map, the
  // rider rail and the diff all read from ONE derived list. Two sources here
  // would be two chances to disagree.
  const effective = useMemo<EffectiveEntry[]>(() => {
    if (pending.size === 0) return entries
    return entries.map((e) => {
      if (!pending.has(e.locality)) return e
      const riderId = pending.get(e.locality) ?? null
      // Recompute what validation would rewrite: an unsaved move changes it, and
      // leaving the server's number here made the bar report 0 orders affected
      // for a locality the user had just moved.
      return {
        ...e,
        riderId,
        changed: riderId !== e.standingRiderId,
        ordersToRestamp: countToRestamp(e.orderRiderIds, riderId),
      }
    })
  }, [entries, pending])

  const summary = useMemo(() => summarise(effective), [effective])
  const diff = useMemo(() => diffRows(effective), [effective])
  const loads = useMemo(() => riderLoads(effective), [effective])

  const colors = useMemo(() => riderColorMap(riders.map((r) => r.id)), [riders])
  const colorFor = useCallback((id: string | null) => (id ? (colors.get(id) ?? UNASSIGNED_COLOR) : UNASSIGNED_COLOR), [colors])
  const riderNames = useMemo(() => new Map(riders.map((r) => [r.id, r.name])), [riders])

  const unassignedWithOrders = useMemo(
    () =>
      effective
        .filter((e) => !e.riderId && e.orderCount > 0)
        .sort((a, b) => b.orderCount - a.orderCount)
        .map((e) => ({ name: e.name, orderCount: e.orderCount, onMap: e.lat != null })),
    [effective],
  )

  const dirty = pending.size > 0

  const assign = useCallback(
    (localities: string[], riderId: string | null) => {
      setPending((prev) => {
        const next = new Map(prev)
        for (const loc of localities) next.set(normLocality(loc), riderId)
        return next
      })
      setNotice(null)
    },
    [],
  )

  const handleSaveDraft = async () => {
    setSaving(true)
    setNotice(null)
    // Send the FULL intended exception set, not just this session's edits:
    // saveDayDraft replaces the set wholesale, so a removed exception has to be
    // absent from what we send.
    const exceptions = effective
      .filter((e) => e.riderId && e.riderId !== e.standingRiderId)
      .map((e) => ({ locality: e.locality, riderId: e.riderId as string }))

    const res = await saveDayDraft(date, exceptions, copiedFrom)
    setSaving(false)
    if ("error" in res && res.error) {
      setNotice({ kind: "err", text: res.error })
      return
    }
    setNotice({ kind: "ok", text: `Draft saved - ${exceptions.length} change${exceptions.length === 1 ? "" : "s"}. Nothing is live yet.` })
    setDays((prev) => {
      const others = prev.filter((p) => p.date !== date)
      return [...others, { date, status: "draft" as const, changedCount: exceptions.length, orders: totalOrders }]
    })
    startTransition(() => load(date))
  }

  const handleValidate = async () => {
    setValidating(true)
    setNotice(null)
    const res = await validateDayPlacement(date)
    setValidating(false)
    if ("error" in res && res.error) {
      setNotice({ kind: "err", text: res.error })
      return
    }
    const r = res as { restamped: number; ridersAffected: number; localitiesChanged: number }
    setNotice({
      kind: "ok",
      // Report what actually happened, with real numbers - never assert an
      // outcome that cannot be seen.
      text:
        r.restamped === 0
          ? `Day is live. ${r.localitiesChanged} localities moved; no existing order needed re-pointing.`
          : `Day is live. ${r.restamped} order${r.restamped === 1 ? "" : "s"} re-pointed across ${r.ridersAffected} rider${r.ridersAffected === 1 ? "" : "s"}.`,
    })
    setDays((prev) => {
      const others = prev.filter((p) => p.date !== date)
      return [...others, { date, status: "validated" as const, changedCount: r.localitiesChanged, orders: totalOrders }]
    })
    load(date)
  }

  const handleReopen = async () => {
    const res = await reopenDayPlacement(date)
    if ("error" in res && res.error) {
      setNotice({ kind: "err", text: res.error })
      return
    }
    // Be honest that re-opening does not undo the orders already moved.
    setNotice({ kind: "ok", text: "Re-opened as a draft. Orders already re-pointed keep their rider." })
    setDays((prev) => prev.map((p) => (p.date === date ? { ...p, status: "draft" as const } : p)))
    load(date)
  }

  const handleCopyPastDay = async (from: string) => {
    setNotice(null)
    const res = await getPastDayAllocation(from)
    if ("error" in res || !res.allocation) {
      setNotice({ kind: "err", text: "Could not read that day." })
      return
    }
    // Only keep entries whose locality still exists and whose rider differs
    // from the standing plan - copying a locality onto the rider it already has
    // would inflate the diff with no-ops.
    const known = new Set(entries.map((e) => e.locality))
    const standing = new Map(entries.map((e) => [e.locality, e.standingRiderId]))
    const next = new Map<string, string | null>()
    let skipped = 0
    for (const a of res.allocation) {
      if (!known.has(a.locality)) {
        skipped++
        continue
      }
      if (standing.get(a.locality) === a.riderId) continue
      next.set(a.locality, a.riderId)
    }
    setPending(next)
    setCopiedFrom(from)
    setNotice({
      kind: "ok",
      text:
        `Loaded ${new Date(`${from}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}: ` +
        `${next.size} change${next.size === 1 ? "" : "s"} vs the standing plan` +
        `${skipped ? `, ${skipped} locality name${skipped === 1 ? "" : "s"} no longer on record` : ""}. Not saved yet.`,
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/dashboard/admin/regions"
            className="mb-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            Regions &amp; localities
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Day placement</h1>
          <p className="text-sm text-muted-foreground">
            Who covers where, for one day. The standing plan is the default - a day only stores what you move.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-sm">
          <Stat label="On this day" value={summary.orders} sub="orders" />
          <Stat label="Moved" value={summary.changed} sub="localities" />
          <Stat label="On map" value={summary.total - summary.notOnMap} sub={`of ${summary.total}`} />
        </div>
      </div>

      <DayStrip
        activeDate={date}
        onPick={setDate}
        days={days}
        pastDays={pastDays}
        onCopyPastDay={handleCopyPastDay}
        busy={saving || validating}
      />

      {notice && (
        <div
          role="status"
          className={`rounded-lg border px-3 py-2 text-sm ${
            notice.kind === "ok"
              ? "border-emerald-600/40 bg-emerald-600/10 text-foreground"
              : "border-destructive/50 bg-destructive/10 text-foreground"
          }`}
        >
          {notice.text}
        </div>
      )}

      {/* State the map's real coverage rather than letting absent pins imply
          the localities do not exist. */}
      {(summary.notOnMap > 0 || summary.estimated > 0 || summary.viaContractor > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {/* Say where the standing riders came from. Most localities have no
              default_rider_id and are covered through their contractor having
              one rider - without saying so, the day looks hand-assigned. */}
          {summary.viaContractor > 0 && (
            <span>
              <strong className="font-medium text-foreground">{summary.viaContractor}</strong> follow their contractor{"\u2019"}s
              only rider
              {summary.ambiguous > 0 && (
                <>
                  {" \u00b7 "}
                  <strong className="font-medium text-foreground">{summary.ambiguous}</strong> need a choice (contractor has
                  several riders)
                </>
              )}
              .
            </span>
          )}
          {summary.notOnMap > 0 && (
            <span>
              <strong className="font-medium text-foreground">{summary.notOnMap}</strong> localities have no position yet
              and are not on the map.
            </span>
          )}
          {summary.estimated > 0 && (
            <span>
              <strong className="font-medium text-foreground">{summary.estimated}</strong> are estimated (hollow pins) -
              drag one to correct it.
            </span>
          )}
          {/* The geocoder falls back to a district centre when it cannot find a
              village, so these pins are spread onto a ring to stay clickable.
              Saying so stops a ring of 25 reading as 25 known addresses. */}
          {summary.stacked > 0 && (
            <span>
              <strong className="font-medium text-foreground">{summary.stacked}</strong> only resolved to a district, so
              they sit in rings near its centre - not their real spot.
            </span>
          )}
        </div>
      )}

      {/* Whole-zone assignment, above the map: clicking pins one at a time
          could not realistically clear 76 riderless localities. Uses the same
          zone presets as the Regions page. */}
      {!loading && (
        <ZoneBar
          entries={effective}
          armedRiderId={armedRiderId}
          armedRiderName={armedRiderId ? (riderNames.get(armedRiderId) ?? null) : null}
          armedColor={colorFor(armedRiderId)}
          onAssign={assign}
        />
      )}

      {/* Height is pinned to the viewport rather than left to `flex-1`, which
          resolves against content here and let the 18-rider rail stretch the
          row to 1695px. The rail scrolls inside instead. */}
      {/* 32rem, not 26rem: the zone bar above adds roughly 6rem, and the old
          value pushed the sticky validate bar back off the bottom of a 1100px
          screen - the exact bug fixed earlier. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:h-[calc(100vh-32rem)] lg:min-h-[24rem] lg:flex-none lg:flex-row">
        {/* Fixed 22rem on mobile: the map is a flex child, so without a height
            it collapses, and giving it the full content height pushed the row to
            2603px and buried everything below it. */}
        <div className="relative h-[22rem] shrink-0 sm:h-[26rem] lg:h-auto lg:min-h-0 lg:flex-1">
          {loading ? (
            <div className="flex h-full min-h-[26rem] items-center justify-center rounded-xl border border-border bg-card">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
            </div>
          ) : (
            <PlacementMap
              entries={effective}
              colorFor={colorFor}
              riderNames={riderNames}
              armedRiderId={armedRiderId}
              onAssign={assign}
              onMovePin={() => {}}
            />
          )}

          {armedRiderId && (
            <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-2 rounded-lg border border-primary/50 bg-background/95 px-3 py-2 backdrop-blur">
              <span className="h-3 w-3 rounded-full" style={{ background: colorFor(armedRiderId) }} aria-hidden="true" />
              <span className="text-xs text-foreground">
                Assigning to <strong className="font-medium">{riderNames.get(armedRiderId)}</strong>
              </span>
            </div>
          )}
        </div>

        <RiderRail
          riders={riders}
          loads={loads}
          colorFor={colorFor}
          armedRiderId={armedRiderId}
          onArm={setArmedRiderId}
          summary={summary}
          unassignedWithOrders={unassignedWithOrders}
          onAssignLocality={(name) => {
            if (armedRiderId) assign([name], armedRiderId)
          }}
        />
      </div>

      {/* Sticky, because the dashboard's <main> is a block element with its own
          scrollbar: `flex-1` above cannot bound this page to the viewport, so
          the bar sat at y=1733 on a 1100px screen - Save and Validate were
          off-screen. The primary action must never need a scroll to find. */}
      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 border-t border-border bg-background/95 px-1 py-2 backdrop-blur">
        {dirty && (
          <button
            type="button"
            onClick={() => {
              setPending(new Map())
              setNotice(null)
            }}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Discard {pending.size} unsaved
          </button>
        )}
        <div className="min-w-0 flex-1">
          <ValidateBar
            status={status}
            summary={summary}
            diff={diff}
            riderNames={riderNames}
            colorFor={colorFor}
            dirty={dirty}
            saving={saving}
            validating={validating}
            onSaveDraft={handleSaveDraft}
            onValidate={handleValidate}
            onReopen={handleReopen}
            stampedOrders={stampedOrders}
            totalOrders={totalOrders}
            validatedAt={validatedAt}
          />
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="flex items-baseline gap-1">
        <span className="font-mono text-xl tabular-nums leading-none text-foreground">{value}</span>
        <span className="text-[11px] text-muted-foreground">{sub}</span>
      </span>
    </div>
  )
}
