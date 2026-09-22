'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import type { OrderChangeRow } from '@/lib/agent-actions'

const FIELD_TEXT: Record<string, string> = {
  products: 'Product',
  qty: 'Quantity',
  amount: 'Amount',
  locality: 'Locality',
  delivery_date: 'Delivery date',
  status: 'Status',
  free_item: 'Free item',
}

function when(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Indian/Mauritius',
  })
}

interface Save {
  key: string
  at: string
  who: string
  role: string | null
  reason: string | null
  customer: string
  phone: string | null
  products: string | null
  status: string | null
  cancelled: boolean
  fields: OrderChangeRow[]
}

export function OrderChangesLog({ rows }: { rows: OrderChangeRow[] }) {
  const [query, setQuery] = useState('')

  // One save writes one row per field; group them back so a product + qty +
  // amount change reads as one entry, the way the agent made it.
  const saves = useMemo(() => {
    const groups = new Map<string, Save>()
    for (const r of rows) {
      const key = `${r.delivery_id}|${r.created_at}`
      const g = groups.get(key) ?? {
        key,
        at: r.created_at,
        who: r.changed_by_name,
        role: r.changed_by_role,
        reason: r.reason,
        customer: r.customer_name || 'Unnamed customer',
        phone: r.contact_1,
        products: r.products,
        status: r.status,
        cancelled: false,
        fields: [],
      }
      if (r.field === 'status' && r.new_value === 'cancelled') g.cancelled = true
      g.fields.push(r)
      groups.set(key, g)
    }
    return [...groups.values()]
  }, [rows])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return saves
    return saves.filter((s) =>
      [s.who, s.customer, s.phone, s.products, s.reason].some((v) => v?.toLowerCase().includes(q)),
    )
  }, [saves, query])

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by agent, customer, phone, product or reason"
            className="pl-9"
            aria-label="Filter order changes"
          />
        </div>

        {shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {saves.length === 0 ? 'No order has been changed from the search yet.' : 'Nothing matches that filter.'}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {shown.map((s) => (
              <li key={s.key} className="flex flex-col gap-2 py-3 md:flex-row md:items-start md:gap-6">
                <div className="w-32 shrink-0 text-sm text-muted-foreground">{when(s.at)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{s.who}</span>
                    {s.role && <span className="text-xs text-muted-foreground">{s.role.replace('_', ' ')}</span>}
                    <span className="text-muted-foreground">{s.cancelled ? 'cancelled' : 'changed'}</span>
                    <span className="font-medium">{s.customer}</span>
                    {s.phone && <span className="text-sm text-muted-foreground">{s.phone}</span>}
                    {s.status && <Badge variant="outline" className="capitalize">{s.status}</Badge>}
                  </div>
                  {s.products && <p className="mt-0.5 text-sm text-muted-foreground">{s.products}</p>}
                  <ul className="mt-1 flex flex-col gap-0.5 text-sm">
                    {s.fields.map((f) => (
                      <li key={f.id}>
                        <span className="text-muted-foreground">{FIELD_TEXT[f.field] ?? f.field}:</span>{' '}
                        <span className="line-through opacity-70">{f.old_value || 'empty'}</span>
                        {' -> '}
                        <span className="font-medium">{f.new_value || 'empty'}</span>
                      </li>
                    ))}
                  </ul>
                  {s.reason && <p className="mt-1 text-sm italic text-muted-foreground">&ldquo;{s.reason}&rdquo;</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
