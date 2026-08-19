'use client'

import React from "react"
import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Package } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import * as XLSX from 'xlsx'

interface InventoryImportDialogProps {
  onSuccess: () => void
}

// Column mapping for your Excel format - maps to product fields
const COLUMN_MAPPING: Record<string, string> = {
  'Category': 'category',
  'category': 'category',
  'Item': 'name',
  'item': 'name',
  'Product': 'name',
  'product': 'name',
  'Name': 'name',
  'name': 'name',
  'Quantity': 'quantity',
  'quantity': 'quantity',
  'Qty': 'quantity',
  'qty': 'quantity',
  // The Excel export now labels on-hand stock "In Store" to distinguish it from
  // in-China and undelivered stock. Accept it so an exported file still
  // re-imports. Initial/In China/Undelivered/Actual are intentionally NOT
  // mapped: they are derived from purchase_orders and deliveries, so importing
  // them would overwrite computed values with a stale snapshot.
  'In Store': 'quantity',
  'in store': 'quantity',
  'PRICE UNIT': 'price',
  'Price Unit': 'price',
  'price_unit': 'price',
  'Price': 'price',
  'price': 'price',
  'Unit Price': 'price',
  'SPX2': 'bundle_2',
  'spx2': 'bundle_2',
  '2-Pack': 'bundle_2',
  '2-pack': 'bundle_2',
  'SPX3': 'bundle_3',
  'spx3': 'bundle_3',
  '3-Pack': 'bundle_3',
  '3-pack': 'bundle_3',
  '4-Pack': 'bundle_4',
  '4-pack': 'bundle_4',
  '6-Pack': 'bundle_6',
  '6-pack': 'bundle_6',
  'B1G1': 'is_b1g1',
  'b1g1': 'is_b1g1',
  'Image': 'image_url',
  'image': 'image_url',
  'image_url': 'image_url',
  'Remarks': 'remarks',
  'remarks': 'remarks',
  'Notes': 'remarks',
  'notes': 'remarks',
  'Variant': 'variant',
  'variant': 'variant',
}

interface ParsedProduct {
  name: string
  category?: string
  quantity?: number
  price?: number
  bundle_2?: number
  bundle_3?: number
  bundle_4?: number
  bundle_6?: number
  is_b1g1?: boolean | string
  image_url?: string
  remarks?: string
  variant?: string  // Format: "AttributeName: AttributeValue" e.g., "Size: Large"
}

