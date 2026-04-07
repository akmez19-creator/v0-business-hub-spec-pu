'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreHorizontal, Edit, RotateCcw, UserPlus, MapPin, Package, Plus, Trash2, Bike } from 'lucide-react'
import { resetCmsDelivery, updateCmsDelivery, addProductToCmsDelivery } from '@/lib/cms-actions'
import { useRouter } from 'next/navigation'

interface Delivery {
  id: string
  customer_name: string
  contact_1: string
  contact_2?: string
  locality: string
  products: string
  qty: number
  amount: number
  rider_id?: string
  delivery_date: string
  delivery_notes?: string
}

interface Rider {
  id: string
  name: string
  email: string
  role?: string
}

interface CmsEditActionsProps {
  delivery: Delivery
  riders: Rider[]
  regions: string[]
  riderMap: Record<string, string>
}

export function CmsEditActions({ delivery, riders, regions, riderMap }: CmsEditActionsProps) {
  const router = useRouter()
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isReassignOpen, setIsReassignOpen] = useState(false)
  const [isAddProductOpen, setIsAddProductOpen] = useState(false)
  const [isResetOpen, setIsResetOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  
  // Edit form state
  const [editForm, setEditForm] = useState({
    locality: delivery.locality,
    qty: delivery.qty || 1,
    amount: delivery.amount || 0,
    products: delivery.products,
  })
  
  // Reassign form state
  const [selectedRider, setSelectedRider] = useState(delivery.rider_id || '')
  
  // Add product form state
  const [newProduct, setNewProduct] = useState({
    name: '',
    qty: 1,
    price: 0,
  })

  const handleReset = async () => {
    setIsLoading(true)
    try {
      const result = await resetCmsDelivery(delivery.id, selectedRider || undefined)
      if (result.error) {
        alert(result.error)
      } else {
        setIsResetOpen(false)
        router.refresh()
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleEdit = async () => {
    setIsLoading(true)
    try {
      const result = await updateCmsDelivery(delivery.id, {
        locality: editForm.locality,
        qty: editForm.qty,
        amount: editForm.amount,
        products: editForm.products,
      })
      if (result.error) {
        alert(result.error)
      } else {
        setIsEditOpen(false)
        router.refresh()
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleReassign = async () => {
    setIsLoading(true)
    try {
      const result = await updateCmsDelivery(delivery.id, {
        rider_id: selectedRider || null,
      })
      if (result.error) {
        alert(result.error)
      } else {
        setIsReassignOpen(false)
        router.refresh()
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleAddProduct = async () => {
    if (!newProduct.name || newProduct.qty <= 0) {
      alert('Please enter a valid product name and quantity')
      return
    }
    
    setIsLoading(true)
    try {
      const result = await addProductToCmsDelivery(delivery.id, {
        customer_name: delivery.customer_name,
        contact_1: delivery.contact_1,
        contact_2: delivery.contact_2,
        locality: delivery.locality,
        delivery_date: delivery.delivery_date,
        rider_id: delivery.rider_id,
        product_name: newProduct.name,
        qty: newProduct.qty,
        price: newProduct.price,
      })
      if (result.error) {
        alert(result.error)
      } else {
        setIsAddProductOpen(false)
        setNewProduct({ name: '', qty: 1, price: 0 })
        router.refresh()
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setIsEditOpen(true)}>
            <Edit className="w-4 h-4 mr-2" />
            Edit Details
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setIsReassignOpen(true)}>
            <Bike className="w-4 h-4 mr-2" />
            Reassign Rider
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setIsAddProductOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Product
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setIsResetOpen(true)} className="text-green-600">
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset & Redeliver
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Edit Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Delivery Details</DialogTitle>
            <DialogDescription>
              Update the delivery information for {delivery.customer_name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Region / Locality</Label>
              <Select value={editForm.locality} onValueChange={(v) => setEditForm(f => ({ ...f, locality: v }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select region" />
                </SelectTrigger>
                <SelectContent>
                  {regions.map(r => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Product</Label>
              <Input
                value={editForm.products}
                onChange={(e) => setEditForm(f => ({ ...f, products: e.target.value }))}
                placeholder="Product name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Quantity</Label>
                <Input
                  type="number"
                  min={1}
                  value={editForm.qty}
                  onChange={(e) => setEditForm(f => ({ ...f, qty: parseInt(e.target.value) || 1 }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Price (Rs)</Label>
                <Input
                  type="number"
                  min={0}
                  value={editForm.amount}
                  onChange={(e) => setEditForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={isLoading}>
              {isLoading ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reassign Dialog */}
      <Dialog open={isReassignOpen} onOpenChange={setIsReassignOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reassign Rider</DialogTitle>
            <DialogDescription>
              Assign a different rider to this delivery
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label>Select Rider / Contractor</Label>
            <Select value={selectedRider || 'unassigned'} onValueChange={(v) => setSelectedRider(v === 'unassigned' ? '' : v)}>
              <SelectTrigger className="mt-2">
                <SelectValue placeholder="Select a rider or contractor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {riders.filter(r => r.id).map(r => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name || r.email} {r.role === 'contractor' ? '(Contractor)' : '(Rider)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {delivery.rider_id && riderMap[delivery.rider_id] && (
              <p className="text-sm text-muted-foreground mt-2">
                Currently assigned to: <span className="font-medium">{riderMap[delivery.rider_id]}</span>
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsReassignOpen(false)}>Cancel</Button>
            <Button onClick={handleReassign} disabled={isLoading}>
              {isLoading ? 'Reassigning...' : 'Reassign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Product Dialog */}
      <Dialog open={isAddProductOpen} onOpenChange={setIsAddProductOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Product</DialogTitle>
            <DialogDescription>
              Add another product line for {delivery.customer_name}. This will create a new delivery entry.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Product Name</Label>
              <Input
                value={newProduct.name}
                onChange={(e) => setNewProduct(p => ({ ...p, name: e.target.value }))}
                placeholder="Enter product name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Quantity</Label>
                <Input
                  type="number"
                  min={1}
                  value={newProduct.qty}
                  onChange={(e) => setNewProduct(p => ({ ...p, qty: parseInt(e.target.value) || 1 }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Price (Rs)</Label>
                <Input
                  type="number"
                  min={0}
                  value={newProduct.price}
                  onChange={(e) => setNewProduct(p => ({ ...p, price: parseFloat(e.target.value) || 0 }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddProductOpen(false)}>Cancel</Button>
            <Button onClick={handleAddProduct} disabled={isLoading}>
              {isLoading ? 'Adding...' : 'Add Product'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Dialog */}
      <Dialog open={isResetOpen} onOpenChange={setIsResetOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset & Redeliver</DialogTitle>
            <DialogDescription>
              Reset this CMS delivery to &quot;assigned&quot; status so it can be redelivered.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label>Assign to Rider / Contractor (optional)</Label>
            <Select value={selectedRider || 'keep-current'} onValueChange={(v) => setSelectedRider(v === 'keep-current' ? '' : v)}>
              <SelectTrigger className="mt-2">
                <SelectValue placeholder="Keep current or select new" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keep-current">Keep current ({delivery.rider_id ? riderMap[delivery.rider_id] || 'Unknown' : 'Unassigned'})</SelectItem>
                {riders.filter(r => r.id).map(r => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name || r.email} {r.role === 'contractor' ? '(Contractor)' : '(Rider)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground mt-4">
              This will change the status from &quot;CMS&quot; back to &quot;assigned&quot; so it can be redelivered.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsResetOpen(false)}>Cancel</Button>
            <Button onClick={handleReset} disabled={isLoading} className="bg-green-600 hover:bg-green-700">
              {isLoading ? 'Resetting...' : 'Reset Delivery'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
