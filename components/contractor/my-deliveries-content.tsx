'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { 
  Package, 
  CheckCircle, 
  Clock, 
  Truck,
  Phone,
  MapPin,
  Navigation,
  XCircle,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import { updateDeliveryStatus } from '@/lib/delivery-actions'
import { useRouter } from 'next/navigation'

const MAPS_URL_REGEX = new RegExp('https?://(maps\\.app\\.goo\\.gl|goo\\.gl/maps|www\\.google\\.com/maps|maps\\.google\\.com|google\\.com/maps)[^\\s)}"\'\\]]*', 'gi')

function RichNoteText({ text, label }: { text: string; label?: string }) {
  const matches: { url: string; start: number; end: number }[] = []
  let match: RegExpExecArray | null
  const regex = new RegExp(MAPS_URL_REGEX.source, MAPS_URL_REGEX.flags)
  while ((match = regex.exec(text)) !== null) {
    matches.push({ url: match[0], start: match.index, end: match.index + match[0].length })
  }
  if (matches.length === 0) return <span>{text}</span>
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  const linkLabel = label ? `${label}'s Pin Location` : 'Pin Location'
  matches.forEach((link, i) => {
    if (link.start > lastIndex) {
      const before = text.slice(lastIndex, link.start).trim()
      if (before) parts.push(<span key={`t-${i}`}>{before} </span>)
    }
    parts.push(
      <a key={`l-${i}`} href={link.url} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 hover:text-blue-300 transition-colors text-xs font-medium no-underline"
        onClick={(e) => e.stopPropagation()}
      >
        <Navigation className="w-3.5 h-3.5 shrink-0" />{linkLabel}
      </a>
    )
    lastIndex = link.end
  })
  if (lastIndex < text.length) {
    const after = text.slice(lastIndex).trim()
    if (after) parts.push(<span key="tail"> {after}</span>)
  }
  return <span>{parts}</span>
}

interface MyDeliveriesContentProps {
  rider: any
  todayDeliveries: any[]
  allDeliveries: any[]
  stats: {
    todayTotal: number
    todayCompleted: number
    todayPending: number
    todayEarnings: number
    allTimeDeliveries: number
  }
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  assigned: { label: 'New', color: 'text-primary', bgColor: 'bg-primary/20' },
  picked_up: { label: 'In Transit', color: 'text-warning', bgColor: 'bg-warning/20' },
  delivered: { label: 'Delivered', color: 'text-success', bgColor: 'bg-success/20' },
  nwd: { label: 'NWD', color: 'text-destructive', bgColor: 'bg-destructive/20' },
  cms: { label: 'CMS', color: 'text-orange-600', bgColor: 'bg-orange-100' },
}

