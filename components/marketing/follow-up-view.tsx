'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { 
  Phone, 
  MessageSquare, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  Search,
  Filter
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Delivery {
  id: string
  index_no: string
  status: string
  created_at: string
  customer_name: string
  customer_phone: string
  address: string
  amount: number
  clients?: {
    name: string
    phone: string
    address: string
  }
}

interface FollowUpViewProps {
  deliveries: Delivery[]
}

const statusConfig: Record<string, { label: string, color: string, icon: React.ElementType }> = {
  pending: { label: 'Pending', color: 'text-amber-500 bg-amber-500/10', icon: Clock },
  assigned: { label: 'Assigned', color: 'text-blue-500 bg-blue-500/10', icon: AlertCircle },
  in_transit: { label: 'In Transit', color: 'text-purple-500 bg-purple-500/10', icon: Clock },
}

export function FollowUpView({ deliveries }: FollowUpViewProps) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string | null>(null)

  const filtered = deliveries.filter(d => {
    const matchesSearch = !search || 
      d.customer_name?.toLowerCase().includes(search.toLowerCase()) ||
      d.index_no?.toLowerCase().includes(search.toLowerCase()) ||
      d.customer_phone?.includes(search)
    const matchesStatus = !statusFilter || d.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const handleCall = (phone: string) => {
    window.open(`tel:${phone}`, '_self')
  }

  const handleWhatsApp = (phone: string, name: string) => {
    const message = encodeURIComponent(`Hi ${name}, this is regarding your order. How can we help you today?`)
    window.open(`https://wa.me/${phone.replace(/\D/g, '')}?text=${message}`, '_blank')
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Follow Up</h1>
        <p className="text-muted-foreground">Track and follow up on pending orders</p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, phone, or order ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2">
          {Object.entries(statusConfig).map(([key, { label, color }]) => (
            <Button
              key={key}
              variant={statusFilter === key ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(statusFilter === key ? null : key)}
              className={cn(statusFilter === key && color)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {Object.entries(statusConfig).map(([key, { label, color, icon: Icon }]) => {
          const count = deliveries.filter(d => d.status === key).length
          return (
            <Card key={key} className={cn("border-l-4", color.replace('text-', 'border-'))}>
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <div className={cn("p-2 rounded-lg", color)}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{count}</p>
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Deliveries List */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <p className="font-medium">All caught up!</p>
              <p className="text-sm text-muted-foreground">No pending orders to follow up</p>
            </CardContent>
          </Card>
        ) : (
          filtered.map(delivery => {
            const config = statusConfig[delivery.status] || statusConfig.pending
            const StatusIcon = config.icon
            return (
              <Card key={delivery.id} className="hover:bg-muted/50 transition-colors">
                <CardContent className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={cn("px-2 py-0.5 rounded text-xs font-medium", config.color)}>
                          {config.label}
                        </span>
                        <span className="text-xs text-muted-foreground">#{delivery.index_no}</span>
                      </div>
                      <p className="font-semibold truncate">{delivery.customer_name || delivery.clients?.name}</p>
                      <p className="text-sm text-muted-foreground truncate">
                        {delivery.address || delivery.clients?.address}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Created: {new Date(delivery.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <p className="font-bold text-emerald-500">Rs {Number(delivery.amount).toLocaleString()}</p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 w-8 p-0"
                          onClick={() => handleCall(delivery.customer_phone || delivery.clients?.phone || '')}
                        >
                          <Phone className="w-4 h-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 w-8 p-0 text-emerald-500 hover:text-emerald-600"
                          onClick={() => handleWhatsApp(
                            delivery.customer_phone || delivery.clients?.phone || '',
                            delivery.customer_name || delivery.clients?.name || ''
                          )}
                        >
                          <MessageSquare className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
