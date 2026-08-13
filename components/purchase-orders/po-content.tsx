'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import * as XLSX from 'xlsx'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import {
  Package,
  Search,
  Upload,
  ExternalLink,
  TruckIcon,
  DollarSign,
  BoxesIcon,
  Filter,
  Download,
  Trash2,
  Loader2,
  FileSpreadsheet,
  ChevronDown,
} from 'lucide-react'
import { POImportDialog } from './po-import-dialog'

interface PurchaseOrder {
  id: string
  status: string | null
  reorder: string | null
  link: string | null
  supplier_name: string | null
  index_no: string | null
  carton: string | null
  image_url: string | null
  product_name: string | null
  product_id: string | null
  products?: { id: string; name: string; image_url: string | null } | null
  qty: number
  unit_price: number
  discounted_unit_price: number
  shipment_to_warehouse: number
  discounted_shipment_to_warehouse: number
  discounted_percentage: number
  total_payment_supplier_yuan: number
  total_payment_supplier: number
  payment_link: string | null
  weight_kg: number
  cbm: number
  boxes: number
  cbm_cost: number
  import_cp: number
  total_cp_import: number
  tracking_number: string | null
  batch_id: string | null
  created_at: string
}

interface Stats {
  totalOrders: number
  totalQty: number
  totalValue: number
  byStatus: Record<string, number>
}

function statusColor(status: string | null): string {
  switch (status?.toLowerCase()) {
    case 'ordered':
    case 'confirmed': return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    case 'shipped':
    case 'in transit': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    case 'delivered':
    case 'received': return 'bg-green-500/20 text-green-400 border-green-500/30'
    case 'pending': return 'bg-muted text-muted-foreground border-border'
    case 'cancelled': return 'bg-red-500/20 text-red-400 border-red-500/30'
    default: return 'bg-muted text-muted-foreground border-border'
  }
}

