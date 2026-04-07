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
import { MoreHorizontal, Edit, RotateCcw, UserPlus, MapPin, Package, Plus, Trash2, Bike, CheckCircle } from 'lucide-react'
import { resetCmsDelivery, updateCmsDelivery, addProductToCmsDelivery, markCmsAsReviewed, deleteCmsDelivery } from '@/lib/cms-actions'
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
  products?: string[]
  riderMap: Record<string, string>
}

export function CmsEditActions({ delivery, riders, regions, products = [], riderMap }: CmsEditActionsProps) {
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
  
  // Search states for filtering
  const [regionSearch, setRegionSearch] = useState('')
  const [productSearch, setProductSearch] = useState('')
  
  // Filtered lists
  const filteredRegions = regionSearch 
    ? regions.filter(r => r.toLowerCase().includes(regionSearch.toLowerCase()))
    : regions
  const filteredProducts = productSearch
    ? products.filter(p => p.toLowerCase().includes(productSearch.toLowerCase()))
    : products

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
    if (!selectedRider) {
      alert('Please select a rider')
      return
    }
    setIsLoading(true)
    try {
      // Use resetCmsDelivery to change status back to "assigned" AND set the new rider
      const result = await resetCmsDelivery(delivery.id, selectedRider)
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

  // Check if this CMS entry has been reviewed by admin
  const isReviewed = delivery.delivery_notes?.startsWith('[REVIEWED]') || false
  
  const handleToggleReviewed = async () => {
    setIsLoading(true)
    try {
      const result = await markCmsAsReviewed(delivery.id, !isReviewed)
      if (result.error) {
        alert(result.error)
      } else {
        router.refresh()
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete this delivery for "${delivery.customer_name}"? This cannot be undone.`)) return
    
    setIsLoading(true)
    try {
      const result = await deleteCmsDelivery(delivery.id)
      if (result.error) {
        alert(result.error)
      } else {
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
          <DropdownMenuItem onClick={handleToggleReviewed} className={isReviewed ? "text-muted-foreground" : "text-green-600"}>
            <CheckCircle className={`w-4 h-4 mr-2 ${isReviewed ? 'fill-green-500 text-green-500' : ''}`} />
            {isReviewed ? 'Mark Unreviewed' : 'Mark Reviewed'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
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
          <DropdownMenuItem onClick={() => setIsResetOpen(true)} className="text-blue-600">
            <RotateCcw className="w-4 h-4 mr-2" />
            Reset & Redeliver
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDelete} className="text-red-600">
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
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
              <Input 
                placeholder="Search regions..." 
                value={regionSearch}
                onChange={(e) => setRegionSearch(e.target.value)}
                className="mb-2"
              />
              <Select value={editForm.locality} onValueChange={(v) => { setEditForm(f => ({ ...f, locality: v })); setRegionSearch('') }}>
                <SelectTrigger>
                  <SelectValue placeholder="Select region" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {/* Keep current value if not in filtered list */}
                  {editForm.locality && !filteredRegions.includes(editForm.locality) && (
                    <SelectItem value={editForm.locality}>{editForm.locality} (current)</SelectItem>
                  )}
                  {filteredRegions.slice(0, 100).map(r => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                  {filteredRegions.length > 100 && (
                    <div className="px-2 py-1 text-xs text-muted-foreground">+{filteredRegions.length - 100} more - type to search</div>
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{regions.length} regions available</p>
            </div>
            <div className="space-y-2">
              <Label>Product</Label>
              {products.length > 0 ? (
                <>
                  <Input 
                    placeholder="Search products..." 
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    className="mb-2"
                  />
                  <Select value={editForm.products} onValueChange={(v) => { setEditForm(f => ({ ...f, products: v })); setProductSearch('') }}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select product" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      {/* Allow keeping original value if not in list */}
                      {editForm.products && !filteredProducts.includes(editForm.products) && (
                        <SelectItem value={editForm.products}>{editForm.products} (current)</SelectItem>
                      )}
                      {filteredProducts.slice(0, 100).map(p => (
                        <SelectItem key={p} value={p}>{p}</SelectItem>
                      ))}
                      {filteredProducts.length > 100 && (
                        <div className="px-2 py-1 text-xs text-muted-foreground">+{filteredProducts.length - 100} more - type to search</div>
                      )}
                    </SelectContent>
                  </Select>
                </>
              ) : (
                <Input
                  value={editForm.products}
                  onChange={(e) => setEditForm(f => ({ ...f, products: e.target.value }))}
                  placeholder="Product name"
                />
              )}
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
            <DialogTitle>Reassign to Rider</DialogTitle>
            <DialogDescription>
              Select a rider to reassign this delivery. The status will be reset to &quot;Assigned&quot; and it will appear on the rider&apos;s delivery list.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label>Select Rider</Label>
            <Select value={selectedRider || ''} onValueChange={setSelectedRider}>
              <SelectTrigger className="mt-2">
                <SelectValue placeholder="Select a rider to reassign" />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                {riders.filter(r => r.id).map(r => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
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
            <Label>Assign to Rider (optional)</Label>
            <Select value={selectedRider || 'keep-current'} onValueChange={(v) => setSelectedRider(v === 'keep-current' ? '' : v)}>
              <SelectTrigger className="mt-2">
                <SelectValue placeholder="Keep current or select new" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keep-current">Keep current ({delivery.rider_id ? riderMap[delivery.rider_id] || 'Unknown' : 'Unassigned'})</SelectItem>
                {riders.filter(r => r.id).map(r => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
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
