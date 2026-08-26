'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  /** Dates that actually have deliveries, NEWEST FIRST. */
  availableDates: string[]
  selectedDate: string
  /** True when the selected day is not today, so the header can say so. */
  isToday: boolean
}

function formatDate(d: string) {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * Date switcher for the contractor Stock page.
 *
 * The page used to show ONE hard-coded day (the newest delivery date) with no
 * way to change it, so a single future-dated order hid the real workload.
 */
export function StockDateNav({ availableDates, selectedDate, isToday }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const idx = availableDates.indexOf(selectedDate)
  // availableDates is newest-first, so "previous day" is the HIGHER index.
  const canGoPrev = idx >= 0 && idx < availableDates.length - 1
  const canGoNext = idx > 0

  const goTo = (date: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('date', date)
    router.push(`?${params.toString()}`)
  }

  const step = (dir: -1 | 1) => {
    const next = idx + dir
    if (next >= 0 && next < availableDates.length) goTo(availableDates[next])
  }

  if (availableDates.length === 0) return null

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => step(1)}
          disabled={!canGoPrev}
          aria-label="Previous delivery day"
        >
          <ChevronLeft className="w-5 h-5" />
        </Button>

        <button
          onClick={() => {
            const el = document.getElementById('stock-date-select') as HTMLSelectElement | null
            el?.showPicker?.()
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-card border border-border hover:border-primary/50 transition-colors min-w-0"
        >
          <Calendar className="w-4 h-4 text-primary shrink-0" />
          <span className="font-semibold text-sm truncate">{formatDate(selectedDate)}</span>
        </button>

        <select
          id="stock-date-select"
          className="sr-only"
          value={selectedDate}
          onChange={(e) => goTo(e.target.value)}
          aria-label="Select delivery day"
        >
          {availableDates.map((d) => (
            <option key={d} value={d}>
              {formatDate(d)}
            </option>
          ))}
        </select>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={() => step(-1)}
          disabled={!canGoNext}
          aria-label="Next delivery day"
        >
          <ChevronRight className="w-5 h-5" />
        </Button>
      </div>

      {/* Say plainly when this is not today's round, so a future-dated order is
          never mistaken for the current day's stock. */}
      {!isToday && (
        <p className="text-[11px] text-muted-foreground text-center">
          Not today&apos;s round &middot; {availableDates.length} days with deliveries
        </p>
      )}
    </div>
  )
}
