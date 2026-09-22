'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { confirmationDayLabel } from '@/lib/inbox/assist-prompt'

type DeliveryDayInfo = {
  success: boolean
  error?: string
  pinned: string | null
  pinExpired: boolean
  ruleDate: string
  ruleReason: string
  cutoff: string
  scheme: Record<string, string>
  dates: string[]
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const fetcher = async (url: string) => {
  const res = await fetch(url)
  const json = (await res.json().catch(() => ({}))) as DeliveryDayInfo
  if (!res.ok) throw new Error(res.status === 403 ? 'Only an admin or manager can change the delivery day.' : json.error || 'Could not load.')
  return json
}

function todayYmd(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * The general delivery date the AI draft and Quick Order offer first. Shows the
 * automatic rule (still edited in the Chrome extension) and lets an admin pin a
 * date over it, e.g. after a closure or when the vans are full.
 */
export function ToolsDeliveryDay() {
  const { data, error, isLoading, mutate } = useSWR<DeliveryDayInfo>('/api/extension/delivery-day', fetcher, { revalidateOnFocus: false })
  const [draft, setDraft] = useState<string | null>(null)
  const [cutoffDraft, setCutoffDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const value = draft ?? data?.pinned ?? ''
  const dirty = draft !== null && draft !== (data?.pinned ?? '')
  const cutoffValue = cutoffDraft ?? data?.cutoff ?? '20:00'
  const cutoffDirty = cutoffDraft !== null && cutoffDraft !== data?.cutoff

  async function save(patch: { pinnedDeliveryDate?: string | null; cutoffTime?: string }) {
    setSaving(true)
    setSaveError('')
    try {
      const res = await fetch('/api/extension/delivery-day', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const json = (await res.json().catch(() => ({}))) as DeliveryDayInfo
      if (!res.ok || !json.success) {
        setSaveError(json.error || 'Could not save.')
        return
      }
      if ('pinnedDeliveryDate' in patch) setDraft(null)
      if ('cutoffTime' in patch) setCutoffDraft(null)
      await mutate(json, { revalidate: false })
    } catch {
      setSaveError('Could not save. Check your connection.')
    } finally {
      setSaving(false)
    }
  }

  const schemeLines = Object.entries(data?.scheme ?? {})
    .map(([from, to]) => {
      const f = WEEKDAYS[Number(from)]
      const t = WEEKDAYS[Number(to)]
      return f && t ? `${f} orders deliver ${t}` : null
    })
    .filter(Boolean) as string[]

  return (
    <section className="px-4 pb-8 md:px-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-balance">Delivery day</CardTitle>
          <CardDescription className="text-pretty leading-relaxed">
            The day the assistant writes in the order confirmation and the first chip in Quick Order. By
            default it follows the rule set in the Chrome extension; pin a date here to override it for
            everyone until that day has passed.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error ? (
            <p className="text-sm text-destructive">{(error as Error).message}</p>
          ) : isLoading || !data ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">Offered now</dt>
                  <dd className="font-medium">{confirmationDayLabel(data.dates[0])}</dd>
                  <dd className="text-xs text-muted-foreground">
                    {data.pinned && !data.pinExpired ? 'pinned below' : `automatic - ${data.ruleReason}`}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Automatic rule</dt>
                  <dd>Next working day; orders after the closing time slip one more day</dd>
                  {schemeLines.map(l => (
                    <dd key={l} className="text-xs text-muted-foreground">{l}</dd>
                  ))}
                  <dd className="text-xs text-muted-foreground">Sundays and closures are skipped.</dd>
                </div>
              </dl>

              <div className="flex flex-col gap-2">
                <label htmlFor="delivery-cutoff-time" className="text-sm font-medium">
                  Closing time for next-day delivery
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    id="delivery-cutoff-time"
                    type="time"
                    step={300}
                    value={cutoffValue}
                    disabled={saving}
                    onChange={e => setCutoffDraft(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <Button variant="secondary" onClick={() => save({ cutoffTime: cutoffValue })} disabled={!cutoffDirty || saving}>
                    {saving ? 'Saving…' : 'Save closing time'}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Shared with the Chrome extension - an order taken after this time is delivered a day later.
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label htmlFor="pinned-delivery-date" className="text-sm font-medium">
                  Pin a general delivery date
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    id="pinned-delivery-date"
                    type="date"
                    min={todayYmd()}
                    value={value}
                    disabled={saving}
                    onChange={e => setDraft(e.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  />
                  <Button onClick={() => save({ pinnedDeliveryDate: value || null })} disabled={!dirty || !value || saving}>
                    {saving ? 'Saving…' : 'Pin this date'}
                  </Button>
                  {data.pinned ? (
                    <Button variant="ghost" onClick={() => save({ pinnedDeliveryDate: null })} disabled={saving}>
                      Back to automatic
                    </Button>
                  ) : null}
                  <span className="text-sm text-muted-foreground" role="status" aria-live="polite">
                    {saveError ? <span className="text-destructive">{saveError}</span> : data.pinExpired ? 'The pinned date has passed - automatic rule in use.' : dirty ? 'Not pinned yet' : ''}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground text-pretty">
                  Next days offered: {data.dates.map(d => confirmationDayLabel(d)).join(' · ')}. Orders already
                  created keep their own date.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
