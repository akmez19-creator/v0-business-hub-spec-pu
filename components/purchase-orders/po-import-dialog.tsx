'use client'

import React from "react"
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Upload, FileSpreadsheet, Loader2, CheckCircle, AlertCircle, ArrowRight, ArrowLeft, Plus, Package } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import * as XLSX from 'xlsx'

interface ProductMapping {
  excelProduct: string
  count: number
  mappedId: string | null
}

interface SystemProduct {
  id: string
  name: string
  image_url: string | null
}

interface ProductAlias {
  alias_name: string
  product_id: string
}

const PO_COLUMN_ALIASES: Record<string, string[]> = {
  status: ['status'],
  reorder: ['reorder', 're-order', 'reorder link'],
  link: ['link'],
  supplier_name: ['supplier name', 'supplier', 'vendor'],
  index_no: ['index', 'index no', 'idx'],
  carton: ['carton', 'cartons'],
  image: ['image', 'img', 'photo'],
  product_name: ['product name', 'product', 'item', 'item name', 'description'],
  qty: ['qty', 'quantity', 'q'],
  unit_price: ['unit price', 'price', 'cost'],
  discounted_unit_price: ['discounted unit price', 'disc unit price', 'disc price'],
  shipment_to_warehouse: ['shipment to warehouse', 'shipping', 'shipment'],
  discounted_shipment_to_warehouse: ['discounted shipment to warehouse', 'disc shipment'],
  discounted_percentage: ['discounted percentage', 'discount %', 'disc %', 'discount'],
  total_payment_supplier_yuan: ['total payment to supplier yuan', 'total supplier yuan', 'yuan'],
  total_payment_supplier: ['total payment to supplier', 'total supplier', 'supplier payment'],
  payment_link: ['payment link', 'pay link'],
  weight_kg: ['weight (kg)', 'weight', 'kg'],
  cbm: ['cbm'],
  boxes: ['boxes', 'box'],
  cbm_cost: ['cbm cost'],
  import_cp: ['import cp'],
  total_cp_import: ['total cp import', 'total cp'],
  tracking_number: ['tracking number', 'tracking', 'track', 'tracking no'],
}