export function ContractorMyDeliveriesContent({ 
  rider,
  todayDeliveries,
  allDeliveries,
  stats
}: MyDeliveriesContentProps) {
  const router = useRouter()
  const [expandedDelivery, setExpandedDelivery] = useState<string | null>(null)
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const deliveriesToShow = showAll ? allDeliveries : todayDeliveries

  async function handleStatusUpdate(deliveryId: string, newStatus: string) {
    setUpdatingStatus(deliveryId)
    await updateDeliveryStatus(deliveryId, newStatus)
    setUpdatingStatus(null)
    router.refresh()
  }

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-foreground">My Deliveries</h1>
        <p className="text-sm text-muted-foreground">
          Deliveries assigned to you as {rider.name}
        </p>
      </div>

      {/* Today Stats */}
      <div className="grid grid-cols-4 gap-2">
        <div className="glass-card rounded-xl p-3 text-center">
          <p className="text-xl font-bold text-foreground">{stats.todayTotal}</p>
          <p className="text-[10px] text-muted-foreground">Total</p>
        </div>
        <div className="glass-card rounded-xl p-3 text-center">
          <p className="text-xl font-bold text-success">{stats.todayCompleted}</p>
          <p className="text-[10px] text-muted-foreground">Done</p>
        </div>
        <div className="glass-card rounded-xl p-3 text-center">
          <p className="text-xl font-bold text-warning">{stats.todayPending}</p>
          <p className="text-[10px] text-muted-foreground">Pending</p>
        </div>
        <div className="glass-card rounded-xl p-3 text-center">
          <p className="text-xl font-bold text-primary">Rs {stats.todayEarnings}</p>
          <p className="text-[10px] text-muted-foreground">Earned</p>
        </div>
      </div>

      {/* Toggle */}
      <div className="flex gap-2">
        <Button
          variant={!showAll ? "default" : "outline"}
          size="sm"
          onClick={() => setShowAll(false)}
          className="flex-1"
        >
          Today ({todayDeliveries.length})
        </Button>
        <Button
          variant={showAll ? "default" : "outline"}
          size="sm"
          onClick={() => setShowAll(true)}
          className="flex-1"
        >
          All ({allDeliveries.length})
        </Button>
      </div>

      {/* Deliveries List */}
      <div className="space-y-3">
        {deliveriesToShow.length === 0 ? (
          <div className="glass-card rounded-xl p-8 text-center">
            <Package className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">
              {showAll ? 'No deliveries found' : 'No deliveries for today'}
            </p>
          </div>
        ) : (
          deliveriesToShow.map((delivery) => {
            const statusConfig = STATUS_CONFIG[delivery.status] || STATUS_CONFIG.assigned
            const isExpanded = expandedDelivery === delivery.id
            const isUpdating = updatingStatus === delivery.id
            const canUpdateStatus = ['assigned', 'picked_up'].includes(delivery.status)

            return (
              <div
                key={delivery.id}
                className="glass-card rounded-xl overflow-hidden"
              >
                {/* Main Row */}
                <div 
                  className="p-4 flex items-center gap-3 cursor-pointer"
                  onClick={() => setExpandedDelivery(isExpanded ? null : delivery.id)}
                >
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center",
                    statusConfig.bgColor
                  )}>
                    {delivery.status === 'delivered' ? (
                      <CheckCircle className={cn("w-5 h-5", statusConfig.color)} />
                    ) : delivery.status === 'picked_up' ? (
                      <Truck className={cn("w-5 h-5", statusConfig.color)} />
                    ) : delivery.status === 'nwd' || delivery.status === 'cms' ? (
                      <XCircle className={cn("w-5 h-5", statusConfig.color)} />
                    ) : (
                      <Package className={cn("w-5 h-5", statusConfig.color)} />
                    )}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{delivery.customer_name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{delivery.index_no || 'No ID'}</span>
                      <span>-</span>
                      <span>{delivery.locality || 'N/A'}</span>
                    </div>
                  </div>

                  <div className="text-right flex items-center gap-2">
                    <Badge className={cn("text-[10px]", statusConfig.bgColor, statusConfig.color)}>
                      {statusConfig.label}
                    </Badge>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                    {/* Customer Info */}
                    <div className="space-y-2">
                      {delivery.contact_1 && (
                        <a 
                          href={`tel:${delivery.contact_1}`}
                          className="flex items-center gap-2 text-sm text-primary"
                        >
                          <Phone className="w-4 h-4" />
                          {delivery.contact_1}
                        </a>
                      )}
                      {delivery.contact_2 && (
                        <a 
                          href={`tel:${delivery.contact_2}`}
                          className="flex items-center gap-2 text-sm text-muted-foreground"
                        >
                          <Phone className="w-4 h-4" />
                          {delivery.contact_2}
                        </a>
                      )}
                      {delivery.address && (
                        <div className="flex items-start gap-2 text-sm text-muted-foreground">
                          <MapPin className="w-4 h-4 mt-0.5 flex-shrink-0" />
                          <span>{delivery.address}</span>
                        </div>
                      )}
                    </div>

                    {/* Products */}
                    {delivery.products && (
                      <div className="bg-muted/50 rounded-lg p-2">
                        <p className="text-xs text-muted-foreground font-medium mb-1">Products:</p>
                        <p className="text-sm">{delivery.products}</p>
                      </div>
                    )}

                    {/* Combined Notes & Replies */}
                    {(delivery.notes || delivery.delivery_notes || delivery.client_response) && (
                      <div className="space-y-1.5">
                        {delivery.notes && (
                          <div className="bg-muted/50 rounded-lg p-2">
                            <p className="text-xs text-muted-foreground font-medium mb-0.5">Notes</p>
                            <p className="text-sm"><RichNoteText text={delivery.notes} label={delivery.customer_name} /></p>
                          </div>
                        )}
                        {delivery.delivery_notes && (
                          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2">
                            <p className="text-xs text-amber-400 font-medium mb-0.5">Remarks</p>
                            <p className="text-sm"><RichNoteText text={delivery.delivery_notes} label={delivery.customer_name} /></p>
                          </div>
                        )}
                        {delivery.client_response && (
                          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2">
                            <p className="text-xs text-emerald-400 font-medium mb-0.5">Client Reply</p>
                            <p className="text-sm"><RichNoteText text={delivery.client_response} label={delivery.customer_name} /></p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Amount */}
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Amount to Collect:</span>
                      <span className="font-bold text-lg">Rs {(delivery.amount || 0).toFixed(0)}</span>
                    </div>

                    {/* Actions */}
                    {canUpdateStatus && (
                      <div className="flex gap-2 pt-2">
                        {delivery.status === 'assigned' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 bg-transparent"
                            disabled={isUpdating}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleStatusUpdate(delivery.id, 'picked_up')
                            }}
                          >
                            <Truck className="w-4 h-4 mr-1" />
                            Pick Up
                          </Button>
                        )}
                        {delivery.status === 'picked_up' && (
                          <>
                            <Button
                              size="sm"
                              className="flex-1 bg-success hover:bg-success/90"
                              disabled={isUpdating}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleStatusUpdate(delivery.id, 'delivered')
                              }}
                            >
                              <CheckCircle className="w-4 h-4 mr-1" />
                              Delivered
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={isUpdating}
                              onClick={(e) => {
                                e.stopPropagation()
                                handleStatusUpdate(delivery.id, 'nwd')
                              }}
                            >
                              NWD
                            </Button>
                          </>
                        )}
                        {delivery.address && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation()
                              window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(delivery.address)}`, '_blank')
                            }}
                          >
                            <Navigation className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