function formatCurrency(value: number, currency = 'Rs') {
  if (!value) return '-'
  return `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Export headers deliberately mirror the import column aliases (see
// PO_COLUMN_ALIASES in po-import-dialog) so an exported file re-imports cleanly.
function orderToExportRow(o: PurchaseOrder): Record<string, string | number> {
  return {
    'Status': o.status || 'pending',
    'Reorder': o.reorder || '',
    'Link': o.link || '',
    'Supplier Name': o.supplier_name || '',
    'Index': o.index_no || '',
    'Carton': o.carton || '',
    'Product Name': o.product_name || '',
    'Inventory Match': o.products?.name || '',
    'Qty': o.qty || 0,
    'Unit Price': o.unit_price || 0,
    'Discounted Unit Price': o.discounted_unit_price || 0,
    'Shipment To Warehouse': o.shipment_to_warehouse || 0,
    'Discounted Shipment To Warehouse': o.discounted_shipment_to_warehouse || 0,
    'Discounted Percentage': o.discounted_percentage || 0,
    'Total Payment To Supplier Yuan': o.total_payment_supplier_yuan || 0,
    'Total Payment To Supplier': o.total_payment_supplier || 0,
    'Payment Link': o.payment_link || '',
    'Weight (kg)': o.weight_kg || 0,
    'CBM': o.cbm || 0,
    'Boxes': o.boxes || 0,
    'CBM Cost': o.cbm_cost || 0,
    'Import CP': o.import_cp || 0,
    'Total CP Import': o.total_cp_import || 0,
    'Tracking Number': o.tracking_number || '',
  }
}

// A single illustrative row rendered when the table is completely empty, so the
// expected import format (columns, units, sign of the discount, etc.) is clear.
const EXAMPLE_ORDER: PurchaseOrder = {
  id: 'example',
  status: 'Received',
  reorder: null,
  link: 'https://detail.1688.com/...',
  supplier_name: '晟瑞塑料制品有限公司',
  index_no: 'A-01',
  carton: null,
  image_url: null,
  product_name: 'Rabbit Foot Rub',
  product_id: null,
  products: { id: 'x', name: 'Rub Foot Rabbit', image_url: null },
  qty: 500,
  unit_price: 5.5,
  discounted_unit_price: 5.2,
  shipment_to_warehouse: 715,
  discounted_shipment_to_warehouse: 0,
  discounted_percentage: -5.45,
  total_payment_supplier_yuan: 2820,
  total_payment_supplier: 23763.38,
  payment_link: null,
  weight_kg: 190,
  cbm: 0.397,
  boxes: 10,
  cbm_cost: 0,
  import_cp: 47.53,
  total_cp_import: 23763.38,
  tracking_number: '300637638892',
  batch_id: null,
  created_at: new Date().toISOString(),
}

function OrderRow({ order, example = false }: { order: PurchaseOrder; example?: boolean }) {
  return (
    <TableRow className={example ? 'opacity-60 italic pointer-events-none' : undefined}>
      <TableCell>
        <Badge variant="outline" className={statusColor(order.status)}>
          {order.status || 'pending'}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {(order.products?.image_url || order.image_url) && (
            <img
              src={order.products?.image_url || order.image_url || ''}
              alt=""
              className="w-8 h-8 rounded object-cover"
            />
          )}
          <span className="font-medium truncate max-w-[150px]">
            {order.product_name || '-'}
          </span>
        </div>
      </TableCell>
      <TableCell>
        {order.products ? (
          <Badge variant="secondary" className="text-xs truncate max-w-[100px]">
            {order.products.name}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">Unmatched</span>
        )}
      </TableCell>
      <TableCell className="truncate max-w-[140px]">{order.supplier_name || '-'}</TableCell>
      <TableCell className="text-right font-medium">{order.qty || 0}</TableCell>
      <TableCell className="text-right">{formatCurrency(order.unit_price)}</TableCell>
      <TableCell className="text-right">{formatCurrency(order.discounted_unit_price)}</TableCell>
      <TableCell className="text-right">{formatCurrency(order.shipment_to_warehouse)}</TableCell>
      <TableCell className="text-right">{order.discounted_percentage ? `${order.discounted_percentage}%` : '-'}</TableCell>
      <TableCell className="text-right">{order.total_payment_supplier_yuan ? `¥ ${Number(order.total_payment_supplier_yuan).toLocaleString()}` : '-'}</TableCell>
      <TableCell className="text-right font-medium">{formatCurrency(order.total_payment_supplier)}</TableCell>
      <TableCell className="text-right">{order.weight_kg ? `${order.weight_kg} kg` : '-'}</TableCell>
      <TableCell className="text-right">{order.cbm || '-'}</TableCell>
      <TableCell className="text-right">{order.boxes || '-'}</TableCell>
      <TableCell className="text-right">{formatCurrency(order.import_cp)}</TableCell>
      <TableCell className="text-right font-medium">{formatCurrency(order.total_cp_import)}</TableCell>
      <TableCell>
        <span className="truncate max-w-[120px] text-xs font-mono">
          {order.tracking_number || '-'}
        </span>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          {order.link && (
            <a href={order.link} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          {order.payment_link && (
            <a href={order.payment_link} target="_blank" rel="noopener noreferrer" className="text-green-500 hover:underline">
              <DollarSign className="w-4 h-4" />
            </a>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

export function PurchaseOrdersContent({
  initialOrders,
  stats,
  suppliers,
}: {
  initialOrders: PurchaseOrder[]
  stats: Stats
  suppliers: string[]
}) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [supplierFilter, setSupplierFilter] = useState<string>('all')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const allStatuses = useMemo(() => {
    const set = new Set<string>()
    for (const o of initialOrders) {
      if (o.status) set.add(o.status)
    }
    return [...set].sort()
  }, [initialOrders])

  const filtered = useMemo(() => {
    return initialOrders.filter(o => {
      if (statusFilter !== 'all' && o.status !== statusFilter) return false
      if (supplierFilter !== 'all' && o.supplier_name !== supplierFilter) return false
      if (search) {
        const q = search.toLowerCase()
        const matchesProduct = o.product_name?.toLowerCase().includes(q)
        const matchesSupplier = o.supplier_name?.toLowerCase().includes(q)
        const matchesTracking = o.tracking_number?.toLowerCase().includes(q)
        const matchesIndex = o.index_no?.toLowerCase().includes(q)
        const matchesInventory = o.products?.name?.toLowerCase().includes(q)
        if (!matchesProduct && !matchesSupplier && !matchesTracking && !matchesIndex && !matchesInventory) return false
      }
      return true
    })
  }, [initialOrders, statusFilter, supplierFilter, search])

  function handleExport(format: 'xlsx' | 'csv') {
    // When there is nothing to export, fall back to the example row so the user
    // can still download a correctly-formatted template to fill in and re-import.
    const isTemplate = filtered.length === 0
    const rows = (isTemplate ? [EXAMPLE_ORDER] : filtered).map(orderToExportRow)
    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Purchase Orders')
    const stamp = new Date().toISOString().slice(0, 10)
    const name = isTemplate ? `purchase-orders-template-${stamp}` : `purchase-orders-${stamp}`
    XLSX.writeFile(workbook, `${name}.${format}`, { bookType: format })
  }

  async function handleDeleteAll() {
    setDeleting(true)
    setDeleteError(null)
    try {
      const supabase = createClient()
      // Supabase requires a filter on delete; match every row via non-null id.
      const { error } = await supabase
        .from('purchase_orders')
        .delete()
        .not('id', 'is', null)
      if (error) {
        setDeleteError(error.message)
        setDeleting(false)
        return
      }
      setDeleteOpen(false)
      setDeleting(false)
      startTransition(() => router.refresh())
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete orders')
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Purchase Orders</h2>
          <p className="text-muted-foreground">Manage and track supplier purchase orders</p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Download className="w-4 h-4 mr-2" />
                {filtered.length === 0 ? 'Download Template' : 'Export'}
                <ChevronDown className="w-4 h-4 ml-2 opacity-70" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExport('xlsx')}>
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                {filtered.length === 0
                  ? 'Template as Excel'
                  : `Export as Excel (${filtered.length})`}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('csv')}>
                <FileSpreadsheet className="w-4 h-4 mr-2" />
                {filtered.length === 0
                  ? 'Template as CSV'
                  : `Export as CSV (${filtered.length})`}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {initialOrders.length > 0 && (
            <Button
              variant="outline"
              className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              onClick={() => { setDeleteError(null); setDeleteOpen(true) }}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete All
            </Button>
          )}
          <POImportDialog>
            <Button>
              <Upload className="w-4 h-4 mr-2" />
              Import PO Excel
            </Button>
          </POImportDialog>
        </div>
      </div>

      {/* Delete-all confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={(o) => { if (!deleting) setDeleteOpen(o) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all purchase orders?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes all <strong>{initialOrders.length}</strong> purchase
              orders. This action cannot be undone. Export a backup first if you may need
              this data later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-md p-2">
              {deleteError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleDeleteAll() }}
              disabled={deleting}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {deleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>Delete all {initialOrders.length}</>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
            <BoxesIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalOrders.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Qty</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalQty.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Value</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.totalValue)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Suppliers</CardTitle>
            <TruckIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{suppliers.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Status badges */}
      {Object.keys(stats.byStatus).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(stats.byStatus).map(([status, count]) => (
            <Badge key={status} variant="outline" className={statusColor(status)}>
              {status}: {count}
            </Badge>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search product, supplier, tracking..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]">
            <Filter className="w-4 h-4 mr-2" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {allStatuses.map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={supplierFilter} onValueChange={setSupplierFilter}>
          <SelectTrigger className="w-[180px]">
            <TruckIcon className="w-4 h-4 mr-2" />
            <SelectValue placeholder="Supplier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Suppliers</SelectItem>
            {suppliers.map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="secondary" className="ml-auto">
          {filtered.length} / {initialOrders.length} orders
        </Badge>
      </div>

      {/* Table */}
      <Card>
        <ScrollArea className="w-full">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[60px]">Status</TableHead>
                <TableHead className="min-w-[180px]">Product</TableHead>
                <TableHead className="min-w-[100px]">Inventory Match</TableHead>
                <TableHead className="min-w-[140px]">Supplier</TableHead>
                <TableHead className="min-w-[50px] text-right">Qty</TableHead>
                <TableHead className="min-w-[100px] text-right">Unit Price</TableHead>
                <TableHead className="min-w-[100px] text-right">Disc. Price</TableHead>
                <TableHead className="min-w-[100px] text-right">Shipment</TableHead>
                <TableHead className="min-w-[80px] text-right">Disc %</TableHead>
                <TableHead className="min-w-[120px] text-right">Total (Yuan)</TableHead>
                <TableHead className="min-w-[120px] text-right">Total Supplier</TableHead>
                <TableHead className="min-w-[80px] text-right">Weight</TableHead>
                <TableHead className="min-w-[60px] text-right">CBM</TableHead>
                <TableHead className="min-w-[60px] text-right">Boxes</TableHead>
                <TableHead className="min-w-[100px] text-right">Import CP</TableHead>
                <TableHead className="min-w-[100px] text-right">Total CP</TableHead>
                <TableHead className="min-w-[140px]">Tracking</TableHead>
                <TableHead className="min-w-[60px]">Links</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialOrders.length === 0 ? (
                <>
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={18} className="py-4 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <Package className="w-8 h-8 opacity-50" />
                        <p className="font-medium text-foreground">No purchase orders yet</p>
                        <p className="text-sm text-muted-foreground">
                          Import an Excel file to get started. The row below is an{' '}
                          <span className="font-medium text-foreground">example</span> showing
                          the expected format.
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={18} className="py-1 pl-2">
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wide text-muted-foreground border-dashed">
                        Example row
                      </Badge>
                    </TableCell>
                  </TableRow>
                  <OrderRow order={EXAMPLE_ORDER} example />
                </>
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={18} className="text-center py-12 text-muted-foreground">
                    <Search className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p>No orders match your filters.</p>
                    <p className="text-sm">Try clearing the search or status/supplier filters.</p>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((order) => (
                  <OrderRow key={order.id} order={order} />
                ))
              )}
            </TableBody>
          </Table>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </Card>
    </div>
  )
}