export function InventoryImportDialog({ onSuccess }: InventoryImportDialogProps) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [previewData, setPreviewData] = useState<ParsedProduct[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [result, setResult] = useState<{
    success: boolean
    totalRows?: number
    insertedRows?: number
    updatedRows?: number
    error?: string
  } | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const parseExcelFile = async (file: File): Promise<ParsedProduct[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      
      reader.onload = (e) => {
        try {
          const data = e.target?.result
          const workbook = XLSX.read(data, { type: 'binary' })
          const sheetName = workbook.SheetNames[0]
          const worksheet = workbook.Sheets[sheetName]
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' })
          
          // Parse and map the data
          const products: ParsedProduct[] = []
          
          for (const row of jsonData as Record<string, unknown>[]) {
            const product: ParsedProduct = { name: '' }
            
            // Map columns from your Excel format
            for (const [excelCol, value] of Object.entries(row)) {
              const mappedField = COLUMN_MAPPING[excelCol] || COLUMN_MAPPING[excelCol.toLowerCase().trim()]
              if (mappedField && value !== '' && value !== null && value !== undefined) {
                const strValue = String(value).trim()
                if (strValue) {
                  if (['quantity'].includes(mappedField)) {
                    const numVal = parseInt(strValue)
                    if (!isNaN(numVal)) {
                      product.quantity = numVal
                    }
                  } else if (['price', 'price_spx2', 'price_spx3', 'price_b1g1'].includes(mappedField)) {
                    // Remove currency symbols and parse
                    const numVal = parseFloat(strValue.replace(/[^0-9.-]/g, ''))
                    if (!isNaN(numVal)) {
                      (product as Record<string, number>)[mappedField] = numVal
                    }
                  } else {
                    (product as Record<string, string>)[mappedField] = strValue
                  }
                }
              }
            }
            
            // Only add if we have a name
            if (product.name) {
              products.push(product)
            }
          }
          
          resolve(products)
        } catch (error) {
          reject(error)
        }
      }
      
      reader.onerror = () => reject(new Error('Failed to read file'))
      reader.readAsBinaryString(file)
    })
  }

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile && (droppedFile.name.endsWith('.csv') || droppedFile.name.endsWith('.xlsx') || droppedFile.name.endsWith('.xls'))) {
      setFile(droppedFile)
      setResult(null)
      
      // Parse and preview
      try {
        const products = await parseExcelFile(droppedFile)
        setTotalCount(products.length)
        setPreviewData(products.slice(0, 5))
      } catch {
        setPreviewData([])
        setTotalCount(0)
      }
    }
  }, [])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      setResult(null)
      
      // Parse and preview
      try {
        const products = await parseExcelFile(selectedFile)
        setTotalCount(products.length)
        setPreviewData(products.slice(0, 5))
      } catch {
        setPreviewData([])
        setTotalCount(0)
      }
    }
  }

  const handleImport = async () => {
    if (!file) return

    setIsLoading(true)
    setResult(null)

    try {
      const products = await parseExcelFile(file)
      
      if (products.length === 0) {
        setResult({
          success: false,
          error: 'No valid product data found. Make sure your file has an "Item" or "Product" column.'
        })
        setIsLoading(false)
        return
      }

      const supabase = createClient()
      let insertedCount = 0
      let updatedCount = 0

      // Group products by name to handle variants
      const productGroups: Record<string, ParsedProduct[]> = {}
      for (const product of products) {
        const key = product.name.trim().toLowerCase()
        if (!productGroups[key]) productGroups[key] = []
        productGroups[key].push(product)
      }

      // Process each product group
      for (const [, group] of Object.entries(productGroups)) {
        const firstProduct = group[0]
        const hasVariants = group.some(p => p.variant && p.variant.trim())
        
        // Check if product exists by name (case-insensitive)
        const { data: existingProducts } = await supabase
          .from('products')
          .select('id, has_variants')
          .eq('name', firstProduct.name.trim())
        
        const existing = existingProducts && existingProducts.length > 0 ? existingProducts[0] : null

        // For products with variants, use the first row's price as base, sum quantities come from variants
        const totalQuantity = hasVariants 
          ? 0 // Will be tracked in variants
          : (firstProduct.quantity || 0)

        // Build bundle prices object
        const bundlePrices: Record<string, number> = {}
        if (firstProduct.bundle_2) bundlePrices['2'] = firstProduct.bundle_2
        if (firstProduct.bundle_3) bundlePrices['3'] = firstProduct.bundle_3
        if (firstProduct.bundle_4) bundlePrices['4'] = firstProduct.bundle_4
        if (firstProduct.bundle_6) bundlePrices['6'] = firstProduct.bundle_6
        
        // Check if B1G1 - can be boolean, "Yes", or truthy value
        const isB1g1 = firstProduct.is_b1g1 === true || 
                       firstProduct.is_b1g1 === 'Yes' || 
                       firstProduct.is_b1g1 === 'yes' ||
                       firstProduct.is_b1g1 === 'YES' ||
                       firstProduct.is_b1g1 === '1'

        const payload = {
          name: firstProduct.name,
          category: firstProduct.category || null,
          quantity: totalQuantity,
          price: firstProduct.price || 0,
          bundle_prices: bundlePrices,
          is_b1g1: isB1g1,
          image_url: firstProduct.image_url || null,
          remarks: firstProduct.remarks || null,
          has_variants: hasVariants,
          is_active: true,
          updated_at: new Date().toISOString(),
        }

        let productId: string

        if (existing) {
          // Update existing product
          const { error } = await supabase
            .from('products')
            .update(payload)
            .eq('id', existing.id)
          
          if (!error) updatedCount++
          productId = existing.id
        } else {
          // Insert new product
          const { data: newProduct, error } = await supabase
            .from('products')
            .insert(payload)
            .select('id')
            .single()
          
          if (!error && newProduct) {
            insertedCount++
            productId = newProduct.id
          } else {
            continue
          }
        }

        // Handle variants
        if (hasVariants && productId) {
          // Delete existing variants for this product
          await supabase.from('product_variants').delete().eq('product_id', productId)
          
          // Insert new variants
          for (const p of group) {
            if (p.variant && p.variant.trim()) {
              // Parse variant string "AttributeName: AttributeValue"
              const [attrName, attrValue] = p.variant.split(':').map(s => s.trim())
              if (attrName && attrValue) {
                await supabase.from('product_variants').insert({
                  product_id: productId,
                  attribute_name: attrName,
                  attribute_value: attrValue,
                  quantity: p.quantity || 0,
                  price_override: p.price !== firstProduct.price ? p.price : null,
                  updated_at: new Date().toISOString(),
                })
              }
            }
          }
        }
      }

      setResult({
        success: true,
        totalRows: products.length,
        insertedRows: insertedCount,
        updatedRows: updatedCount,
      })
      onSuccess()
    } catch (error) {
      setResult({
        success: false,
        error: 'Failed to import products: ' + (error as Error).message
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    setOpen(false)
    setFile(null)
    setResult(null)
    setPreviewData([])
    setTotalCount(0)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="mr-2 h-4 w-4" />
          Import Excel
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Inventory from Excel</DialogTitle>
          <DialogDescription>
            Upload your inventory Excel file. Products will be matched by name - existing products will be updated, new products will be added.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {/* Drop Zone */}
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              isDragging
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:border-muted-foreground/50'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {file ? (
              <div className="flex items-center justify-center gap-2">
                <FileSpreadsheet className="h-8 w-8 text-primary" />
                <div className="text-left">
                  <p className="font-medium">{file.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {(file.size / 1024).toFixed(1)} KB - {totalCount} products found
                  </p>
                </div>
              </div>
            ) : (
              <>
                <Upload className="mx-auto h-10 w-10 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground mb-2">
                  Drag and drop your inventory Excel file here
                </p>
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileChange}
                  className="hidden"
                  id="inventory-file-upload"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById('inventory-file-upload')?.click()}
                >
                  Browse Files
                </Button>
              </>
            )}
          </div>

          {/* Preview */}
          {previewData.length > 0 && !result && (
            <div className="mt-4 border rounded-lg overflow-hidden">
              <div className="bg-muted px-4 py-2 flex items-center gap-2">
                <Package className="h-4 w-4" />
                <span className="text-sm font-medium">Preview (first 5 of {totalCount} products)</span>
              </div>
              <div className="max-h-48 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2">Category</th>
                      <th className="text-left px-3 py-2">Item</th>
                      <th className="text-left px-3 py-2">Variant</th>
                      <th className="text-right px-3 py-2">Qty</th>
                      <th className="text-right px-3 py-2">Price</th>
                      <th className="text-right px-3 py-2">Bundles</th>
                      <th className="text-center px-3 py-2">B1G1</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.map((product, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-3 py-2 text-muted-foreground">{product.category || '-'}</td>
                        <td className="px-3 py-2 font-medium">{product.name}</td>
                        <td className="px-3 py-2 text-violet-600">{product.variant || '-'}</td>
                        <td className="px-3 py-2 text-right">{product.quantity || '-'}</td>
                        <td className="px-3 py-2 text-right">{product.price ? `Rs ${product.price}` : '-'}</td>
                        <td className="px-3 py-2 text-right text-xs">
                          {[
                            product.bundle_2 && `2pk: Rs${product.bundle_2}`,
                            product.bundle_3 && `3pk: Rs${product.bundle_3}`,
                            product.bundle_4 && `4pk: Rs${product.bundle_4}`,
                            product.bundle_6 && `6pk: Rs${product.bundle_6}`,
                          ].filter(Boolean).join(', ') || '-'}
                        </td>
                        <td className="px-3 py-2 text-center">{product.is_b1g1 ? 'Yes' : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Result Display */}
          {result && (
            <div className={`mt-4 p-4 rounded-lg ${
              result.success ? 'bg-green-50 dark:bg-green-950' : 'bg-red-50 dark:bg-red-950'
            }`}>
              <div className="flex items-start gap-2">
                {result.success ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" />
                ) : (
                  <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
                )}
                <div>
                  {result.success ? (
                    <>
                      <p className="font-medium text-green-800 dark:text-green-200">
                        Import Successful
                      </p>
                      <p className="text-sm text-green-700 dark:text-green-300">
                        {result.insertedRows} new products added, {result.updatedRows} existing products updated
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium text-red-800 dark:text-red-200">
                        Import Failed
                      </p>
                      <p className="text-sm text-red-700 dark:text-red-300">
                        {result.error}
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Expected Format */}
          <div className="mt-4 p-3 bg-muted rounded-lg">
            <p className="text-sm font-medium mb-2">Expected Excel columns:</p>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div><span className="text-muted-foreground">Category</span> → Category</div>
              <div><span className="text-muted-foreground">Item</span> → Product Name</div>
              <div><span className="text-muted-foreground">Variant</span> → Size: Large</div>
              <div><span className="text-muted-foreground">Quantity</span> → Stock Qty</div>
              <div><span className="text-muted-foreground">PRICE UNIT</span> → Unit Price</div>
              <div><span className="text-muted-foreground">2-Pack</span> → Bundle price for 2</div>
              <div><span className="text-muted-foreground">3-Pack</span> → Bundle price for 3</div>
              <div><span className="text-muted-foreground">4-Pack / 6-Pack</span> → etc.</div>
              <div><span className="text-muted-foreground">B1G1</span> → &quot;Yes&quot; if offer</div>
              <div><span className="text-muted-foreground">Image</span> → Image URL</div>
              <div><span className="text-muted-foreground">Remarks</span> → Notes</div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              For products with variants, add multiple rows with same Item name but different Variant values (e.g., &quot;Size: Medium&quot;, &quot;Size: Large&quot;).
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            {result?.success ? 'Close' : 'Cancel'}
          </Button>
          {!result?.success && (
            <Button onClick={handleImport} disabled={!file || isLoading}>
              {isLoading ? 'Importing...' : `Import ${totalCount > 0 ? `${totalCount} Products` : ''}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
