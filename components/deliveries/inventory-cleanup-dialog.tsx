'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertTriangle, Merge, Loader2, Sparkles, Check, Search, Brain, Copy } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface DuplicateGroup {
  normalized_name?: string
  reason?: string
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
  const [aiLoading, setAiLoading] = useState(false)
  const [exactDuplicates, setExactDuplicates] = useState<DuplicateGroup[]>([])
  const [aiDuplicates, setAiDuplicates] = useState<DuplicateGroup[]>([])
  const [selectedMasters, setSelectedMasters] = useState<Record<string, string>>({})
  const [merging, setMerging] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [activeTab, setActiveTab] = useState('exact')
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)
  
  const supabase = createClient()

  const fetchExactDuplicates = async () => {
    setLoading(true)
    try {
      const { data: exactDupes } = await supabase.rpc('find_duplicate_products')
      
      if (exactDupes && exactDupes.length > 0) {
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
        
        setExactDuplicates(groupsWithDetails)
        autoSelectMasters(groupsWithDetails)
      }
    } catch (error) {
      console.error('Error fetching duplicates:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchAiDuplicates = async () => {
    setAiLoading(true)
    try {
      const res = await fetch('/api/inventory/find-similar', { method: 'POST' })
      const data = await res.json()
      
      if (data.groups) {
        setAiDuplicates(data.groups)
        autoSelectMasters(data.groups, 'ai_')
      }
    } catch (error) {
      console.error('Error fetching AI duplicates:', error)
    } finally {
      setAiLoading(false)
    }
  }

  const autoSelectMasters = (groups: DuplicateGroup[], prefix = '') => {
    const masters: Record<string, string> = { ...selectedMasters }
    groups.forEach((group, idx) => {
      const key = prefix + (group.normalized_name || `group_${idx}`)
      if (group.products.length > 0) {
        const withImage = group.products.find(p => p.image_url)
        const oldest = [...group.products].sort((a, b) => 
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )[0]
        masters[key] = withImage?.id || oldest.id
      }
    })
    setSelectedMasters(masters)
  }

  useEffect(() => {
    if (open) {
      fetchExactDuplicates()
    }
  }, [open])

  const handleMerge = async (group: DuplicateGroup, prefix = '') => {
    const key = prefix + (group.normalized_name || `group_${exactDuplicates.indexOf(group)}`)
    const masterId = selectedMasters[key]
    if (!masterId) return

    setMerging(key)
    try {
      const duplicateIds = group.ids.filter(id => id !== masterId)
      
      for (const dupId of duplicateIds) {
        const dupProduct = group.products.find(p => p.id === dupId)
        const masterProduct = group.products.find(p => p.id === masterId)
        
        if (dupProduct && masterProduct) {
          await supabase
            .from('deliveries')
            .update({ products: masterProduct.name })
            .eq('products', dupProduct.name)
        }
      }

      const totalQuantity = group.products.reduce((sum, p) => sum + (p.quantity || 0), 0)
      await supabase
        .from('products')
        .update({ quantity: totalQuantity })
        .eq('id', masterId)

      await supabase
        .from('products')
        .delete()
        .in('id', duplicateIds)

      // Remove from lists
      if (prefix === 'ai_') {
        setAiDuplicates(prev => prev.filter(g => g !== group))
      } else {
        setExactDuplicates(prev => prev.filter(g => g.normalized_name !== group.normalized_name))
      }
      
      onSuccess?.()
    } catch (error) {
      console.error('Error merging products:', error)
    } finally {
      setMerging(null)
    }
  }

  const handleMergeAll = async (groups: DuplicateGroup[], prefix = '') => {
    for (const group of groups) {
      await handleMerge(group, prefix)
    }
  }

  const filterGroups = (groups: DuplicateGroup[]) => {
    if (!searchTerm) return groups
    return groups.filter(group =>
      (group.normalized_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (group.reason || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      group.products.some(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
    )
  }

  const filteredExact = filterGroups(exactDuplicates)
  const filteredAi = filterGroups(aiDuplicates)

  const getGroupKey = (group: DuplicateGroup, prefix = '', idx = 0) => {
    return prefix + (group.normalized_name || `group_${idx}`)
  }

  const renderGroupTable = (groups: DuplicateGroup[], prefix = '') => (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[50px]">#</TableHead>
          <TableHead>Product Variants</TableHead>
          <TableHead className="w-[100px] text-center">Count</TableHead>
          <TableHead className="w-[120px] text-right">Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((group, idx) => {
          const key = getGroupKey(group, prefix, idx)
          const isExpanded = expandedGroup === key
          const masterId = selectedMasters[key]
          
          return (
            <>
              <TableRow 
                key={key}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => setExpandedGroup(isExpanded ? null : key)}
              >
                <TableCell className="font-mono text-muted-foreground">{idx + 1}</TableCell>
                <TableCell>
                  <div className="space-y-1">
                    <div className="font-medium flex items-center gap-2">
                      {group.normalized_name ? (
                        <span className="capitalize">{group.normalized_name}</span>
                      ) : (
                        <span className="text-muted-foreground italic">Similar products</span>
                      )}
                      {group.reason && (
                        <Badge variant="outline" className="text-xs font-normal">
                          {group.reason}
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {group.name_variants.slice(0, 3).map((name, i) => (
                        <Badge key={i} variant="secondary" className="text-xs font-normal">
                          {name}
                        </Badge>
                      ))}
                      {group.name_variants.length > 3 && (
                        <Badge variant="secondary" className="text-xs font-normal">
                          +{group.name_variants.length - 3} more
                        </Badge>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant="destructive" className="font-mono">
                    {group.count}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleMerge(group, prefix)
                    }}
                    disabled={!!merging}
                    className="h-8"
                  >
                    {merging === key ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <>
                        <Merge className="w-3 h-3 mr-1" />
                        Merge
                      </>
                    )}
                  </Button>
                </TableCell>
              </TableRow>
              
              {/* Expanded row with product selection */}
              {isExpanded && (
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableCell colSpan={4} className="p-4">
                    <div className="text-xs text-muted-foreground mb-2">
                      Click to select the master product (others will be merged into it):
                    </div>
                    <div className="grid gap-2">
                      {group.products.map((product) => (
                        <div 
                          key={product.id}
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedMasters(prev => ({ ...prev, [key]: product.id }))
                          }}
                          className={`
                            flex items-center gap-3 p-2 rounded-md border cursor-pointer transition-all text-sm
                            ${masterId === product.id 
                              ? 'border-primary bg-primary/10' 
                              : 'border-border/50 hover:border-border'
                            }
                          `}
                        >
                          <div className={`
                            w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0
                            ${masterId === product.id ? 'border-primary bg-primary' : 'border-muted-foreground/30'}
                          `}>
                            {masterId === product.id && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                          </div>

                          {product.image_url && (
                            <img 
                              src={product.image_url} 
                              alt=""
                              className="w-8 h-8 rounded object-cover shrink-0"
                            />
                          )}

                          <div className="flex-1 min-w-0">
                            <span className="font-medium">{product.name}</span>
                          </div>

                          <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                            <span>Rs {product.price}</span>
                            <span>•</span>
                            <span>Qty: {product.quantity || 0}</span>
                          </div>

                          {masterId === product.id && (
                            <Badge size="sm" className="bg-primary text-[10px] px-1.5 py-0">Master</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </>
          )
        })}
      </TableBody>
    </Table>
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Sparkles className="w-4 h-4" />
          Clean Duplicates
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="w-5 h-5 text-amber-500" />
            Inventory Cleanup
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <div className="px-6 pt-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="exact" className="gap-2">
                <Copy className="w-4 h-4" />
                Exact Matches
                {exactDuplicates.length > 0 && (
                  <Badge variant="destructive" className="ml-1 h-5 px-1.5">
                    {exactDuplicates.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="ai" className="gap-2" onClick={() => !aiDuplicates.length && !aiLoading && fetchAiDuplicates()}>
                <Brain className="w-4 h-4" />
                AI Detection
                {aiDuplicates.length > 0 && (
                  <Badge variant="destructive" className="ml-1 h-5 px-1.5">
                    {aiDuplicates.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Search */}
          <div className="px-6 py-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search products..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
          </div>

          <TabsContent value="exact" className="flex-1 overflow-hidden m-0 flex flex-col">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground">Scanning inventory...</span>
              </div>
            ) : exactDuplicates.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Check className="w-10 h-10 text-emerald-500 mb-2" />
                <h3 className="font-medium">No Exact Duplicates</h3>
                <p className="text-muted-foreground text-sm mt-1">Try AI Detection for similar names</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between px-6 py-2 bg-amber-500/10 border-y border-amber-500/20">
                  <span className="text-sm">
                    <strong>{exactDuplicates.length}</strong> duplicate groups found
                  </span>
                  <Button 
                    size="sm"
                    onClick={() => handleMergeAll(filteredExact)} 
                    disabled={!!merging}
                    className="h-7 bg-amber-500 hover:bg-amber-600"
                  >
                    <Merge className="w-3 h-3 mr-1" />
                    Merge All
                  </Button>
                </div>
                <ScrollArea className="flex-1">
                  <div className="px-6 pb-4">
                    {renderGroupTable(filteredExact)}
                  </div>
                </ScrollArea>
              </>
            )}
          </TabsContent>

          <TabsContent value="ai" className="flex-1 overflow-hidden m-0 flex flex-col">
            {aiLoading ? (
              <div className="flex items-center justify-center py-12">
                <Brain className="w-6 h-6 animate-pulse text-violet-500" />
                <span className="ml-2 text-sm text-muted-foreground">AI analyzing products...</span>
              </div>
            ) : aiDuplicates.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                <Brain className="w-10 h-10 text-violet-500/50 mb-2" />
                <h3 className="font-medium">AI-Powered Detection</h3>
                <p className="text-muted-foreground text-sm mt-1 max-w-sm">
                  Uses AI to find similar product names with typos, abbreviations, or different wording
                </p>
                <Button 
                  onClick={fetchAiDuplicates} 
                  className="mt-4 gap-2"
                  variant="outline"
                >
                  <Brain className="w-4 h-4" />
                  Run AI Analysis
                </Button>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between px-6 py-2 bg-violet-500/10 border-y border-violet-500/20">
                  <span className="text-sm">
                    <strong>{aiDuplicates.length}</strong> similar groups detected by AI
                  </span>
                  <Button 
                    size="sm"
                    onClick={() => handleMergeAll(filteredAi, 'ai_')} 
                    disabled={!!merging}
                    className="h-7 bg-violet-500 hover:bg-violet-600"
                  >
                    <Merge className="w-3 h-3 mr-1" />
                    Merge All
                  </Button>
                </div>
                <ScrollArea className="flex-1">
                  <div className="px-6 pb-4">
                    {renderGroupTable(filteredAi, 'ai_')}
                  </div>
                </ScrollArea>
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
