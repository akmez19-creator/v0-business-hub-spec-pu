'use client'

import React from "react"
import { useState, useRef, useEffect, useMemo } from 'react'
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
import { Upload, FileSpreadsheet, Loader2, CheckCircle, AlertCircle, ArrowRight, ArrowLeft, Plus, Package, Sparkles, ImageIcon } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import * as XLSX from 'xlsx'

type MatchTier = 'exact' | 'high' | 'medium' | 'low' | 'none'

interface Suggestion {
  id: string
  name: string
  score: number
}

interface ProductMapping {
  excelProduct: string
  count: number
  mappedId: string | null
  // Populated by the AI auto-match pass so the UI can classify each row by
  // confidence and route the reviewer to the ones that actually need a human.
  matchConfidence?: number
  matchMethod?: 'fuzzy' | 'ai' | 'manual'
  tier?: MatchTier
  reason?: string
  alternatives?: Suggestion[]
  // Set once a human has explicitly signed off on the row.
  confirmed?: boolean
  // 1688 listing URL from the Excel "Link" column - the photo source.
  sourceLink?: string | null
  // Result of the image pass, kept per row so the UI can show what happened.
  imageStatus?: 'idle' | 'fetching' | 'done' | 'skipped' | 'failed'
  fetchedImage?: string | null
  imageNote?: string
}

const TIER_META: Record<MatchTier, { label: string; text: string; bar: string; ring: string }> = {
  exact: { label: 'Exact', text: 'text-emerald-400', bar: 'bg-emerald-500', ring: 'border-emerald-500/40' },
  high: { label: 'High', text: 'text-green-400', bar: 'bg-green-500', ring: 'border-green-500/40' },
  medium: { label: 'Medium', text: 'text-yellow-400', bar: 'bg-yellow-500', ring: 'border-yellow-500/40' },
  low: { label: 'Low', text: 'text-orange-400', bar: 'bg-orange-500', ring: 'border-orange-500/40' },
  none: { label: 'No match', text: 'text-red-400', bar: 'bg-red-500', ring: 'border-red-500/40' },
}

