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

interface Product {
  id: string
  name: string
  image_url: string | null
  sku: string | null
  price: number
  category: string | null
  description: string | null
  is_active: boolean
  created_at: string
}

export function InventoryContent({ products: initialProducts }: { products: Product[] }) {
  const [products, setProducts] = useState(initialProducts)
  const [search, setSearch] = useState('')
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const router = useRouter()

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.sku && p.sku.toLowerCase().includes(search.toLowerCase())) ||
    (p.category && p.category.toLowerCase().includes(search.toLowerCase()))
  )

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
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add Product
            </Button>
          </DialogTrigger>
          <DialogContent>
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

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search products by name, SKU, or category..."
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
              <div className="p-3">
                <h3 className="font-medium text-sm text-foreground truncate">{product.name}</h3>
                <div className="flex items-center justify-between mt-1">
                  {product.sku && (
                    <span className="text-xs text-muted-foreground">SKU: {product.sku}</span>
                  )}
                  {product.price > 0 && (
                    <span className="text-sm font-semibold text-foreground">Rs {product.price}</span>
                  )}
                </div>
                {product.category && (
                  <Badge variant="outline" className="mt-2 text-xs bg-transparent">{product.category}</Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      {editProduct && (
        <Dialog open={!!editProduct} onOpenChange={(open) => { if (!open) setEditProduct(null) }}>
          <DialogContent>
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

        {/* Category */}
        <div className="space-y-2">
          <Label htmlFor="product-category">Category</Label>
          <Input
            id="product-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g., Kitchen, Car, Health"
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
