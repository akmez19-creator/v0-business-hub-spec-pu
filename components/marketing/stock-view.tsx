'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Package, Search, AlertTriangle } from 'lucide-react'

interface StockItem {
  id: string
  name: string
  sku: string | null
  quantity: number
  min_quantity: number | null
  category_id: string | null
  unit_price: number | null
}

interface Category {
  id: string
  name: string
}

interface Props {
  stockItems: StockItem[]
  categories: Category[]
}

export function MarketingStockView({ stockItems, categories }: Props) {
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  const categoryMap = new Map(categories.map(c => [c.id, c.name]))

  const filteredItems = stockItems.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(search.toLowerCase()) ||
      (item.sku && item.sku.toLowerCase().includes(search.toLowerCase()))
    const matchesCategory = !selectedCategory || item.category_id === selectedCategory
    return matchesSearch && matchesCategory
  })

  const lowStockItems = stockItems.filter(item => 
    item.min_quantity && item.quantity <= item.min_quantity
  )

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Stock Inventory</h1>
        <p className="text-muted-foreground mt-1">View current stock levels</p>
      </div>

      {/* Low Stock Alert */}
      {lowStockItems.length > 0 && (
        <Card className="mb-6 border-amber-500/50 bg-amber-500/10">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <div>
                <p className="font-semibold text-amber-500">Low Stock Alert</p>
                <p className="text-sm text-muted-foreground">
                  {lowStockItems.length} item(s) are below minimum stock level
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <Badge
            variant={selectedCategory === null ? 'default' : 'outline'}
            className="cursor-pointer"
            onClick={() => setSelectedCategory(null)}
          >
            All
          </Badge>
          {categories.map((cat) => (
            <Badge
              key={cat.id}
              variant={selectedCategory === cat.id ? 'default' : 'outline'}
              className="cursor-pointer"
              onClick={() => setSelectedCategory(cat.id)}
            >
              {cat.name}
            </Badge>
          ))}
        </div>
      </div>

      {/* Stock Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredItems.map((item) => {
          const isLow = item.min_quantity && item.quantity <= item.min_quantity
          return (
            <Card 
              key={item.id} 
              className={isLow ? 'border-amber-500/50' : ''}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
                    <Package className="w-5 h-5 text-violet-500" />
                  </div>
                  {isLow && (
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20">
                      Low Stock
                    </Badge>
                  )}
                </div>
                <h3 className="font-semibold truncate">{item.name}</h3>
                {item.sku && (
                  <p className="text-xs text-muted-foreground">SKU: {item.sku}</p>
                )}
                <div className="mt-3 flex items-baseline justify-between">
                  <span className="text-2xl font-bold">{item.quantity}</span>
                  {item.min_quantity && (
                    <span className="text-xs text-muted-foreground">
                      Min: {item.min_quantity}
                    </span>
                  )}
                </div>
                {item.category_id && (
                  <Badge variant="secondary" className="mt-2">
                    {categoryMap.get(item.category_id) || 'Unknown'}
                  </Badge>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {filteredItems.length === 0 && (
        <div className="text-center py-12">
          <Package className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">No stock items found</p>
        </div>
      )}
    </div>
  )
}
