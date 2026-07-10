'use client'

import { useEffect, useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Phone, MapPin, Package, TrendingUp, TrendingDown, ShoppingBag, Calendar } from 'lucide-react'
import { getClientDetail } from '@/lib/client-actions'
import {
  CLIENT_STATUS_LABELS,
  CLIENT_STATUS_COLORS,
  BAD_SEVERITY_COLORS,
  getBadSeverity,
  STATUS_LABELS,
  STATUS_COLORS,
  SALES_TYPE_LABELS,
  SALES_TYPE_COLORS,
} from '@/lib/types'
import type { Client, ClientOrderHistoryItem, SalesType } from '@/lib/types'

interface ClientDetailSheetProps {
  client: Client | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatPhone(phone: string | null) {
  if (!phone) return '-'
  const c = phone.replace(/\D/g, '')
  if (c.length === 8) return `+230 ${c.slice(0, 4)} ${c.slice(4)}`
  return phone
}

function formatDate(d: string | null) {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function ClientDetailSheet({ client, open, onOpenChange }: ClientDetailSheetProps) {
  const [orders, setOrders] = useState<ClientOrderHistoryItem[]>([])
  const [detailClient, setDetailClient] = useState<Client | null>(client)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open || !client) return
    setLoading(true)
    setDetailClient(client)
    getClientDetail(client.id)
      .then((res) => {
        if (res.client) setDetailClient(res.client)
        setOrders(res.orders || [])
      })
      .finally(() => setLoading(false))
  }, [open, client])

  const c = detailClient
  if (!c) return null

  const rated = (c.delivered_orders || 0) + (c.cms_orders || 0)
  const deliveredPct = rated > 0 ? Math.round(((c.delivered_orders || 0) / rated) * 100) : null
  const avgOrder = (c.delivered_orders || 0) > 0 ? Math.round(Number(c.total_sales || 0) / (c.delivered_orders || 1)) : 0
  const sev = c.client_status === 'bad' ? getBadSeverity(c.cms_orders || 0) : null

  // Sales-type mix from live order history
  const typeMix = orders.reduce<Record<string, number>>((acc, o) => {
    if (o.sales_type) acc[o.sales_type] = (acc[o.sales_type] || 0) + 1
    return acc
  }, {})

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <SheetTitle className="text-xl text-balance">{c.name}</SheetTitle>
            <div className="flex flex-wrap items-center justify-end gap-1">
              <Badge className={CLIENT_STATUS_COLORS[c.client_status] || CLIENT_STATUS_COLORS.new}>
                {CLIENT_STATUS_LABELS[c.client_status] || 'New'}
              </Badge>
              {sev && (
                <Badge variant="outline" className={BAD_SEVERITY_COLORS[sev.level]}>
                  {sev.label} · {sev.failedOrders} failed
                </Badge>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            {c.phone && (
              <a href={`tel:${c.phone}`} className="flex items-center gap-2 hover:underline">
                <Phone className="h-3.5 w-3.5" />
                {formatPhone(c.phone)}
              </a>
            )}
            {(c.region || c.city) && (
              <span className="flex items-center gap-2">
                <MapPin className="h-3.5 w-3.5" />
                {c.region || c.city}
              </span>
            )}
            <span className="flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5" />
              {c.first_order_date ? `First order ${formatDate(c.first_order_date)}` : 'No orders yet'}
              {c.last_order_date ? ` · Last ${formatDate(c.last_order_date)}` : ''}
            </span>
          </div>
        </SheetHeader>

        {/* Stat grid */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <StatCard icon={ShoppingBag} label="Total orders" value={(c.total_orders || 0).toLocaleString()} />
          <StatCard
            icon={TrendingUp}
            label="Delivered"
            value={`${c.delivered_orders || 0}${deliveredPct !== null ? ` · ${deliveredPct}%` : ''}`}
            tone="success"
          />
          <StatCard icon={TrendingDown} label="Failed (CMS)" value={String(c.cms_orders || 0)} tone="destructive" />
          <StatCard icon={Package} label="Total sales" value={`Rs ${Number(c.total_sales || 0).toLocaleString()}`} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Average delivered order value: Rs {avgOrder.toLocaleString()}
        </p>

        {/* Sales-type mix */}
        {Object.keys(typeMix).length > 0 && (
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-medium">Order type mix</h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(typeMix).map(([type, count]) => (
                <Badge key={type} variant="outline" className={SALES_TYPE_COLORS[type as SalesType]}>
                  {SALES_TYPE_LABELS[type as SalesType] || type}: {count}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <Separator className="my-6" />

        {/* Order history */}
        <div>
          <h3 className="mb-3 text-sm font-medium">
            Order history {orders.length > 0 && <span className="text-muted-foreground">({orders.length})</span>}
          </h3>

          {loading ? (
            <div className="flex h-24 items-center justify-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : orders.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No individual order records found.
              {(c.total_orders || 0) > 0 && ' This client\u2019s stats come from imported history (aggregated).'}
            </div>
          ) : (
            <ul className="space-y-2">
              {orders.map((o) => (
                <li key={o.id} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge className={STATUS_COLORS[o.status] || ''} variant="secondary">
                          {STATUS_LABELS[o.status] || o.status}
                        </Badge>
                        {o.sales_type && (
                          <Badge variant="outline" className={SALES_TYPE_COLORS[o.sales_type]}>
                            {SALES_TYPE_LABELS[o.sales_type] || o.sales_type}
                          </Badge>
                        )}
                      </div>
                      {o.products && (
                        <p className="mt-1 text-sm line-clamp-2">{o.products}</p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDate(o.delivery_date || o.entry_date)}
                        {o.locality ? ` · ${o.locality}` : ''}
                        {o.qty ? ` · Qty ${o.qty}` : ''}
                        {o.return_product ? ` · Returns: ${o.return_product}` : ''}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-sm font-medium">
                      {o.amount != null ? `Rs ${Number(o.amount).toLocaleString()}` : '-'}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  tone?: 'success' | 'destructive'
}) {
  const toneClass =
    tone === 'success' ? 'text-success' : tone === 'destructive' ? 'text-destructive' : 'text-foreground'
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className={`mt-1 text-lg font-semibold ${toneClass}`}>{value}</div>
    </div>
  )
}
