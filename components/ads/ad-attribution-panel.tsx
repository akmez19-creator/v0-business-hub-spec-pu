'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, RefreshCw, Users, Ban, RotateCcw, Info } from 'lucide-react'
import { KILL_SPEND_RS } from '@/lib/ads/kill-rule'

export interface AdAttributionRow {
  adId: string
  adName: string
  campaignId: string | null
  campaignName: string | null
  status: string
  createdTime: string | null
  clients: number
  spendUsd: number
  spendRs: number
  costPerClientRs: number | null
  killed: boolean
  shouldKill: boolean
  verdictReason: string
}

interface Props {
  accountId: string | null
  since?: string | null
  until?: string | null
}

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString()}`

/**
 * Per-ad client attribution plus the Rs 150 kill queue.
 *
 * Kills are suggest-only: this panel never pauses anything on its own. Each
 * candidate needs an explicit click, because a delivery that lost its ad_id is
 * indistinguishable from an ad that genuinely produced nothing.
 */
export function AdAttributionPanel({ accountId, since, until }: Props) {
  const [rows, setRows] = useState<AdAttributionRow[]>([])
  const [unattributed, setUnattributed] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyAd, setBusyAd] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(async () => {
    if (!accountId) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ accountId })
      if (since) params.set('since', since)
      if (until) params.set('until', until)
      const res = await fetch(`/api/ads/ad-attribution?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load attribution')
      setRows(json.ads ?? [])
      setUnattributed(json.unattributedDeliveries ?? 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load attribution')
    } finally {
      setLoading(false)
    }
  }, [accountId, since, until])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (row: AdAttributionRow, action: 'kill' | 'reactivate') => {
    setBusyAd(row.adId)
    setError(null)
    try {
      const res = await fetch('/api/ads/kill-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adId: row.adId,
          adName: row.adName,
          action,
          spendUsd: row.spendUsd,
          clients: row.clients,
          reason: row.verdictReason,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `Failed to ${action}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to ${action}`)
    } finally {
      setBusyAd(null)
    }
  }

  const candidates = rows.filter((r) => r.shouldKill)
  const killed = rows.filter((r) => r.killed)
  const visible = showAll ? rows : rows.slice(0, 25)

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="size-5 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-foreground">Clients per ad</h2>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
      </header>

      {error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {/*
        Unattributed deliveries are shown prominently rather than hidden. They
        are the single biggest way this screen can mislead: every one of them is
        a real client that some ad produced but cannot be credited for, which
        pushes ads toward looking like failures.
      */}
      {unattributed > 0 ? (
        <p className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-600 dark:text-amber-500">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {unattributed} deliver{unattributed === 1 ? 'y has' : 'ies have'} no ad linked, so
            {unattributed === 1 ? ' it is' : ' they are'} not counted against any ad below. Check
            these before killing anything.
          </span>
        </p>
      ) : null}

      {candidates.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            {candidates.length} ad{candidates.length === 1 ? '' : 's'} to kill &mdash; over {rs(KILL_SPEND_RS)}, zero clients
          </h3>
          <ul className="flex flex-col gap-2">
            {candidates.map((r) => (
              <li key={r.adId} className="flex flex-wrap items-center justify-between gap-2 rounded bg-background/60 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">{r.adName}</p>
                  <p className="text-xs text-muted-foreground">{r.verdictReason}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void act(r, 'kill')}
                  disabled={busyAd === r.adId}
                  className="flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-sm font-semibold text-destructive-foreground hover:opacity-90 disabled:opacity-50"
                >
                  <Ban className="size-4" aria-hidden="true" />
                  {busyAd === r.adId ? 'Killing...' : 'Kill'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Spend and attributed clients for each ad</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">Ad</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Spend</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Clients</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">Per client</th>
              <th scope="col" className="py-2 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.adId} className="border-b border-border/50">
                <td className="max-w-[22rem] py-2 pr-3">
                  <p className="truncate text-foreground">{r.adName}</p>
                  {r.campaignName ? (
                    <p className="truncate text-xs text-muted-foreground">{r.campaignName}</p>
                  ) : null}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-foreground">{rs(r.spendRs)}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-foreground">{r.clients}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                  {r.costPerClientRs === null ? '—' : rs(r.costPerClientRs)}
                </td>
                <td className="py-2 text-right">
                  {r.killed ? (
                    <button
                      type="button"
                      onClick={() => void act(r, 'reactivate')}
                      disabled={busyAd === r.adId}
                      className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
                    >
                      <RotateCcw className="size-3" aria-hidden="true" />
                      Killed &mdash; revive
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground">{r.status.toLowerCase()}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > 25 ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="self-start text-sm text-muted-foreground underline hover:text-foreground"
        >
          {showAll ? 'Show top 25' : `Show all ${rows.length} ads`}
        </button>
      ) : null}

      {!loading && rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No ads found for this account and date range.
        </p>
      ) : null}

      {killed.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {killed.length} ad{killed.length === 1 ? '' : 's'} previously killed and staying off.
        </p>
      ) : null}
    </section>
  )
}
