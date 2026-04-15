'use client'

import React from "react"

import { useState, useRef } from 'react'
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
  Search,
  Plus,
  Loader2,
  Package,
  ImageIcon,
  Pencil,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import Image from 'next/image'
import { Product } from '@/lib/types'
import { InventoryImportDialog } from './inventory-import-dialog'

export function InventoryContent({ products: initialProducts }: { products: Product[] }) {
  const [products, setProducts] = useState(initialProducts)
  const [search, setSearch] = useState('')
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const router = useRouter()

  const filtered = products.filter(p => {
    const searchTerm = search.toLowerCase().trim()
    if (!searchTerm) return true
    
    // Check name, SKU, category
    const matchesText = 
      p.name.toLowerCase().includes(searchTerm) ||
      (p.sku && p.sku.toLowerCase().includes(searchTerm)) ||
      (p.category && p.category.toLowerCase().includes(searchTerm))
    
    // Check price - supports exact match, partial match, or "Rs" prefix
    const priceString = p.price.toString()
    const cleanSearch = searchTerm.replace(/^rs\s*/i, '').trim()
    const matchesPrice = 
      priceString.includes(cleanSearch) ||
      priceString === cleanSearch ||
      `rs ${priceString}`.includes(searchTerm) ||
      `rs${priceString}`.includes(searchTerm)
    
    return matchesText || matchesPrice
  })

  const activeCount = products.filter(p => p.is_active).length
  const withImageCount = products.filter(p => p.image_url).length

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inventory</h1>
          <p className="text-sm text-muted-foreground">
            {products.length} products -- {activeCount} active -- {withImageCount} with images
          </p>
        </div>
        <div className="flex items-center gap-2">
          <InventoryImportDialog onSuccess={() => router.refresh()} />
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                Add Product
              </Button>
            </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
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

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, SKU, category, or price..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Product Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <Package className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-50" />
          <p className="font-medium text-foreground">No products found</p>
          <p className="text-sm text-muted-foreground mt-1">
            {search ? 'Try a different search term' : 'Add your first product to get started'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((product) => (
            <div
              key={product.id}
              className="group border border-border rounded-xl overflow-hidden bg-card hover:shadow-md transition-shadow"
            >
              {/* Image */}
              <div className="relative aspect-square bg-muted">
                {product.image_url ? (
                  <Image
                    src={product.image_url || "/placeholder.svg"}
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
                {/* Edit overlay */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setEditProduct(product)}
                  >
                    <Pencil className="w-3 h-3 mr-1" />
                    Edit
                  </Button>
                </div>
                {!product.is_active && (
                  <Badge variant="destructive" className="absolute top-2 right-2">Inactive</Badge>
                )}
              </div>

              {/* Details */}
              <div className="p-3 space-y-2">
                <h3 className="font-medium text-sm text-foreground truncate">{product.name}</h3>
                <div className="flex items-center justify-between">
                  {product.sku && (
                    <span className="text-xs text-muted-foreground">SKU: {product.sku}</span>
                  )}
                  {product.quantity > 0 && (
                    <Badge variant="secondary" className="text-xs">Qty: {product.quantity}</Badge>
                  )}
                </div>
                {/* Pricing Grid */}
                <div className="grid grid-cols-2 gap-1 text-xs">
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
                {product.category && (
                  <Badge variant="outline" className="text-xs bg-transparent">{product.category}</Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      {editProduct && (
        <Dialog open={!!editProduct} onOpenChange={(open) => { if (!open) setEditProduct(null) }}>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
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
  // New fields
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
        // New fields
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
          {product ? 'Update product details and image.' : 'Add a new product to inventory.'}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        {/* Image Upload */}
        <div className="space-y-2">
          <Label>Product Image</Label>
          <div className="flex items-start gap-4">
            <div
              className="relative w-24 h-24 rounded-lg border-2 border-dashed border-border bg-muted flex items-center justify-center cursor-pointer overflow-hidden hover:border-primary/50 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              {imageUrl ? (
                <>
                  <Image
                    src={imageUrl || "/placeholder.svg"}
                    alt="Product"
                    fill
                    className="object-cover"
                    sizes="96px"
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
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              ) : (
                <Upload className="w-6 h-6 text-muted-foreground" />
              )}
            </div>
            <div className="text-xs text-muted-foreground pt-1">
              <p>Click to upload image</p>
              <p>JPG, PNG, WebP. Max 5MB.</p>
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

        <div className="grid grid-cols-2 gap-4">
          {/* SKU */}
          <div className="space-y-2">
            <Label htmlFor="product-sku">SKU</Label>
            <Input
              id="product-sku"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="e.g., WVC-001"
              disabled={saving}
            />
          </div>
          {/* Price */}
          <div className="space-y-2">
            <Label htmlFor="product-price">Price (Rs)</Label>
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

        {/* Category & Quantity */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="product-category">Category</Label>
            <Input
              id="product-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g., Kitchen, Car"
              disabled={saving}
            />
          </div>
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
        </div>

        {/* Pricing Tiers */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Pricing Tiers (Rs)</Label>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="price-spx2" className="text-xs text-muted-foreground">SPX2</Label>
              <Input
                id="price-spx2"
                type="number"
                value={priceSpx2}
                onChange={(e) => setPriceSpx2(e.target.value)}
                placeholder="0"
                disabled={saving}
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
            placeholder="Notes or comments..."
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
          <span className="text-sm">Active (visible in imports and assignments)</span>
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
