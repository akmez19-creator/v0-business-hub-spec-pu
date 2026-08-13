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
import { Upload, FileSpreadsheet, Loader2, CheckCircle, AlertCircle, ArrowRight, ArrowLeft, Plus, Package, Sparkles, ImageIcon, Images, Wand2 } from 'lucide-react'
import { PoMediaPicker } from './po-media-picker'
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
  matchMethod?: 'fuzzy' | 'ai' | 'manual' | 'alias' | 'exact'
  tier?: MatchTier
  // AI-proposed replacement name (2 words, based on the photo + inventory).
  suggestedName?: string
  suggestedReason?: string
  suggestedSource?: 'vision' | 'text'
  nameStatus?: 'idle' | 'thinking' | 'ready' | 'accepted'
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

/** Comparison key: casing, punctuation and spacing are noise, not meaning. */
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// A row's tier: explicit human choices always outrank the classifier. A mapped
// row that no classifier has scored yet is 'unscored' rather than a fake tier.
function tierOf(m: ProductMapping): MatchTier {
  if (!m.mappedId) return 'none'
  if (m.matchMethod === 'manual' || m.matchMethod === 'alias' || m.matchMethod === 'exact') return 'exact'
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
  // Row whose 1688 listing is open in the media browser.
  const [mediaTarget, setMediaTarget] = useState<ProductMapping | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoProgress, setPhotoProgress] = useState<{ done: number; total: number } | null>(null)
  const [photoStats, setPhotoStats] = useState<{ fetched: number; failed: number } | null>(null)
  const [namingBusy, setNamingBusy] = useState(false)
  const [namingProgress, setNamingProgress] = useState<{ done: number; total: number } | null>(null)
  const [applyingNames, setApplyingNames] = useState(false)
  // Whether the classifier has been run at all - drives the honest empty state
  // on the coverage meter instead of reporting a misleading percentage.
  const [hasClassified, setHasClassified] = useState(false)

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

    // Auto-match: aliases first, then the product name itself. Both are
    // compared on a normalised key so casing, punctuation and double spaces
    // ("Real to real" vs "real-to-real") still count as the same product.
    const productMaps: ProductMapping[] = []
    const aliasByKey = new Map(productAliases.map(a => [normalizeName(a.alias_name), a.product_id]))
    const productByKey = new Map(systemProducts.map(p => [normalizeName(p.name), p.id]))

    for (const [excelProduct, count] of productCounts.entries()) {
      const key = normalizeName(excelProduct)
      const matchedId = aliasByKey.get(key) ?? productByKey.get(key) ?? null

      productMaps.push({
        excelProduct,
        count,
        mappedId: matchedId,
        sourceLink: productLinks.get(excelProduct) || null,
        // These are certainties, not guesses - record them as such so the row
        // shows 100% instead of an empty confidence.
        matchConfidence: matchedId ? 1 : undefined,
        tier: matchedId ? 'exact' : undefined,
        matchMethod: matchedId ? (aliasByKey.has(key) ? 'alias' : 'exact') : undefined,
        confirmed: !!matchedId,
      })
    }

    setProductMappings(productMaps)
    setStep('product_mapping')
  }

  function updateProductMapping(excelProduct: string, productId: string | null) {
    const row = productMappings.find(m => m.excelProduct === excelProduct)
    if (productId && row?.fetchedImage && !productImageById.get(productId)) {
      void fetch('/api/purchase-orders/product-media', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, imageUrl: row.fetchedImage }),
      }).then(() => {
        setSystemProducts(prev =>
          prev.map(p => (p.id === productId ? { ...p, image_url: row.fetchedImage || null } : p)),
        )
      })
    }
    setProductMappings(prev =>
      prev.map(m =>
        m.excelProduct === excelProduct
          ? {
              ...m,
              mappedId: productId,
              matchMethod: productId ? 'manual' : undefined,
              matchConfidence: productId ? 1 : undefined,
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
          // Match on the visually identified name when available; preserve the
          // Excel key separately so the response still updates the right row.
          products: unmatched.map(m => ({
            name: m.suggestedName || m.excelProduct,
            key: m.excelProduct,
          })),
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
      const byName = new Map(data.matches.map(m => [normalizeName(m.excelProduct), m]))
      setProductMappings(prev =>
        prev.map(m => {
          const match = byName.get(normalizeName(m.suggestedName || m.excelProduct))
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
      // A row-level photo becomes an inventory photo only after the matcher has
      // identified its owner. Do not refetch it or lose the reviewer’s choice.
      await Promise.all(
        unmatched.map(async row => {
          const match = byName.get(normalizeName(row.suggestedName || row.excelProduct))
          if (!match?.matchedId || !row.fetchedImage || productImageById.get(match.matchedId)) return
          await fetch('/api/purchase-orders/product-media', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ productId: match.matchedId, imageUrl: row.fetchedImage }),
          })
        }),
      )
      if (data.stats) setAiMatchStats(data.stats)
      setHasClassified(true)
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
      // If the reviewer accepted an AI name for this row, create the product
      // under that clean name and keep the messy PO spelling as the alias.
      const row = productMappings.find(m => m.excelProduct === excelProduct)
      const createName =
        row?.nameStatus === 'accepted' && row.suggestedName ? row.suggestedName : excelProduct.trim()
      const { data, error } = await supabase
        .from('products')
        .insert({ name: createName, image_url: row?.fetchedImage || null, is_active: true })
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

  // Photos are fetched from the supplier link BEFORE naming or matching. For
  // unmatched rows they live temporarily on ProductMapping; once a product is
  // selected or created, that same chosen photo is persisted to inventory.
  const productImageById = useMemo(
    () => new Map(systemProducts.map(p => [p.id, p.image_url])),
    [systemProducts],
  )

  const imageTargets = useMemo(
    () =>
      productMappings.filter(
        m => !m.fetchedImage && !(m.mappedId && productImageById.get(m.mappedId)) && !!m.sourceLink,
      ),
    [productMappings, productImageById],
  )

  const missingImageNoLink = useMemo(
    () =>
      productMappings.filter(
        m => !m.fetchedImage && !(m.mappedId && productImageById.get(m.mappedId)) && !m.sourceLink,
      ).length,
    [productMappings, productImageById],
  )

  // Rows the namer can actually SEE. Naming quality depends on this, so it is
  // surfaced in stage 3 rather than left implicit.
  const withPhotoCount = useMemo(
    () =>
      productMappings.filter(m => m.fetchedImage || (m.mappedId && productImageById.get(m.mappedId))).length,
    [productMappings, productImageById],
  )

  // Rows that have never been attempted. Only these hold the workflow back:
  // a listing with no photo, or one with no link at all, can never succeed, so
  // letting them block naming would deadlock the whole import.
  const pendingPhotos = useMemo(
    () => imageTargets.filter(m => !m.imageStatus || m.imageStatus === 'idle'),
    [imageTargets],
  )
  const photoReady = pendingPhotos.length === 0

  /**
   * Stage 2: give every linked product a photo automatically, taking the
   * listing's main image. This has to run BEFORE naming, because the namer
   * reads the photo - without it stage 3 would be guessing from PO text alone.
   * Individual photos can still be refined afterwards with "Choose media".
   */
  async function fetchAllPhotos() {
    const targets = imageTargets.filter(m => m.sourceLink)
    if (!targets.length) return

    setPhotoBusy(true)
    setPhotoStats(null)
    setPhotoProgress({ done: 0, total: targets.length })
    const PAGE = 25
    let done = 0
    let fetched = 0
    let failed = 0

    try {
      for (let i = 0; i < targets.length; i += PAGE) {
        const page = targets.slice(i, i + PAGE)
        const res = await fetch('/api/purchase-orders/product-media', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: page.map(m => ({ key: m.excelProduct, productId: m.mappedId, link: m.sourceLink })),
          }),
        })
        const data = (await res.json()) as {
          success: boolean
          error?: string
          results?: { key: string; productId: string | null; status: 'done' | 'skipped' | 'failed'; image: string | null }[]
        }
        if (!data.success) throw new Error(data.error || 'Photo fetch failed')

        const byKey = new Map((data.results || []).map(r => [r.key, r]))
        const byId = new Map(
          (data.results || []).filter(r => r.productId).map(r => [r.productId as string, r]),
        )
        setSystemProducts(prev =>
          prev.map(p => {
            const r = byId.get(p.id)
            return r?.image ? { ...p, image_url: r.image } : p
          }),
        )
        // Record the outcome for EVERY attempted row, including failures.
        // Without this a listing that has no usable photo stays queued forever
        // and blocks the rest of the workflow.
        setProductMappings(prev =>
          prev.map(m => {
            const r = byKey.get(m.excelProduct)
            if (!r) return m
            if (r.image) return { ...m, fetchedImage: r.image, imageStatus: 'done' as const }
            return { ...m, imageStatus: 'failed' as const, imageNote: 'No photo on the listing' }
          }),
        )
        fetched += (data.results || []).filter(r => r.status === 'done').length
        failed += (data.results || []).filter(r => r.status === 'failed').length
        done += page.length
        setPhotoProgress({ done, total: targets.length })
      }
      setPhotoStats({ fetched, failed })
    } catch (err) {
      console.error('[v0] bulk photo fetch failed:', err)
    } finally {
      setPhotoBusy(false)
    }
  }

  /**
   * Ask the AI for a better name for each row, using the product PHOTO as the
   * primary signal and the existing inventory names as the house vocabulary.
   * Sent in pages of 40 so a 591-product import cannot blow the request limit.
   */
  async function suggestNames(scope: 'all' | 'unmatched') {
    // Runs after the photo pass, so rows WITH a photo are named from it. Rows
    // whose listing had none are still included and fall back to text, which
    // beats leaving their raw Excel name to drive the inventory match.
    const pool = productMappings.filter(m => (scope === 'unmatched' ? !m.mappedId : true))
    if (!pool.length) return

    setNamingBusy(true)
    setNamingProgress({ done: 0, total: pool.length })
    const poolKeys = new Set(pool.map(m => m.excelProduct))
    setProductMappings(prev =>
      prev.map(m => (poolKeys.has(m.excelProduct) ? { ...m, nameStatus: 'thinking' } : m)),
    )

    const inventoryNames = systemProducts.slice(0, 300).map(p => p.name)
    const PAGE = 40
    let done = 0

    try {
      for (let i = 0; i < pool.length; i += PAGE) {
        const page = pool.slice(i, i + PAGE)
        const res = await fetch('/api/purchase-orders/suggest-names', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inventoryNames,
            items: page.map(m => ({
              key: m.excelProduct,
              // Mapped rows are judged on their inventory name, which is the
              // one a rename would actually change.
              currentName:
                (m.mappedId ? systemProducts.find(p => p.id === m.mappedId)?.name : null) || m.excelProduct,
              imageUrl: m.fetchedImage || (m.mappedId ? productImageById.get(m.mappedId) : null),
            })),
          }),
        })
        const data = (await res.json()) as {
          success: boolean
          error?: string
          suggestions?: { key: string; suggested: string; reason: string; source: 'vision' | 'text' }[]
        }
        if (!data.success) throw new Error(data.error || 'Naming failed')

        const byKey = new Map((data.suggestions || []).map(s => [s.key, s]))
        setProductMappings(prev =>
          prev.map(m => {
            if (!poolKeys.has(m.excelProduct)) return m
            const s = byKey.get(m.excelProduct)
            if (!s) return m.nameStatus === 'thinking' ? { ...m, nameStatus: 'idle' } : m
            return {
              ...m,
              suggestedName: s.suggested,
              suggestedReason: s.reason,
              suggestedSource: s.source,
              nameStatus: 'ready',
            }
          }),
        )
        done += page.length
        setNamingProgress({ done, total: pool.length })
      }
    } catch (err) {
      console.error('[v0] suggest names failed:', err)
      setProductMappings(prev =>
        prev.map(m => (m.nameStatus === 'thinking' ? { ...m, nameStatus: 'idle' } : m)),
      )
    } finally {
      setNamingBusy(false)
    }
  }

  function acceptName(excelProduct: string) {
    setProductMappings(prev =>
      prev.map(m => (m.excelProduct === excelProduct ? { ...m, nameStatus: 'accepted' } : m)),
    )
  }

  function rejectName(excelProduct: string) {
    setProductMappings(prev =>
      prev.map(m =>
        m.excelProduct === excelProduct
          ? { ...m, nameStatus: 'idle', suggestedName: undefined, suggestedReason: undefined }
          : m,
      ),
    )
  }

  const pendingNames = productMappings.filter(m => m.nameStatus === 'ready')
  const acceptedNames = productMappings.filter(m => m.nameStatus === 'accepted' && m.suggestedName)
  // Matching waits for the photo pass and for any suggestion still sitting in
  // review - but never for names that were never requested. Requiring every
  // row to be 'accepted' would lock the import behind 591 manual approvals.
  const readyForMatching = photoReady && pendingNames.length === 0

  function acceptAllNames() {
    setProductMappings(prev =>
      prev.map(m => (m.nameStatus === 'ready' ? { ...m, nameStatus: 'accepted' } : m)),
    )
  }

  /** Persist accepted names for products that exist in inventory. */
  async function applyAcceptedNames() {
    const renames = acceptedNames.filter(m => m.mappedId)
    if (!renames.length) return
    setApplyingNames(true)
    try {
      const res = await fetch('/api/purchase-orders/rename-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: renames.map(m => ({
            productId: m.mappedId,
            newName: m.suggestedName,
            oldName: m.excelProduct,
          })),
        }),
      })
      const data = (await res.json()) as { success: boolean; error?: string }
      if (!data.success) throw new Error(data.error || 'Rename failed')

      // Reflect the new names locally so the dropdown and rows agree.
      const nameById = new Map(renames.map(m => [m.mappedId as string, m.suggestedName as string]))
      setSystemProducts(prev => prev.map(p => (nameById.has(p.id) ? { ...p, name: nameById.get(p.id)! } : p)))
      setProductMappings(prev =>
        prev.map(m =>
          m.nameStatus === 'accepted' && m.mappedId
            ? { ...m, nameStatus: 'idle', suggestedName: undefined, suggestedReason: undefined }
            : m,
        ),
      )
    } catch (err) {
      console.error('[v0] apply names failed:', err)
    } finally {
      setApplyingNames(false)
    }
  }

  // Record the photo the reviewer picked in the media browser.
  function handleMediaSaved(imageUrl: string) {
    const target = mediaTarget
    if (!target?.mappedId) return
    setProductMappings(prev =>
      prev.map(m =>
        m.excelProduct === target.excelProduct ? { ...m, fetchedImage: imageUrl, imageStatus: 'done' } : m,
      ),
    )
    setSystemProducts(prev => prev.map(p => (p.id === target.mappedId ? { ...p, image_url: imageUrl } : p)))
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
    <>
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
                      disabled={aiMatching || creatingAllProducts || !readyForMatching}
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
                      disabled={creatingAllProducts || aiMatching || !readyForMatching}
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
                  {/* Dependency order is strict: fetch a supplier photo, identify
                      the product from that photo, then match/create inventory. */}
                  <div className="grid gap-3 lg:grid-cols-3">
                    {/* Stage 3 - match/create only after visual naming. */}
                    <div className={`order-3 rounded-lg border p-3 flex flex-col gap-2 ${readyForMatching ? '' : 'opacity-60'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          3. Match or create
                        </span>
                        <span className="text-xl font-bold tabular-nums">{coveragePct}%</span>
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
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        {(['exact', 'high', 'medium', 'low', 'none'] as const).map((t) => (
                          <span key={t} className="flex items-center gap-1">
                            <span className={`inline-block w-1.5 h-1.5 rounded-full ${TIER_META[t].bar}`} />
                            {TIER_META[t].label} <strong className="text-foreground">{tierCounts[t]}</strong>
                          </span>
                        ))}
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {!readyForMatching
                          ? pendingPhotos.length > 0
                            ? `Waiting on step 1 - ${pendingPhotos.length} photo${pendingPhotos.length === 1 ? '' : 's'} still to fetch.`
                            : `Waiting on step 2 - ${pendingNames.length} name${pendingNames.length === 1 ? '' : 's'} still awaiting your approval.`
                          : hasClassified
                            ? needsReviewCount > 0
                              ? `${needsReviewCount} uncertain match${needsReviewCount === 1 ? '' : 'es'} to review below.`
                              : 'Every product has a confident inventory match.'
                            : `${tierCounts.exact} matched exactly by name or alias. Match the remaining ${unmappedCount}.`}
                      </p>
                    </div>

                    {/* Stage 1 - photos. Bulk first, hand-picking second. */}
                    <div className="order-1 rounded-lg border p-3 flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          1. Fetch photos
                        </span>
                        <ImageIcon className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <div className="text-xl font-bold tabular-nums">
                        {withPhotoCount}
                        <span className="text-sm font-normal text-muted-foreground"> / {productMappings.length} have a photo</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {photoBusy && photoProgress
                          ? `Fetching ${photoProgress.done} of ${photoProgress.total}...`
                          : photoStats
                            ? `Added ${photoStats.fetched} photo${photoStats.fetched === 1 ? '' : 's'}${photoStats.failed > 0 ? `, ${photoStats.failed} had none to pull` : ''}. Refine any of them with Choose media.`
                            : pendingPhotos.length > 0
                              ? `${pendingPhotos.length} can pull a photo from their 1688 listing. Do this before naming.`
                              : imageTargets.length > 0
                                ? `${imageTargets.length} listing${imageTargets.length === 1 ? '' : 's'} had no photo - retry, or set one with Choose media.`
                                : 'Every product with a supplier link has a photo ready for naming.'}
                        {missingImageNoLink > 0 && ` ${missingImageNoLink} have no 1688 link.`}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-auto">
                        <Button
                          size="sm"
                          onClick={fetchAllPhotos}
                          disabled={photoBusy || imageTargets.length === 0}
                          className="h-7 gap-1 text-xs"
                        >
                          {photoBusy ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <ImageIcon className="w-3 h-3" />
                          )}
                          Fetch {imageTargets.length > 0 ? imageTargets.length : ''} photo
                          {imageTargets.length === 1 ? '' : 's'}
                        </Button>
                      </div>
                    </div>

                    {/* Stage 2 - naming. Deliberately gated on stage 1: the
                        namer reads the photo and never guesses from PO text. */}
                    <div className={`order-2 rounded-lg border p-3 flex flex-col gap-2 ${photoReady ? '' : 'opacity-60'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          2. Identify product name
                        </span>
                        <Wand2 className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <div className="text-xl font-bold tabular-nums">
                        {withPhotoCount}
                        <span className="text-sm font-normal text-muted-foreground"> can be named from a photo</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {namingBusy && namingProgress
                          ? `Naming ${namingProgress.done} of ${namingProgress.total}...`
                          : pendingNames.length > 0
                            ? `${pendingNames.length} suggestion${pendingNames.length === 1 ? '' : 's'} waiting for your approval.`
                            : photoReady
                              ? 'Two-word names read from the product photo, matched to your existing naming style.'
                              : `Fetch photos first - ${pendingPhotos.length} product${pendingPhotos.length === 1 ? '' : 's'} not yet checked, and the namer reads the photo.`}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-auto">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => suggestNames('all')}
                          disabled={namingBusy || photoBusy || !photoReady || productMappings.length === 0}
                          className="h-7 gap-1 text-xs bg-transparent"
                        >
                          {namingBusy ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Wand2 className="w-3 h-3" />
                          )}
                          Suggest all
                        </Button>
                        {unmappedCount > 0 && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => suggestNames('unmatched')}
                            disabled={namingBusy || photoBusy || !photoReady || unmappedCount === 0}
                            className="h-7 text-xs"
                          >
                            Unmatched only
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Bulk bar for name suggestions, only while there are some. */}
                  {(pendingNames.length > 0 || acceptedNames.length > 0) && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                      <Wand2 className="w-4 h-4 text-primary flex-shrink-0" />
                      <span className="text-xs flex-1 min-w-0">
                        {pendingNames.length > 0 && (
                          <><strong>{pendingNames.length}</strong> name suggestion{pendingNames.length === 1 ? '' : 's'} to review. </>
                        )}
                        {acceptedNames.length > 0 && (
                          <><strong>{acceptedNames.length}</strong> accepted{acceptedNames.filter(m => m.mappedId).length > 0 ? ` (${acceptedNames.filter(m => m.mappedId).length} will rename an inventory product)` : ''}.</>
                        )}
                      </span>
                      {pendingNames.length > 0 && (
                        <Button size="sm" variant="outline" onClick={acceptAllNames} className="h-7 text-xs bg-transparent">
                          Accept all {pendingNames.length}
                        </Button>
                      )}
                      {acceptedNames.filter(m => m.mappedId).length > 0 && (
                        <Button size="sm" onClick={applyAcceptedNames} disabled={applyingNames} className="h-7 gap-1 text-xs">
                          {applyingNames && <Loader2 className="w-3 h-3 animate-spin" />}
                          Save {acceptedNames.filter(m => m.mappedId).length} rename
                          {acceptedNames.filter(m => m.mappedId).length === 1 ? '' : 's'}
                        </Button>
                      )}
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
                  {/* Single column: the PO name, the target product and the
                      actions all need real width, and two columns truncated
                      every one of them. */}
                  <div className="p-4 flex flex-col gap-2">
                    {visibleMappings.length === 0 && (
                      <div className="text-center py-8 text-sm text-muted-foreground">
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
                        className={`flex items-center gap-3 p-3 bg-muted/50 rounded-lg border-l-2 ${meta.ring} ${
                          mapping.nameStatus === 'accepted' ? 'ring-1 ring-green-500/30' : ''
                        }`}
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
                          <button
                            type="button"
                            onClick={() => mapping.sourceLink && setMediaTarget(mapping)}
                            disabled={!mapping.sourceLink}
                            title={
                              mapping.sourceLink
                                ? 'Choose media from the 1688 listing'
                                : 'No 1688 link for this product'
                            }
                            className={`group relative w-10 h-10 flex-shrink-0 rounded border bg-background overflow-hidden flex items-center justify-center ${
                              mapping.sourceLink ? 'hover:border-primary cursor-pointer' : 'cursor-default'
                            }`}
                          >
                            {rowImage ? (
                              <img
                                src={rowImage || "/placeholder.svg"}
                                alt={`${mapping.excelProduct} product photo`}
                                className="w-full h-full object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <ImageIcon className="w-4 h-4 text-muted-foreground/40" />
                            )}
                            {mapping.sourceLink && (
                              <span className="absolute inset-0 hidden items-center justify-center bg-black/60 group-hover:flex">
                                <Images className="w-4 h-4 text-white" />
                              </span>
                            )}
                          </button>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm break-words" title={mapping.excelProduct}>
                            {mapping.excelProduct}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap mt-0.5">
                            <span className="text-xs text-muted-foreground">{mapping.count} rows</span>
                            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${meta.ring} ${meta.text}`}>
                              {meta.label}
                              {mapping.matchMethod === 'ai' && ' - AI'}
                              {mapping.matchMethod === 'fuzzy' && ' - Name'}
                              {mapping.matchMethod === 'manual' && ' - Manual'}
                              {mapping.matchMethod === 'alias' && ' - Alias'}
                              {mapping.matchMethod === 'exact' && ' - Name'}
                            </Badge>
                            {mapping.reason && !mapping.mappedId && (
                              <span className="text-[10px] text-muted-foreground truncate max-w-[280px]" title={mapping.reason}>
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
                                  className="text-[10px] px-1.5 py-0.5 rounded border border-border hover:bg-accent hover:text-accent-foreground transition-colors max-w-[200px] truncate"
                                  title={`${alt.name} (${Math.round(alt.score * 100)}% name similarity)`}
                                >
                                  {alt.name} <span className="opacity-60">{Math.round(alt.score * 100)}%</span>
                                </button>
                              ))}
                            </div>
                          )}
                          {/* AI name proposal, accepted or rejected per row. */}
                          {mapping.nameStatus === 'thinking' && (
                            <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-muted-foreground">
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Naming from photo...
                            </div>
                          )}
                          {mapping.suggestedName && mapping.nameStatus === 'ready' && (
                            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                              <Wand2 className="w-3 h-3 text-primary flex-shrink-0" />
                              <span className="text-[11px] text-muted-foreground">Rename to</span>
                              <span className="text-[11px] font-semibold">{mapping.suggestedName}</span>
                              {mapping.suggestedSource === 'vision' && (
                                <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 border-primary/40 text-primary">
                                  from photo
                                </Badge>
                              )}
                              {mapping.suggestedReason && (
                                <span className="text-[10px] text-muted-foreground truncate max-w-[200px]" title={mapping.suggestedReason}>
                                  {mapping.suggestedReason}
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => acceptName(mapping.excelProduct)}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground hover:opacity-90"
                              >
                                Accept
                              </button>
                              <button
                                type="button"
                                onClick={() => rejectName(mapping.excelProduct)}
                                className="text-[10px] px-1.5 py-0.5 rounded border border-border hover:bg-accent hover:text-accent-foreground"
                              >
                                Keep current
                              </button>
                            </div>
                          )}
                          {mapping.suggestedName && mapping.nameStatus === 'accepted' && (
                            <div className="flex items-center gap-1.5 mt-1.5 text-[11px]">
                              <CheckCircle className="w-3 h-3 text-green-500 flex-shrink-0" />
                              <span className="text-muted-foreground">Will be named</span>
                              <span className="font-semibold">{mapping.suggestedName}</span>
                              <button
                                type="button"
                                onClick={() => rejectName(mapping.excelProduct)}
                                className="text-[10px] text-muted-foreground underline hover:text-foreground"
                              >
                                undo
                              </button>
                            </div>
                          )}
                        </div>
                        <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <Select
                          value={mapping.mappedId || 'unmapped'}
                          onValueChange={(v) => updateProductMapping(mapping.excelProduct, v === 'unmapped' ? null : v)}
                        >
                          <SelectTrigger className="w-[260px] xl:w-[320px] flex-shrink-0">
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
                        {mapping.mappedId && mapping.sourceLink && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setMediaTarget(mapping)}
                            title="Browse all photos and videos on the 1688 listing"
                            className="flex-shrink-0 h-8 gap-1 text-xs"
                          >
                            <Images className="w-3.5 h-3.5" />
                            {rowImage ? 'Change' : 'Choose'} media
                          </Button>
                        )}
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

    {/* Rendered as a sibling so it is not nested inside the import dialog. */}
    <PoMediaPicker
      open={!!mediaTarget}
      onOpenChange={o => !o && setMediaTarget(null)}
      productId={mediaTarget?.mappedId ?? null}
      productName={mediaTarget?.excelProduct ?? ''}
      link={mediaTarget?.sourceLink ?? null}
      currentImage={mediaTarget?.mappedId ? productImageById.get(mediaTarget.mappedId) : null}
      onSaved={handleMediaSaved}
    />
    </>
  )
}
