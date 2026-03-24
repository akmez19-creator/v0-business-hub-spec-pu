'use client'

import { useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { assignDelivery, deleteDelivery, updateDeliveryStatus, bulkAssignDeliveries, markRiderPaid } from '@/lib/delivery-actions'
import type { Delivery, Profile, Rider, DeliveryStatus, SalesType } from '@/lib/types'
import { STATUS_LABELS, SALES_TYPE_LABELS, SALES_TYPE_COLORS } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { MoreHorizontal, Trash2, UserPlus, CheckCircle, Clock, Package, Banknote, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

interface Props {
  deliveries: Delivery[]
  riders: Rider[]
  contractors: Profile[]
  currentPage: number
  totalPages: number
  totalCount: number
  pageSize: number
  allowedPageSizes: number[]
}

export function DeliveriesTable({ deliveries, riders, contractors, currentPage, totalPages, totalCount, pageSize, allowedPageSizes }: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [assignDialogOpen, setAssignDialogOpen] = useState(false)
  const [selectedRider, setSelectedRider] = useState<string>('')
  const [bulkAssigning, setBulkAssigning] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)
  const [jumpToPage, setJumpToPage] = useState('')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Stats for current page
  const pageDeliveries = deliveries.length
  const pendingCount = deliveries.filter(d => d.status === 'pending').length
  const assignedCount = deliveries.filter(d => d.status === 'assigned').length
  const deliveredCount = deliveries.filter(d => d.status === 'delivered').length
  const totalAmount = deliveries.reduce((sum, d) => sum + Number(d.amount || 0), 0)

  function navigateToPage(page: number) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('page', page.toString())
    router.push(`${pathname}?${params.toString()}`)
  }

  function handlePageSizeChange(newSize: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('pageSize', newSize)
    params.set('page', '1')
    router.push(`${pathname}?${params.toString()}`)
  }

  function handleJumpToPage() {
    const page = parseInt(jumpToPage)
    if (page >= 1 && page <= totalPages) {
      navigateToPage(page)
      setJumpToPage('')
    }
  }

  function handleSelectAll(checked: boolean) {
    if (checked) {
      setSelectedIds(deliveries.map(d => d.id))
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

  async function handleAssign(deliveryId: string, riderId: string) {
    setLoading(deliveryId)
    const rider = riders.find(r => r.id === riderId)
    await assignDelivery(deliveryId, riderId, rider?.contractor_id || null)
    setLoading(null)
    router.refresh()
  }

  async function handleStatusChange(deliveryId: string, status: DeliveryStatus) {
    setLoading(deliveryId)
    await updateDeliveryStatus(deliveryId, status)
    setLoading(null)
    router.refresh()
  }

  async function handleDelete(deliveryId: string) {
    if (!confirm('Are you sure you want to delete this delivery?')) return
    setLoading(deliveryId)
    await deleteDelivery(deliveryId)
    setLoading(null)
    router.refresh()
  }

  async function handleBulkAssign() {
    if (!selectedRider || selectedIds.length === 0) return
    setBulkAssigning(true)
    const rider = riders.find(r => r.id === selectedRider)
    await bulkAssignDeliveries(selectedIds, selectedRider, rider?.contractor_id || null)
    setBulkAssigning(false)
    setAssignDialogOpen(false)
    setSelectedIds([])
    setSelectedRider('')
    router.refresh()
  }

  async function handleMarkPaid() {
    const unpaidDeliveries = deliveries.filter(
      d => selectedIds.includes(d.id) && d.status === 'delivered' && !d.rider_paid
    )
    if (unpaidDeliveries.length === 0) {
      alert('No delivered unpaid deliveries selected')
      return
    }
    await markRiderPaid(unpaidDeliveries.map(d => d.id))
    setSelectedIds([])
    router.refresh()
  }

  // Calculate page range info
  const startRecord = (currentPage - 1) * pageSize + 1
  const endRecord = Math.min(currentPage * pageSize, totalCount)

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total</CardTitle>
            <Package className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCount.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Showing {pageDeliveries} on this page</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Pending</CardTitle>
            <Clock className="w-4 h-4 text-warning" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingCount}</div>
            <p className="text-xs text-muted-foreground">On this page</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Assigned</CardTitle>
            <UserPlus className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{assignedCount}</div>
            <p className="text-xs text-muted-foreground">On this page</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Delivered</CardTitle>
            <CheckCircle className="w-4 h-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{deliveredCount}</div>
            <p className="text-xs text-muted-foreground">On this page</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Page Amount</CardTitle>
            <Banknote className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Rs {totalAmount.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">On this page</p>
          </CardContent>
        </Card>
      </div>

      {/* Bulk Actions */}
      {selectedIds.length > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-md bg-muted">
          <span className="text-sm font-medium">{selectedIds.length} selected</span>
          <Button size="sm" onClick={() => setAssignDialogOpen(true)}>
            <UserPlus className="w-4 h-4 mr-1" />
            Bulk Assign
          </Button>
          <Button size="sm" variant="outline" onClick={handleMarkPaid}>
            <Banknote className="w-4 h-4 mr-1" />
            Mark Paid
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])}>
            Clear
          </Button>
        </div>
      )}

      {/* Pagination Controls - Top */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-2 py-3 rounded-lg bg-muted/50">
        <div className="flex items-center gap-4">
          <div className="text-sm text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{startRecord.toLocaleString()}</span> - <span className="font-semibold text-foreground">{endRecord.toLocaleString()}</span> of <span className="font-semibold text-foreground">{totalCount.toLocaleString()}</span> records
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Rows per page:</span>
            <Select value={pageSize.toString()} onValueChange={handlePageSizeChange}>
              <SelectTrigger className="w-[80px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allowedPageSizes.map((size) => (
                  <SelectItem key={size} value={size.toString()}>
                    {size.toLocaleString()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigateToPage(1)}
            disabled={currentPage === 1}
          >
            <ChevronsLeft className="w-4 h-4" />
            First
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigateToPage(currentPage - 1)}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="w-4 h-4" />
            Prev
          </Button>
          <div className="flex items-center gap-2 px-2">
            <span className="text-sm text-muted-foreground">Page</span>
            <span className="font-semibold">{currentPage.toLocaleString()}</span>
            <span className="text-sm text-muted-foreground">of</span>
            <span className="font-semibold">{totalPages.toLocaleString()}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigateToPage(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigateToPage(totalPages)}
            disabled={currentPage === totalPages}
          >
            Last
            <ChevronsRight className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-1 ml-2 border-l pl-3">
            <span className="text-sm text-muted-foreground">Go to:</span>
            <Input
              type="number"
              min={1}
              max={totalPages}
              value={jumpToPage}
              onChange={(e) => setJumpToPage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJumpToPage()}
              className="w-[70px] h-8"
              placeholder={currentPage.toString()}
            />
            <Button variant="outline" size="sm" onClick={handleJumpToPage}>
              Go
            </Button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                <Checkbox
                  checked={selectedIds.length === deliveries.length && deliveries.length > 0}
                  onCheckedChange={handleSelectAll}
                />
              </TableHead>
              <TableHead>RTE</TableHead>
              <TableHead>Entry Date</TableHead>
              <TableHead>Delivery Date</TableHead>
              <TableHead>Index</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Contact</TableHead>
              <TableHead>Region</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Products</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead>SalesType</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead>Medium</TableHead>
              <TableHead>Rider</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Contractor</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={19} className="text-center py-8 text-muted-foreground">
                  No deliveries found
                </TableCell>
              </TableRow>
            ) : (
              deliveries.map((delivery) => (
                <TableRow key={delivery.id}>
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.includes(delivery.id)}
                      onCheckedChange={(checked) => handleSelectOne(delivery.id, !!checked)}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{delivery.rte || '-'}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {delivery.entry_date ? new Date(delivery.entry_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '-'}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {delivery.delivery_date ? new Date(delivery.delivery_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '-'}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{delivery.index_no || '-'}</TableCell>
                  <TableCell>
                    <div>
                      <p className="font-medium text-sm">{delivery.customer_name}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    <div>
                      <p>{delivery.contact_1 || '-'}</p>
                      {delivery.contact_2 && <p className="text-muted-foreground">{delivery.contact_2}</p>}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">{delivery.locality || '-'}</TableCell>
                  <TableCell className="text-center">{delivery.qty || 1}</TableCell>
                  <TableCell className="max-w-[120px] truncate text-xs" title={delivery.products || ''}>
                    {delivery.products || '-'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">Rs {Number(delivery.amount || 0).toLocaleString()}</TableCell>
              <TableCell className="text-xs">
                {delivery.payment_method === 'juice' ? 'Juice' :
                 delivery.payment_method === 'cash' ? 'Cash' :
                 delivery.payment_method === 'juice_to_rider' ? 'Juice To Rider' :
                 delivery.payment_method === 'bank' ? 'Bank' :
                 delivery.payment_method === 'already_paid' ? 'Pre-paid' :
                 delivery.payment_method || '-'}
              </TableCell>
              <TableCell className="text-xs">
                {delivery.sales_type ? (
                  <div>
                    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', SALES_TYPE_COLORS[delivery.sales_type as SalesType] || 'bg-muted text-muted-foreground')}>
                      {SALES_TYPE_LABELS[delivery.sales_type as SalesType] || delivery.sales_type}
                    </span>
                    {delivery.return_product && (
                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate max-w-[100px]" title={`Return: ${delivery.return_product}`}>
                        Return: {delivery.return_product}
                      </p>
                    )}
                  </div>
                ) : '-'}
              </TableCell>
              <TableCell className="max-w-[100px] truncate text-xs" title={delivery.notes || ''}>{delivery.notes || '-'}</TableCell>
              <TableCell className="text-xs">{delivery.medium || '-'}</TableCell>
                  <TableCell>
                    <Select
                      value={delivery.rider_id || 'unassigned'}
                      onValueChange={(v) => v !== 'unassigned' && handleAssign(delivery.id, v)}
                      disabled={loading === delivery.id}
                    >
                      <SelectTrigger className="w-[120px] h-8 text-xs">
                        <SelectValue placeholder="Assign..." />
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
                  <TableCell>
                    <Select
                      value={delivery.status}
                      onValueChange={(v) => handleStatusChange(delivery.id, v as DeliveryStatus)}
                      disabled={loading === delivery.id}
                    >
                      <SelectTrigger className="w-[110px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(STATUS_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-xs">
                    {delivery.contractor_id
                      ? contractors.find(c => c.id === delivery.contractor_id)?.name || '-'
                      : '-'}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" disabled={loading === delivery.id} className="h-8 w-8">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleDelete(delivery.id)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination Controls - Bottom */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-2 py-3 rounded-lg bg-muted/50">
        <div className="text-sm text-muted-foreground">
          Page <span className="font-semibold text-foreground">{currentPage.toLocaleString()}</span> of <span className="font-semibold text-foreground">{totalPages.toLocaleString()}</span> ({totalCount.toLocaleString()} total records)
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigateToPage(1)} disabled={currentPage === 1}>
            <ChevronsLeft className="w-4 h-4" /> First
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigateToPage(currentPage - 1)} disabled={currentPage === 1}>
            <ChevronLeft className="w-4 h-4" /> Prev
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigateToPage(currentPage + 1)} disabled={currentPage === totalPages}>
            Next <ChevronRight className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigateToPage(totalPages)} disabled={currentPage === totalPages}>
            Last <ChevronsRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Bulk Assign Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Assign Deliveries</DialogTitle>
            <DialogDescription>
              Assign {selectedIds.length} deliveries to a rider
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Select value={selectedRider} onValueChange={setSelectedRider}>
              <SelectTrigger>
                <SelectValue placeholder="Select a rider" />
              </SelectTrigger>
              <SelectContent>
                {riders.map((rider) => (
                  <SelectItem key={rider.id} value={rider.id}>
                    {rider.name || rider.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkAssign} disabled={!selectedRider || bulkAssigning}>
              {bulkAssigning ? 'Assigning...' : 'Assign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
