'use client'

// Review list for open orders that may have been entered twice.
//
// Deliberately read-only. The same data shape covers a double-entry 55 minutes
// apart and a genuine re-order three weeks later, and only a person can tell
// those apart - so this screen reports and never deletes. The confidence tiers
// come from the database function and are shown as separate sections rather
// than one ranked list, because presenting a legitimate repeat order in the
// same block as a real duplicate is how a real order gets cancelled.
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Loader2, RefreshCw, Users } from 'lucide-react'
import type { DuplicateGroup } from '@/app/api/deliveries/duplicates/route'

const TIERS = [
  {
    key: 'same_day' as const,
    title: 'Same product, same delivery date',
    blurb:
      'Two or more open orders for the same client, product and delivery day. These are duplicates in the ordinary sense.',
    tone: 'destructive' as const,
  },
  {
    key: 'near' as const,
    title: 'Same product, entered within 24 hours',
    blurb:
      'Different delivery dates, but entered close together - usually a re-entry after the date was changed. Worth a look.',
    tone: 'warning' as const,
  },
  {
    key: 'distant' as const,
    title: 'Same product, ordered again later',
    blurb:
      'Days or weeks apart. Almost always genuine repeat business, listed only for completeness.',
    tone: 'muted' as const,
  },
]

function formatDate(d: string | null) {
  if (!d) return 'No date'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function gap(hours: number | null) {
  if (hours === null) return ''
  if (hours < 1) return `${Math.round(hours * 60)} min apart`
  if (hours < 48) return `${hours.toFixed(1)} h apart`
  return `${Math.round(hours / 24)} days apart`
}

export function DuplicateOrders() {
  const [groups, setGroups] = useState<DuplicateGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    setError(null)
    fetch('/api/deliveries/duplicates')
      .then(async (res) => {
        // 401 is a signed-out session, not an empty result - saying "no
        // duplicates" here would be a false all-clear.
        if (res.status === 401) throw new Error('Your session expired. Sign in again to view this list.')
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || 'Could not load duplicates')
        setGroups(json.groups || [])
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const sameDayValue = groups
    .filter((g) => g.confidence === 'same_day')
    .reduce((sum, g) => sum + g.redundantValue, 0)
  const crossAgent = groups.filter((g) => g.confidence === 'same_day' && g.agentCount > 1).length

  return (
    <main className="mx-auto w-full max-w-4xl p-4 md:p-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Possible duplicate orders</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Open orders only. Nothing here is changed automatically.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </header>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : (
        <>
          {groups.some((g) => g.confidence === 'same_day') && (
            <div className="mb-6 rounded-lg border bg-muted/40 p-4">
              <div className="flex flex-wrap gap-6">
                <div>
                  <div className="text-2xl font-semibold">
                    {groups.filter((g) => g.confidence === 'same_day').length}
                  </div>
                  <div className="text-xs text-muted-foreground">same-day groups</div>
                </div>
                <div>
                  <div className="text-2xl font-semibold">Rs {Math.round(sameDayValue).toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">value of the extra copies</div>
                </div>
                <div>
                  <div className="text-2xl font-semibold">{crossAgent}</div>
                  <div className="text-xs text-muted-foreground">involve two different agents</div>
                </div>
              </div>
            </div>
          )}

          {TIERS.map((tier) => {
            const rows = groups.filter((g) => g.confidence === tier.key)
            if (!rows.length) return null
            return (
              <section key={tier.key} className="mb-8">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  {tier.tone === 'destructive' && <AlertTriangle className="h-4 w-4 text-destructive" />}
                  {tier.title}
                  <span className="text-muted-foreground">({rows.length})</span>
                </h2>
                <p className="mb-3 mt-1 text-xs text-muted-foreground">{tier.blurb}</p>

                <ul className="space-y-2">
                  {rows.map((g) => (
                    <li
                      key={`${g.phone}-${g.orderIds.join('-')}`}
                      className={`rounded-md border p-3 ${
                        tier.tone === 'destructive' ? 'border-destructive/40 bg-destructive/5' : ''
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-medium">{g.clientName || 'Unnamed client'}</span>
                            <span className="text-xs text-muted-foreground">{g.phone}</span>
                            {g.agentCount > 1 && (
                              <Badge variant="secondary" className="gap-1">
                                <Users className="h-3 w-3" />
                                {g.agentCount} agents
                              </Badge>
                            )}
                          </div>
                          <p className="mt-1 text-sm">{g.products || 'No product listed'}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {g.orderCount} orders · {formatDate(g.deliveryDate)}
                            {g.hoursApart !== null ? ` · ${gap(g.hoursApart)}` : ''} · taken by{' '}
                            {g.agents.join(', ')}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-medium">Rs {g.redundantValue.toLocaleString()}</div>
                          <div className="text-xs text-muted-foreground">extra</div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}

          {!groups.length && (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              No repeated open orders found.
            </div>
          )}
        </>
      )}
    </main>
  )
}