export function POImportDialog({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'upload' | 'column_mapping' | 'product_mapping' | 'importing' | 'result'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [parsedData, setParsedData] = useState<Record<string, unknown>[]>([])
  const [columnMap, setColumnMap] = useState<Record<string, string>>({})
  const [excelColumns, setExcelColumns] = useState<string[]>([])
  const [productMappings, setProductMappings] = useState<ProductMapping[]>([])
  const [systemProducts, setSystemProducts] = useState<SystemProduct[]>([])
  const [productAliases, setProductAliases] = useState<ProductAlias[]>([])
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [result, setResult] = useState<{ success: number; failed: number; errors: string[] } | null>(null)
  const [creatingProduct, setCreatingProduct] = useState<string | null>(null)
  const [creatingAllProducts, setCreatingAllProducts] = useState(false)

  useEffect(() => {
    if (open) loadSystemData()
  }, [open])

  async function loadSystemData() {
    const supabase = createClient()
    const [{ data: products }, { data: aliases }] = await Promise.all([
      supabase.from('products').select('id, name, image_url').eq('is_active', true).order('name'),
      supabase.from('product_aliases').select('alias_name, product_id'),
    ])
    if (products) setSystemProducts(products)
    if (aliases) setProductAliases(aliases)
  }

  function getValue(row: Record<string, unknown>, field: string): unknown {
    const mappedCol = columnMap[field]
    if (mappedCol && row[mappedCol] !== undefined) return row[mappedCol]
    return null
  }

  function parseAmount(value: unknown): number {
    if (value === null || value === undefined || value === '') return 0
    if (typeof value === 'number') return value
    const cleaned = String(value).replace(/[Rs,$,\s,¥]/g, '').trim()
    const num = parseFloat(cleaned)
    return isNaN(num) ? 0 : num
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      setResult(null)
      parseFile(selectedFile)
    }
  }

  async function parseFile(selectedFile: File) {
    try {
      const arrayBuffer = await selectedFile.arrayBuffer()
      const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true })
      const sheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[sheetName]
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false })

      if (jsonData.length === 0) {
        setResult({ success: 0, failed: 0, errors: ['File is empty or has no data rows'] })
        setStep('result')
        return
      }

      setParsedData(jsonData as Record<string, unknown>[])

      // Get excel columns
      const firstRow = jsonData[0] as Record<string, unknown>
      const cols = Object.keys(firstRow)
      setExcelColumns(cols)

      // Auto-map columns
      const autoMap: Record<string, string> = {}
      for (const [field, aliases] of Object.entries(PO_COLUMN_ALIASES)) {
        for (const col of cols) {
          const colLower = col.toLowerCase().trim()
          if (aliases.some(a => a === colLower)) {
            autoMap[field] = col
            break
          }
        }
      }
      setColumnMap(autoMap)
      setStep('column_mapping')
    } catch {
      setResult({ success: 0, failed: 0, errors: ['Failed to parse file'] })
      setStep('result')
    }
  }

  function proceedToProductMapping() {
    // Extract unique product names
    const productCounts = new Map<string, number>()
    for (const row of parsedData) {
      const productCol = columnMap['product_name']
      if (!productCol) continue
      const val = row[productCol]
      if (val && String(val).trim() !== '') {
        const name = String(val).trim()
        productCounts.set(name, (productCounts.get(name) || 0) + 1)
      }
    }

    // Auto-match: first check aliases, then exact product name
    const productMaps: ProductMapping[] = []
    for (const [excelProduct, count] of productCounts.entries()) {
      let matchedId: string | null = null
      const searchName = excelProduct.toLowerCase().trim()

      // Check aliases first
      const alias = productAliases.find(a => a.alias_name.toLowerCase().trim() === searchName)
      if (alias) {
        matchedId = alias.product_id
      }

      // Fallback: exact product name match
      if (!matchedId) {
        const product = systemProducts.find(p => p.name.toLowerCase().trim() === searchName)
        if (product) matchedId = product.id
      }

      productMaps.push({ excelProduct, count, mappedId: matchedId })
    }

    setProductMappings(productMaps)
    setStep('product_mapping')
  }

  function updateProductMapping(excelProduct: string, productId: string | null) {
    setProductMappings(prev =>
      prev.map(m => m.excelProduct === excelProduct ? { ...m, mappedId: productId } : m)
    )
  }

  async function handleCreateProduct(excelProduct: string) {
    setCreatingProduct(excelProduct)
    try {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('products')
        .insert({ name: excelProduct.trim(), is_active: true })
        .select('id, name, image_url')
        .single()

      if (data) {
        setSystemProducts(prev => [...prev, data])
        updateProductMapping(excelProduct, data.id)
        // Also create alias
        await supabase.from('product_aliases').insert({
          alias_name: excelProduct.trim(),
          product_id: data.id,
          source: 'po_import'
        }).select().maybeSingle()
      } else if (error) {
        // Product might already exist, try to find it
        const { data: existing } = await supabase
          .from('products')
          .select('id, name, image_url')
          .ilike('name', excelProduct.trim())
          .single()
        if (existing) {
          updateProductMapping(excelProduct, existing.id)
        }
      }
    } finally {
      setCreatingProduct(null)
    }
  }

  async function handleCreateAllUnmappedProducts() {
    setCreatingAllProducts(true)
    try {
      const unmapped = productMappings.filter(m => !m.mappedId)
      for (const mapping of unmapped) {
        await handleCreateProduct(mapping.excelProduct)
      }
    } finally {
      setCreatingAllProducts(false)
    }
  }

  async function saveAlias(aliasName: string, productId: string) {
    const supabase = createClient()
    await supabase.from('product_aliases').upsert({
      alias_name: aliasName.trim(),
      product_id: productId,
      source: 'po_import'
    }, { onConflict: 'alias_name' }).select().maybeSingle()
  }

  async function handleImport() {
    setImporting(true)
    setStep('importing')
    setImportProgress(0)

    const supabase = createClient()
    const batchId = `po_${Date.now()}`
    let success = 0
    let failed = 0
    const errors: string[] = []

    // Build product lookup
    const productLookup = new Map<string, string>()
    for (const mapping of productMappings) {
      if (mapping.mappedId) {
        productLookup.set(mapping.excelProduct, mapping.mappedId)
        // Save alias for future imports
        await saveAlias(mapping.excelProduct, mapping.mappedId)
      }
    }

    const BATCH_SIZE = 50
    for (let i = 0; i < parsedData.length; i += BATCH_SIZE) {
      const batch = parsedData.slice(i, i + BATCH_SIZE)
      const records = batch.map(row => {
        const productName = columnMap['product_name'] ? String(row[columnMap['product_name']] || '').trim() : null
        const productId = productName ? productLookup.get(productName) || null : null

        return {
          status: columnMap['status'] ? String(row[columnMap['status']] || 'pending').trim() : 'pending',
          reorder: columnMap['reorder'] ? String(row[columnMap['reorder']] || '').trim() || null : null,
          link: columnMap['link'] ? String(row[columnMap['link']] || '').trim() || null : null,
          supplier_name: columnMap['supplier_name'] ? String(row[columnMap['supplier_name']] || '').trim() || null : null,
          index_no: columnMap['index_no'] ? String(row[columnMap['index_no']] || '').trim() || null : null,
          carton: columnMap['carton'] ? String(row[columnMap['carton']] || '').trim() || null : null,
          image_url: columnMap['image'] ? String(row[columnMap['image']] || '').trim() || null : null,
          product_name: productName || null,
          product_id: productId,
          qty: columnMap['qty'] ? parseInt(String(row[columnMap['qty']] || '0')) || 0 : 0,
          unit_price: parseAmount(columnMap['unit_price'] ? row[columnMap['unit_price']] : 0),
          discounted_unit_price: parseAmount(columnMap['discounted_unit_price'] ? row[columnMap['discounted_unit_price']] : 0),
          shipment_to_warehouse: parseAmount(columnMap['shipment_to_warehouse'] ? row[columnMap['shipment_to_warehouse']] : 0),
          discounted_shipment_to_warehouse: parseAmount(columnMap['discounted_shipment_to_warehouse'] ? row[columnMap['discounted_shipment_to_warehouse']] : 0),
          discounted_percentage: parseAmount(columnMap['discounted_percentage'] ? row[columnMap['discounted_percentage']] : 0),
          total_payment_supplier_yuan: parseAmount(columnMap['total_payment_supplier_yuan'] ? row[columnMap['total_payment_supplier_yuan']] : 0),
          total_payment_supplier: parseAmount(columnMap['total_payment_supplier'] ? row[columnMap['total_payment_supplier']] : 0),
          payment_link: columnMap['payment_link'] ? String(row[columnMap['payment_link']] || '').trim() || null : null,
          weight_kg: parseAmount(columnMap['weight_kg'] ? row[columnMap['weight_kg']] : 0),
          cbm: parseAmount(columnMap['cbm'] ? row[columnMap['cbm']] : 0),
          boxes: columnMap['boxes'] ? parseInt(String(row[columnMap['boxes']] || '0')) || 0 : 0,
          cbm_cost: parseAmount(columnMap['cbm_cost'] ? row[columnMap['cbm_cost']] : 0),
          import_cp: parseAmount(columnMap['import_cp'] ? row[columnMap['import_cp']] : 0),
          total_cp_import: parseAmount(columnMap['total_cp_import'] ? row[columnMap['total_cp_import']] : 0),
          tracking_number: columnMap['tracking_number'] ? String(row[columnMap['tracking_number']] || '').trim() || null : null,
          batch_id: batchId,
        }
      })

      const { error } = await supabase.from('purchase_orders').insert(records)
      if (error) {
        failed += batch.length
        errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`)
      } else {
        success += batch.length
      }
      setImportProgress(Math.round(((i + batch.length) / parsedData.length) * 100))
    }

    setResult({ success, failed, errors })
    setStep('result')
    setImporting(false)
    router.refresh()
  }

  function handleClose() {
    setOpen(false)
    setStep('upload')
    setFile(null)
    setParsedData([])
    setColumnMap({})
    setExcelColumns([])
    setProductMappings([])
    setResult(null)
    setImportProgress(0)
  }

  const mappedCount = productMappings.filter(m => m.mappedId).length
  const unmappedCount = productMappings.filter(m => !m.mappedId).length

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); else setOpen(true) }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 'upload' && 'Step 1: Upload Purchase Order Excel'}
            {step === 'column_mapping' && 'Step 2: Map Columns'}
            {step === 'product_mapping' && 'Step 3: Map Products to Inventory'}
            {step === 'importing' && 'Importing...'}
            {step === 'result' && 'Import Complete'}
          </DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Upload your purchase order Excel file'}
            {step === 'column_mapping' && `Map Excel columns to system fields. ${parsedData.length} rows found.`}
            {step === 'product_mapping' && 'Match PO product names to your inventory. Aliases are saved for future imports.'}
            {step === 'importing' && 'Please wait while we import your purchase orders...'}
            {step === 'result' && 'Import has finished.'}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {/* Step 1: Upload */}
          {step === 'upload' && (
            <div className="space-y-4">
              <div
                className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                />
                {file ? (
                  <div className="space-y-2">
                    <FileSpreadsheet className="w-12 h-12 mx-auto text-primary" />
                    <p className="font-medium">{file.name}</p>
                    <p className="text-sm text-muted-foreground">{parsedData.length} rows parsed</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="w-12 h-12 mx-auto text-muted-foreground" />
                    <p className="font-medium">Click to upload PO Excel file</p>
                    <p className="text-sm text-muted-foreground">Supports .xlsx, .xls, .csv</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Column Mapping */}
          {step === 'column_mapping' && (
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground mb-2">
                Map your Excel columns to the PO fields. Auto-detected mappings are pre-filled.
              </div>
              <ScrollArea className="h-[350px] border rounded-lg">
                <div className="p-4 space-y-3">
                  {Object.entries(PO_COLUMN_ALIASES).map(([field, aliases]) => (
                    <div key={field} className="flex items-center gap-3 p-2 bg-muted/50 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm capitalize">{field.replace(/_/g, ' ')}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          Matches: {aliases.join(', ')}
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <Select
                        value={columnMap[field] || 'unmapped'}
                        onValueChange={(v) => setColumnMap(prev => ({ ...prev, [field]: v === 'unmapped' ? '' : v }))}
                      >
                        <SelectTrigger className="w-[200px]">
                          <SelectValue placeholder="Select column..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unmapped">
                            <span className="text-muted-foreground">-- Skip --</span>
                          </SelectItem>
                          {excelColumns.map((col) => (
                            <SelectItem key={col} value={col}>{col}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {columnMap[field] ? (
                        <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                      ) : (
                        <div className="w-5 h-5 flex-shrink-0" />
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
              <div className="text-xs text-muted-foreground bg-muted p-3 rounded-md">
                Mapped: <strong>{Object.values(columnMap).filter(v => v).length}</strong> / {Object.keys(PO_COLUMN_ALIASES).length} fields.
                Unmapped fields will be left empty.
              </div>
            </div>
          )}

          {/* Step 3: Product Mapping */}
          {step === 'product_mapping' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Match PO products to inventory:</span>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{productMappings.length} products</Badge>
                  {unmappedCount > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCreateAllUnmappedProducts}
                      disabled={creatingAllProducts}
                      className="gap-1 bg-transparent"
                    >
                      {creatingAllProducts ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      {creatingAllProducts ? 'Creating...' : `Add All ${unmappedCount} to Inventory`}
                    </Button>
                  )}
                </div>
              </div>

              {productMappings.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p>No product names found. Check your column mapping.</p>
                </div>
              ) : (
                <ScrollArea className="h-[300px] border rounded-lg">
                  <div className="p-4 space-y-3">
                    {productMappings.map((mapping) => (
                      <div key={mapping.excelProduct} className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate text-sm">{mapping.excelProduct}</div>
                          <div className="text-xs text-muted-foreground">{mapping.count} rows</div>
                        </div>
                        <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <Select
                          value={mapping.mappedId || 'unmapped'}
                          onValueChange={(v) => updateProductMapping(mapping.excelProduct, v === 'unmapped' ? null : v)}
                        >
                          <SelectTrigger className="w-[200px]">
                            <SelectValue placeholder="Select product..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unmapped">
                              <span className="text-muted-foreground">-- No match --</span>
                            </SelectItem>
                            {systemProducts.map((product) => (
                              <SelectItem key={product.id} value={product.id}>
                                {product.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {mapping.mappedId ? (
                          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleCreateProduct(mapping.excelProduct)}
                            disabled={creatingProduct === mapping.excelProduct}
                            title={`Add "${mapping.excelProduct}" to inventory`}
                            className="flex-shrink-0 bg-transparent"
                          >
                            {creatingProduct === mapping.excelProduct ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Plus className="w-4 h-4" />
                            )}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}

              <div className="text-xs text-muted-foreground bg-muted p-3 rounded-md">
                <p>Matched: <strong>{mappedCount}</strong> / {productMappings.length} products.
                  Mappings are saved as aliases for automatic matching in future imports.</p>
              </div>
            </div>
          )}

          {/* Importing progress */}
          {step === 'importing' && (
            <div className="space-y-4 text-center py-8">
              <Loader2 className="w-12 h-12 mx-auto animate-spin text-primary" />
              <Progress value={importProgress} className="w-full" />
              <p className="text-sm text-muted-foreground">{importProgress}% complete</p>
            </div>
          )}

          {/* Result */}
          {step === 'result' && result && (
            <div className="space-y-4">
              <div className={`p-4 rounded-lg ${result.failed === 0 ? 'bg-green-500/10 border border-green-500/20' : 'bg-yellow-500/10 border border-yellow-500/20'}`}>
                <div className="flex items-center gap-2 mb-2">
                  {result.failed === 0 ? (
                    <CheckCircle className="w-5 h-5 text-green-600" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-yellow-600" />
                  )}
                  <span className="font-medium">
                    {result.success} imported, {result.failed} failed
                  </span>
                </div>
                {result.errors.length > 0 && (
                  <div className="text-sm text-muted-foreground mt-2 space-y-1">
                    {result.errors.slice(0, 5).map((err, i) => (
                      <p key={i}>{err}</p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {step === 'upload' && file && parsedData.length > 0 && (
            <Button onClick={() => setStep('column_mapping')}>
              Next: Map Columns
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          )}
          {step === 'column_mapping' && (
            <>
              <Button variant="outline" onClick={() => setStep('upload')} className="bg-transparent">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button onClick={proceedToProductMapping}>
                Next: Map Products
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </>
          )}
          {step === 'product_mapping' && (
            <>
              <Button variant="outline" onClick={() => setStep('column_mapping')} className="bg-transparent">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button onClick={handleImport} disabled={importing}>
                {importing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Import {parsedData.length} Purchase Orders
              </Button>
            </>
          )}
          {step === 'result' && (
            <Button onClick={handleClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
