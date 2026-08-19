'use client'

import React from "react"
import { useState, useRef, useMemo, useEffect } from 'react'
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
  ClipboardPaste,
  Car,
  Sparkles,
  UtensilsCrossed,
  Sofa,
  Shirt,
  Heart,
  PawPrint,
  Wrench,
  Boxes,
  LayoutGrid,
  Baby,
  Briefcase,
  Dumbbell,
  Scissors,
  Lightbulb,
  TreeDeciduous,
  Bug,
  Plane,
  Droplets,
  Zap,
  Bed,
  Lamp,
  Flower2,
  WashingMachine,
} from 'lucide-react'
import Image from 'next/image'
import { Product, ProductStock } from '@/lib/types'
import { InventoryImportDialog } from './inventory-import-dialog'
import { mediaSrc } from '@/lib/media-url'

type ViewMode = 'table' | 'grid'
type SortKey = 'name' | 'category' | 'quantity' | 'price' | 'initial' | 'actual'
type SortOrder = 'asc' | 'desc'

/** Empty breakdown for products with no PO or delivery history. */
const NO_STOCK: ProductStock = {
  initialQty: 0,
  chinaQty: 0,
  undeliveredQty: 0,
  latestOrderDate: null,
  poBatches: [],
}

export function InventoryContent({
  products: initialProducts,
  stock = {},
  unresolvedDeliveries = 0,
}: {
  products: Product[]
  stock?: Record<string, ProductStock>
  unresolvedDeliveries?: number
}) {
  const [products, setProducts] = useState(initialProducts)
  const [search, setSearch] = useState('')
  const [editProduct, setEditProduct] = useState<Product | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('table')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const router = useRouter()
  const supabase = createClient()
  const [clearing, setClearing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)

  // Export to Excel
  const handleExport = async () => {
    setExporting(true)
    try {
      const XLSX = await import('xlsx')
      
      // Fetch variants for products that have them
      const productsWithVariants = products.filter(p => p.has_variants)
      const variantsMap: Record<string, Array<{attribute_name: string, attribute_value: string, quantity: number, price_override: number | null}>> = {}
      
      if (productsWithVariants.length > 0) {
        const { data: variants } = await supabase
          .from('product_variants')
          .select('*')
          .in('product_id', productsWithVariants.map(p => p.id))
        
        if (variants) {
          for (const v of variants) {
            if (!variantsMap[v.product_id]) variantsMap[v.product_id] = []
            variantsMap[v.product_id].push(v)
          }
        }
      }
      
      // Build export data - products with variants get multiple rows
      const exportData: Array<Record<string, string | number>> = []
      
      for (const p of products) {
        if (p.has_variants && variantsMap[p.id]?.length > 0) {
          // Add one row per variant
          for (const v of variantsMap[p.id]) {
            exportData.push({
              'Category': p.category || '',
              'Item': p.name,
              'Variant': `${v.attribute_name}: ${v.attribute_value}`,
              'In Store': v.quantity || 0,
              // Stock breakdown is tracked per product, not per variant. Left
              // blank on variant rows so summing the column in Excel cannot
              // multiply one product's stock by its variant count.
              'Initial Stock': '',
              'Order Date': '',
              'In China': '',
              'Undelivered': '',
              'Actual Stock': '',
              'PRICE UNIT': v.price_override || p.price || 0,
              '2-Pack': p.bundle_prices?.['2'] || '',
              '3-Pack': p.bundle_prices?.['3'] || '',
              '4-Pack': p.bundle_prices?.['4'] || '',
              '6-Pack': p.bundle_prices?.['6'] || '',
              'B1G1': p.is_b1g1 ? 'Yes' : '',
              'Image': p.image_url || '',
              'Status': p.is_active ? 'Active' : 'Inactive',
              'Remarks': p.remarks || '',
            })
          }
        } else {
          // Regular product without variants
          const st = stock[p.id] ?? NO_STOCK
          exportData.push({
            'Category': p.category || '',
            'Item': p.name,
            'Variant': '',
            'In Store': p.quantity || 0,
            'Initial Stock': st.initialQty,
            'Order Date': st.latestOrderDate || '',
            'In China': st.chinaQty,
            'Undelivered': st.undeliveredQty,
            'Actual Stock': actualStock(p, st),
            'PRICE UNIT': p.price || 0,
            '2-Pack': p.bundle_prices?.['2'] || '',
            '3-Pack': p.bundle_prices?.['3'] || '',
            '4-Pack': p.bundle_prices?.['4'] || '',
            '6-Pack': p.bundle_prices?.['6'] || '',
            'B1G1': p.is_b1g1 ? 'Yes' : '',
            'Image': p.image_url || '',
            'Status': p.is_active ? 'Active' : 'Inactive',
            'Remarks': p.remarks || '',
          })
        }
      }
      
      const worksheet = XLSX.utils.json_to_sheet(exportData)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Products')
      
      // Auto-size columns
      const colWidths = Object.keys(exportData[0] || {}).map(key => ({ wch: Math.max(String(key).length, 15) }))
      worksheet['!cols'] = colWidths
      
      XLSX.writeFile(workbook, `products_export_${new Date().toISOString().split('T')[0]}.xlsx`)
    } catch (error) {
      console.error('Export failed:', error)
    } finally {
      setExporting(false)
    }
  }

  // Clear all products
  const handleClearAll = async () => {
    setClearing(true)
    try {
      // Get all product IDs first
      const productIds = products.map(p => p.id)
      if (productIds.length === 0) {
        setClearConfirmOpen(false)
        return
      }
      
      const batchSize = 100
      
      // First, delete related records in tables that reference products
      // Delete purchase_orders that reference these products
      for (let i = 0; i < productIds.length; i += batchSize) {
        const batch = productIds.slice(i, i + batchSize)
        await supabase.from('purchase_orders').delete().in('product_id', batch)
      }
      
      // Delete stock_transactions that reference these products
      for (let i = 0; i < productIds.length; i += batchSize) {
        const batch = productIds.slice(i, i + batchSize)
        await supabase.from('stock_transactions').delete().in('product_id', batch)
      }
      
      // Now delete products in batches
      for (let i = 0; i < productIds.length; i += batchSize) {
        const batch = productIds.slice(i, i + batchSize)
        const { error } = await supabase.from('products').delete().in('id', batch)
        if (error) {
          throw error
        }
      }
      
      setProducts([])
      setClearConfirmOpen(false)
      router.refresh()
    } catch (error: any) {
      console.error('Clear all failed:', error)
      alert(`Failed to delete products: ${error?.message || 'Unknown error'}`)
    } finally {
      setClearing(false)
    }
  }

  const [pastingImageFor, setPastingImageFor] = useState<string | null>(null)

  // Quick paste image for a product (without opening edit dialog)
  const handleQuickPasteImage = async (productId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setPastingImageFor(productId)
    try {
      const clipboardItems = await navigator.clipboard.read()
      for (const item of clipboardItems) {
        const imageType = item.types.find(type => type.startsWith('image/'))
        if (imageType) {
          const blob = await item.getType(imageType)
          const ext = imageType.split('/')[1] || 'png'
          const file = new File([blob], `product-${productId}.${ext}`, { type: imageType })
          
          // Upload to Supabase storage
          const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
          const { error: uploadError } = await supabase.storage
            .from('product-images')
            .upload(fileName, file, { cacheControl: '3600', upsert: false })

          if (uploadError) throw uploadError

          const { data: { publicUrl } } = supabase.storage
            .from('product-images')
            .getPublicUrl(fileName)

          // Update product with new image URL
          const { error: updateError } = await supabase
            .from('products')
            .update({ image_url: publicUrl, updated_at: new Date().toISOString() })
            .eq('id', productId)

          if (updateError) throw updateError

          // Update local state
          setProducts(prev => prev.map(p => 
            p.id === productId ? { ...p, image_url: publicUrl } : p
          ))
          return
        }
      }
      alert('No image found in clipboard. Copy an image first.')
    } catch (err) {
      console.error('Paste failed:', err)
      alert('Paste failed: ' + (err as Error).message)
    } finally {
      setPastingImageFor(null)
    }
  }

  // Get unique categories
  const categories = useMemo(() => {
    const cats = new Set(products.map(p => p.category).filter(Boolean))
    return Array.from(cats).sort() as string[]
  }, [products])

  // Stats
  const stats = useMemo(() => {
    const total = products.length
    const active = products.filter(p => p.is_active).length
    // Low stock: has quantity between 1-5
    const lowStock = products.filter(p => (p.quantity ?? 0) > 0 && (p.quantity ?? 0) <= 5).length
    // To count: quantity is 0, null, or undefined (needs manual counting)
    const toCount = products.filter(p => !p.quantity || p.quantity === 0).length
    const withImages = products.filter(p => p.image_url).length
    return { total, active, lowStock, toCount, withImages }
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
        case 'initial':
          aVal = (stock[a.id] ?? NO_STOCK).initialQty
          bVal = (stock[b.id] ?? NO_STOCK).initialQty
          break
        case 'actual':
          aVal = actualStock(a, stock[a.id])
          bVal = actualStock(b, stock[b.id])
          break
      }
      
      if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1
      if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1
      return 0
    })

    return result
  }, [products, search, categoryFilter, sortKey, sortOrder, stock])

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
          <h1 className="text-2xl font-bold text-foreground">Products</h1>
          <p className="text-sm text-muted-foreground">
            Manage your product catalog, pricing tiers, and stock
          </p>
        </div>
