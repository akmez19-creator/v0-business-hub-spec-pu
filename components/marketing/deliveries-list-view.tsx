'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Truck, Search, Calendar } from 'lucide-react'

interface Delivery {
  id: string
  index_no: string | null
  customer_name: string | null
  contact_1: string | null
  locality: string | null
  products: string | null
  amount: number | null
  status: string
  delivery_date: string | null
  created_at: string
}

interface Props {
  deliveries: Delivery[]
}

const fmtRs = (n: number) => `Rs ${n.toLocaleString()}`

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  assigned: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  picked_up: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  delivered: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  nwd: 'bg-red-500/10 text-red-500 border-red-500/20',
  cms: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
}

export function DeliveriesListView({ deliveries }: Props) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | null>(null)

  const filteredDeliveries = deliveries.filter(d => {
    const matchesSearch = 
      (d.customer_name && d.customer_name.toLowerCase().includes(search.toLowerCase())) ||
      (d.index_no && d.index_no.toLowerCase().includes(search.toLowerCase())) ||
      (d.products && d.products.toLowerCase().includes(search.toLowerCase()))
    const matchesStatus = !statusFilter || d.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const statuses = ['pending', 'assigned', 'picked_up', 'delivered', 'nwd', 'cms']

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Deliveries</h1>
        <p className="text-muted-foreground mt-1">View all delivery orders</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, index, or products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <Badge
            variant={statusFilter === null ? 'default' : 'outline'}
            className="cursor-pointer"
            onClick={() => setStatusFilter(null)}
          >
            All
          </Badge>
          {statuses.map(status => (
            <Badge
              key={status}
              variant={statusFilter === status ? 'default' : 'outline'}
              className={`cursor-pointer capitalize ${statusFilter === status ? '' : statusColors[status]}`}
              onClick={() => setStatusFilter(status)}
            >
              {status.replace('_', ' ')}
            </Badge>
          ))}
        </div>
      </div>

      {/* Deliveries List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="w-5 h-5" />
            Deliveries ({filteredDeliveries.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {filteredDeliveries.map(delivery => (
              <div 
                key={delivery.id}
                className="flex items-center justify-between p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {delivery.index_no && (
                      <Badge variant="outline" className="text-xs">{delivery.index_no}</Badge>
                    )}
                    <span className="font-semibold truncate">{delivery.customer_name || 'Unknown'}</span>
                  </div>
                  <p className="text-sm text-muted-foreground truncate">{delivery.products || 'No products'}</p>
                  {delivery.delivery_date && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(delivery.delivery_date).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <Badge variant="outline" className={statusColors[delivery.status] || ''}>
                    {delivery.status.replace('_', ' ')}
                  </Badge>
                  <span className="font-bold text-lg">
                    {fmtRs(Number(delivery.amount || 0))}
                  </span>
                </div>
              </div>
            ))}
            {filteredDeliveries.length === 0 && (
              <div className="text-center py-12">
                <Truck className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">No deliveries found</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
