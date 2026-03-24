'use client'

import { useState, useMemo } from 'react'
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

export function PurchaseOrdersContent({
  initialOrders,
  stats,
  suppliers,
}: {
  initialOrders: PurchaseOrder[]
  stats: Stats
  suppliers: string[]
}) {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [supplierFilter, setSupplierFilter] = useState<string>('all')

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Purchase Orders</h2>
          <p className="text-muted-foreground">Manage and track supplier purchase orders</p>
        </div>
        <POImportDialog>
          <Button>
            <Upload className="w-4 h-4 mr-2" />
            Import PO Excel
          </Button>
        </POImportDialog>
      </div>

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
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={18} className="text-center py-12 text-muted-foreground">
                    <Package className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p>No purchase orders found.</p>
                    <p className="text-sm">Import an Excel file to get started.</p>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((order) => (
                  <TableRow key={order.id}>
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
