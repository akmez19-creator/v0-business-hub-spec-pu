'use client'

import { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Search, Phone, MapPin, AlertTriangle, Loader2 } from 'lucide-react'
import { CLIENT_STATUS_LABELS, CLIENT_STATUS_COLORS } from '@/lib/types'
import {
  searchClientsForAgent,
  getClientOrders,
  type AgentClientResult,
  type AgentEntry,
  type ClientOrder,
} from '@/lib/agent-actions'
import { AgentOrderEditor } from '@/components/dashboard/agent-order-editor'

function statusKey(s: string | null): keyof typeof CLIENT_STATUS_LABELS {
  return s === 'good' || s === 'average' || s === 'bad' ? s : 'new'
}

function formatTime(iso: string) {
  // Entries are timestamped in UTC but the agents work in Mauritius, so the
  // clock has to be rendered in their timezone or an 08:31 entry reads 04:31.
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Indian/Mauritius',
  })
}

export function MarketingAgentHome({
  agentName,
  initialEntries,
}: {
  agentName: string
  initialEntries: AgentEntry[]
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<AgentClientResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)

  // Guards against out-of-order responses: a slow request for "kim" must not
  // overwrite the results of the newer "kimberley" the agent has since typed.
  const requestId = useRef(0)

  // The expanded client's orders.
  const [openPhone, setOpenPhone] = useState<string | null>(null)
  const [orders, setOrders] = useState<ClientOrder[]>([])
  const [loadingOrders, setLoadingOrders] = useState(false)

  async function refreshOrders(phone: string) {
    setLoadingOrders(true)
    setOrders(await getClientOrders(phone))
    setLoadingOrders(false)
  }

  function toggleClient(phone: string) {
    if (openPhone === phone) {
      setOpenPhone(null)
      setOrders([])
      return
    }
    setOpenPhone(phone)
    setOrders([])
    void refreshOrders(phone)
  }

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setSearched(false)
      setSearching(false)
      return
    }

    setSearching(true)
    const id = ++requestId.current
    const timer = setTimeout(async () => {
      const found = await searchClientsForAgent(q)
      if (id !== requestId.current) return
      setResults(found)
      setSearched(true)
      setSearching(false)
    }, 300)

    return () => clearTimeout(timer)
  }, [query])

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Hi {agentName}</h2>
        <p className="text-muted-foreground">Look up a client, or check what you have entered today.</p>
      </div>

      {/* Search - the primary tool on this page */}
      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by phone number or name"
              className="h-12 pl-11 text-base"
              aria-label="Search clients by phone number or name"
            />
            {searching && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
            )}
          </div>

          {query.trim().length > 0 && query.trim().length < 2 && (
            <p className="mt-3 text-sm text-muted-foreground">Keep typing to search.</p>
          )}

          {searched && results.length === 0 && !searching && (
            <div className="mt-4 rounded-lg border border-border p-4">
              <p className="text-sm font-medium">{`No client found for "${query.trim()}"`}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                They are probably new. Create the order as usual and the client record is made automatically.
              </p>
            </div>
          )}

          {results.length > 0 && (
            <ul className="mt-4 flex flex-col gap-2">
              {results.map((c) => (
                <li key={c.id} className="rounded-lg border border-border p-3">
                  <button
                    type="button"
                    onClick={() => toggleClient(c.phone)}
                    aria-expanded={openPhone === c.phone}
                    className="flex w-full flex-wrap items-start justify-between gap-2 text-left"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{c.name || 'Unnamed client'}</span>
                        <Badge className={CLIENT_STATUS_COLORS[statusKey(c.client_status)]}>
                          {CLIENT_STATUS_LABELS[statusKey(c.client_status)]}
                        </Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {c.phone}
                        </span>
                        {c.region && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {c.region}
                          </span>
                        )}
                        <span>
                          {c.total_orders} completed
                          {c.delivered_rate != null ? ` · ${Math.round(Number(c.delivered_rate))}% delivered` : ''}
                        </span>
                      </div>
                    </div>

                    {/* Open orders are shown separately from the completed count,
                        which counts delivered + CMS only and so reads 0 for a
                        client who already has live orders waiting. */}
                    {c.open_orders > 0 && (
                      <span className="flex items-center gap-1 rounded-md bg-warning/10 px-2 py-1 text-xs font-semibold text-warning">
                        <AlertTriangle className="h-3 w-3" />
                        {c.open_orders} order{c.open_orders === 1 ? '' : 's'} already open
                      </span>
                    )}
                  </button>

                  {openPhone === c.phone && (
                    <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                      {loadingOrders ? (
                        <p className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" /> Loading orders...
                        </p>
                      ) : orders.length === 0 ? (
                        <p className="py-2 text-sm text-muted-foreground">
                          No orders on record for this client.
                        </p>
                      ) : (
                        orders.map((o) => (
                          <AgentOrderEditor
                            key={o.id}
                            order={o}
                            onDone={() => refreshOrders(c.phone)}
                          />
                        ))
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* This agent's own entries for today */}
      <Card>
        <CardHeader>
          <CardTitle>Your entries today</CardTitle>
          <CardDescription>Orders you have created today.</CardDescription>
        </CardHeader>
        <CardContent>
          {initialEntries.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">Nothing entered yet today.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {initialEntries.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{e.customer_name || 'No name'}</p>
                    <p className="text-sm text-muted-foreground">
                      {e.products || 'No products'}
                      {e.locality ? ` · ${e.locality}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">Rs {Number(e.amount || 0).toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {e.status} · {formatTime(e.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
