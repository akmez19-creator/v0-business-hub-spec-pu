'use client'

import React from "react"
import { useState, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
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
  Search,
  Plus,
  Loader2,
  Package,
  ImageIcon,
  Pencil,
  Trash2,
  Upload,
  X,
  AlertTriangle,
  Grid3X3,
  List,
  ArrowUpDown,
  Filter,
  Download,
} from 'lucide-react'
import Image from 'next/image'
import { Product } from '@/lib/types'
import { InventoryImportDialog } from './inventory-import-dialog'
import { InventoryCleanupDialog } from './inventory-cleanup-dialog'

type ViewMode = 'table' | 'grid'
type SortKey = 'name' | 'category' | 'quantity' | 'price'
type SortOrder = 'asc' | 'desc'

export function InventoryContent({ products: initialProducts }: { products: Product[] }) {
  const [products, setProducts] = useState(initialProducts)
  const [search, setSearch] = useState('')
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('table')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const router = useRouter()

  // Get unique categories
  const categories = useMemo(() => {
    const cats = new Set(products.map(p => p.category).filter(Boolean))
    return Array.from(cats).sort() as string[]
  }, [products])

  // Stats
  const stats = useMemo(() => {
    const total = products.length
    const active = products.filter(p => p.is_active).length
    const lowStock = products.filter(p => p.quantity > 0 && p.quantity <= 5).length
    const outOfStock = products.filter(p => p.quantity === 0).length
    const withImages = products.filter(p => p.image_url).length
    return { total, active, lowStock, outOfStock, withImages }
  }, [products])

  // Filtered and sorted products
  const filtered = useMemo(() => {
    let result = products.filter(p => {
      const searchTerm = search.toLowerCase().trim()
      
      // Category filter
      if (categoryFilter !== 'all' && p.category !== categoryFilter) return false
      
      if (!searchTerm) return true
      
      // Search filter
      const matchesText = 
        p.name.toLowerCase().includes(searchTerm) ||
        (p.sku && p.sku.toLowerCase().includes(searchTerm)) ||
        (p.category && p.category.toLowerCase().includes(searchTerm))
      
      const priceString = p.price.toString()
      const cleanSearch = searchTerm.replace(/^rs\s*/i, '').trim()
      const matchesPrice = priceString.includes(cleanSearch)
      
      return matchesText || matchesPrice
    })

    // Sort
    result.sort((a, b) => {
      let aVal: string | number = ''
      let bVal: string | number = ''
      
      switch (sortKey) {
        case 'name':
          aVal = a.name.toLowerCase()
          bVal = b.name.toLowerCase()
          break
        case 'category':
          aVal = (a.category || '').toLowerCase()
          bVal = (b.category || '').toLowerCase()
          break
        case 'quantity':
          aVal = a.quantity || 0
          bVal = b.quantity || 0
          break
        case 'price':
          aVal = a.price || 0
          bVal = b.price || 0
          break
      }
      
      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1
      return 0
    })

    return result
  }, [products, search, categoryFilter, sortKey, sortOrder])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortOrder('asc')
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inventory</h1>
          <p className="text-sm text-muted-foreground">
            Manage your product catalog and stock levels
          </p>
        </div>
<div className="flex items-center gap-2">
<InventoryCleanupDialog onSuccess={() => router.refresh()} />
<InventoryImportDialog onSuccess={() => router.refresh()} />
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Add Product
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
              <ProductForm
                onSave={async (p) => {
                  setProducts(prev => [...prev, p])
                  setAddOpen(false)
                  router.refresh()
                }}
                onCancel={() => setAddOpen(false)}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Package className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{stats.total}</p>
              <p className="text-xs text-muted-foreground">Total Products</p>
            </div>
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Package className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{stats.active}</p>
              <p className="text-xs text-muted-foreground">Active</p>
            </div>
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{stats.lowStock}</p>
              <p className="text-xs text-muted-foreground">Low Stock</p>
            </div>
          </div>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
              <Package className="w-5 h-5 text-red-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{stats.outOfStock}</p>
              <p className="text-xs text-muted-foreground">Out of Stock</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, SKU, category, or price..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        
        {/* Category Filter */}
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <Filter className="w-4 h-4 mr-2 text-muted-foreground" />
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map(cat => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* View Toggle */}
        <div className="flex border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setViewMode('table')}
            className={`px-3 py-2 flex items-center gap-1.5 text-sm transition-colors ${
              viewMode === 'table' 
                ? 'bg-primary text-primary-foreground' 
                : 'bg-card hover:bg-muted text-muted-foreground'
            }`}
          >
            <List className="w-4 h-4" />
            <span className="hidden sm:inline">Table</span>
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={`px-3 py-2 flex items-center gap-1.5 text-sm transition-colors ${
              viewMode === 'grid' 
                ? 'bg-primary text-primary-foreground' 
                : 'bg-card hover:bg-muted text-muted-foreground'
            }`}
          >
            <Grid3X3 className="w-4 h-4" />
            <span className="hidden sm:inline">Grid</span>
          </button>
        </div>
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Showing {filtered.length} of {products.length} products</span>
      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 bg-card border border-border rounded-lg">
          <Package className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-50" />
          <p className="font-medium text-foreground">No products found</p>
          <p className="text-sm text-muted-foreground mt-1">
            {search || categoryFilter !== 'all' ? 'Try different filters' : 'Add your first product to get started'}
          </p>
        </div>
      ) : viewMode === 'table' ? (
        /* Table View */
        <div className="border border-border rounded-lg overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-[50px]">Image</TableHead>
                  <TableHead>
                    <button 
                      onClick={() => toggleSort('name')}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                      Product
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button 
                      onClick={() => toggleSort('category')}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                      Category
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </TableHead>
                  <TableHead className="text-center">
                    <button 
                      onClick={() => toggleSort('quantity')}
                      className="flex items-center gap-1 hover:text-foreground transition-colors mx-auto"
                    >
                      Qty
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button 
                      onClick={() => toggleSort('price')}
                      className="flex items-center gap-1 hover:text-foreground transition-colors ml-auto"
                    >
                      Unit
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">SPX2</TableHead>
                  <TableHead className="text-right">SPX3</TableHead>
                  <TableHead className="text-right">B1G1</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((product) => (
                  <TableRow 
                    key={product.id} 
                    className="hover:bg-muted/30 cursor-pointer"
                    onClick={() => setEditProduct(product)}
                  >
                    <TableCell>
                      <div className="w-10 h-10 rounded-md overflow-hidden bg-muted flex items-center justify-center">
                        {product.image_url ? (
                          <Image
                            src={product.image_url}
                            alt={product.name}
                            width={40}
                            height={40}
                            className="object-cover w-full h-full"
                          />
                        ) : (
                          <ImageIcon className="w-4 h-4 text-muted-foreground/50" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium text-foreground">{product.name}</p>
                        {product.sku && (
                          <p className="text-xs text-muted-foreground">SKU: {product.sku}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {product.category ? (
                        <Badge variant="outline" className="bg-transparent font-normal">
                          {product.category}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <QuantityBadge quantity={product.quantity} />
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {product.price > 0 ? `Rs ${product.price}` : '-'}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {product.price_spx2 ? `Rs ${product.price_spx2}` : '-'}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {product.price_spx3 ? `Rs ${product.price_spx3}` : '-'}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {product.price_b1g1 ? `Rs ${product.price_b1g1}` : '-'}
                    </TableCell>
                    <TableCell className="text-center">
                      {product.is_active ? (
                        <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-0">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="bg-muted text-muted-foreground">
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button 
                        size="sm" 
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditProduct(product)
                        }}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : (
        /* Grid View */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((product) => (
            <div
              key={product.id}
              className="group border border-border rounded-xl overflow-hidden bg-card hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => setEditProduct(product)}
            >
              {/* Image */}
              <div className="relative aspect-square bg-muted">
                {product.image_url ? (
                  <Image
                    src={product.image_url}
                    alt={product.name}
                    fill
                    className="object-cover"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                  />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <ImageIcon className="w-12 h-12 text-muted-foreground/30" />
                  </div>
                )}
                {/* Stock badge */}
                <div className="absolute top-2 left-2">
                  <QuantityBadge quantity={product.quantity} />
                </div>
                {!product.is_active && (
                  <Badge variant="destructive" className="absolute top-2 right-2">Inactive</Badge>
                )}
              </div>

              {/* Details */}
              <div className="p-3 space-y-2">
                <h3 className="font-medium text-sm text-foreground truncate">{product.name}</h3>
                {product.category && (
                  <Badge variant="outline" className="text-xs bg-transparent">{product.category}</Badge>
                )}
                {/* Pricing Grid */}
                <div className="grid grid-cols-2 gap-1 text-xs pt-1 border-t border-border">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Unit:</span>
                    <span className="font-medium text-foreground">{product.price > 0 ? `Rs ${product.price}` : '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">SPX2:</span>
                    <span className="font-medium text-foreground">{product.price_spx2 ? `Rs ${product.price_spx2}` : '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">SPX3:</span>
                    <span className="font-medium text-foreground">{product.price_spx3 ? `Rs ${product.price_spx3}` : '-'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">B1G1:</span>
                    <span className="font-medium text-foreground">{product.price_b1g1 ? `Rs ${product.price_b1g1}` : '-'}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      {editProduct && (
        <Dialog open={!!editProduct} onOpenChange={(open) => { if (!open) setEditProduct(null) }}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <ProductForm
              product={editProduct}
              onSave={async (p) => {
                setProducts(prev => prev.map(x => x.id === p.id ? p : x))
                setEditProduct(null)
                router.refresh()
              }}
              onCancel={() => setEditProduct(null)}
              onDelete={async () => {
                setProducts(prev => prev.filter(x => x.id !== editProduct.id))
                setEditProduct(null)
                router.refresh()
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function QuantityBadge({ quantity }: { quantity: number }) {
  if (quantity === 0) {
    return (
      <Badge className="bg-red-500/10 text-red-600 hover:bg-red-500/20 border-0">
        Out of Stock
      </Badge>
    )
  }
  if (quantity <= 5) {
    return (
      <Badge className="bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 border-0">
        Low: {quantity}
      </Badge>
    )
  }
  return (
    <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-0">
      {quantity}
    </Badge>
  )
}

function ProductForm({
  product,
  onSave,
  onCancel,
  onDelete,
}: {
  product?: Product
  onSave: (product: Product) => void
  onCancel: () => void
  onDelete?: () => void
}) {
  const [name, setName] = useState(product?.name || '')
  const [sku, setSku] = useState(product?.sku || '')
  const [price, setPrice] = useState(product?.price?.toString() || '')
  const [category, setCategory] = useState(product?.category || '')
  const [description, setDescription] = useState(product?.description || '')
  const [isActive, setIsActive] = useState(product?.is_active ?? true)
  const [imageUrl, setImageUrl] = useState(product?.image_url || '')
  const [quantity, setQuantity] = useState(product?.quantity?.toString() || '0')
  const [priceSpx2, setPriceSpx2] = useState(product?.price_spx2?.toString() || '')
  const [priceSpx3, setPriceSpx3] = useState(product?.price_spx3?.toString() || '')
  const [priceB1g1, setPriceB1g1] = useState(product?.price_b1g1?.toString() || '')
  const [remarks, setRemarks] = useState(product?.remarks || '')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop()
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      
      const { error: uploadError } = await supabase.storage
        .from('product-images')
        .upload(fileName, file, { cacheControl: '3600', upsert: false })

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from('product-images')
        .getPublicUrl(fileName)

      setImageUrl(publicUrl)
    } catch (err) {
      setError('Image upload failed: ' + (err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }

    setSaving(true)
    setError(null)

    try {
      const supabase = createClient()
      const payload = {
        name: name.trim(),
        sku: sku.trim() || null,
        price: parseFloat(price) || 0,
        category: category.trim() || null,
        description: description.trim() || null,
        is_active: isActive,
        image_url: imageUrl || null,
        quantity: parseInt(quantity) || 0,
        price_spx2: priceSpx2 ? parseFloat(priceSpx2) : null,
        price_spx3: priceSpx3 ? parseFloat(priceSpx3) : null,
        price_b1g1: priceB1g1 ? parseFloat(priceB1g1) : null,
        remarks: remarks.trim() || null,
        updated_at: new Date().toISOString(),
      }

      if (product) {
        const { data, error: err } = await supabase
          .from('products')
          .update(payload)
          .eq('id', product.id)
          .select()
          .single()
        if (err) throw err
        onSave(data)
      } else {
        const { data, error: err } = await supabase
          .from('products')
          .insert(payload)
          .select()
          .single()
        if (err) throw err
        onSave(data)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!product || !onDelete) return
    if (!confirm(`Delete "${product.name}"? This cannot be undone.`)) return

    setDeleting(true)
    try {
      const supabase = createClient()
      const { error: err } = await supabase
        .from('products')
        .delete()
        .eq('id', product.id)
      if (err) throw err
      onDelete()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <form onSubmit={handleSave}>
      <DialogHeader>
        <DialogTitle>{product ? 'Edit Product' : 'Add Product'}</DialogTitle>
        <DialogDescription>
          {product ? 'Update product details and pricing.' : 'Add a new product to inventory.'}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        {/* Image Upload */}
        <div className="space-y-2">
          <Label>Product Image</Label>
          <div className="flex items-start gap-4">
            <div
              className="relative w-20 h-20 rounded-lg border-2 border-dashed border-border bg-muted flex items-center justify-center cursor-pointer overflow-hidden hover:border-primary/50 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              {imageUrl ? (
                <>
                  <Image
                    src={imageUrl}
                    alt="Product"
                    fill
                    className="object-cover"
                    sizes="80px"
                  />
                  <button
                    type="button"
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center"
                    onClick={(e) => { e.stopPropagation(); setImageUrl('') }}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </>
              ) : uploading ? (
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              ) : (
                <Upload className="w-5 h-5 text-muted-foreground" />
              )}
            </div>
            <div className="text-xs text-muted-foreground pt-1">
              <p>Click to upload</p>
              <p>JPG, PNG, WebP</p>
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
          />
        </div>

        {/* Name */}
        <div className="space-y-2">
          <Label htmlFor="product-name">Product Name *</Label>
          <Input
            id="product-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Wireless Vacuum Cleaner"
            disabled={saving}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* SKU */}
          <div className="space-y-2">
            <Label htmlFor="product-sku">SKU</Label>
            <Input
              id="product-sku"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="WVC-001"
              disabled={saving}
            />
          </div>
          {/* Category */}
          <div className="space-y-2">
            <Label htmlFor="product-category">Category</Label>
            <Input
              id="product-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Kitchen"
              disabled={saving}
            />
          </div>
        </div>

        {/* Quantity & Unit Price */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="product-quantity">Quantity</Label>
            <Input
              id="product-quantity"
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0"
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-price">Unit Price (Rs)</Label>
            <Input
              id="product-price"
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0"
              disabled={saving}
            />
          </div>
        </div>

        {/* Pricing Tiers */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Pricing Tiers (Rs)</Label>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label htmlFor="price-spx2" className="text-xs text-muted-foreground">SPX2</Label>
              <Input
                id="price-spx2"
                type="number"
                value={priceSpx2}
                onChange={(e) => setPriceSpx2(e.target.value)}
                placeholder="0"
                disabled={saving}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="price-spx3" className="text-xs text-muted-foreground">SPX3</Label>
              <Input
                id="price-spx3"
                type="number"
                value={priceSpx3}
                onChange={(e) => setPriceSpx3(e.target.value)}
                placeholder="0"
                disabled={saving}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="price-b1g1" className="text-xs text-muted-foreground">B1G1</Label>
              <Input
                id="price-b1g1"
                type="number"
                value={priceB1g1}
                onChange={(e) => setPriceB1g1(e.target.value)}
                placeholder="0"
                disabled={saving}
                className="h-9"
              />
            </div>
          </div>
        </div>

        {/* Remarks */}
        <div className="space-y-2">
          <Label htmlFor="product-remarks">Remarks</Label>
          <Input
            id="product-remarks"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Notes..."
            disabled={saving}
          />
        </div>

        {/* Active toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="rounded border-border"
          />
          <span className="text-sm">Active (visible in system)</span>
        </label>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <DialogFooter className="gap-2">
        {product && onDelete && (
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={deleting || saving}
            className="mr-auto"
          >
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4 mr-1" />}
            Delete
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
          {product ? 'Update' : 'Create'}
        </Button>
      </DialogFooter>
    </form>
  )
}