<div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExport} disabled={exporting || products.length === 0}>
            {exporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
            Export Excel
          </Button>
          <Dialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10" disabled={products.length === 0}>
                <Trash2 className="w-4 h-4 mr-2" />
                Clear All
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="w-5 h-5" />
                  Clear All Products
                </DialogTitle>
                <DialogDescription>
                  This will permanently delete all {products.length} products from your inventory. This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => setClearConfirmOpen(false)}>Cancel</Button>
                <Button variant="destructive" onClick={handleClearAll} disabled={clearing}>
                  {clearing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                  Delete All Products
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-card border border-border rounded-xl p-4 hover:border-primary/30 transition-colors">
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
        <div className="bg-card border border-border rounded-xl p-4 hover:border-emerald-500/30 transition-colors">
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
        <div className="bg-card border border-border rounded-xl p-4 hover:border-amber-500/30 transition-colors">
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
        <div className="bg-card border border-border rounded-xl p-4 hover:border-blue-500/30 transition-colors">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Package className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{stats.toCount}</p>
              <p className="text-xs text-muted-foreground">To Count</p>
            </div>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 hover:border-rose-500/30 transition-colors">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-rose-500/10 flex items-center justify-center">
              <ImageIcon className="w-5 h-5 text-rose-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{stats.total - stats.withImages}</p>
              <p className="text-xs text-muted-foreground">No Image</p>
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

      {/* Category Cards - 3D Style */}
      {(() => {
        const categoryConfig: Record<string, { icon: React.ReactNode; gradient: string; shadow: string; iconBg: string; shortLabel?: string }> = {
          'all': { 
            icon: <Package className="w-5 h-5" />, 
            gradient: 'from-slate-500 to-slate-700',
            shadow: 'shadow-slate-500/25',
            iconBg: 'bg-white/20'
          },
          'Automotive': { 
            icon: <Car className="w-5 h-5" />, 
            gradient: 'from-blue-500 to-blue-700',
            shadow: 'shadow-blue-500/25',
            iconBg: 'bg-white/20'
          },
          'Car Accessories': { 
            icon: <Car className="w-5 h-5" />, 
            gradient: 'from-sky-500 to-sky-700',
            shadow: 'shadow-sky-500/25',
            iconBg: 'bg-white/20'
          },
          'Bathroom / Personal Care': { 
            icon: <Droplets className="w-5 h-5" />, 
            gradient: 'from-cyan-500 to-cyan-700',
            shadow: 'shadow-cyan-500/25',
            iconBg: 'bg-white/20'
          },
          'Cleaning & Household': { 
            icon: <Sparkles className="w-5 h-5" />, 
            gradient: 'from-emerald-500 to-emerald-700',
            shadow: 'shadow-emerald-500/25',
            iconBg: 'bg-white/20'
          },
          'Kitchen & Food Tools': { 
            icon: <UtensilsCrossed className="w-5 h-5" />, 
            gradient: 'from-orange-500 to-orange-700',
            shadow: 'shadow-orange-500/25',
            iconBg: 'bg-white/20'
          },
          'Home / Furniture': { 
            icon: <Sofa className="w-5 h-5" />, 
            gradient: 'from-amber-500 to-amber-700',
            shadow: 'shadow-amber-500/25',
            iconBg: 'bg-white/20',
            shortLabel: 'Furniture'
          },
          'Home Decor': { 
            icon: <Lamp className="w-5 h-5" />, 
            gradient: 'from-rose-500 to-rose-700',
            shadow: 'shadow-rose-500/25',
            iconBg: 'bg-white/20',
            shortLabel: 'Decor'
          },
          'Home / Laundry': { 
            icon: <WashingMachine className="w-5 h-5" />, 
            gradient: 'from-indigo-500 to-indigo-700',
            shadow: 'shadow-indigo-500/25',
            iconBg: 'bg-white/20',
            shortLabel: 'Laundry'
          },
          'Home / Bedding': { 
            icon: <Bed className="w-5 h-5" />, 
            gradient: 'from-purple-500 to-purple-700',
            shadow: 'shadow-purple-500/25',
            iconBg: 'bg-white/20',
            shortLabel: 'Bedding'
          },
          'Health & Wellness': { 
            icon: <Heart className="w-5 h-5" />, 
            gradient: 'from-pink-500 to-pink-700',
            shadow: 'shadow-pink-500/25',
            iconBg: 'bg-white/20'
          },
          'Pet Supplies': { 
            icon: <PawPrint className="w-5 h-5" />, 
            gradient: 'from-amber-600 to-amber-800',
            shadow: 'shadow-amber-600/25',
            iconBg: 'bg-white/20'
          },
          'Garden & Outdoor': { 
            icon: <TreeDeciduous className="w-5 h-5" />, 
            gradient: 'from-green-500 to-green-700',
            shadow: 'shadow-green-500/25',
            iconBg: 'bg-white/20'
          },
          'Tools / Hardware': { 
            icon: <Wrench className="w-5 h-5" />, 
            gradient: 'from-zinc-500 to-zinc-700',
            shadow: 'shadow-zinc-500/25',
            iconBg: 'bg-white/20'
          },
          'Storage & Organization': { 
            icon: <Boxes className="w-5 h-5" />, 
            gradient: 'from-teal-500 to-teal-700',
            shadow: 'shadow-teal-500/25',
            iconBg: 'bg-white/20'
          },
          'Tiles & Flooring': { 
            icon: <LayoutGrid className="w-5 h-5" />, 
            gradient: 'from-stone-500 to-stone-700',
            shadow: 'shadow-stone-500/25',
            iconBg: 'bg-white/20'
          },
          'Baby & Kids': { 
            icon: <Baby className="w-5 h-5" />, 
            gradient: 'from-fuchsia-500 to-fuchsia-700',
            shadow: 'shadow-fuchsia-500/25',
            iconBg: 'bg-white/20'
          },
          'Bags & Travel': { 
            icon: <Briefcase className="w-5 h-5" />, 
            gradient: 'from-violet-500 to-violet-700',
            shadow: 'shadow-violet-500/25',
            iconBg: 'bg-white/20'
          },
          'Sports & Fitness': { 
            icon: <Dumbbell className="w-5 h-5" />, 
            gradient: 'from-red-500 to-red-700',
            shadow: 'shadow-red-500/25',
            iconBg: 'bg-white/20'
          },
          'Sewing & Crafts': { 
            icon: <Scissors className="w-5 h-5" />, 
            gradient: 'from-lime-500 to-lime-700',
            shadow: 'shadow-lime-500/25',
            iconBg: 'bg-white/20'
          },
          'Electronics': { 
            icon: <Zap className="w-5 h-5" />, 
            gradient: 'from-yellow-500 to-yellow-700',
            shadow: 'shadow-yellow-500/25',
            iconBg: 'bg-white/20'
          },
          'Home Appliances': { 
            icon: <Lightbulb className="w-5 h-5" />, 
            gradient: 'from-orange-400 to-orange-600',
            shadow: 'shadow-orange-400/25',
            iconBg: 'bg-white/20',
            shortLabel: 'Appliances'
          },
          'Home & Pest Control': { 
            icon: <Bug className="w-5 h-5" />, 
            gradient: 'from-red-600 to-red-800',
            shadow: 'shadow-red-600/25',
            iconBg: 'bg-white/20',
            shortLabel: 'Pest Ctrl'
          },
          'Toys & Games': { 
            icon: <Plane className="w-5 h-5" />, 
            gradient: 'from-blue-400 to-blue-600',
            shadow: 'shadow-blue-400/25',
            iconBg: 'bg-white/20'
          },
        }
        const defaultConfig = { 
          icon: <Package className="w-5 h-5" />, 
          gradient: 'from-gray-500 to-gray-700',
          shadow: 'shadow-gray-500/25',
          iconBg: 'bg-white/20'
        }
        
        return (
          <div className="overflow-x-auto pb-2 -mx-4 px-4">
            <div className="flex gap-3 min-w-max">
              {/* All Button */}
              <button
                onClick={() => setCategoryFilter('all')}
                className={`group relative flex flex-col items-center gap-2 p-3 rounded-2xl transition-all duration-300 min-w-[90px] ${
                  categoryFilter === 'all'
                    ? `bg-gradient-to-br ${categoryConfig.all.gradient} text-white shadow-lg ${categoryConfig.all.shadow} scale-105 -translate-y-1`
                    : 'bg-card border border-border hover:border-primary/30 hover:-translate-y-0.5 hover:shadow-md'
                }`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                  categoryFilter === 'all'
                    ? categoryConfig.all.iconBg
                    : 'bg-muted group-hover:bg-primary/10'
                }`}>
                  {categoryConfig.all.icon}
                </div>
                <div className="text-center">
                  <p className={`text-xs font-semibold ${categoryFilter === 'all' ? 'text-white' : 'text-foreground'}`}>All</p>
                  <p className={`text-[10px] ${categoryFilter === 'all' ? 'text-white/80' : 'text-muted-foreground'}`}>{products.length} items</p>
                </div>
                {categoryFilter === 'all' && (
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-6 h-1 bg-white rounded-full shadow-sm" />
                )}
              </button>
              
              {/* Category Buttons */}
              {categories.map(cat => {
                const count = products.filter(p => p.category === cat).length
                const config = categoryConfig[cat] || defaultConfig
                const isActive = categoryFilter === cat
                return (
                  <button
                    key={cat}
                    onClick={() => setCategoryFilter(cat)}
                    className={`group relative flex flex-col items-center gap-2 p-3 rounded-2xl transition-all duration-300 min-w-[90px] ${
                      isActive
                        ? `bg-gradient-to-br ${config.gradient} text-white shadow-lg ${config.shadow} scale-105 -translate-y-1`
                        : 'bg-card border border-border hover:border-primary/30 hover:-translate-y-0.5 hover:shadow-md'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                      isActive
                        ? config.iconBg
                        : 'bg-muted group-hover:bg-primary/10'
                    }`}>
                      {config.icon}
                    </div>
                    <div className="text-center">
                      <p className={`text-xs font-semibold truncate max-w-[70px] ${isActive ? 'text-white' : 'text-foreground'}`}>
                        {config.shortLabel || cat.split(' / ')[0].split(' & ')[0]}
                      </p>
                      <p className={`text-[10px] ${isActive ? 'text-white/80' : 'text-muted-foreground'}`}>{count} items</p>
                    </div>
                    {isActive && (
                      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-6 h-1 bg-white rounded-full shadow-sm" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* Results count */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>Showing {filtered.length} of {products.length} products</span>
        {/* Say so when some deliveries could not be matched to a product, rather
            than quietly under-reporting the Undelivered column. */}
        {unresolvedDeliveries > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-amber-600">
            <AlertTriangle className="w-3.5 h-3.5" />
            {unresolvedDeliveries.toLocaleString()} undelivered rows not matched to a product
          </span>
        )}
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
                  {/* Initial Stock: everything ever ordered, with the order date
                      of the most recent PO batch underneath. */}
                  <TableHead className="text-center border-l border-border/50">
                    <button
                      onClick={() => toggleSort('initial')}
                      className="flex items-center gap-1 hover:text-foreground transition-colors mx-auto"
                    >
                      Initial
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </TableHead>
                  {/* Actual Stock group: the three components, then the total.
                      'In Store' IS the old Qty column - same products.quantity,
                      renamed to say what it actually measures. */}
                  <TableHead className="text-center border-l border-border/50">
                    <button
                      onClick={() => toggleSort('quantity')}
                      className="flex items-center gap-1 hover:text-foreground transition-colors mx-auto"
                    >
                      In Store
                      <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </TableHead>
                  <TableHead className="text-center text-xs">In China</TableHead>
                  <TableHead className="text-center text-xs">Undelivered</TableHead>
                  <TableHead className="text-center border-r border-border/50">
                    <button
                      onClick={() => toggleSort('actual')}
                      className="flex items-center gap-1 hover:text-foreground transition-colors mx-auto font-semibold"
                    >
                      Actual
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
<TableHead className="text-right">Bundles</TableHead>
                  <TableHead className="text-center w-[60px]">B1G1</TableHead>
                  <TableHead className="text-center w-[80px]">Status</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((product) => (
                  <TableRow 
                    key={product.id} 
                    className="hover:bg-muted/30 cursor-pointer"
                    onClick={() => setEditProduct(product)}
                  >
                    <TableCell className="w-[56px]">
                      <div className="w-10 h-10 rounded-lg overflow-hidden bg-muted/50 flex items-center justify-center border border-border/50">
                        {product.image_url ? (
                          <Image
                            // 1688-hosted photos 403 a direct browser request,
                            // so they are served through the proxy.
                            src={mediaSrc(product.image_url)}
                            alt={product.name}
                            width={40}
                            height={40}
                            className="object-cover w-full h-full"
                          />
                        ) : (
                          <ImageIcon className="w-4 h-4 text-muted-foreground/30" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground truncate">{product.name}</p>
                          {product.sku && (
                            <p className="text-xs text-muted-foreground">SKU: {product.sku}</p>
                          )}
                        </div>
                        {!product.image_url && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 w-6 p-0 text-muted-foreground/50 hover:text-primary shrink-0"
                            onClick={(e) => handleQuickPasteImage(product.id, e)}
                            disabled={pastingImageFor === product.id}
                            title="Paste image from clipboard"
                          >
                            {pastingImageFor === product.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <ClipboardPaste className="w-3 h-3" />
                            )}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {product.category ? (
                        <span className="text-sm text-muted-foreground">{product.category}</span>
                      ) : (
                        <span className="text-muted-foreground/50">-</span>
                      )}
                    </TableCell>
                    {(() => {
                      const st = stock[product.id] ?? NO_STOCK
                      return (
                        <>
                          <TableCell className="text-center border-l border-border/50">
                            {st.initialQty > 0 ? (
                              <div className="flex flex-col items-center leading-tight">
                                <span className="text-sm font-medium text-foreground">
                                  {st.initialQty.toLocaleString()}
                                </span>
                                {/* Order date is blank until entered - all POs
                                    share one bulk-import timestamp, so showing
                                    that would fake an ordering date. */}
                                {st.latestOrderDate ? (
                                  <span className="text-[10px] text-muted-foreground">
                                    {new Date(st.latestOrderDate).toLocaleDateString('en-GB', {
                                      day: '2-digit',
                                      month: 'short',
                                      year: '2-digit',
                                    })}
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-muted-foreground/40">no date</span>
                                )}
                                {st.poBatches.length > 1 && (
                                  <span className="text-[10px] text-muted-foreground/60">
                                    {st.poBatches.length} batches
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground/40">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center border-l border-border/50">
                            <QuantityBadge quantity={product.quantity} hasVariants={product.has_variants} />
                          </TableCell>
                          <TableCell className="text-center">
                            <StockPart value={st.chinaQty} className="text-sky-500" />
                          </TableCell>
                          <TableCell className="text-center">
                            <StockPart value={st.undeliveredQty} className="text-amber-500" />
                          </TableCell>
                          <TableCell className="text-center border-r border-border/50">
                            <span className="text-sm font-semibold text-foreground">
                              {actualStock(product, st).toLocaleString()}
                            </span>
                          </TableCell>
                        </>
                      )
                    })()}
                    <TableCell className="text-right">
                      {product.price > 0 ? (
                        <span className="font-medium text-foreground">Rs {product.price}</span>
                      ) : (
                        <span className="text-muted-foreground/50">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {Object.keys(product.bundle_prices || {}).length > 0 ? (
                        <div className="flex flex-wrap gap-1 justify-end">
                          {Object.entries(product.bundle_prices || {})
                            .sort(([a], [b]) => Number(a) - Number(b))
                            .map(([tier, price]) => (
                              <Badge key={tier} variant="outline" className="text-xs font-normal bg-amber-500/10 text-amber-600 border-amber-500/20">
                                {tier}x Rs{price}
                              </Badge>
                            ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground/50">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {product.is_b1g1 && (
                        <Badge className="bg-violet-500/10 text-violet-500 border-violet-500/20 border text-xs">
                          B1G1
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {product.is_active ? (
                        <div className="flex items-center justify-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          <span className="text-xs text-emerald-600">Active</span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50"></span>
                          <span className="text-xs text-muted-foreground">Inactive</span>
                        </div>
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
                    src={mediaSrc(product.image_url)}
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
                  <QuantityBadge quantity={product.quantity} hasVariants={product.has_variants} />
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
                {/* Pricing */}
                <div className="text-xs pt-1 border-t border-border space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Unit:</span>
                    <span className="font-medium text-foreground">{product.price > 0 ? `Rs ${product.price}` : '-'}</span>
                  </div>
                  {Object.keys(product.bundle_prices || {}).length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Bundles:</span>
                      <span className="font-medium text-foreground">
                        {Object.entries(product.bundle_prices || {})
                          .sort(([a], [b]) => Number(a) - Number(b))
                          .map(([tier, price]) => `${tier}pk Rs${price}`)
                          .join(', ')}
                      </span>
                    </div>
                  )}
                  {product.is_b1g1 && (
                    <Badge className="bg-violet-500/10 text-violet-600 border-0 text-xs">B1G1 Offer</Badge>
                  )}
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

/**
 * Actual Stock = in store + in China + undelivered.
 *
 * `products.quantity` is the counted Mauritius on-hand and is the ONLY source
 * for the in-store part. PO status 'Received' describes that same physical
 * stock (327 of 378 POs are Received), so it is excluded from chinaQty rather
 * than added in - otherwise received goods would be counted twice.
 * Undelivered is included as committed stock but never subtracted.
 */
function actualStock(product: Product, s: ProductStock | undefined): number {
  const st = s ?? NO_STOCK
  return (product.quantity || 0) + st.chinaQty + st.undeliveredQty
}

/** Muted dash for a genuinely zero component, so real zeros read as zero. */
function StockPart({ value, className }: { value: number; className: string }) {
  if (!value) return <span className="text-xs text-muted-foreground/40">—</span>
  return <span className={`text-xs font-medium ${className}`}>{value.toLocaleString()}</span>
}

function QuantityBadge({ quantity, hasVariants }: { quantity: number | null | undefined, hasVariants?: boolean }) {
  // Product has variants - show "Variants" badge
  if (hasVariants) {
    return (
      <Badge className="bg-violet-500/10 text-violet-600 hover:bg-violet-500/20 border-0">
        Variants
      </Badge>
    )
  }
  // No quantity set or zero - needs manual counting
  if (quantity === null || quantity === undefined || quantity === 0) {
    return (
      <Badge className="bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 border-0">
        To Count
      </Badge>
    )
  }
  // Low stock (1-5)
  if (quantity <= 5) {
    return (
      <Badge className="bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 border-0">
        Low: {quantity}
      </Badge>
    )
  }
  // In stock
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
  // Bundle prices - flexible tiers
  const [bundlePrices, setBundlePrices] = useState<Record<string, string>>(
    Object.fromEntries(
      Object.entries(product?.bundle_prices || {}).map(([k, v]) => [k, String(v)])
    )
  )
  const [isB1g1, setIsB1g1] = useState(product?.is_b1g1 ?? false)
  const [remarks, setRemarks] = useState(product?.remarks || '')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  
  // Variants management
  const [hasVariants, setHasVariants] = useState(product?.has_variants ?? false)
  const [variants, setVariants] = useState<Array<{
    id?: string
    attribute_name: string
    attribute_value: string
    quantity: number
    price_override: number | null
    sku: string | null
    isNew?: boolean
    toDelete?: boolean
  }>>([])
  const [loadingVariants, setLoadingVariants] = useState(false)
  
  // Fetch existing variants when editing
  useEffect(() => {
    async function fetchVariants() {
      if (!product?.id || !product?.has_variants) return
      setLoadingVariants(true)
      try {
        const supabase = createClient()
        const { data, error } = await supabase
          .from('product_variants')
          .select('*')
          .eq('product_id', product.id)
          .order('attribute_name', { ascending: true })
          .order('attribute_value', { ascending: true })
        if (error) throw error
        setVariants(data || [])
      } catch (err) {
        console.error('Failed to load variants:', err)
      } finally {
        setLoadingVariants(false)
      }
    }
    fetchVariants()
  }, [product?.id, product?.has_variants])

  async function uploadImageFile(file: File) {
    setUploading(true)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop() || 'png'
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

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    await uploadImageFile(file)
  }

  async function handlePasteImage() {
    try {
      const clipboardItems = await navigator.clipboard.read()
      for (const item of clipboardItems) {
        const imageType = item.types.find(type => type.startsWith('image/'))
        if (imageType) {
          const blob = await item.getType(imageType)
          const ext = imageType.split('/')[1] || 'png'
          const file = new File([blob], `pasted-image.${ext}`, { type: imageType })
          await uploadImageFile(file)
          return
        }
      }
      setError('No image found in clipboard. Copy an image first.')
    } catch (err) {
      setError('Paste failed: ' + (err as Error).message)
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
        quantity: hasVariants ? 0 : (parseInt(quantity) || 0), // If has variants, main quantity is 0
        bundle_prices: Object.fromEntries(
          Object.entries(bundlePrices)
            .filter(([, v]) => v && parseFloat(v) > 0)
            .map(([k, v]) => [k, parseFloat(v)])
        ),
        is_b1g1: isB1g1,
        remarks: remarks.trim() || null,
        has_variants: hasVariants,
        updated_at: new Date().toISOString(),
      }

      let savedProduct: Product
      if (product) {
        const { data, error: err } = await supabase
          .from('products')
          .update(payload)
          .eq('id', product.id)
          .select()
          .single()
        if (err) throw err
        savedProduct = data
      } else {
        const { data, error: err } = await supabase
          .from('products')
          .insert(payload)
          .select()
          .single()
        if (err) throw err
        savedProduct = data
      }
      
      // Save variants if has_variants is enabled
      if (hasVariants && savedProduct) {
        // Delete variants marked for deletion
        const toDelete = variants.filter(v => v.toDelete && v.id)
        for (const v of toDelete) {
          await supabase.from('product_variants').delete().eq('id', v.id)
        }
        
        // Upsert remaining variants
        const toSave = variants.filter(v => !v.toDelete)
        for (const v of toSave) {
          const variantPayload = {
            product_id: savedProduct.id,
            attribute_name: v.attribute_name.trim(),
            attribute_value: v.attribute_value.trim(),
            quantity: v.quantity || 0,
            price_override: v.price_override,
            sku: v.sku?.trim() || null,
            updated_at: new Date().toISOString(),
          }
          
          if (v.id && !v.isNew) {
            await supabase.from('product_variants').update(variantPayload).eq('id', v.id)
          } else {
            await supabase.from('product_variants').insert(variantPayload)
          }
        }
      } else if (!hasVariants && product?.has_variants) {
        // If variants were disabled, delete all variants
        await supabase.from('product_variants').delete().eq('product_id', product.id)
      }
      
      onSave(savedProduct)
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
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handlePasteImage}
                disabled={uploading}
                className="text-xs"
              >
                <ClipboardPaste className="w-3 h-3 mr-1" />
                Paste Image
              </Button>
              {imageUrl && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  asChild
                  className="text-xs"
                >
                  <a href={imageUrl} download target="_blank" rel="noopener noreferrer">
                    <Download className="w-3 h-3 mr-1" />
                    Download
                  </a>
                </Button>
              )}
              <p className="text-xs text-muted-foreground">or click box to upload</p>
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
            <Select value={category} onValueChange={setCategory} disabled={saving}>
              <SelectTrigger id="product-category">
                <SelectValue placeholder="Select category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Automotive">Automotive</SelectItem>
                <SelectItem value="Bags & Travel">Bags & Travel</SelectItem>
                <SelectItem value="Bathroom / Personal Care">Bathroom / Personal Care</SelectItem>
                <SelectItem value="Car Accessories">Car Accessories</SelectItem>
                <SelectItem value="Cleaning & Household">Cleaning & Household</SelectItem>
                <SelectItem value="Electronics">Electronics</SelectItem>
                <SelectItem value="Health & Wellness">Health & Wellness</SelectItem>
                <SelectItem value="Home / Bedding">Home / Bedding</SelectItem>
                <SelectItem value="Home / Furniture">Home / Furniture</SelectItem>
                <SelectItem value="Home / Laundry">Home / Laundry</SelectItem>
                <SelectItem value="Home & Pest Control">Home & Pest Control</SelectItem>
                <SelectItem value="Home Appliances">Home Appliances</SelectItem>
                <SelectItem value="Kitchen & Food Tools">Kitchen & Food Tools</SelectItem>
                <SelectItem value="Pet / Outdoor">Pet / Outdoor</SelectItem>
                <SelectItem value="Pet Supplies">Pet Supplies</SelectItem>
                <SelectItem value="Phone Accessories">Phone Accessories</SelectItem>
                <SelectItem value="Sewing & Crafts">Sewing & Crafts</SelectItem>
                <SelectItem value="Sports & Fitness">Sports & Fitness</SelectItem>
                <SelectItem value="Storage & Organization">Storage & Organization</SelectItem>
                <SelectItem value="Tiles & Flooring">Tiles & Flooring</SelectItem>
                <SelectItem value="Tools / Hardware">Tools / Hardware</SelectItem>
                <SelectItem value="Toys & Games">Toys & Games</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Has Variants Toggle */}
        <label className="flex items-center gap-2 cursor-pointer py-2 border-y border-border">
          <input
            type="checkbox"
            checked={hasVariants}
            onChange={(e) => setHasVariants(e.target.checked)}
            className="rounded border-border"
          />
          <span className="text-sm font-medium">Has Variants (Size, Color, etc.)</span>
        </label>

        {/* Quantity & Unit Price - only show quantity if no variants */}
        <div className="grid grid-cols-2 gap-3">
          {!hasVariants && (
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
          )}
          <div className={`space-y-2 ${hasVariants ? 'col-span-2' : ''}`}>
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
        
        {/* Variants Management */}
        {hasVariants && (
          <div className="space-y-3 p-3 bg-muted/50 rounded-lg border">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Product Variants</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setVariants([...variants, { 
                  attribute_name: '', 
                  attribute_value: '', 
                  quantity: 0, 
                  price_override: null, 
                  sku: null,
                  isNew: true 
                }])}
                disabled={saving}
              >
                <Plus className="w-3 h-3 mr-1" />
                Add Variant
              </Button>
            </div>
            
            {loadingVariants ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : variants.filter(v => !v.toDelete).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No variants yet. Click &quot;Add Variant&quot; to create one.
              </p>
            ) : (
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {variants.map((variant, idx) => 
                  variant.toDelete ? null : (
                    <div key={variant.id || `new-${idx}`} className="grid grid-cols-12 gap-2 items-center bg-background p-2 rounded border">
                      <select
                        value={variant.attribute_name}
                        onChange={(e) => {
                          const updated = [...variants]
                          updated[idx].attribute_name = e.target.value
                          setVariants(updated)
                        }}
                        disabled={saving}
                        className="col-span-3 h-8 text-xs bg-background border border-input rounded-md px-2"
                      >
                        <option value="">Select...</option>
                        <option value="Size">Size</option>
                        <option value="Color">Color</option>
                        <option value="Capacity">Capacity</option>
                        <option value="Material">Material</option>
                        <option value="Style">Style</option>
                        <option value="Weight">Weight</option>
                        <option value="Length">Length</option>
                        <option value="Pack">Pack</option>
                      </select>
                      <Input
                        placeholder="Value (e.g., Large)"
                        value={variant.attribute_value}
                        onChange={(e) => {
                          const updated = [...variants]
                          updated[idx].attribute_value = e.target.value
                          setVariants(updated)
                        }}
                        disabled={saving}
                        className="col-span-3 h-8 text-xs"
                      />
                      <Input
                        type="number"
                        placeholder="Qty"
                        value={variant.quantity || ''}
                        onChange={(e) => {
                          const updated = [...variants]
                          updated[idx].quantity = parseInt(e.target.value) || 0
                          setVariants(updated)
                        }}
                        disabled={saving}
                        className="col-span-2 h-8 text-xs"
                      />
                      <Input
                        type="number"
                        placeholder="Price"
                        value={variant.price_override ?? ''}
                        onChange={(e) => {
                          const updated = [...variants]
                          updated[idx].price_override = e.target.value ? parseFloat(e.target.value) : null
                          setVariants(updated)
                        }}
                        disabled={saving}
                        className="col-span-3 h-8 text-xs"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="col-span-1 h-8 w-8 p-0 text-destructive hover:text-destructive"
                        onClick={() => {
                          const updated = [...variants]
                          if (variant.id && !variant.isNew) {
                            updated[idx].toDelete = true
                          } else {
                            updated.splice(idx, 1)
                          }
                          setVariants(updated)
                        }}
                        disabled={saving}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  )
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Leave price empty to use the main unit price. Total stock: {variants.filter(v => !v.toDelete).reduce((sum, v) => sum + (v.quantity || 0), 0)}
            </p>
          </div>
        )}

        {/* Bundle Pricing */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-medium">Bundle Prices (Rs)</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                const nextTier = ['2', '3', '4', '6', '8', '10', '12'].find(t => !bundlePrices[t])
                if (nextTier) setBundlePrices({ ...bundlePrices, [nextTier]: '' })
              }}
              disabled={saving}
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Tier
            </Button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {Object.entries(bundlePrices).sort(([a], [b]) => Number(a) - Number(b)).map(([tier, tierPrice]) => (
              <div key={tier} className="space-y-1 relative">
                <Label className="text-xs text-muted-foreground">{tier}-Pack</Label>
                <div className="flex gap-1">
                  <Input
                    type="number"
                    value={tierPrice}
                    onChange={(e) => setBundlePrices({ ...bundlePrices, [tier]: e.target.value })}
                    placeholder="0"
                    disabled={saving}
                    className="h-9"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 w-9 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      const updated = { ...bundlePrices }
                      delete updated[tier]
                      setBundlePrices(updated)
                    }}
                    disabled={saving}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
            {Object.keys(bundlePrices).length === 0 && (
              <p className="col-span-4 text-xs text-muted-foreground py-2">No bundle prices set. Click &quot;Add Tier&quot; to add one.</p>
            )}
          </div>
        </div>
        
        {/* B1G1 Offer Toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isB1g1}
            onChange={(e) => setIsB1g1(e.target.checked)}
            className="rounded border-border"
            disabled={saving}
          />
          <span className="text-sm">B1G1 Offer (Buy 1 Get 1)</span>
        </label>

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
