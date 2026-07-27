'use client'

import { useMemo, useState } from 'react'
import useSWR, { mutate } from 'swr'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Check, GitMerge, Loader2, Sparkles } from 'lucide-react'

// AI Merge Center: shows product names from purchase orders and deliveries
// that don't match the canonical inventory, lets AI suggest which product
// each one is, and the user validates before anything is saved.

interface Unmatched {
  name: string
  source: 'po' | 'delivery'
  occurrences: number
}

interface Suggestion {
  name: string
  suggestedProductId: string | null
  suggestedProductName: string | null
  confidence: string
  reason: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const confidenceStyles: Record<string, string> = {
  high: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500',
  medium: 'border-amber-500/40 bg-amber-500/10 text-amber-500',
  low: 'border-orange-500/40 bg-orange-500/10 text-orange-400',
  none: 'border-muted text-muted-foreground',
}

export function MergeCenter({ onMerged }: { onMerged?: () => void }) {
  const { data, isLoading } = useSWR<{ unmatched: Unmatched[]; products: { id: string; name: string }[] }>(
    '/api/product-master/merge',
    fetcher,
  )
  const unmatched = data?.unmatched || []
  const products = data?.products || []

  // Per-name state: AI suggestion, user override, checked
  const [suggestions, setSuggestions] = useState<Map<string, Suggestion>>(new Map())
  const [overrides, setOverrides] = useState<Map<string, string>>(new Map())
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [suggesting, setSuggesting] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const key = (u: Unmatched) => `${u.source}:${u.name}`

  const effectiveProduct = (u: Unmatched): string | '' => {
    const k = key(u)
    if (overrides.has(k)) return overrides.get(k)!
    return suggestions.get(k)?.suggestedProductId ?? ''
  }

  const suggest = async () => {
    setSuggesting(true)
    setError(null)
    try {
      const res = await fetch('/api/product-master/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'suggest',
          names: unmatched.map((u) => ({ name: u.name, source: u.source })),
          products,
        }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Suggestion failed')
      const map = new Map<string, Suggestion>()
      const autoCheck = new Set<string>()
      json.suggestions.forEach((s: Suggestion, i: number) => {
        const u = unmatched[i]
        if (!u) return
        map.set(key(u), s)
        // Pre-check confident matches for one-click validation
        if (s.suggestedProductId && (s.confidence === 'high' || s.confidence === 'medium')) autoCheck.add(key(u))
      })
      setSuggestions(map)
      setChecked(autoCheck)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Suggestion failed')
    } finally {
      setSuggesting(false)
    }
  }

  const confirm = async () => {
    const matches = unmatched
      .filter((u) => checked.has(key(u)) && effectiveProduct(u))
      .map((u) => ({ aliasName: u.name, productId: effectiveProduct(u), source: u.source }))
    if (matches.length === 0) return
    setConfirming(true)
    setError(null)
    try {
      const res = await fetch('/api/product-master/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', matches }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error || 'Confirm failed')
      setResult(
        `Merged ${json.saved} name(s) - linked ${json.backfilledPOs} purchase order(s) and ${json.backfilledDeliveries} deliverie(s).`,
      )
      setChecked(new Set())
      setSuggestions(new Map())
      setOverrides(new Map())
      await mutate('/api/product-master/merge')
      await mutate('/api/product-master/overview')
      onMerged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Confirm failed')
    } finally {
      setConfirming(false)
    }
  }

  const checkedCount = useMemo(
    () => unmatched.filter((u) => checked.has(key(u)) && effectiveProduct(u)).length,
    [unmatched, checked, overrides, suggestions], // eslint-disable-line react-hooks/exhaustive-deps
  )

  return (
    <div className="flex flex-col gap-4">
      {/* Actions bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {isLoading
            ? 'Scanning purchase orders and deliveries\u2026'
            : `${unmatched.length} name(s) don\u2019t match your inventory yet.`}
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={suggest} disabled={suggesting || unmatched.length === 0}>
            {suggesting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5 text-amber-500" />}
            {suggesting ? 'Matching\u2026' : 'Suggest with AI'}
          </Button>
          <Button size="sm" onClick={confirm} disabled={confirming || checkedCount === 0}>
            {confirming ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <GitMerge className="mr-1.5 h-3.5 w-3.5" />}
            {confirming ? 'Merging\u2026' : `Confirm ${checkedCount} match(es)`}
          </Button>
        </div>
      </div>

      {result && (
        <p className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm">
          <Check className="h-4 w-4 shrink-0 text-emerald-500" /> {result}
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Unmatched list */}
      {unmatched.length === 0 && !isLoading ? (
        <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          Everything is merged. Purchase orders and deliveries all map to inventory products.
        </div>
      ) : (
        <div className="flex max-h-[52vh] flex-col gap-1.5 overflow-y-auto pr-1">
          {unmatched.map((u) => {
            const k = key(u)
            const s = suggestions.get(k)
            const productId = effectiveProduct(u)
            return (
              <div key={k} className="flex items-center gap-3 rounded-md border px-3 py-2">
                <Checkbox
                  checked={checked.has(k)}
                  disabled={!productId}
                  onCheckedChange={(v) => {
                    setChecked((prev) => {
                      const next = new Set(prev)
                      if (v) next.add(k)
                      else next.delete(k)
                      return next
                    })
                  }}
                  aria-label={`Select ${u.name}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{u.name}</p>
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                      {u.source === 'po' ? 'Purchase order' : 'Delivery'}
                    </Badge>
                    {u.occurrences} occurrence(s)
                    {s?.reason && <span className="truncate">{'\u00b7'} {s.reason}</span>}
                  </p>
                </div>
                {s && (
                  <Badge variant="outline" className={`shrink-0 text-[10px] uppercase ${confidenceStyles[s.confidence] || ''}`}>
                    {s.confidence}
                  </Badge>
                )}
                <div className="w-52 shrink-0">
                  <Select
                    value={productId || undefined}
                    onValueChange={(v) => {
                      setOverrides((prev) => new Map(prev).set(k, v))
                      setChecked((prev) => new Set(prev).add(k))
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder={'Map to product\u2026'} />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
