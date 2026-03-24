'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
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
  Package,
  Truck,
  RotateCcw,
  AlertTriangle,
  Search,
  Plus,
  Calendar,
  Bike,
  ArrowRight,
  History,
} from 'lucide-react'
import { useRouter } from 'next/navigation'

interface Rider {
  id: string
  name: string
  phone: string | null
  contractor_id: string | null
  contractors: { id: string; name: string } | null
}

interface RiderStock {
  id: string
  rider_id: string
  stock_date: string
  opening_stock: number
  stock_received: number
  delivered: number
  returns: number
  defective: number
  in_transit: number
  closing_stock: number
  notes: string | null
}

interface StockMovement {
  id: string
  rider_id: string
  movement_type: string
  quantity: number
  description: string | null
  movement_date: string
  created_at: string
  riders: { name: string } | null
}

interface Totals {
  openingStock: number
  inTransit: number
  delivered: number
  returns: number
  defective: number
}

interface StockOverviewProps {
  riders: Rider[]
  riderStockMap: Record<string, RiderStock>
  recentMovements: StockMovement[]
  todayDate: string
  totals: Totals
}

export function StockOverview({
  riders,
  riderStockMap,
  recentMovements,
  todayDate,
  totals,
}: StockOverviewProps) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [stockDialog, setStockDialog] = useState<string | null>(null)
  const [movementDialog, setMovementDialog] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [selectedDate, setSelectedDate] = useState(todayDate)

  // Form states
  const [openingStock, setOpeningStock] = useState('')
  const [stockReceived, setStockReceived] = useState('')
  const [returns, setReturns] = useState('')
  const [defective, setDefective] = useState('')
  const [inTransit, setInTransit] = useState('')
  const [notes, setNotes] = useState('')

  const [movementType, setMovementType] = useState<string>('received')
  const [movementQty, setMovementQty] = useState('')
  const [movementDesc, setMovementDesc] = useState('')

  const filteredRiders = riders.filter(r => 
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.contractors?.name?.toLowerCase().includes(search.toLowerCase())
  )

  // Open stock dialog
  function openStockEdit(riderId: string) {
    const stock = riderStockMap[riderId]
    setOpeningStock(stock?.opening_stock?.toString() || '0')
    setStockReceived(stock?.stock_received?.toString() || '0')
    setReturns(stock?.returns?.toString() || '0')
    setDefective(stock?.defective?.toString() || '0')
    setInTransit(stock?.in_transit?.toString() || '0')
    setNotes(stock?.notes || '')
    setStockDialog(riderId)
  }

  // Save stock
  async function saveStock() {
    if (!stockDialog) return
    setSaving(true)

    const supabase = createClient()
    
    const opening = Number(openingStock) || 0
    const received = Number(stockReceived) || 0
    const ret = Number(returns) || 0
    const def = Number(defective) || 0
    const transit = Number(inTransit) || 0

    // Calculate closing stock
    // Closing = Opening + Received - Returns - Defective - In Transit
    const closing = opening + received - ret - def - transit

    await supabase
      .from('rider_stock')
      .upsert({
        rider_id: stockDialog,
        stock_date: selectedDate,
        opening_stock: opening,
        stock_received: received,
        returns: ret,
        defective: def,
        in_transit: transit,
        closing_stock: closing,
        notes: notes || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'rider_id,stock_date' })

    setSaving(false)
    setStockDialog(null)
    router.refresh()
  }

  // Add stock movement
  async function addMovement() {
    if (!movementDialog || !movementQty) return
    setSaving(true)

    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()

    await supabase
      .from('stock_movements')
      .insert({
        rider_id: movementDialog,
        movement_type: movementType,
        quantity: Number(movementQty),
        description: movementDesc || null,
        movement_date: selectedDate,
        created_by: user?.id
      })

    // Also update rider_stock table
    const stock = riderStockMap[movementDialog]
    if (stock) {
      const updates: Record<string, number> = {}
      if (movementType === 'received') {
        updates.stock_received = (stock.stock_received || 0) + Number(movementQty)
      } else if (movementType === 'return') {
        updates.returns = (stock.returns || 0) + Number(movementQty)
      } else if (movementType === 'defective') {
        updates.defective = (stock.defective || 0) + Number(movementQty)
      } else if (movementType === 'delivered') {
        updates.delivered = (stock.delivered || 0) + Number(movementQty)
      }

      if (Object.keys(updates).length > 0) {
        await supabase
          .from('rider_stock')
          .update({ ...updates, updated_at: new Date().toISOString() })
          .eq('id', stock.id)
      }
    }

    setSaving(false)
    setMovementDialog(null)
    setMovementQty('')
    setMovementDesc('')
    router.refresh()
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-blue-100">
                <Package className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Opening Stock</p>
                <p className="text-xl font-bold">{totals.openingStock}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-amber-100">
                <Truck className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">In Transit</p>
                <p className="text-xl font-bold">{totals.inTransit}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-green-100">
                <Package className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Delivered</p>
                <p className="text-xl font-bold">{totals.delivered}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-orange-100">
                <RotateCcw className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Returns</p>
                <p className="text-xl font-bold">{totals.returns}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-red-100">
                <AlertTriangle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Defective</p>
                <p className="text-xl font-bold">{totals.defective}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search riders..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <Input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-auto"
          />
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="stock">
        <TabsList>
          <TabsTrigger value="stock" className="gap-2">
            <Package className="w-4 h-4" />
            Daily Stock
          </TabsTrigger>
          <TabsTrigger value="movements" className="gap-2">
            <History className="w-4 h-4" />
            Stock Movements
          </TabsTrigger>
        </TabsList>

        {/* Stock Tab */}
        <TabsContent value="stock" className="mt-4">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rider</TableHead>
                  <TableHead className="text-center">Opening</TableHead>
                  <TableHead className="text-center">Received</TableHead>
                  <TableHead className="text-center">In Transit</TableHead>
                  <TableHead className="text-center">Delivered</TableHead>
                  <TableHead className="text-center">Returns</TableHead>
                  <TableHead className="text-center">Defective</TableHead>
                  <TableHead className="text-center">Closing</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRiders.map((rider) => {
                  const stock = riderStockMap[rider.id]
                  return (
                    <TableRow key={rider.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Bike className="w-4 h-4 text-muted-foreground" />
                          <div>
                            <p className="font-medium">{rider.name}</p>
                            <p className="text-xs text-muted-foreground">{rider.contractors?.name || '-'}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{stock?.opening_stock || 0}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">{stock?.stock_received || 0}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge className="bg-amber-100 text-amber-700">{stock?.in_transit || 0}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge className="bg-green-100 text-green-700">{stock?.delivered || 0}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge className="bg-orange-100 text-orange-700">{stock?.returns || 0}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge className="bg-red-100 text-red-700">{stock?.defective || 0}</Badge>
                      </TableCell>
                      <TableCell className="text-center font-medium">
                        {stock?.closing_stock || 0}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => openStockEdit(rider.id)}
                          >
                            Edit
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => setMovementDialog(rider.id)}
                          >
                            <Plus className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
                {filteredRiders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      No riders found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        {/* Movements Tab */}
        <TabsContent value="movements" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Recent Stock Movements</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Rider</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-center">Quantity</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentMovements.map((movement) => (
                  <TableRow key={movement.id}>
                    <TableCell className="text-muted-foreground">
                      {new Date(movement.movement_date).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Bike className="w-4 h-4" />
                        {movement.riders?.name || 'Unknown'}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={
                        movement.movement_type === 'delivered' ? 'default' :
                        movement.movement_type === 'return' ? 'secondary' :
                        movement.movement_type === 'defective' ? 'destructive' :
                        'outline'
                      }>
                        {movement.movement_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center font-medium">
                      {movement.quantity}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {movement.description || '-'}
                    </TableCell>
                  </TableRow>
                ))}
                {recentMovements.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No stock movements yet
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Stock Edit Dialog */}
      <Dialog open={!!stockDialog} onOpenChange={() => setStockDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Stock for {riders.find(r => r.id === stockDialog)?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <Label>Opening Stock</Label>
              <Input
                type="number"
                value={openingStock}
                onChange={(e) => setOpeningStock(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Stock Received</Label>
              <Input
                type="number"
                value={stockReceived}
                onChange={(e) => setStockReceived(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>In Transit</Label>
              <Input
                type="number"
                value={inTransit}
                onChange={(e) => setInTransit(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Returns</Label>
              <Input
                type="number"
                value={returns}
                onChange={(e) => setReturns(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Defective</Label>
              <Input
                type="number"
                value={defective}
                onChange={(e) => setDefective(e.target.value)}
              />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Notes (Optional)</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any notes..."
              />
            </div>
          </div>
          <div className="bg-muted rounded-lg p-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Closing Stock:</span>
            <span className="font-bold text-lg">
              {(Number(openingStock) || 0) + (Number(stockReceived) || 0) - (Number(returns) || 0) - (Number(defective) || 0) - (Number(inTransit) || 0)}
            </span>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStockDialog(null)}>Cancel</Button>
            <Button onClick={saveStock} disabled={saving}>
              {saving ? 'Saving...' : 'Save Stock'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Movement Dialog */}
      <Dialog open={!!movementDialog} onOpenChange={() => setMovementDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Stock Movement</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Movement Type</Label>
              <Select value={movementType} onValueChange={setMovementType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="received">Stock Received</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
                  <SelectItem value="return">Return</SelectItem>
                  <SelectItem value="defective">Defective</SelectItem>
                  <SelectItem value="transfer">Transfer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input
                type="number"
                value={movementQty}
                onChange={(e) => setMovementQty(e.target.value)}
                placeholder="Enter quantity"
              />
            </div>

            <div className="space-y-2">
              <Label>Description (Optional)</Label>
              <Input
                value={movementDesc}
                onChange={(e) => setMovementDesc(e.target.value)}
                placeholder="e.g., Morning batch"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMovementDialog(null)}>Cancel</Button>
            <Button onClick={addMovement} disabled={saving || !movementQty}>
              {saving ? 'Adding...' : 'Add Movement'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
