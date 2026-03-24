'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { updateDeliveryStatus } from '@/lib/delivery-actions'
import type { Delivery, DeliveryStatus, SalesType } from '@/lib/types'
import { STATUS_LABELS, SALES_TYPE_LABELS, SALES_TYPE_COLORS } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Package, Truck, CheckCircle, AlertTriangle, Phone, MapPin, Loader2 } from 'lucide-react'

interface Props {
  deliveries: Delivery[]
}

export function RiderDeliveryList({ deliveries }: Props) {
  const [statusDialogOpen, setStatusDialogOpen] = useState(false)
  const [selectedDelivery, setSelectedDelivery] = useState<Delivery | null>(null)
  const [newStatus, setNewStatus] = useState<DeliveryStatus | null>(null)
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const assignedDeliveries = deliveries.filter(d => d.status === 'assigned')
  const pickedUpDeliveries = deliveries.filter(d => d.status === 'picked_up')
  const completedDeliveries = deliveries.filter(d => ['delivered', 'nwd', 'cms'].includes(d.status))

  function openStatusDialog(delivery: Delivery, status: DeliveryStatus) {
    setSelectedDelivery(delivery)
    setNewStatus(status)
    setNotes('')
    setStatusDialogOpen(true)
  }

  async function handleStatusUpdate() {
    if (!selectedDelivery || !newStatus) return
    
    setLoading(true)
    await updateDeliveryStatus(selectedDelivery.id, newStatus, notes || undefined)
    setLoading(false)
    setStatusDialogOpen(false)
    router.refresh()
  }

  function DeliveryCard({ delivery, showActions = true }: { delivery: Delivery; showActions?: boolean }) {
    return (
      <Card key={delivery.id}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-base">{delivery.customer_name}</CardTitle>
              <CardDescription className="flex items-center gap-1 mt-1">
                <MapPin className="w-3 h-3" />
                {delivery.locality || 'No locality'}
              </CardDescription>
            </div>
            <div className="flex items-center gap-1.5">
              {delivery.sales_type && delivery.sales_type !== 'sale' && (
                <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', SALES_TYPE_COLORS[delivery.sales_type as SalesType] || 'bg-muted text-muted-foreground')}>
                  {SALES_TYPE_LABELS[delivery.sales_type as SalesType] || delivery.sales_type}
                </span>
              )}
              <Badge variant={
                delivery.status === 'delivered' ? 'default' :
                delivery.status === 'picked_up' ? 'secondary' :
                delivery.status === 'nwd' || delivery.status === 'cms' ? 'destructive' :
                'outline'
              }>
                {STATUS_LABELS[delivery.status]}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <p className="text-muted-foreground">Products</p>
              <p className="font-medium truncate">{delivery.products || '-'}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Amount</p>
              <p className="font-medium">Rs {Number(delivery.amount || 0).toLocaleString()}</p>
            </div>
          </div>
          
          {delivery.sales_type && ['exchange', 'trade_in', 'refund'].includes(delivery.sales_type) && (
            <div className={cn(
              "p-3 rounded-md border",
              delivery.sales_type === 'exchange' ? 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800/30' :
              delivery.sales_type === 'trade_in' ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800/30' :
              'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/30'
            )}>
              <div className={cn("flex items-center gap-2 font-bold text-sm",
                delivery.sales_type === 'exchange' ? 'text-violet-700 dark:text-violet-400' :
                delivery.sales_type === 'trade_in' ? 'text-blue-700 dark:text-blue-400' : 'text-red-700 dark:text-red-400'
              )}>
                <Package className="w-4 h-4 shrink-0" />
                {delivery.sales_type === 'exchange' ? 'EXCHANGE ORDER' : delivery.sales_type === 'trade_in' ? 'TRADE-IN ORDER' : 'REFUND ORDER'}
              </div>
              {delivery.return_product && (
                <p className="font-semibold text-sm mt-1 text-foreground">Collect: {delivery.return_product}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                {delivery.sales_type === 'exchange'
                  ? 'Deliver new product, collect old with ALL packaging & parts. Missing items deducted from payout.'
                  : delivery.sales_type === 'trade_in'
                  ? 'Deliver new product, collect trade-in. Verify all packaging & parts. Missing items deducted from payout.'
                  : `Give cash refund of Rs ${delivery.amount || 0}, collect product with ALL packaging. Missing items deducted from payout.`}
              </p>
            </div>
          )}

          {delivery.contact_1 && (
            <a 
              href={`tel:${delivery.contact_1}`}
              className="flex items-center gap-2 p-2 rounded-md bg-muted text-sm hover:bg-muted/80 transition-colors"
            >
              <Phone className="w-4 h-4" />
              {delivery.contact_1}
            </a>
          )}
          
          {delivery.notes && (
            <p className="text-sm text-muted-foreground bg-muted/50 p-2 rounded-md">
              {delivery.notes}
            </p>
          )}
          
          {delivery.rider_fee && (
            <div className="flex items-center justify-between text-sm pt-2 border-t border-border">
              <span className="text-muted-foreground">Your fee</span>
              <span className="font-medium text-success">Rs {Number(delivery.rider_fee || 50).toLocaleString()}</span>
            </div>
          )}
          
          {showActions && delivery.status === 'assigned' && (
            <Button 
              className="w-full" 
              onClick={() => openStatusDialog(delivery, 'picked_up')}
            >
              <Truck className="w-4 h-4 mr-2" />
              Mark as Picked Up
            </Button>
          )}
          
          {showActions && delivery.status === 'picked_up' && (
            <div className="grid grid-cols-3 gap-2">
              <Button 
                className="col-span-2"
                onClick={() => openStatusDialog(delivery, 'delivered')}
              >
                <CheckCircle className="w-4 h-4 mr-2" />
                Delivered
              </Button>
              <Button 
                variant="outline"
                onClick={() => openStatusDialog(delivery, 'nwd')}
              >
                NWD
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Tabs defaultValue="assigned" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="assigned" className="flex items-center gap-2">
            <Package className="w-4 h-4" />
            Assigned ({assignedDeliveries.length})
          </TabsTrigger>
          <TabsTrigger value="in-transit" className="flex items-center gap-2">
            <Truck className="w-4 h-4" />
            In Transit ({pickedUpDeliveries.length})
          </TabsTrigger>
          <TabsTrigger value="completed" className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4" />
            Completed ({completedDeliveries.length})
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="assigned" className="mt-4">
          {assignedDeliveries.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Package className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No assigned deliveries</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {assignedDeliveries.map(delivery => (
                <DeliveryCard key={delivery.id} delivery={delivery} />
              ))}
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="in-transit" className="mt-4">
          {pickedUpDeliveries.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Truck className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No deliveries in transit</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {pickedUpDeliveries.map(delivery => (
                <DeliveryCard key={delivery.id} delivery={delivery} />
              ))}
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="completed" className="mt-4">
          {completedDeliveries.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CheckCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No completed deliveries yet</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {completedDeliveries.map(delivery => (
                <DeliveryCard key={delivery.id} delivery={delivery} showActions={false} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
      
      {/* Status Update Dialog */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {newStatus === 'picked_up' && 'Mark as Picked Up'}
              {newStatus === 'delivered' && 'Mark as Delivered'}
              {newStatus === 'nwd' && 'Mark as Not With Driver'}
              {newStatus === 'cms' && 'Mark as CMS'}
            </DialogTitle>
            <DialogDescription>
              {selectedDelivery?.customer_name} - {selectedDelivery?.locality}
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            <Textarea
              placeholder="Add notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
          
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatusDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleStatusUpdate} disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
