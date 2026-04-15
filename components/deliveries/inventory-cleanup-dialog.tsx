'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertTriangle, Trash2, Merge, Loader2, Sparkles, Check, Search } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'

interface DuplicateGroup {
  normalized_name: string
  count: number
  ids: string[]
  name_variants: string[]
  products: ProductDetail[]
}

interface ProductDetail {
  id: string
  name: string
  price: number
  category: string | null
  quantity: number
  image_url: string | null
  created_at: string
}

interface InventoryCleanupDialogProps {
  onSuccess?: () => void
}

export function InventoryCleanupDialog({ onSuccess }: InventoryCleanupDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [duplicates, setDuplicates] = useState<DuplicateGroup[]>([])
  const [selectedMasters, setSelectedMasters] = useState<Record<string, string>>({})
  const [merging, setMerging] = useState<string | null>(null)
  const [mergedGroups, setMergedGroups] = useState<Set<string>>(new Set())
  const [searchTerm, setSearchTerm] = useState('')
  const [activeTab, setActiveTab] = useState('exact')
  
  const supabase = createClient()

  const fetchDuplicates = async () => {
    setLoading(true)
    try {
      // Fetch exact duplicates (case-insensitive)
      const { data: exactDupes } = await supabase.rpc('find_duplicate_products')
      
      if (exactDupes && exactDupes.length > 0) {
        // Fetch full product details for each group
        const groupsWithDetails: DuplicateGroup[] = []
        
        for (const group of exactDupes) {
          const { data: products } = await supabase
            .from('products')
            .select('id, name, price, category, quantity, image_url, created_at')
            .in('id', group.ids)
          
          if (products) {
            groupsWithDetails.push({
              ...group,
              products: products as ProductDetail[]
            })
          }
        }
        
        setDuplicates(groupsWithDetails)
        
        // Auto-select the first product as master for each group
        const masters: Record<string, string> = {}
        groupsWithDetails.forEach(group => {
          if (group.products.length > 0) {
            // Prefer the one with an image, or the oldest one
            const withImage = group.products.find(p => p.image_url)
            const oldest = group.products.sort((a, b) => 
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            )[0]
            masters[group.normalized_name] = withImage?.id || oldest.id
          }
        })
        setSelectedMasters(masters)
      }
    } catch (error) {
      console.error('Error fetching duplicates:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) {
      fetchDuplicates()
    }
  }, [open])

  const handleMerge = async (group: DuplicateGroup) => {
    const masterId = selectedMasters[group.normalized_name]
    if (!masterId) return

    setMerging(group.normalized_name)
    try {
      const duplicateIds = group.ids.filter(id => id !== masterId)
      
      // Update any deliveries referencing the duplicate products to use master
      // This assumes deliveries has a 'products' text field - adjust if needed
      for (const dupId of duplicateIds) {
        const dupProduct = group.products.find(p => p.id === dupId)
        const masterProduct = group.products.find(p => p.id === masterId)
        
        if (dupProduct && masterProduct) {
          // Update deliveries that reference the duplicate product name
          await supabase
            .from('deliveries')
            .update({ products: masterProduct.name })
            .eq('products', dupProduct.name)
        }
      }

      // Merge quantities into master
      const totalQuantity = group.products.reduce((sum, p) => sum + (p.quantity || 0), 0)
      await supabase
        .from('products')
        .update({ quantity: totalQuantity })
        .eq('id', masterId)

      // Delete duplicate products
      await supabase
        .from('products')
        .delete()
        .in('id', duplicateIds)

      setMergedGroups(prev => new Set([...prev, group.normalized_name]))
      
      // Remove from duplicates list
      setDuplicates(prev => prev.filter(g => g.normalized_name !== group.normalized_name))
      
    } catch (error) {
      console.error('Error merging products:', error)
    } finally {
      setMerging(null)
    }
  }

  const handleMergeAll = async () => {
    for (const group of duplicates) {
      await handleMerge(group)
    }
    onSuccess?.()
  }

  const filteredDuplicates = duplicates.filter(group =>
    group.normalized_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    group.products.some(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
  )

  const totalDuplicates = duplicates.reduce((sum, g) => sum + g.count - 1, 0)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Sparkles className="w-4 h-4" />
          Clean Duplicates
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-500" />
            Inventory Cleanup - Duplicate Detection
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            <span className="ml-3 text-muted-foreground">Analyzing inventory for duplicates...</span>
          </div>
        ) : duplicates.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Check className="w-12 h-12 text-emerald-500 mb-3" />
            <h3 className="font-semibold text-lg">No Duplicates Found</h3>
            <p className="text-muted-foreground text-sm mt-1">Your inventory is clean!</p>
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="flex items-center justify-between bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                <span className="font-medium">
                  Found {duplicates.length} duplicate groups ({totalDuplicates} items to merge)
                </span>
              </div>
              <Button 
                onClick={handleMergeAll} 
                disabled={!!merging}
                className="bg-amber-500 hover:bg-amber-600"
              >
                <Merge className="w-4 h-4 mr-2" />
                Merge All
              </Button>
            </div>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search duplicates..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Duplicate Groups */}
            <ScrollArea className="flex-1 -mx-6 px-6">
              <div className="space-y-4 pb-4">
                {filteredDuplicates.map((group) => (
                  <div 
                    key={group.normalized_name}
                    className="border rounded-lg p-4 bg-card"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{group.count} variants</Badge>
                        <span className="font-medium capitalize">{group.normalized_name}</span>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleMerge(group)}
                        disabled={!!merging}
                      >
                        {merging === group.normalized_name ? (
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        ) : (
                          <Merge className="w-4 h-4 mr-2" />
                        )}
                        Merge
                      </Button>
                    </div>

                    <div className="text-xs text-muted-foreground mb-3">
                      Select which product to keep as the master (others will be merged into it):
                    </div>

                    <div className="space-y-2">
                      {group.products.map((product) => (
                        <div 
                          key={product.id}
                          onClick={() => setSelectedMasters(prev => ({
                            ...prev,
                            [group.normalized_name]: product.id
                          }))}
                          className={`
                            flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all
                            ${selectedMasters[group.normalized_name] === product.id 
                              ? 'border-primary bg-primary/5 ring-1 ring-primary' 
                              : 'border-border hover:border-muted-foreground/50'
                            }
                          `}
                        >
                          <div className={`
                            w-5 h-5 rounded-full border-2 flex items-center justify-center
                            ${selectedMasters[group.normalized_name] === product.id 
                              ? 'border-primary bg-primary' 
                              : 'border-muted-foreground/30'
                            }
                          `}>
                            {selectedMasters[group.normalized_name] === product.id && (
                              <Check className="w-3 h-3 text-primary-foreground" />
                            )}
                          </div>

                          {product.image_url && (
                            <img 
                              src={product.image_url} 
                              alt={product.name}
                              className="w-10 h-10 rounded object-cover"
                            />
                          )}

                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{product.name}</div>
                            <div className="text-xs text-muted-foreground flex items-center gap-2">
                              <span>Rs {product.price}</span>
                              {product.category && (
                                <>
                                  <span>•</span>
                                  <span>{product.category}</span>
                                </>
                              )}
                              <span>•</span>
                              <span>Qty: {product.quantity || 0}</span>
                            </div>
                          </div>

                          {selectedMasters[group.normalized_name] === product.id && (
                            <Badge className="bg-primary">Master</Badge>
                          )}
                          
                          {product.image_url && (
                            <Badge variant="outline" className="text-emerald-600 border-emerald-600">
                              Has Image
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
