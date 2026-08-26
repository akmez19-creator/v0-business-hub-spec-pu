'use client'

import { Fragment, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { assignDelivery, deleteDelivery, updateDeliveryStatus, bulkAssignDeliveries, bulkUpdateDeliveryDate, markRiderPaid, updateDeliveryPrice, updateDeliveryFields } from '@/lib/delivery-actions'
import type { Delivery, Profile, Rider, DeliveryStatus, SalesType } from '@/lib/types'
import { STATUS_LABELS, SALES_TYPE_LABELS, SALES_TYPE_COLORS } from '@/lib/types'
import { isPendingReattempt, staysOnVan } from '@/lib/reschedule-stock'
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
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { MoreHorizontal, Trash2, UserPlus, CheckCircle, Clock, Package, Banknote, CalendarDays, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Edit } from 'lucide-react'
import { DeliveryDateCell } from '@/components/deliveries/delivery-date-cell'

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
  const [dateDialogOpen, setDateDialogOpen] = useState(false)
  const [bulkDate, setBulkDate] = useState('')
  const [bulkDateSaving, setBulkDateSaving] = useState(false)
  const [loading, setLoading] = useState<string | null>(null)
  const [jumpToPage, setJumpToPage] = useState('')
  const [editPriceDelivery, setEditPriceDelivery] = useState<Delivery | null>(null)
  const [editPriceValue, setEditPriceValue] = useState('')
  const [editDelivery, setEditDelivery] = useState<Delivery | null>(null)
  const [editForm, setEditForm] = useState({
    delivery_date: '',
    contact_1: '',
    contact_2: '',
    locality: '',
    products: '',
    qty: '1',
    notes: '',
  })
  const [savingEdit, setSavingEdit] = useState(false)
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

  async function handleBulkDate() {
    if (!bulkDate || selectedIds.length === 0) return
    setBulkDateSaving(true)
    const result = await bulkUpdateDeliveryDate(selectedIds, bulkDate)
    setBulkDateSaving(false)
    if (!result?.error) {
      setDateDialogOpen(false)
      setBulkDate('')
      setSelectedIds([])
      router.refresh()
    }
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

  function openEditPrice(delivery: Delivery) {
    setEditPriceDelivery(delivery)
    setEditPriceValue(String(delivery.amount || 0))
  }

  function openEdit(delivery: Delivery) {
    setEditDelivery(delivery)
    setEditForm({
      // date input wants yyyy-mm-dd
      delivery_date: delivery.delivery_date ? String(delivery.delivery_date).slice(0, 10) : '',
      contact_1: delivery.contact_1 || '',
      contact_2: delivery.contact_2 || '',
      locality: delivery.locality || '',
      products: delivery.products || '',
      qty: String(delivery.qty || 1),
      notes: delivery.notes || '',
    })
  }

  async function handleEditSave() {
    if (!editDelivery) return
    setSavingEdit(true)
    try {
      const result = await updateDeliveryFields(editDelivery.id, {
        delivery_date: editForm.delivery_date || null,
        contact_1: editForm.contact_1.trim() || null,
        contact_2: editForm.contact_2.trim() || null,
        locality: editForm.locality.trim() || null,
        products: editForm.products.trim() || null,
        qty: parseInt(editForm.qty, 10) || 1,
        notes: editForm.notes.trim() || null,
      })
      if (result?.error) {
        alert(result.error)
      } else {
        setEditDelivery(null)
        router.refresh()
      }
    } catch (error) {
      console.error('[v0] Edit delivery error:', error)
      alert('Failed to update delivery. Please try again.')
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleEditPrice() {
    if (!editPriceDelivery) return
    const newPrice = parseFloat(editPriceValue)
    if (isNaN(newPrice) || newPrice < 0) {
      alert('Please enter a valid price')
      return
    }
    setLoading(editPriceDelivery.id)
    try {
      console.log('[v0] Calling updateDeliveryPrice', editPriceDelivery.id, newPrice)
      const result = await updateDeliveryPrice(editPriceDelivery.id, newPrice)
      console.log('[v0] updateDeliveryPrice result:', result)
      if (result.error) {
        alert(result.error)
      } else {
        setEditPriceDelivery(null)
        setEditPriceValue('')
        router.refresh()
      }
    } catch (error) {
      console.error('[v0] Edit price error:', error)
      alert('Failed to update price. Please try again.')
    } finally {
      setLoading(null)
    }
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
          <Button size="sm" variant="outline" onClick={() => setDateDialogOpen(true)}>
            <CalendarDays className="w-4 h-4 mr-1" />
            Set Delivery Date
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
              <TableHead className="w-[84px]">Order ID</TableHead>
              <TableHead className="w-[60px]">RTE</TableHead>
              <TableHead className="w-[72px]">Entry Date</TableHead>
              <TableHead className="w-[90px]">Agent</TableHead>
              <TableHead className="w-[110px]">Delivery Date</TableHead>
              <TableHead className="w-[52px]">Index</TableHead>
              <TableHead className="min-w-[140px] max-w-[200px]">Customer</TableHead>
              <TableHead className="w-[90px]">Contact</TableHead>
              <TableHead className="min-w-[110px] max-w-[160px]">Region</TableHead>
              <TableHead className="w-[42px] text-center">Qty</TableHead>
              <TableHead className="min-w-[130px] max-w-[180px]">Products</TableHead>
              <TableHead className="w-[85px] text-right">Amount</TableHead>
              <TableHead className="w-[80px]">Payment</TableHead>
              <TableHead className="w-[90px]">SalesType</TableHead>
              <TableHead className="w-[90px]">Notes</TableHead>
              <TableHead className="w-[64px]">Medium</TableHead>
              <TableHead className="w-[130px]">Rider</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead className="w-[90px]">Contractor</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={20} className="text-center py-8 text-muted-foreground">
                  No deliveries found
                </TableCell>
              </TableRow>
            ) : (
              deliveries.map((delivery) => (
                <Fragment key={delivery.id}>
                {/* THE ATTEMPT THAT FAILED, PRESERVED AS ITS OWN ROW.
                    One `status` column cannot describe two days, which is why
                    CMS kept resurfacing on the new date. So a rescheduled order
                    now shows TWO lines sharing one Order ID: this one records
                    what happened on the original day and keeps its CMS, and the
                    live row below carries the new date.
                    It is deliberately read-only - no checkbox, no status
                    dropdown, no actions - because `deliveries` is still ONE row
                    underneath. It is the unit of money and of the client's order
                    count, so a real second row would double the amount, double
                    the rating through `deliveries_rating_sync`, and trip the
                    duplicate-order detector. The durable per-attempt history
                    lives in the `delivery_attempts` table. */}
                {isPendingReattempt(delivery) && (
                  <TableRow className="bg-muted/10 text-muted-foreground border-l-2 border-l-muted">
                    <TableCell />
                    <TableCell className="font-mono text-[11px] whitespace-nowrap">{delivery.order_code || '-'}</TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell className="text-xs whitespace-nowrap">
                      <span className="line-through">
                        {/* `delivery_date` is nullable in the schema, so it must
                            be guarded before Date() - a null here would render
                            "Invalid Date" on the row. */}
                        {delivery.delivery_date
                          ? new Date(delivery.delivery_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
                          : '-'}
                      </span>
                    </TableCell>
                    <TableCell colSpan={11} className="text-xs italic">
                      Attempt 1 - not delivered on this day
                      {delivery.reschedule_reason ? `: ${delivery.reschedule_reason}` : ''}
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap">
                      {riders.find(r => r.id === delivery.rider_id)?.name || '-'}
                    </TableCell>
                    <TableCell>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/15 text-red-400">
                        {STATUS_LABELS[delivery.status] || delivery.status}
                      </span>
                    </TableCell>
                    <TableCell />
                    <TableCell />
                  </TableRow>
                )}
                <TableRow className="odd:bg-muted/30 hover:bg-muted/50">
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.includes(delivery.id)}
                      onCheckedChange={(checked) => handleSelectOne(delivery.id, !!checked)}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-[11px] whitespace-nowrap">{delivery.order_code || '-'}</TableCell>
                  <TableCell className="font-mono text-xs">{delivery.rte || '-'}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    <div>
                      <p>{delivery.entry_date ? new Date(delivery.entry_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '-'}</p>
                      {delivery.created_at && (
                        <p className="text-muted-foreground">
                          {new Date(delivery.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {delivery.agent_name || '-'}
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    <DeliveryDateCell
                      deliveryDate={delivery.delivery_date}
                      rescheduledTo={delivery.rescheduled_to}
                      requestedTo={delivery.reschedule_requested_to}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{delivery.index_no || '-'}</TableCell>
                  <TableCell className="max-w-[200px]">
                    <p className="font-medium text-sm truncate" title={delivery.customer_name}>{delivery.customer_name}</p>
                  </TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    <div>
                      <p>{delivery.contact_1 || '-'}</p>
                      {delivery.contact_2 && <p className="text-muted-foreground">{delivery.contact_2}</p>}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate text-xs" title={delivery.locality || ''}>{delivery.locality || '-'}</TableCell>
                  <TableCell className="text-center font-medium">{delivery.qty || 1}</TableCell>
                  <TableCell className="max-w-[180px] truncate text-xs" title={delivery.products || ''}>
                    {delivery.products || '-'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">Rs {Number(delivery.amount || 0).toLocaleString()}</TableCell>
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
                            {rider.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1 items-start">
                      <Select
                        value={delivery.status}
                        onValueChange={(v) => handleStatusChange(delivery.id, v as DeliveryStatus)}
                        disabled={loading === delivery.id}
                      >
                        <SelectTrigger className="w-[110px] h-8 text-xs">
                          {/* SHOW "Rescheduled", NOT THE STALE CMS.
                              `status` records how the LAST attempt ended, and on
                              a rescheduled row that attempt is over - so the
                              cell was describing a day that has passed while the
                              order is live again for the new date.
                              Only the LABEL is overridden. `value` is still the
                              real stored status, so opening the dropdown shows
                              the true current value and picking an option writes
                              exactly what it says: this cannot write one thing
                              while showing another. The stored 'cms' also has to
                              survive untouched because `incomingToStore()` only
                              returns the original day's stock while status is
                              EXACTLY 'cms'. */}
                          {isPendingReattempt(delivery)
                            ? <span className="text-primary">Rescheduled</span>
                            : <SelectValue />}
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(STATUS_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* WHERE THE GOODS ARE - the thing that decides whether
                          anyone has to hand stock out again, and which no other
                          column in this table states. */}
                      {isPendingReattempt(delivery) && (
                        <span
                          className={cn(
                            'px-1.5 py-0.5 rounded text-[9px] font-semibold leading-none whitespace-nowrap',
                            staysOnVan(delivery)
                              ? 'bg-violet-500/15 text-violet-400'
                              : 'bg-amber-500/15 text-amber-500'
                          )}
                          title={
                            staysOnVan(delivery)
                              ? 'Rider still has these goods - nothing to issue again'
                              : 'Goods are in the store - issue them on the new date'
                          }
                        >
                          {staysOnVan(delivery) ? 'with rider' : 'issue from store'}
                        </span>
                      )}
                    </div>
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
                        <DropdownMenuItem onClick={() => openEdit(delivery)}>
                          <Edit className="w-4 h-4 mr-2" />
                          Edit Delivery
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openEditPrice(delivery)}>
                          <Banknote className="w-4 h-4 mr-2" />
                          Edit Price
                        </DropdownMenuItem>
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
                </Fragment>
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
                    {rider.name}
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

      {/* Bulk Delivery Date Dialog */}
      <Dialog open={dateDialogOpen} onOpenChange={setDateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Delivery Date</DialogTitle>
            <DialogDescription>
              Change the delivery date for {selectedIds.length} selected {selectedIds.length === 1 ? 'delivery' : 'deliveries'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Label htmlFor="bulk-delivery-date">New delivery date</Label>
            <Input
              id="bulk-delivery-date"
              type="date"
              value={bulkDate}
              onChange={(e) => setBulkDate(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkDate} disabled={!bulkDate || bulkDateSaving}>
              {bulkDateSaving ? 'Updating...' : `Update ${selectedIds.length} ${selectedIds.length === 1 ? 'delivery' : 'deliveries'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Price Dialog */}
      <Dialog open={!!editPriceDelivery} onOpenChange={(open) => !open && setEditPriceDelivery(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Price</DialogTitle>
            <DialogDescription>
              Update the price for {editPriceDelivery?.customer_name}&apos;s delivery
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Current Price</p>
              <p className="text-muted-foreground">Rs {Number(editPriceDelivery?.amount || 0).toLocaleString()}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">New Price (Rs)</p>
              <Input
                type="number"
                min={0}
                value={editPriceValue}
                onChange={(e) => setEditPriceValue(e.target.value)}
                placeholder="Enter new price"
              />
            </div>
            {editPriceDelivery?.products && (
              <div className="text-xs text-muted-foreground">
                Product: {editPriceDelivery.products}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPriceDelivery(null)}>
              Cancel
            </Button>
            <Button onClick={handleEditPrice} disabled={loading === editPriceDelivery?.id}>
              {loading === editPriceDelivery?.id ? 'Saving...' : 'Save Price'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Delivery Dialog */}
      <Dialog open={!!editDelivery} onOpenChange={(open) => !open && setEditDelivery(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Delivery</DialogTitle>
            <DialogDescription>
              Update the delivery date, contact, products and notes for {editDelivery?.customer_name}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-date">Delivery Date</Label>
                <Input
                  id="edit-date"
                  type="date"
                  value={editForm.delivery_date}
                  onChange={(e) => setEditForm({ ...editForm, delivery_date: e.target.value })}
                  aria-describedby={editDelivery?.rescheduled_to ? 'edit-date-resched' : undefined}
                />
                {/* Editing this field was completely blind to a reschedule:
                    this box holds the day the goods WENT OUT, but the order may
                    already be due on another day, and overwriting it silently
                    re-dates the van stock and returns that hang off it. */}
                {editDelivery?.rescheduled_to &&
                  editDelivery.rescheduled_to !== editDelivery.delivery_date && (
                    <p id="edit-date-resched" className="text-xs text-amber-600">
                      Already rescheduled to{' '}
                      <span className="font-medium">
                        {new Date(editDelivery.rescheduled_to).toLocaleDateString('en-GB', {
                          weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
                        })}
                      </span>
                      . This box is the day it went out - change it only to correct a mistake,
                      not to move the delivery.
                    </p>
                  )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-qty">Qty</Label>
                <Input
                  id="edit-qty"
                  type="number"
                  min={1}
                  value={editForm.qty}
                  onChange={(e) => setEditForm({ ...editForm, qty: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-c1">Contact 1</Label>
                <Input
                  id="edit-c1"
                  value={editForm.contact_1}
                  onChange={(e) => setEditForm({ ...editForm, contact_1: e.target.value })}
                  placeholder="Primary phone"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-c2">Contact 2</Label>
                <Input
                  id="edit-c2"
                  value={editForm.contact_2}
                  onChange={(e) => setEditForm({ ...editForm, contact_2: e.target.value })}
                  placeholder="Optional"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-region">Region</Label>
              <Input
                id="edit-region"
                value={editForm.locality}
                onChange={(e) => setEditForm({ ...editForm, locality: e.target.value })}
                placeholder="Locality / region"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-products">Products</Label>
              <Textarea
                id="edit-products"
                rows={2}
                value={editForm.products}
                onChange={(e) => setEditForm({ ...editForm, products: e.target.value })}
                placeholder="e.g. Nose Patch, Tile Filler"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-notes">Notes</Label>
              <Textarea
                id="edit-notes"
                rows={2}
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                placeholder="Delivery notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDelivery(null)}>
              Cancel
            </Button>
            <Button onClick={handleEditSave} disabled={savingEdit}>
              {savingEdit ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
