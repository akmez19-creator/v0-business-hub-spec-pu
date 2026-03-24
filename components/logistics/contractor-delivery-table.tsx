'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { assignDelivery, markRiderPaid } from '@/lib/delivery-actions'
import type { Delivery, Profile } from '@/lib/types'
import { STATUS_LABELS } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Banknote, CheckCircle } from 'lucide-react'

interface Props {
  deliveries: Delivery[]
  riders: Profile[]
}

export function ContractorDeliveryTable({ deliveries, riders }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [loading, setLoading] = useState<string | null>(null)
  const router = useRouter()

  // Group deliveries by status
  const activeDeliveries = deliveries.filter(d => ['assigned', 'picked_up'].includes(d.status))
  const completedDeliveries = deliveries.filter(d => d.status === 'delivered')
  const unpaidDeliveries = completedDeliveries.filter(d => !d.rider_paid)

  function handleSelectAll(checked: boolean) {
    if (checked) {
      setSelectedIds(unpaidDeliveries.map(d => d.id))
    } else {
      setSelectedIds([])
    }
  }

  function handleSelectOne(id: string, checked: boolean) {
    if (checked) {
      setSelectedIds([...selectedIds, id])
    } else {
      setSelectedIds(selectedIds.filter(i => i !== id))
    }
  }

  async function handleReassign(deliveryId: string, riderId: string) {
    setLoading(deliveryId)
    await assignDelivery(deliveryId, riderId, null)
    setLoading(null)
    router.refresh()
  }

  async function handleMarkPaid() {
    if (selectedIds.length === 0) return
    await markRiderPaid(selectedIds)
    setSelectedIds([])
    router.refresh()
  }

  function getRiderName(riderId: string | null) {
    if (!riderId) return 'Unassigned'
    const rider = riders.find(r => r.id === riderId)
    return rider?.name || rider?.email || 'Unknown'
  }

  return (
    <div className="space-y-6">
      {/* Active Deliveries */}
      <Card>
        <CardHeader>
          <CardTitle>Active Deliveries</CardTitle>
          <CardDescription>Deliveries currently in progress</CardDescription>
        </CardHeader>
        <CardContent>
          {activeDeliveries.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No active deliveries</p>
          ) : (
            <div className="rounded-md border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Customer</TableHead>
                    <TableHead>Region</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Rider</TableHead>
                    <TableHead>Fee</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeDeliveries.map((delivery) => (
                    <TableRow key={delivery.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{delivery.customer_name}</p>
                          <p className="text-sm text-muted-foreground">{delivery.contact_1 || '-'}</p>
                        </div>
                      </TableCell>
                      <TableCell>{delivery.locality || '-'}</TableCell>
                      <TableCell>
                        <Badge variant={delivery.status === 'picked_up' ? 'default' : 'secondary'}>
                          {STATUS_LABELS[delivery.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={delivery.rider_id || 'unassigned'}
                          onValueChange={(v) => v !== 'unassigned' && handleReassign(delivery.id, v)}
                          disabled={loading === delivery.id}
                        >
                          <SelectTrigger className="w-[130px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unassigned">Unassigned</SelectItem>
                            {riders.map((rider) => (
                              <SelectItem key={rider.id} value={rider.id}>
                                {rider.name || rider.email}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>Rs {Number(delivery.rider_fee || 50).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Unpaid Deliveries */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Unpaid Rider Fees</CardTitle>
            <CardDescription>Mark deliveries as paid after settling with riders</CardDescription>
          </div>
          {selectedIds.length > 0 && (
            <Button onClick={handleMarkPaid}>
              <Banknote className="w-4 h-4 mr-2" />
              Mark {selectedIds.length} as Paid
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {unpaidDeliveries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>All rider fees are paid</p>
            </div>
          ) : (
            <div className="rounded-md border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <Checkbox
                        checked={selectedIds.length === unpaidDeliveries.length}
                        onCheckedChange={handleSelectAll}
                      />
                    </TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Rider</TableHead>
                    <TableHead>Delivered</TableHead>
                    <TableHead>Fee</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unpaidDeliveries.map((delivery) => (
                    <TableRow key={delivery.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.includes(delivery.id)}
                          onCheckedChange={(checked) => handleSelectOne(delivery.id, !!checked)}
                        />
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{delivery.customer_name}</p>
                          <p className="text-sm text-muted-foreground">{delivery.locality || '-'}</p>
                        </div>
                      </TableCell>
                      <TableCell>{getRiderName(delivery.rider_id)}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {delivery.delivered_at 
                          ? new Date(delivery.delivered_at).toLocaleDateString()
                          : '-'
                        }
                      </TableCell>
                      <TableCell className="font-medium">
                        Rs {Number(delivery.rider_fee || 50).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
