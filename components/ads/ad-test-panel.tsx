'use client'

import { useCallback, useEffect, useState } from 'react'
import { FlaskConical, RefreshCw, Trophy, AlertTriangle } from 'lucide-react'

interface Variant {
  adId: string
  label: string
  spendUsd: number
  spendRs: number
  clients: number
  costPerClientRs: number | null
}

interface AdTest {
  id: string
  source_ad_id: string | null
  status: string
  started_at: string
  daily_budget_usd: number
  notes: string | null
  winner_ad_id: string | null
  variants: Variant[]
}

const rs = (n: number) => `Rs ${Math.round(n).toLocaleString()}`

/**
 * The 3-at-a-time testing harness. Every variant runs at $1/day, clamped on
 * the server - the budget is never sent from here.
 */
export function AdTestPanel() {
  const [tests, setTests] = useState<AdTest[]>([])
  const [sourceAdId, setSourceAdId] = useState('')
  const [label, setLabel] = useState('')
  const [loading, setLoading] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/ads/ad-test')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load tests')
      setTests(json.tests ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load tests')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const launch = async () => {
    if (!sourceAdId.trim()) return
    setLaunching(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/ads/ad-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceAdId: sourceAdId.trim(), label: label.trim() || undefined }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to launch test')

      const msgs: string[] = [`${json.created?.length ?? 0} variants created (paused, $1/day).`]
      if (json.failed?.length) msgs.push(`${json.failed.length} variant(s) failed: ${json.failed[0].error}`)
      if (json.budgetWarning) msgs.push(`Budget warning: ${json.budgetWarning}`)
      setNotice(msgs.join(' '))
      setSourceAdId('')
      setLabel('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to launch test')
    } finally {
      setLaunching(false)
    }
  }

  // The winner is the variant with the lowest cost per client. Variants with no
  // clients are not eligible - cheap and useless is not winning.
  const winnerOf = (vs: Variant[]) => {
    const scored = vs.filter((v) => v.costPerClientRs !== null)
    if (scored.length === 0) return null
    return scored.reduce((best, v) => ((v.costPerClientRs ?? Infinity) < (best.costPerClientRs ?? Infinity) ? v : best))
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="size-5 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-foreground">Ad tests &mdash; 3 at a time, $1/day</h2>
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

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-[16rem] flex-1 flex-col gap-1">
          <label htmlFor="source-ad" className="text-xs font-medium text-muted-foreground">
            Source ad ID
          </label>
          <input
            id="source-ad"
            value={sourceAdId}
            onChange={(e) => setSourceAdId(e.target.value)}
            placeholder="1234567890"
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground"
          />
        </div>
        <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <label htmlFor="test-label" className="text-xs font-medium text-muted-foreground">
            Label (optional)
          </label>
          <input
            id="test-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Winter promo"
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground"
          />
        </div>
        <button
          type="button"
          onClick={() => void launch()}
          disabled={launching || !sourceAdId.trim()}
          className="rounded-md bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {launching ? 'Launching...' : 'Launch 3 variants'}
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        Variants are created paused so nothing spends until you review them on Facebook.
      </p>

      {error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-sm text-foreground">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden="true" />
          <span>{notice}</span>
        </p>
      ) : null}

      <div className="flex flex-col gap-3">
        {tests.map((t) => {
          const winner = winnerOf(t.variants)
          return (
            <article key={t.id} className="rounded-md border border-border p-3">
              <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground">
                  {new Date(t.started_at).toLocaleDateString()} &middot; {t.status}
                </p>
                <p className="text-xs text-muted-foreground">${t.daily_budget_usd}/day per variant</p>
              </header>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {t.variants.map((v) => {
                  const isWinner = winner?.adId === v.adId
                  return (
                    <div
                      key={v.adId}
                      className={`rounded border p-2 ${isWinner ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-border'}`}
                    >
                      <p className="flex items-center gap-1 truncate text-sm font-medium text-foreground">
                        {isWinner ? <Trophy className="size-3.5 text-emerald-500" aria-hidden="true" /> : null}
                        {v.label}
                      </p>
                      <dl className="mt-1 flex flex-col gap-0.5 text-xs text-muted-foreground">
                        <div className="flex justify-between">
                          <dt>Spend</dt>
                          <dd className="tabular-nums text-foreground">{rs(v.spendRs)}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt>Clients</dt>
                          <dd className="tabular-nums text-foreground">{v.clients}</dd>
                        </div>
                        <div className="flex justify-between">
                          <dt>Per client</dt>
                          <dd className="tabular-nums text-foreground">
                            {v.costPerClientRs === null ? '—' : rs(v.costPerClientRs)}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  )
                })}
              </div>
              {t.notes ? <p className="mt-2 text-xs text-amber-600 dark:text-amber-500">{t.notes}</p> : null}
            </article>
          )
        })}
        {!loading && tests.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No tests yet. Paste an ad ID above to launch three $1/day variants.
          </p>
        ) : null}
      </div>
    </section>
  )
}
