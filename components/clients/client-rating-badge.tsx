'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Loader2, ThumbsUp, ThumbsDown, Minus, Sparkles } from 'lucide-react'
import { CLIENT_STATUS_COLORS, BAD_SEVERITY_COLORS, type BadSeverity } from '@/lib/types'

interface RatingInfo {
  found: boolean
  rating: 'good' | 'average' | 'bad' | 'new'
  name?: string
  totalOrders?: number
  delivered?: number
  cms?: number
  deliveredPct?: number | null
  totalSales?: number
  badSeverity?: BadSeverity | null
}

const RATING_ICONS = {
  good: ThumbsUp,
  average: Minus,
  bad: ThumbsDown,
  new: Sparkles,
} as const

/**
 * Live client rating lookup by phone number.
 * Debounces the phone input and hits the indexed /api/clients/rating endpoint.
 */
export function ClientRatingBadge({ phone }: { phone: string }) {
  const [info, setInfo] = useState<RatingInfo | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 7) {
      setInfo(null)
      return
    }
    let cancelled = false
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients/rating?phone=${encodeURIComponent(digits)}`)
        if (!res.ok) throw new Error()
        const json = await res.json()
        if (!cancelled) setInfo(json)
      } catch {
        if (!cancelled) setInfo(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 400)
    return () => { cancelled = true; clearTimeout(t) }
  }, [phone])

  if (loading) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Checking client…
      </span>
    )
  }

  if (!info) return null

  if (!info.found) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Sparkles className="h-3 w-3" /> New client — no history
      </span>
    )
  }

  const Icon = RATING_ICONS[info.rating] || Sparkles
  const label = info.rating.charAt(0).toUpperCase() + info.rating.slice(1)

  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs">
      <Badge className={CLIENT_STATUS_COLORS[info.rating] || CLIENT_STATUS_COLORS.new}>
        <Icon className="mr-1 h-3 w-3" />
        {label} client
      </Badge>
      {info.rating === 'bad' && info.badSeverity && (
        <Badge className={BAD_SEVERITY_COLORS[info.badSeverity.level]}>
          {info.badSeverity.label} · {info.badSeverity.failedOrders} failed
        </Badge>
      )}
      <span className="text-muted-foreground">
        {info.name} · {info.totalOrders} orders
        {info.deliveredPct !== null && info.deliveredPct !== undefined && ` · ${info.deliveredPct}% delivered`}
        {info.totalSales ? ` · Rs ${info.totalSales.toLocaleString()}` : ''}
      </span>
    </span>
  )
}