// A row's tier: explicit human choices always outrank the classifier.
function tierOf(m: ProductMapping): MatchTier {
  if (!m.mappedId) return 'none'
  if (m.matchMethod === 'manual' || m.confirmed) return 'exact'
  return m.tier ?? 'high'
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
  const [aiMatching, setAiMatching] = useState(false)
  const [aiMatchStats, setAiMatchStats] = useState<{ fuzzy: number; ai: number; unmatched: number } | null>(null)
  const [mapFilter, setMapFilter] = useState<'all' | MatchTier>('all')
  const [mapSearch, setMapSearch] = useState('')
  const [mapSort, setMapSort] = useState<'risk' | 'confidence_desc' | 'rows_desc' | 'name'>('risk')
  const [fetchingImages, setFetchingImages] = useState(false)
  const [imageStats, setImageStats] = useState<{ fetched: number; skipped: number; failed: number } | null>(null)

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
    // Extract unique product names, remembering the first supplier link seen
    // for each. That link is the 1688 listing the photo will be pulled from.
    const productCounts = new Map<string, number>()
    const productLinks = new Map<string, string>()
    for (const row of parsedData) {
      const productCol = columnMap['product_name']
      if (!productCol) continue
      const val = row[productCol]
      if (val && String(val).trim() !== '') {
        const name = String(val).trim()
        productCounts.set(name, (productCounts.get(name) || 0) + 1)
        if (!productLinks.has(name)) {
          // "link" is the primary source; "reorder" often holds the same URL.
          for (const field of ['link', 'reorder']) {
            const col = columnMap[field]
            const raw = col ? String(row[col] ?? '').trim() : ''
            if (/1688\.com/i.test(raw)) {
              productLinks.set(name, raw)
              break
            }
          }
        }
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

      productMaps.push({
        excelProduct,
        count,
        mappedId: matchedId,
        sourceLink: productLinks.get(excelProduct) || null,
      })
    }

    setProductMappings(productMaps)
    setStep('product_mapping')
  }

  function updateProductMapping(excelProduct: string, productId: string | null) {
    setProductMappings(prev =>
      prev.map(m =>
        m.excelProduct === excelProduct
          ? {
              ...m,
              mappedId: productId,
              matchMethod: productId ? 'manual' : undefined,
              matchConfidence: undefined,
              tier: productId ? 'exact' : 'none',
              confirmed: !!productId,
            }
          : m,
      ),
    )
  }

  // AI auto-match: sends every still-unmatched product name to the cascade
  // matcher (local fuzzy first, then gpt-4o-mini semantic) and applies the
  // results with a confidence score so weak matches can be spot-checked.
  async function handleAiMatch() {
    const unmatched = productMappings.filter(m => !m.mappedId)
    if (unmatched.length === 0 || systemProducts.length === 0) return
    setAiMatching(true)
    setAiMatchStats(null)
    try {
      const res = await fetch('/api/purchase-orders/ai-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          products: unmatched.map(m => ({ name: m.excelProduct })),
          candidates: systemProducts.map(p => ({ id: p.id, name: p.name })),
        }),
      })
      if (!res.ok) throw new Error('AI matching request failed')
      const data = (await res.json()) as {
        matches: {
          excelProduct: string
          matchedId: string | null
          confidence: number
          method: string
          tier?: MatchTier
          reason?: string
          alternatives?: Suggestion[]
        }[]
        stats?: { fuzzy: number; ai: number; unmatched: number }
      }
      const byName = new Map(data.matches.map(m => [m.excelProduct, m]))
      setProductMappings(prev =>
        prev.map(m => {
          const match = byName.get(m.excelProduct)
          if (!match || m.mappedId) return m
          // Keep the suggestions even when nothing was matched: they power the
          // one-click quick-pick chips on unmatched rows.
          return {
            ...m,
            mappedId: match.matchedId,
            matchConfidence: match.confidence,
            matchMethod: match.matchedId ? (match.method === 'fuzzy' ? 'fuzzy' : 'ai') : undefined,
            tier: match.tier,
            reason: match.reason,
            alternatives: match.alternatives || [],
          }
        }),
      )
      if (data.stats) setAiMatchStats(data.stats)
    } catch (err) {
      console.error('[v0] AI match failed:', err)
    } finally {
      setAiMatching(false)
    }
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

  // Tier counts drive the classification tabs and the coverage read-out.
  const tierCounts = useMemo(() => {
    const acc: Record<MatchTier, number> = { exact: 0, high: 0, medium: 0, low: 0, none: 0 }
    for (const m of productMappings) acc[tierOf(m)]++
    return acc
  }, [productMappings])

  const coveragePct = productMappings.length
    ? Math.round((mappedCount / productMappings.length) * 100)
    : 0
  // Rows a human genuinely has to look at: anything matched below "high".
  const needsReviewCount = tierCounts.medium + tierCounts.low
  const autoAcceptable = productMappings.filter(
    m => m.mappedId && !m.confirmed && m.matchMethod !== 'manual' && (m.tier === 'exact' || m.tier === 'high'),
  ).length

  // Sorted + filtered view. "risk" (default) front-loads the work: doubtful
  // matches first (weakest %), then unmatched, then the safe ones last.
  const visibleMappings = useMemo(() => {
    const risk: Record<MatchTier, number> = { low: 0, medium: 1, none: 2, high: 3, exact: 4 }
    const q = mapSearch.trim().toLowerCase()
    return productMappings
      .filter(m => (mapFilter === 'all' ? true : tierOf(m) === mapFilter))
      .filter(m => (q ? m.excelProduct.toLowerCase().includes(q) : true))
      .sort((a, b) => {
        if (mapSort === 'name') return a.excelProduct.localeCompare(b.excelProduct)
        if (mapSort === 'rows_desc') return b.count - a.count
        if (mapSort === 'confidence_desc') return (b.matchConfidence ?? 0) - (a.matchConfidence ?? 0)
        const ra = risk[tierOf(a)]
        const rb = risk[tierOf(b)]
        if (ra !== rb) return ra - rb
        if (ra <= 1) return (a.matchConfidence ?? 0) - (b.matchConfidence ?? 0)
        return b.count - a.count
      })
  }, [productMappings, mapFilter, mapSearch, mapSort])

  // Bulk: sign off every safe auto-match so only the doubtful rows remain.
  function confirmAllConfident() {
    setProductMappings(prev =>
      prev.map(m =>
        m.mappedId && (m.tier === 'exact' || m.tier === 'high') ? { ...m, confirmed: true } : m,
      ),
    )
  }

  // Products that are mapped, still have no photo in inventory, and carry a
  // 1688 link we can pull one from. Mapping deliberately happens first so the
  // photo lands on the right inventory item.
  const productImageById = useMemo(
    () => new Map(systemProducts.map(p => [p.id, p.image_url])),
    [systemProducts],
  )

  const imageTargets = useMemo(
    () => productMappings.filter(m => m.mappedId && !productImageById.get(m.mappedId) && !!m.sourceLink),
    [productMappings, productImageById],
  )

  const missingImageNoLink = useMemo(
    () => productMappings.filter(m => m.mappedId && !productImageById.get(m.mappedId) && !m.sourceLink).length,
    [productMappings, productImageById],
  )

  async function fetchProductImages() {
    if (!imageTargets.length) return
    setFetchingImages(true)
    setImageStats(null)
    const targetIds = new Set(imageTargets.map(m => m.excelProduct))
    setProductMappings(prev =>
      prev.map(m => (targetIds.has(m.excelProduct) ? { ...m, imageStatus: 'fetching' } : m)),
    )

    try {
      const res = await fetch('/api/purchase-orders/fetch-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: imageTargets.map(m => ({ productId: m.mappedId, link: m.sourceLink })),
        }),
      })
      const data = (await res.json()) as {
        success: boolean
        error?: string
        results?: { productId: string; status: 'done' | 'skipped' | 'failed'; image: string | null; note: string }[]
        stats?: { fetched: number; skipped: number; failed: number }
      }
      if (!data.success) throw new Error(data.error || 'Image fetch failed')

      const byProduct = new Map((data.results || []).map(r => [r.productId, r]))
      setProductMappings(prev =>
        prev.map(m => {
          const r = m.mappedId ? byProduct.get(m.mappedId) : undefined
          if (!r) return m.imageStatus === 'fetching' ? { ...m, imageStatus: 'idle' } : m
          return { ...m, imageStatus: r.status, fetchedImage: r.image, imageNote: r.note }
        }),
      )
      // Reflect the new photos locally so the "needs a photo" count settles.
      setSystemProducts(prev =>
        prev.map(p => {
          const r = byProduct.get(p.id)
          return r?.status === 'done' && r.image ? { ...p, image_url: r.image } : p
        }),
      )
      if (data.stats) setImageStats(data.stats)
    } catch (err) {
      console.error('[v0] fetch images failed:', err)
      setProductMappings(prev =>
        prev.map(m =>
          m.imageStatus === 'fetching'
            ? { ...m, imageStatus: 'failed', imageNote: 'Request failed' }
            : m,
        ),
      )
    } finally {
      setFetchingImages(false)
    }
  }

  // Bulk: drop every doubtful auto-match back to unmatched for a clean slate.
  function clearWeakMatches() {
    setProductMappings(prev =>
      prev.map(m =>
        m.mappedId && !m.confirmed && m.matchMethod !== 'manual' && (m.tier === 'low' || m.tier === 'medium')
          ? { ...m, mappedId: null, matchConfidence: undefined, matchMethod: undefined, tier: 'none' }
          : m,
      ),
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); else setOpen(true) }}>
      <DialogTrigger asChild>{children}</DialogTrigger>
        <DialogContent
          className={`max-h-[90vh] overflow-y-auto ${
            step === 'product_mapping' ? 'sm:max-w-4xl xl:max-w-6xl' : 'sm:max-w-2xl'
          }`}
        >
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
                      size="sm"
                      onClick={handleAiMatch}
                      disabled={aiMatching || creatingAllProducts}
                      className="gap-1"
                    >
                      {aiMatching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      {aiMatching ? 'Matching...' : `AI Match ${unmappedCount}`}
                    </Button>
                  )}
                  {unmappedCount > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCreateAllUnmappedProducts}
                      disabled={creatingAllProducts || aiMatching}
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
                <>
                  {/* Coverage meter: the headline number for the whole step. */}
                  <div className="rounded-lg border p-3">
                    <div className="flex items-baseline justify-between mb-2">
                      <span className="text-sm font-medium">Classification coverage</span>
                      <span className="text-2xl font-bold tabular-nums">{coveragePct}%</span>
                    </div>
                    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                      {(['exact', 'high', 'medium', 'low'] as const).map((t) =>
                        tierCounts[t] > 0 ? (
                          <div
                            key={t}
                            className={TIER_META[t].bar}
                            style={{ width: `${(tierCounts[t] / productMappings.length) * 100}%` }}
                            title={`${TIER_META[t].label}: ${tierCounts[t]}`}
                          />
                        ) : null,
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {(['exact', 'high', 'medium', 'low', 'none'] as const).map((t) => (
                        <span key={t} className="flex items-center gap-1.5">
                          <span className={`inline-block w-2 h-2 rounded-full ${TIER_META[t].bar}`} />
                          {TIER_META[t].label}: <strong className="text-foreground">{tierCounts[t]}</strong>
                          <span className="opacity-60">
                            ({Math.round((tierCounts[t] / productMappings.length) * 100)}%)
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Photos come AFTER mapping so each one lands on the right
                      inventory item. Products that already have a photo are
                      left alone. */}
                  {(imageTargets.length > 0 || imageStats) && (
                    <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                      <ImageIcon className="w-4 h-4 text-primary flex-shrink-0" />
                      <div className="flex-1 min-w-0 text-xs">
                        <div className="font-medium text-sm">Product photos from 1688</div>
                        <div className="text-muted-foreground">
                          {imageTargets.length > 0
                            ? `${imageTargets.length} mapped product${imageTargets.length === 1 ? '' : 's'} still need a photo and have a supplier link.`
                            : 'All mapped products have a photo.'}
                          {missingImageNoLink > 0 && ` ${missingImageNoLink} more need one but have no 1688 link.`}
                        </div>
                        {imageStats && (
                          <div className="mt-1 text-muted-foreground">
                            Linked <strong className="text-foreground">{imageStats.fetched}</strong>,
                            skipped <strong className="text-foreground">{imageStats.skipped}</strong> (already had one),
                            failed <strong className="text-foreground">{imageStats.failed}</strong>.
                          </div>
                        )}
                      </div>
                      <Button
                        size="sm"
                        onClick={fetchProductImages}
                        disabled={fetchingImages || imageTargets.length === 0}
                        className="gap-1.5"
                      >
                        {fetchingImages ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Fetching photos...
                          </>
                        ) : (
                          <>
                            <ImageIcon className="w-3.5 h-3.5" />
                            Fetch {imageTargets.length} photo{imageTargets.length === 1 ? '' : 's'}
                          </>
                        )}
                      </Button>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1 rounded-lg border p-1">
                      {([
                        { key: 'all', label: 'All', n: productMappings.length },
                        { key: 'low', label: 'Low', n: tierCounts.low },
                        { key: 'medium', label: 'Medium', n: tierCounts.medium },
                        { key: 'none', label: 'No match', n: tierCounts.none },
                        { key: 'high', label: 'High', n: tierCounts.high },
                        { key: 'exact', label: 'Exact', n: tierCounts.exact },
                      ] as const).map((tab) => (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => setMapFilter(tab.key)}
                          className={`px-3 py-1 text-xs rounded-md transition-colors ${
                            mapFilter === tab.key
                              ? 'bg-primary text-primary-foreground'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {tab.label} ({tab.n})
                        </button>
                      ))}
                    </div>
                    <Input
                      value={mapSearch}
                      onChange={(e) => setMapSearch(e.target.value)}
                      placeholder="Search product name..."
                      className="h-8 w-full sm:w-56 text-sm"
                    />
                    <Select value={mapSort} onValueChange={(v) => setMapSort(v as typeof mapSort)}>
                      <SelectTrigger className="h-8 w-[190px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="risk">Sort: Riskiest first</SelectItem>
                        <SelectItem value="confidence_desc">Sort: Highest confidence</SelectItem>
                        <SelectItem value="rows_desc">Sort: Most rows</SelectItem>
                        <SelectItem value="name">Sort: Name (A-Z)</SelectItem>
                      </SelectContent>
                    </Select>
                    {autoAcceptable > 0 && (
                      <Button variant="outline" size="sm" onClick={confirmAllConfident} className="h-8 gap-1 bg-transparent">
                        <CheckCircle className="w-3.5 h-3.5" />
                        Accept {autoAcceptable} confident
                      </Button>
                    )}
                    {needsReviewCount > 0 && (
                      <Button variant="ghost" size="sm" onClick={clearWeakMatches} className="h-8 text-xs">
                        Clear {needsReviewCount} weak
                      </Button>
                    )}
                  </div>

                  <ScrollArea className="h-[55vh] min-h-[360px] border rounded-lg">
                  <div className="p-4 grid grid-cols-1 xl:grid-cols-2 gap-3">
                    {visibleMappings.length === 0 && (
                      <div className="col-span-full text-center py-8 text-sm text-muted-foreground">
                        No products in this view.
                      </div>
                    )}
                    {visibleMappings.map((mapping) => {
                      const tier = tierOf(mapping)
                      const meta = TIER_META[tier]
                      const pct = Math.round((mapping.matchConfidence ?? (mapping.confirmed ? 1 : 0)) * 100)
                      const rowImage =
                        mapping.fetchedImage || (mapping.mappedId ? productImageById.get(mapping.mappedId) : null)
                      return (
                      <div
                        key={mapping.excelProduct}
                        className={`flex items-center gap-3 p-3 bg-muted/50 rounded-lg border-l-2 ${meta.ring}`}
                      >
                        {/* Confidence read-out: percentage + a bar of the same color as the tier. */}
                        <div className="w-12 flex-shrink-0 text-center">
                          <div className={`text-sm font-bold tabular-nums ${meta.text}`}>
                            {mapping.mappedId ? `${pct}%` : '--'}
                          </div>
                          <div className="mt-1 h-1 w-full rounded-full bg-muted overflow-hidden">
                            <div className={`h-full ${meta.bar}`} style={{ width: `${mapping.mappedId ? pct : 0}%` }} />
                          </div>
                        </div>
                        {/* Photo slot: existing inventory photo, or the one just
                            pulled from the supplier's 1688 listing. */}
                        {mapping.mappedId && (
                          <div className="w-10 h-10 flex-shrink-0 rounded border bg-background overflow-hidden flex items-center justify-center">
                            {mapping.imageStatus === 'fetching' ? (
                              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                            ) : rowImage ? (
                              <img
                                src={rowImage || "/placeholder.svg"}
                                alt={`${mapping.excelProduct} product photo`}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <ImageIcon className="w-4 h-4 text-muted-foreground/40" />
                            )}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate text-sm">{mapping.excelProduct}</div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-muted-foreground">{mapping.count} rows</span>
                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${meta.ring} ${meta.text}`}>
                              {meta.label}
                              {mapping.matchMethod === 'ai' && ' - AI'}
                              {mapping.matchMethod === 'fuzzy' && ' - Name'}
                              {mapping.matchMethod === 'manual' && ' - Manual'}
                            </Badge>
                            {mapping.reason && !mapping.mappedId && (
                              <span className="text-[10px] text-muted-foreground truncate max-w-[220px]" title={mapping.reason}>
                                {mapping.reason}
                              </span>
                            )}
                          </div>
                          {/* One-click corrections from the classifier's runner-ups. */}
                          {!mapping.confirmed && (mapping.alternatives?.length ?? 0) > 0 && (
                            <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                              <span className="text-[10px] text-muted-foreground">Suggestions:</span>
                              {mapping.alternatives!.slice(0, 3).map((alt) => (
                                <button
                                  key={alt.id}
                                  type="button"
                                  onClick={() => updateProductMapping(mapping.excelProduct, alt.id)}
                                  className="text-[10px] px-1.5 py-0.5 rounded border border-border hover:bg-accent hover:text-accent-foreground transition-colors max-w-[180px] truncate"
                                  title={`${alt.name} (${Math.round(alt.score * 100)}% name similarity)`}
                                >
                                  {alt.name} <span className="opacity-60">{Math.round(alt.score * 100)}%</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <Select
                          value={mapping.mappedId || 'unmapped'}
                          onValueChange={(v) => updateProductMapping(mapping.excelProduct, v === 'unmapped' ? null : v)}
                        >
                          <SelectTrigger className="w-[220px] lg:w-[260px] flex-shrink-0">
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
                          <button
                            type="button"
                            onClick={() => setProductMappings(prev => prev.map(x =>
                              x.excelProduct === mapping.excelProduct ? { ...x, confirmed: !x.confirmed } : x))}
                            title={mapping.confirmed ? 'Confirmed - click to unconfirm' : 'Click to confirm this match'}
                            className="flex-shrink-0"
                          >
                            <CheckCircle
                              className={`w-5 h-5 transition-colors ${
                                mapping.confirmed ? 'text-green-500' : 'text-muted-foreground/40 hover:text-green-500'
                              }`}
                            />
                          </button>
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
                      )
                    })}
                  </div>
                  </ScrollArea>
                </>
              )}

              <div className="text-xs text-muted-foreground bg-muted p-3 rounded-md space-y-1">
                <p>Matched: <strong>{mappedCount}</strong> / {productMappings.length} products.
                  Mappings are saved as aliases for automatic matching in future imports.</p>
                {aiMatchStats && (
                  <p className="text-foreground">
                    <Sparkles className="w-3 h-3 inline mr-1 text-primary" />
                    Classifier: <strong>{aiMatchStats.fuzzy}</strong> by name similarity,{' '}
                    <strong>{aiMatchStats.ai}</strong> by AI, <strong>{aiMatchStats.unmatched}</strong> unresolved.
                    Work the <strong>Low</strong> and <strong>Medium</strong> tabs first, then accept the confident ones in bulk.
                  </p>
                )}
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
