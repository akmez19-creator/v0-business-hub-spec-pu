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
import { Upload, FileSpreadsheet, Loader2, CheckCircle, AlertCircle, ArrowRight, ArrowLeft, Users, MapPin, Plus, UserPlus, Building2, Package, RefreshCw, ArrowDownUp, Truck, RotateCcw } from 'lucide-react'
import { createRider, createContractor } from '@/lib/admin-actions'
import { normalizeSalesType, SALES_TYPE_LABELS, SALES_TYPE_COLORS, type SalesType } from '@/lib/types'
import { getRegionResolverData } from '@/lib/region-actions'
import { buildClientRegionResolver } from '@/lib/region-utils'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import * as XLSX from 'xlsx'

interface RiderMapping {
  excelName: string
  count: number
  mappedId: string | null
}

interface SystemRider {
  id: string
  name: string
  email: string
  contractor_id?: string | null
}

interface SystemContractor {
  id: string
  name: string
}

interface StatusMapping {
  excelStatus: string
  count: number
  mappedStatus: string
}

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

interface SalesTypeMappingEntry {
  excelValue: string
  count: number
  mappedType: SalesType
}

// System sales types for the mapping dropdown
const SYSTEM_SALES_TYPES: { value: SalesType; label: string; icon: string }[] = [
  { value: 'sale', label: 'Sale (Normal Delivery)', icon: 'truck' },
  { value: 'exchange', label: 'Exchange (Swap Product)', icon: 'refresh' },
  { value: 'trade_in', label: 'Trade In (Upgrade/Downgrade)', icon: 'arrowdownup' },
  { value: 'refund', label: 'Refund (Return & Cash Back)', icon: 'rotateccw' },
  { value: 'drop_off', label: 'Drop Off (Just Deliver)', icon: 'truck' },
]

// System statuses
const SYSTEM_STATUSES = [
  { value: 'pending', label: 'Pending' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'picked_up', label: 'Picked Up' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'nwd', label: 'NWD (Not Working Day)' },
  { value: 'cms', label: 'CMS (Cancelled)' },
]

export function ImportDeliveriesDialog() {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'upload' | 'duplicate_check' | 'mapping' | 'status_mapping' | 'sales_type_mapping' | 'return_product_mapping' | 'product_mapping' | 'contractors' | 'importing' | 'result'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [parsedData, setParsedData] = useState<Record<string, unknown>[]>([])
  const [riderMappings, setRiderMappings] = useState<RiderMapping[]>([])
  const [statusMappings, setStatusMappings] = useState<StatusMapping[]>([])
  const [systemRiders, setSystemRiders] = useState<SystemRider[]>([])
  const [systemContractors, setSystemContractors] = useState<SystemContractor[]>([])
  const [riderContractorAssignments, setRiderContractorAssignments] = useState<Record<string, string>>({})
  const [productMappings, setProductMappings] = useState<ProductMapping[]>([])
  const [systemProducts, setSystemProducts] = useState<SystemProduct[]>([])
  const [salesTypeMappings, setSalesTypeMappings] = useState<SalesTypeMappingEntry[]>([])
  const [savedRiderMappings, setSavedRiderMappings] = useState<Record<string, string>>({}) // excelName -> riderId
  const [savedStatusMappings, setSavedStatusMappings] = useState<Record<string, string>>({}) // excelStatus -> systemStatus
  const [savedContractorMappings, setSavedContractorMappings] = useState<Record<string, string>>({}) // riderId -> contractorId
  const [savedProductMappings, setSavedProductMappings] = useState<Record<string, string>>({}) // excelProduct -> productId
  const [savedSalesTypeMappings, setSavedSalesTypeMappings] = useState<Record<string, string>>({}) // excelSalesType -> SalesType
  const [returnProductOverrides, setReturnProductOverrides] = useState<Record<number, string>>({}) // rowIndex -> returnProduct
  const [duplicateContacts, setDuplicateContacts] = useState<{ contact: string; names: string[]; deliveryDate: string; rows: number[] }[]>([])
  const [duplicateResolutions, setDuplicateResolutions] = useState<Record<string, string>>({}) // contact-date key -> resolved name
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<{ success: number; failed: number; errors: string[] } | null>(null)
  const [resolveRegion, setResolveRegion] = useState<((input: string) => { locality: string; region: string } | null) | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // Fetch system riders, contractors, saved mappings, and region resolver when dialog opens
  useEffect(() => {
    if (open) {
      fetchRidersAndContractors()
      fetchSavedMappings()
      fetchRegionResolver()
    }
  }, [open])

  async function fetchRegionResolver() {
    const data = await getRegionResolverData()
    const resolver = buildClientRegionResolver(data)
    setResolveRegion(() => resolver)
  }

  async function fetchRidersAndContractors() {
    const supabase = createClient()
    
    // Fetch from riders table
    const { data: ridersData } = await supabase
      .from('riders')
      .select('id, name, phone, contractor_id')
      .eq('is_active', true)
      .order('name')
    
    if (ridersData) {
      setSystemRiders(ridersData.map(r => ({ id: r.id, name: r.name, email: r.phone || '', contractor_id: r.contractor_id })))
    }

    // Fetch from contractors table
    const { data: contractorsData } = await supabase
      .from('contractors')
      .select('id, name')
      .eq('is_active', true)
      .order('name')
    
    if (contractorsData) {
      setSystemContractors(contractorsData)
    }

    // Fetch products
    const { data: productsData } = await supabase
      .from('products')
      .select('id, name, image_url')
      .eq('is_active', true)
      .order('name')
    
    if (productsData) {
      setSystemProducts(productsData)
    }
  }

  async function fetchSavedMappings() {
    const supabase = createClient()
    
    const { data: mappings } = await supabase
      .from('import_mappings')
      .select('*')
    
    if (mappings) {
      const riderMap: Record<string, string> = {}
      const statusMap: Record<string, string> = {}
      const contractorMap: Record<string, string> = {}
      
      const productMap: Record<string, string> = {}
      const salesTypeMap: Record<string, string> = {}
      for (const m of mappings) {
        if (m.mapping_type === 'rider' && m.target_id) {
          riderMap[m.source_value] = m.target_id
        } else if (m.mapping_type === 'status' && m.target_value) {
          statusMap[m.source_value] = m.target_value
        } else if (m.mapping_type === 'rider_contractor' && m.target_id) {
          contractorMap[m.source_value] = m.target_id
        } else if (m.mapping_type === 'product' && m.target_id) {
          productMap[m.source_value] = m.target_id
        } else if (m.mapping_type === 'sales_type' && m.target_value) {
          salesTypeMap[m.source_value] = m.target_value
        }
      }
      
      setSavedRiderMappings(riderMap)
      setSavedStatusMappings(statusMap)
      setSavedContractorMappings(contractorMap)
      setSavedProductMappings(productMap)
      setSavedSalesTypeMappings(salesTypeMap)
    }
  }

  // Save a mapping to the database
  async function saveMapping(type: 'rider' | 'status' | 'rider_contractor' | 'product' | 'sales_type', sourceValue: string, targetId?: string, targetValue?: string) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    // Upsert the mapping
    await supabase
      .from('import_mappings')
      .upsert({
        mapping_type: type,
        source_value: sourceValue,
        target_id: targetId || null,
        target_value: targetValue || null,
        created_by: user?.id,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'mapping_type,source_value'
      })
  }

  // Column mapping
  const columnMap: Record<string, string> = {
    'RTE': 'rte', 'Entry Date': 'entry_date', 'Delivery Date': 'delivery_date',
    'INDEX': 'index_no', 'Customer Name': 'customer_name', 'Contact #1': 'contact_1',
    'Contact #2': 'contact_2', 'Region': 'region', 'Qty': 'qty', 'Qty ': 'qty',
    'Products': 'products', 'Amt': 'amount', 'Amt ': 'amount', ' Amt ': 'amount',
    'Payment Method': 'payment_method', 'SalesType': 'sales_type', 'SalesTyp': 'sales_type',
    'Notes': 'notes', 'MEDIUM': 'medium', 'Rider': 'rider', 'Rider Name': 'rider',
    'Rider name': 'rider', 'rider name': 'rider', 'RIDER NAME': 'rider', 'Status': 'status',
    'rte': 'rte', 'entry date': 'entry_date', 'delivery date': 'delivery_date',
    'index': 'index_no', 'customer name': 'customer_name', 'customer': 'customer_name',
    'name': 'customer_name', 'contact #1': 'contact_1', 'contact #2': 'contact_2',
    'contact 1': 'contact_1', 'contact 2': 'contact_2', 'contact': 'contact_1',
    'phone': 'contact_1', 'region': 'region', 'qty': 'qty', 'quantity': 'qty',
    'products': 'products', 'product': 'products', 'amt': 'amount', 'amount': 'amount',
    'price': 'amount', 'payment method': 'payment_method', 'payment': 'payment_method',
    'salestype': 'sales_type', 'sales type': 'sales_type', 'type': 'sales_type',
    'notes': 'notes', 'note': 'notes', 'medium': 'medium', 'rider': 'rider', 'status': 'status',
    'Contractor': 'contractor', 'contractor': 'contractor', 'Contractor Name': 'contractor',
  }

  function getValue(row: Record<string, unknown>, targetField: string): unknown {
    // First try exact match from columnMap
    for (const [excelCol, mappedField] of Object.entries(columnMap)) {
      if (mappedField === targetField && row[excelCol] !== undefined && row[excelCol] !== '') {
        return row[excelCol]
      }
    }
    // Second pass: check each actual row key against the columnMap (case-insensitive)
    for (const rowKey of Object.keys(row)) {
      const normalizedKey = rowKey.toLowerCase().trim()
      for (const [excelCol, mappedField] of Object.entries(columnMap)) {
        if (mappedField === targetField && normalizedKey === excelCol.toLowerCase().trim()) {
          if (row[rowKey] !== undefined && row[rowKey] !== '') return row[rowKey]
        }
      }
    }
    // Third pass: direct field name match (e.g. row key "rider" matches target "rider")
    for (const rowKey of Object.keys(row)) {
      if (rowKey.toLowerCase().trim() === targetField.toLowerCase()) {
        if (row[rowKey] !== undefined && row[rowKey] !== '') return row[rowKey]
      }
    }
    return null
  }

  // Parse date from various formats - avoid timezone issues by extracting date parts directly
  function parseDate(value: string | number | Date | null | undefined): string | null {
    if (!value) return null
    
    // Helper to format date parts to YYYY-MM-DD
    const formatDate = (year: number, month: number, day: number): string => {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
    
    // If Date object, extract local date parts (not UTC)
    if (value instanceof Date) {
      return formatDate(value.getFullYear(), value.getMonth() + 1, value.getDate())
    }
    
    // Excel serial date number
    if (typeof value === 'number') {
      const date = XLSX.SSF.parse_date_code(value)
      if (date) return formatDate(date.y, date.m, date.d)
    }
    
    const str = String(value).trim()
    if (!str) return null
    
    const months: Record<string, string> = { 
      'jan': '01', 'january': '01',
      'feb': '02', 'february': '02',
      'mar': '03', 'march': '03',
      'apr': '04', 'april': '04',
      'may': '05',
      'jun': '06', 'june': '06',
      'jul': '07', 'july': '07',
      'aug': '08', 'august': '08',
      'sep': '09', 'september': '09',
      'oct': '10', 'october': '10',
      'nov': '11', 'november': '11',
      'dec': '12', 'december': '12'
    }
    
    // Handle "3-Feb" format
    const shortMatch = str.match(/^(\d{1,2})-([A-Za-z]{3,9})$/)
    if (shortMatch) {
      const month = months[shortMatch[2].toLowerCase()]
      if (month) return `${new Date().getFullYear()}-${month}-${shortMatch[1].padStart(2, '0')}`
    }
    
    // Handle "Tuesday, 3 February 2026" or "3 February 2026" format
    const longMatch = str.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/)
    if (longMatch) {
      const month = months[longMatch[2].toLowerCase()]
      if (month) return `${longMatch[3]}-${month}-${longMatch[1].padStart(2, '0')}`
    }
    
    // Handle "2026-02-03" ISO format
    const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (isoMatch) {
      return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
    }
    
    // Handle "02/03/2026" or "03/02/2026" format (assume DD/MM/YYYY)
    const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (slashMatch) {
      const day = slashMatch[1].padStart(2, '0')
      const month = slashMatch[2].padStart(2, '0')
      return `${slashMatch[3]}-${month}-${day}`
    }
    
    // Fallback: parse with Date but use local date parts to avoid timezone shift
    const parsed = new Date(str)
    if (!isNaN(parsed.getTime())) {
      return formatDate(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate())
    }
    
    return null
  }

  function parseAmount(value: string | number | null | undefined): number {
    if (value === null || value === undefined || value === '') return 0
    if (typeof value === 'number') return value
    const cleaned = String(value).replace(/[Rs,\s]/g, '').trim()
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

      // Normalize headers — trim whitespace from all column names
      const normalizedData = (jsonData as Record<string, unknown>[]).map(row => {
        const normalized: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(row)) {
          normalized[key.trim()] = value
        }
        return normalized
      })
      setParsedData(normalizedData)

      // Extract unique rider names, products, sales types and count occurrences
      const riderCounts = new Map<string, number>()
      const statusCounts = new Map<string, number>()
      const productCounts = new Map<string, number>()
      const salesTypeCounts = new Map<string, number>()
      
      for (const row of normalizedData) {
        const riderValue = getValue(row, 'rider')
        if (riderValue && String(riderValue).trim() !== '') {
          const riderName = String(riderValue).trim()
          riderCounts.set(riderName, (riderCounts.get(riderName) || 0) + 1)
        }
        
        // Extract product values
        const productValue = getValue(row, 'products')
        if (productValue && String(productValue).trim() !== '') {
          const productName = String(productValue).trim()
          productCounts.set(productName, (productCounts.get(productName) || 0) + 1)
        }

        // Extract status values
        const statusValue = getValue(row, 'status')
        const statusStr = statusValue ? String(statusValue).trim() : ''
        if (statusStr) {
          statusCounts.set(statusStr, (statusCounts.get(statusStr) || 0) + 1)
        } else {
          statusCounts.set('(blank)', (statusCounts.get('(blank)') || 0) + 1)
        }

        // Extract sales type values
        const salesTypeValue = getValue(row, 'sales_type')
        const salesTypeStr = salesTypeValue ? String(salesTypeValue).trim() : ''
        if (salesTypeStr) {
          salesTypeCounts.set(salesTypeStr, (salesTypeCounts.get(salesTypeStr) || 0) + 1)
        }
      }

      // Create rider mappings - prioritize saved mappings, then auto-match
      const riderMaps: RiderMapping[] = []
      for (const [excelName, count] of riderCounts.entries()) {
        let matchedId: string | null = null
        
        // First check saved mappings
        if (savedRiderMappings[excelName]) {
          // Verify the saved rider still exists
          const savedRider = systemRiders.find(r => r.id === savedRiderMappings[excelName])
          if (savedRider) {
            matchedId = savedRiderMappings[excelName]
          }
        }
        
        // If no saved mapping, try auto-match
        if (!matchedId) {
          const searchName = excelName.toLowerCase().trim()
          for (const rider of systemRiders) {
            const riderName = (rider.name || rider.email || '').toLowerCase().trim()
            if (riderName === searchName || riderName.includes(searchName) || searchName.includes(riderName)) {
              matchedId = rider.id
              break
            }
          }
        }

        riderMaps.push({ excelName, count, mappedId: matchedId })
      }

      // Auto-assign contractors from Excel "Contractor" column
      const autoContractorAssignments: Record<string, string> = {}
      for (const row of normalizedData) {
        const riderValue = getValue(row, 'rider')
        const contractorValue = getValue(row, 'contractor')
        if (riderValue && contractorValue) {
          const riderName = String(riderValue).trim()
          const contractorName = String(contractorValue).trim().toLowerCase()
          // Find the mapped rider ID
          const riderMapping = riderMaps.find(m => m.excelName === riderName)
          if (riderMapping?.mappedId && !autoContractorAssignments[riderMapping.mappedId]) {
            // Find matching contractor
            const matchedContractor = systemContractors.find(c => 
              c.name.toLowerCase().trim() === contractorName ||
              c.name.toLowerCase().trim().includes(contractorName) ||
              contractorName.includes(c.name.toLowerCase().trim())
            )
            if (matchedContractor) {
              autoContractorAssignments[riderMapping.mappedId] = matchedContractor.id
            }
          }
        }
      }
      if (Object.keys(autoContractorAssignments).length > 0) {
        setRiderContractorAssignments(prev => ({ ...prev, ...autoContractorAssignments }))
      }

      // Create status mappings - prioritize saved mappings, then auto-match
      const statusMaps: StatusMapping[] = []
      for (const [excelStatus, count] of statusCounts.entries()) {
        let mappedStatus = 'pending' // Default
        
        // First check saved mappings
        if (savedStatusMappings[excelStatus]) {
          mappedStatus = savedStatusMappings[excelStatus]
        } else {
          // Auto-match based on keywords
          const statusLower = excelStatus.toLowerCase()
          
          if (excelStatus === '(blank)') {
            mappedStatus = 'pending'
          } else if (statusLower.includes('deliver')) {
            mappedStatus = 'delivered'
          } else if (statusLower.includes('pick')) {
            mappedStatus = 'picked_up'
          } else if (statusLower.includes('assign')) {
            mappedStatus = 'assigned'
          } else if (statusLower.includes('nwd') || statusLower.includes('not working')) {
            mappedStatus = 'nwd'
          } else if (statusLower.includes('cms') || statusLower.includes('cancel')) {
            mappedStatus = 'cms'
          } else if (statusLower.includes('pending')) {
            mappedStatus = 'pending'
          }
        }
        
        statusMaps.push({ excelStatus, count, mappedStatus })
      }

      // Create product mappings - prioritize saved mappings, then exact match
      const productMaps: ProductMapping[] = []
      for (const [excelProduct, count] of productCounts.entries()) {
        let matchedId: string | null = null
        
        // First check saved mappings
        if (savedProductMappings[excelProduct]) {
          const savedProduct = systemProducts.find(p => p.id === savedProductMappings[excelProduct])
          if (savedProduct) matchedId = savedProductMappings[excelProduct]
        }
        
        // Auto-match by exact name (case-insensitive)
        if (!matchedId) {
          const searchName = excelProduct.toLowerCase().trim()
          for (const product of systemProducts) {
            if (product.name.toLowerCase().trim() === searchName) {
              matchedId = product.id
              break
            }
          }
        }
        
        productMaps.push({ excelProduct, count, mappedId: matchedId })
      }

      // Create sales type mappings - prioritize saved mappings, then auto-normalize
      const salesTypeMaps: SalesTypeMappingEntry[] = []
      for (const [excelValue, count] of salesTypeCounts.entries()) {
        let mappedType: SalesType = 'sale'
        
        // First check saved mappings
        if (savedSalesTypeMappings[excelValue]) {
          mappedType = savedSalesTypeMappings[excelValue] as SalesType
        } else {
          // Auto-normalize using the utility function
          mappedType = normalizeSalesType(excelValue)
        }
        
        salesTypeMaps.push({ excelValue, count, mappedType })
      }

      setRiderMappings(riderMaps)
      setStatusMappings(statusMaps)
      setProductMappings(productMaps)
      setSalesTypeMappings(salesTypeMaps)
      
      // Pre-populate contractor assignments from saved mappings
      const contractorAssigns: Record<string, string> = {}
      for (const mapping of riderMaps) {
        if (mapping.mappedId && savedContractorMappings[mapping.mappedId]) {
          contractorAssigns[mapping.mappedId] = savedContractorMappings[mapping.mappedId]
        }
      }
      setRiderContractorAssignments(contractorAssigns)
      
      // Detect duplicate contacts with different names for the same delivery date
      const contactNamesByDate = new Map<string, Map<string, Set<number>>>() // deliveryDate -> contact -> Set of row indices
      const contactNamesMap = new Map<string, Map<string, Set<string>>>() // deliveryDate -> contact -> Set of names
      
      normalizedData.forEach((row, index) => {
        const contact1 = getValue(row, 'contact_1')
        const contact2 = getValue(row, 'contact_2')
        const customerName = getValue(row, 'customer_name')
        const deliveryDateRaw = getValue(row, 'delivery_date')
        const deliveryDate = parseDate(deliveryDateRaw as string | number | Date | null | undefined) || 'no_date'
        const name = customerName ? String(customerName).trim() : ''
        
        const contacts = [contact1, contact2].filter(c => c && String(c).trim() !== '').map(c => String(c).trim())
        
        for (const contact of contacts) {
          if (!contactNamesByDate.has(deliveryDate)) {
            contactNamesByDate.set(deliveryDate, new Map())
            contactNamesMap.set(deliveryDate, new Map())
          }
          
          const dateContactRows = contactNamesByDate.get(deliveryDate)!
          const dateContactNames = contactNamesMap.get(deliveryDate)!
          
          if (!dateContactRows.has(contact)) {
            dateContactRows.set(contact, new Set())
            dateContactNames.set(contact, new Set())
          }
          
          dateContactRows.get(contact)!.add(index)
          if (name) dateContactNames.get(contact)!.add(name)
        }
      })
      
      // Find contacts with multiple different names for the same date
      const duplicates: { contact: string; names: string[]; deliveryDate: string; rows: number[] }[] = []
      for (const [deliveryDate, contactMap] of contactNamesByDate) {
        const namesMap = contactNamesMap.get(deliveryDate)!
        for (const [contact, rowIndices] of contactMap) {
          const names = Array.from(namesMap.get(contact) || [])
          if (names.length > 1) {
            duplicates.push({
              contact,
              names,
              deliveryDate,
              rows: Array.from(rowIndices)
            })
          }
        }
      }
      
      setDuplicateContacts(duplicates)
      
      // If duplicates found, initialize default resolutions and go to duplicate_check step
      if (duplicates.length > 0) {
        // Initialize with first name as default for each duplicate
        const defaultResolutions: Record<string, string> = {}
        for (const dup of duplicates) {
          const key = `${dup.contact}-${dup.deliveryDate}`
          defaultResolutions[key] = dup.names[0] // Default to first name
        }
        setDuplicateResolutions(defaultResolutions)
        setStep('duplicate_check')
      } else {
        setStep('mapping')
      }
    } catch (err) {
      setResult({ success: 0, failed: 0, errors: ['Failed to parse file: ' + (err as Error).message] })
      setStep('result')
    }
  }

  function updateMapping(excelName: string, riderId: string | null) {
    setRiderMappings(prev => 
      prev.map(m => m.excelName === excelName ? { ...m, mappedId: riderId } : m)
    )
    // Save to database for future imports
    if (riderId) {
      saveMapping('rider', excelName, riderId)
    }
  }

  function updateStatusMapping(excelStatus: string, mappedStatus: string) {
    setStatusMappings(prev => 
      prev.map(m => m.excelStatus === excelStatus ? { ...m, mappedStatus } : m)
    )
    // Save to database for future imports
    saveMapping('status', excelStatus, undefined, mappedStatus)
  }

  function updateProductMapping(excelProduct: string, productId: string | null) {
    setProductMappings(prev =>
      prev.map(m => m.excelProduct === excelProduct ? { ...m, mappedId: productId } : m)
    )
    if (productId) {
      saveMapping('product', excelProduct, productId)
    }
  }

  function updateSalesTypeMapping(excelValue: string, mappedType: SalesType) {
    setSalesTypeMappings(prev =>
      prev.map(m => m.excelValue === excelValue ? { ...m, mappedType } : m)
    )
    saveMapping('sales_type', excelValue, undefined, mappedType)
  }

  const [creatingProduct, setCreatingProduct] = useState<string | null>(null)
  const [creatingAllProducts, setCreatingAllProducts] = useState(false)

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
      } else if (error) {
        alert(`Failed: ${error.message}`)
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

  const [creatingRider, setCreatingRider] = useState<string | null>(null)
  const [creatingAll, setCreatingAll] = useState(false)

  // Create rider from Excel name and auto-map
  // Keep the EXACT name from Excel (e.g., "JASSAM" and "JASSAM-1" are different riders)
  async function handleCreateRider(excelName: string) {
    setCreatingRider(excelName)
    try {
      // Use the exact name from Excel - don't strip suffixes
      const riderName = excelName.trim()
      
      const result = await createRider(riderName)
      
      if (result.success && result.riderId) {
        // Add the new rider to system riders with exact name
        setSystemRiders(prev => [...prev, { id: result.riderId!, name: riderName, email: '' }])
        // Auto-map this Excel name to the new rider
        updateMapping(excelName, result.riderId)
      } else if (result.error) {
        alert(`Failed to create rider: ${result.error}`)
      }
    } catch (err) {
      alert(`Error creating rider: ${(err as Error).message}`)
    } finally {
      setCreatingRider(null)
    }
  }

  // Create all unmapped riders at once
  async function handleCreateAllUnmapped() {
    setCreatingAll(true)
    try {
      const unmapped = riderMappings.filter(m => !m.mappedId)
      
      for (const mapping of unmapped) {
        await handleCreateRider(mapping.excelName)
      }
      
      // Refresh riders list
      await fetchRidersAndContractors()
    } finally {
      setCreatingAll(false)
    }
  }

  // Create contractor
  const [creatingContractor, setCreatingContractor] = useState(false)
  const [newContractorName, setNewContractorName] = useState('')

  async function handleCreateContractor() {
    if (!newContractorName.trim()) return
    setCreatingContractor(true)
    try {
      const result = await createContractor(newContractorName.trim())
      if (result.success && result.contractorId) {
        setSystemContractors(prev => [...prev, { id: result.contractorId!, name: newContractorName.trim() }])
        setNewContractorName('')
      } else if (result.error) {
        alert(`Failed to create contractor: ${result.error}`)
      }
    } catch (err) {
      alert(`Error: ${(err as Error).message}`)
    } finally {
      setCreatingContractor(false)
    }
  }

  // Assign contractor to rider
  function assignContractorToRider(riderId: string, contractorId: string | null) {
    setRiderContractorAssignments(prev => {
      const updated = { ...prev }
      if (contractorId) {
        updated[riderId] = contractorId
        // Save to database for future imports
        saveMapping('rider_contractor', riderId, contractorId)
      } else {
        delete updated[riderId]
      }
      return updated
    })
  }

  async function handleImport() {
    setStep('importing')
    setImporting(true)
    setProgress(0)

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      // Create rider lookup from mappings
      const riderLookup = new Map<string, string>()
      for (const mapping of riderMappings) {
        if (mapping.mappedId) {
          riderLookup.set(mapping.excelName, mapping.mappedId)
        }
      }

      // Create status lookup from mappings
      const statusLookup = new Map<string, string>()
      for (const mapping of statusMappings) {
        statusLookup.set(mapping.excelStatus, mapping.mappedStatus)
      }

      // Create product lookup from mappings
      const productLookup = new Map<string, string>()
      for (const mapping of productMappings) {
        if (mapping.mappedId) {
          productLookup.set(mapping.excelProduct, mapping.mappedId)
        }
      }

      // Create sales type lookup from mappings
      const salesTypeLookup = new Map<string, SalesType>()
      for (const mapping of salesTypeMappings) {
        salesTypeLookup.set(mapping.excelValue, mapping.mappedType)
      }

      // Create import log
      const { data: importLog } = await supabase
        .from('delivery_imports')
        .insert({
          filename: file?.name || 'unknown',
          total_rows: parsedData.length,
          status: 'processing',
          imported_by: user?.id,
        })
        .select()
        .single()

      const deliveries: Record<string, unknown>[] = []
      const errors: string[] = []

      for (let i = 0; i < parsedData.length; i++) {
        const row = parsedData[i]
        let customerName = getValue(row, 'customer_name')
        
        // Check if this row has a duplicate resolution
        const contact1 = getValue(row, 'contact_1')
        const contact2 = getValue(row, 'contact_2')
        const deliveryDateRaw = getValue(row, 'delivery_date')
        const deliveryDateForKey = parseDate(deliveryDateRaw as string | number | Date | null | undefined) || 'no_date'
        
        const contacts = [contact1, contact2].filter(c => c && String(c).trim() !== '').map(c => String(c).trim())
        for (const contact of contacts) {
          const resolutionKey = `${contact}-${deliveryDateForKey}`
          if (duplicateResolutions[resolutionKey]) {
            customerName = duplicateResolutions[resolutionKey]
            break
          }
        }
        
        if (!customerName || String(customerName).trim() === '') {
          errors.push(`Row ${i + 2}: Missing customer name`)
          continue
        }

        const riderValue = getValue(row, 'rider')
        const riderName = riderValue ? String(riderValue).trim() : ''
        const riderId = riderName ? riderLookup.get(riderName) || null : null

        // Use status mapping
        const rawStatus = getValue(row, 'status')
        const statusStr = rawStatus ? String(rawStatus).trim() : ''
        const lookupKey = statusStr || '(blank)'
        let status = statusLookup.get(lookupKey) || 'pending'
        
        // If no status mapped and rider is assigned, set to 'assigned'
        if (lookupKey === '(blank)' && riderId && status === 'pending') {
          status = 'assigned'
        }

        const productName = getValue(row, 'products') ? String(getValue(row, 'products')).trim() : null
        const productId = productName ? productLookup.get(productName) || null : null

        // Resolve sales type
        const rawSalesType = getValue(row, 'sales_type') ? String(getValue(row, 'sales_type')).trim() : ''
        const resolvedSalesType: SalesType = rawSalesType
          ? (salesTypeLookup.get(rawSalesType) || normalizeSalesType(rawSalesType))
          : 'sale'

        // Determine return_product based on sales type
        let returnProduct: string | null = null
        const notesValue = getValue(row, 'notes') ? String(getValue(row, 'notes')).trim() : null
        
        // Check if admin manually set return product in the return_product_mapping step
        if (returnProductOverrides[i] !== undefined) {
          returnProduct = returnProductOverrides[i] || null
        } else if (resolvedSalesType === 'exchange') {
          returnProduct = productName
        } else if (resolvedSalesType === 'refund') {
          returnProduct = productName
        } else if (resolvedSalesType === 'trade_in') {
          returnProduct = notesValue || productName
        }

        // Parse payment method and set appropriate payment fields
        const rawPaymentMethod = getValue(row, 'payment_method') ? String(getValue(row, 'payment_method')).trim().toLowerCase() : null
        let paymentMethod: string | null = null
        let paymentCash = 0
        let paymentBank = 0
        const amt = parseAmount(getValue(row, 'amount') as string | number)
        
        if (rawPaymentMethod) {
          if (rawPaymentMethod === 'juice to rider' || rawPaymentMethod === 'juice_to_rider' || rawPaymentMethod === 'jtr' || rawPaymentMethod === 'juice') {
            paymentMethod = 'juice'
          } else if (rawPaymentMethod === 'cash') {
            paymentMethod = 'cash'
            paymentCash = amt // Set payment_cash for cash payments
          } else if (rawPaymentMethod === 'bank' || rawPaymentMethod === 'internet banking' || rawPaymentMethod === 'already paid' || rawPaymentMethod === 'already_paid' || rawPaymentMethod === 'prepaid' || rawPaymentMethod === 'pre-paid' || rawPaymentMethod === 'paid') {
            paymentMethod = 'paid'
            paymentBank = amt // Set payment_bank for paid/bank payments
          } else {
            paymentMethod = rawPaymentMethod
          }
        }

        deliveries.push({
          rte: getValue(row, 'rte') ? String(getValue(row, 'rte')) : null,
          entry_date: parseDate(getValue(row, 'entry_date') as string | number | Date | null) || new Date().toISOString().split('T')[0],
          delivery_date: parseDate(getValue(row, 'delivery_date') as string | number | Date | null),
          // index_no is excluded to avoid unique constraint violations during import
          customer_name: String(customerName).trim(),
          contact_1: getValue(row, 'contact_1') ? String(getValue(row, 'contact_1')) : null,
          contact_2: getValue(row, 'contact_2') ? String(getValue(row, 'contact_2')) : null,
          ...(() => {
            const raw = getValue(row, 'region') ? String(getValue(row, 'region')).trim() : null
            if (!raw) return { locality: null }
            if (!resolveRegion) return { locality: raw }
            const resolved = resolveRegion(raw)
            if (resolved) return { locality: resolved.locality }
            return { locality: raw }
          })(),
          qty: parseInt(String(getValue(row, 'qty') || '1')) || 1,
          products: productName,
          product_id: productId,
          amount: amt,
          payment_cash: paymentCash,
          payment_bank: paymentBank,
          payment_method: paymentMethod,
          sales_type: resolvedSalesType,
          return_product: returnProduct,
          notes: notesValue,
          medium: getValue(row, 'medium') ? String(getValue(row, 'medium')) : null,
          rider_id: riderId,
          contractor_id: riderId ? (riderContractorAssignments[riderId] || systemRiders.find(r => r.id === riderId)?.contractor_id || null) : null,
          status: status,
          assigned_at: riderId ? new Date().toISOString() : null,
          assigned_by: riderId ? user?.id : null,
          import_batch_id: importLog?.id,
          created_by: user?.id,
        })
      }

      // Insert in batches - simple insert, ignoring index_no constraint
      const batchSize = 50
      let successCount = 0
      const totalBatches = Math.ceil(deliveries.length / batchSize)
      
      for (let i = 0; i < deliveries.length; i += batchSize) {
        const batchNum = Math.floor(i / batchSize) + 1
        setProgress(Math.round((batchNum / totalBatches) * 100))
        
        const batch = deliveries.slice(i, i + batchSize)
        
        const { error } = await supabase.from('deliveries').insert(batch)
        
        if (error) {
          errors.push(`Batch ${batchNum}: ${error.message}`)
        } else {
          successCount += batch.length
        }
        
        if (i + batchSize < deliveries.length) {
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      }

      // Update riders with contractor assignments AND set contractor_id on their deliveries
      for (const [riderId, contractorId] of Object.entries(riderContractorAssignments)) {
        if (contractorId) {
          // Update rider record
          await supabase
            .from('riders')
            .update({ contractor_id: contractorId, updated_at: new Date().toISOString() })
            .eq('id', riderId)
          // Patch deliveries that were just imported with this rider but missing contractor_id
          if (importLog?.id) {
            await supabase
              .from('deliveries')
              .update({ contractor_id: contractorId })
              .eq('import_batch_id', importLog.id)
              .eq('rider_id', riderId)
              .is('contractor_id', null)
          }
        }
      }

      // Update import log
      await supabase
        .from('delivery_imports')
        .update({
          successful_rows: successCount,
          failed_rows: deliveries.length - successCount + errors.filter(e => e.includes('Row')).length,
          status: 'completed',
          completed_at: new Date().toISOString(),
          error_message: errors.length > 0 ? errors.slice(0, 10).join('; ') : null,
        })
        .eq('id', importLog?.id)

      setResult({
        success: successCount,
        failed: deliveries.length - successCount + errors.filter(e => e.includes('Row')).length,
        errors: errors.slice(0, 5),
      })

      router.refresh()
    } catch (err) {
      setResult({ success: 0, failed: 0, errors: ['Import failed: ' + (err as Error).message] })
    }

    setImporting(false)
    setStep('result')
  }

  function handleClose() {
    setOpen(false)
    setFile(null)
    setParsedData([])
    setRiderMappings([])
    setStatusMappings([])
    setProductMappings([])
    setSalesTypeMappings([])
    setReturnProductOverrides({})
    setRiderContractorAssignments({})
    setNewContractorName('')
    setDuplicateContacts([])
    setDuplicateResolutions({})
    setResult(null)
    setProgress(0)
    setStep('upload')
  }

  const unmappedCount = riderMappings.filter(m => !m.mappedId).length
  const totalDeliveriesWithRider = riderMappings.reduce((sum, m) => sum + m.count, 0)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="w-4 h-4 mr-2" />
          Import Excel
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>
            {step === 'upload' && 'Step 1: Upload Excel File'}
            {step === 'duplicate_check' && 'Step 2: Duplicate Contacts Found'}
            {step === 'mapping' && 'Step 3: Map Riders'}
            {step === 'status_mapping' && 'Step 4: Map Status Values'}
            {step === 'sales_type_mapping' && 'Step 5: Map Sales Types'}
            {step === 'return_product_mapping' && 'Step 6: Return Products'}
            {step === 'product_mapping' && 'Step 7: Map Products'}
            {step === 'contractors' && 'Step 8: Assign Contractors to Riders'}
            {step === 'importing' && 'Importing...'}
            {step === 'result' && 'Import Complete'}
          </DialogTitle>
          <DialogDescription>
            {step === 'upload' && 'Upload your Excel file with deliveries'}
            {step === 'duplicate_check' && `Found ${duplicateContacts.length} contact(s) with different customer names for the same delivery date`}
            {step === 'mapping' && `Map rider names from Excel to riders in the system. ${parsedData.length.toLocaleString()} deliveries found.`}
            {step === 'status_mapping' && 'Map status values from Excel to system statuses'}
            {step === 'sales_type_mapping' && 'Map sales types from Excel (Sale, Exchange, Trade In, Refund, Drop Off)'}
            {step === 'return_product_mapping' && 'Review and edit which products the rider needs to pick up for Exchange, Trade In, and Refund orders'}
            {step === 'product_mapping' && 'Map product names from Excel to your inventory'}
            {step === 'contractors' && 'Assign each rider to their contractor (optional)'}
            {step === 'importing' && 'Please wait while your data is being imported'}
            {step === 'result' && 'Review your import results'}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {/* Step 1: Upload */}
          {step === 'upload' && (
            <div className="space-y-4">
              <div
                className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <FileSpreadsheet className="w-10 h-10 mx-auto mb-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mb-2">
                  {file ? file.name : 'Click to select a file'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Supports Excel (.xlsx, .xls) and CSV files
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>

              <div className="text-xs text-muted-foreground bg-muted p-3 rounded-md">
                <p className="font-medium mb-1">Expected columns:</p>
                <p>RTE, Entry Date, Delivery Date, INDEX, Customer Name, Contact #1, Contact #2, Region, Qty, Products, Amt, Payment Method, SalesType, Notes, MEDIUM, Rider Name, Status</p>
              </div>
            </div>
          )}

          {/* Step 2: Duplicate Check */}
          {step === 'duplicate_check' && (
            <div className="space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-5 h-5 text-amber-500" />
                  <span className="font-medium text-amber-500">Potential Duplicate Customers</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  The following contacts have different customer names for the same delivery date. 
                  Please select the correct name to use for each.
                </p>
              </div>

              <ScrollArea className="h-[350px] border rounded-lg">
                <div className="p-4 space-y-4">
                  {duplicateContacts.map((dup, idx) => {
                    const key = `${dup.contact}-${dup.deliveryDate}`
                    const selectedName = duplicateResolutions[key] || dup.names[0]
                    return (
                      <div key={idx} className="bg-muted/50 rounded-lg p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium">{dup.contact}</div>
                            <div className="text-xs text-muted-foreground">
                              {dup.deliveryDate !== 'no_date' ? `Delivery: ${dup.deliveryDate}` : 'No delivery date'} · {dup.rows.length} rows affected
                            </div>
                          </div>
                        </div>
                        
                        <div className="space-y-2">
                          <div className="text-xs font-medium text-muted-foreground">Select the correct name:</div>
                          <div className="flex flex-wrap gap-2">
                            {dup.names.map((name, nameIdx) => {
                              const resKey = `${dup.contact}-${dup.deliveryDate}`
                              return (
                              <Button
                                key={nameIdx}
                                variant={selectedName === name ? "default" : "outline"}
                                size="sm"
                                onClick={() => {
                                  console.log("[v0] Button clicked - key:", resKey, "name:", name)
                                  setDuplicateResolutions(prev => {
                                    const updated = { ...prev, [resKey]: name }
                                    console.log("[v0] Updated resolutions:", updated)
                                    return updated
                                  })
                                }}
                              >
                                {name}
                              </Button>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Step 3: Mapping */}
          {step === 'mapping' && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-muted rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold">{parsedData.length.toLocaleString()}</div>
                  <div className="text-xs text-muted-foreground">Total Deliveries</div>
                </div>
                <div className="bg-muted rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold">{riderMappings.length}</div>
                  <div className="text-xs text-muted-foreground">Unique Riders in Excel</div>
                </div>
                <div className="bg-muted rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold">{systemRiders.length}</div>
                  <div className="text-xs text-muted-foreground">Riders in System</div>
                </div>
              </div>

              {riderMappings.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p>No rider names found in your Excel file.</p>
                  <p className="text-sm">All deliveries will be imported as "Pending".</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Map rider names from Excel to system riders, or create new riders:</span>
                    {unmappedCount > 0 && (
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          handleCreateAllUnmapped()
                        }}
                        disabled={creatingAll}
                        className="gap-1 bg-transparent"
                      >
                        {creatingAll ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <UserPlus className="w-4 h-4" />
                        )}
                        {creatingAll ? 'Creating...' : `Create All ${unmappedCount} Riders`}
                      </Button>
                    )}
                  </div>

                  <ScrollArea className="h-[300px] border rounded-lg">
                    <div className="p-4 space-y-3">
                      {riderMappings.map((mapping) => (
                        <div key={mapping.excelName} className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{mapping.excelName}</div>
                            <div className="text-xs text-muted-foreground">{mapping.count} deliveries</div>
                          </div>
                          <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <Select
                            value={mapping.mappedId || 'unmapped'}
                            onValueChange={(v) => updateMapping(mapping.excelName, v === 'unmapped' ? null : v)}
                          >
                            <SelectTrigger className="w-[200px]">
                              <SelectValue placeholder="Select rider..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unmapped">
                                <span className="text-muted-foreground">-- Leave as Pending --</span>
                              </SelectItem>
                              {systemRiders.map((rider) => (
                                <SelectItem key={rider.id} value={rider.id}>
                                  {rider.name || rider.email}
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
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                handleCreateRider(mapping.excelName)
                              }}
                              disabled={creatingRider === mapping.excelName}
                              title={`Create rider "${mapping.excelName.replace(/[\s-]+\d+$/, '').trim()}"`}
                              className="flex-shrink-0 bg-transparent"
                            >
                              {creatingRider === mapping.excelName ? (
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

                  <div className="text-xs text-muted-foreground bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-3 rounded-md">
                    <p className="font-medium text-amber-800 dark:text-amber-200">Note:</p>
                    <p className="text-amber-700 dark:text-amber-300">Unmapped riders will have their deliveries imported as "Pending" status. You can assign riders later from the deliveries table.</p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 3: Map Status Values */}
          {step === 'status_mapping' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Map status values from Excel to system statuses:</span>
                <Badge variant="secondary">{statusMappings.length} unique statuses found</Badge>
              </div>

              <ScrollArea className="h-[300px] border rounded-lg">
                <div className="p-4 space-y-3">
                  {statusMappings.map((mapping) => (
                    <div key={mapping.excelStatus} className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">
                          {mapping.excelStatus === '(blank)' ? (
                            <span className="text-muted-foreground italic">{'(blank/empty)'}</span>
                          ) : (
                            mapping.excelStatus
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">{mapping.count} deliveries</div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      <Select
                        value={mapping.mappedStatus}
                        onValueChange={(v) => updateStatusMapping(mapping.excelStatus, v)}
                      >
                        <SelectTrigger className="w-[200px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SYSTEM_STATUSES.map((status) => (
                            <SelectItem key={status.value} value={status.value}>
                              {status.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                    </div>
                  ))}
                </div>
              </ScrollArea>

              <div className="text-xs text-muted-foreground bg-muted p-3 rounded-md">
                <p className="font-medium mb-1">System Statuses:</p>
                <ul className="grid grid-cols-2 gap-1">
                  <li><strong>Pending:</strong> Not yet assigned</li>
                  <li><strong>Assigned:</strong> Assigned to rider</li>
                  <li><strong>Picked Up:</strong> Rider picked up</li>
                  <li><strong>Delivered:</strong> Successfully delivered</li>
                  <li><strong>NWD:</strong> Not Working Day</li>
                  <li><strong>CMS:</strong> Cancelled/Customer No Show</li>
                </ul>
              </div>
            </div>
          )}

          {/* Step 4: Map Sales Types */}
          {step === 'sales_type_mapping' && (
            <div className="space-y-4">
              {salesTypeMappings.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Truck className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p>No sales type values found in your Excel file.</p>
                  <p className="text-sm">All deliveries will default to "Sale" (normal delivery).</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Map sales type values from Excel to system types:</span>
                    <Badge variant="secondary">{salesTypeMappings.length} unique types found</Badge>
                  </div>

                  <ScrollArea className="h-[300px] border rounded-lg">
                    <div className="p-4 space-y-3">
                      {salesTypeMappings.map((mapping) => (
                        <div key={mapping.excelValue} className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{mapping.excelValue}</div>
                            <div className="text-xs text-muted-foreground">{mapping.count} deliveries</div>
                          </div>
                          <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                          <Select
                            value={mapping.mappedType}
                            onValueChange={(v) => updateSalesTypeMapping(mapping.excelValue, v as SalesType)}
                          >
                            <SelectTrigger className="w-[240px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {SYSTEM_SALES_TYPES.map((st) => (
                                <SelectItem key={st.value} value={st.value}>
                                  {st.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0" />
                        </div>
                      ))}
                    </div>
                  </ScrollArea>

                  <div className="text-xs text-muted-foreground bg-muted p-3 rounded-md">
                    <p className="font-medium mb-1">Sales Type Actions:</p>
                    <ul className="grid grid-cols-1 gap-1">
                      <li><strong>Sale:</strong> Normal delivery, no return</li>
                      <li><strong>Exchange:</strong> Deliver new product, pick up old product</li>
                      <li><strong>Trade In:</strong> Deliver new, pick up trade product (from notes)</li>
                      <li><strong>Refund:</strong> Give cash refund, pick up product</li>
                      <li><strong>Drop Off:</strong> Just deliver, no collection</li>
                    </ul>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Step 5: Return Product Mapping */}
          {step === 'return_product_mapping' && (() => {
            // Build list of return-type rows from parsed data + sales type mappings
            const salesTypeLookupLocal = new Map<string, SalesType>()
            for (const m of salesTypeMappings) salesTypeLookupLocal.set(m.excelValue, m.mappedType)
            
            const returnRows: { idx: number; customer: string; product: string; salesType: SalesType; notes: string; autoReturn: string }[] = []
            // Simple field lookup - matches column headers case-insensitively
            const getVal = (row: Record<string, unknown>, ...fields: string[]) => {
              for (const field of fields) {
                for (const key of Object.keys(row)) {
                  if (key.toLowerCase().trim() === field.toLowerCase()) {
                    if (row[key] !== undefined && row[key] !== '') return row[key]
                  }
                }
              }
              return null
            }
            
            for (let i = 0; i < parsedData.length; i++) {
              const row = parsedData[i]
              const rawST = getVal(row, 'sales_type', 'salestype', 'SalesType') ? String(getVal(row, 'sales_type', 'salestype', 'SalesType')).trim() : ''
              const resolvedType = rawST ? (salesTypeLookupLocal.get(rawST) || normalizeSalesType(rawST)) : 'sale'
              
              if (resolvedType === 'exchange' || resolvedType === 'trade_in' || resolvedType === 'refund') {
                const product = getVal(row, 'products', 'product', 'Products') ? String(getVal(row, 'products', 'product', 'Products')).trim() : ''
                const customer = getVal(row, 'customer_name', 'customer name', 'Customer Name') ? String(getVal(row, 'customer_name', 'customer name', 'Customer Name')).trim() : 'Unknown'
                const notes = getVal(row, 'notes', 'Notes') ? String(getVal(row, 'notes', 'Notes')).trim() : ''
                
                let autoReturn = product
                if (resolvedType === 'trade_in') autoReturn = notes || product
                
                returnRows.push({ idx: i, customer, product, salesType: resolvedType, notes, autoReturn })
              }
            }
            
            return (
              <div className="space-y-4">
                {returnRows.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Package className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p>No Exchange, Trade In, or Refund orders found.</p>
                    <p className="text-sm">All deliveries are normal sales or drop offs.</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Specify which product the rider needs to pick up:</span>
                      <Badge variant="secondary">{returnRows.length} return orders</Badge>
                    </div>

                    <ScrollArea className="h-[350px] border rounded-lg">
                      <div className="p-3 space-y-2">
                        {returnRows.map((r) => (
                          <div key={r.idx} className="p-3 rounded-lg bg-muted/50 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{r.customer}</p>
                                <p className="text-xs text-muted-foreground truncate">Delivering: {r.product || '(no product)'}</p>
                              </div>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                                r.salesType === 'exchange' ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' : 
                                r.salesType === 'trade_in' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' : 
                                'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                              }`}>
                                {r.salesType === 'exchange' ? 'Exchange' : r.salesType === 'trade_in' ? 'Trade In' : 'Refund'}
                              </span>
                            </div>
                            {r.notes && r.salesType === 'trade_in' && (
                              <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-1.5 rounded">
                                Notes: {r.notes}
                              </p>
                            )}
                            <div className="flex items-center gap-2">
                              <RotateCcw className="w-4 h-4 text-muted-foreground shrink-0" />
                              <Input
                                placeholder="Product to pick up from customer..."
                                value={returnProductOverrides[r.idx] !== undefined ? returnProductOverrides[r.idx] : r.autoReturn}
                                onChange={(e) => setReturnProductOverrides(prev => ({ ...prev, [r.idx]: e.target.value }))}
                                className="h-8 text-sm"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>

                    <div className="text-xs text-muted-foreground bg-muted p-3 rounded-md">
                      <p><strong>Exchange/Refund:</strong> defaults to the same product being delivered.</p>
                      <p><strong>Trade In:</strong> defaults to the product from the Notes column. Edit to correct if needed.</p>
                    </div>
                  </>
                )}
              </div>
            )
          })()}

          {/* Step 6: Map Products */}
          {step === 'product_mapping' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Map product names from Excel to inventory:</span>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{productMappings.length} products found</Badge>
                  {productMappings.filter(m => !m.mappedId).length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCreateAllUnmappedProducts() }}
                      disabled={creatingAllProducts}
                      className="gap-1 bg-transparent"
                    >
                      {creatingAllProducts ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                      {creatingAllProducts ? 'Creating...' : `Add All ${productMappings.filter(m => !m.mappedId).length} to Inventory`}
                    </Button>
                  )}
                </div>
              </div>

              {productMappings.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <p>No product names found in your Excel file.</p>
                </div>
              ) : (
                <ScrollArea className="h-[300px] border rounded-lg">
                  <div className="p-4 space-y-3">
                    {productMappings.map((mapping) => (
                      <div key={mapping.excelProduct} className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{mapping.excelProduct}</div>
                          <div className="text-xs text-muted-foreground">{mapping.count} deliveries</div>
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
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleCreateProduct(mapping.excelProduct) }}
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
                <p>Matched: <strong>{productMappings.filter(m => m.mappedId).length}</strong> / {productMappings.length} products. Unmatched products will be stored as text only without inventory tracking.</p>
              </div>
            </div>
          )}

          {/* Step 5: Assign Contractors to Riders */}
          {step === 'contractors' && (
            <div className="space-y-4">
              {/* Create new contractor */}
              <div className="flex gap-2">
                <Input
                  placeholder="New contractor name..."
                  value={newContractorName}
                  onChange={(e) => setNewContractorName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateContractor()}
                />
                <Button 
                  onClick={handleCreateContractor} 
                  disabled={!newContractorName.trim() || creatingContractor}
                >
                  {creatingContractor ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
                  Add
                </Button>
              </div>

              <div className="text-sm text-muted-foreground">
                Assign contractors to the {riderMappings.filter(m => m.mappedId).length} riders mapped from your Excel:
              </div>

              <ScrollArea className="h-[300px] border rounded-lg p-2">
                <div className="space-y-2">
                  {riderMappings.filter(m => m.mappedId).map((mapping) => {
                    const rider = systemRiders.find(r => r.id === mapping.mappedId)
                    const currentContractorId = riderContractorAssignments[mapping.mappedId!] || rider?.contractor_id || ''
                    
                    return (
                      <div key={mapping.excelName} className="flex items-center gap-3 p-2 rounded-md bg-muted/50">
                        <Users className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{mapping.excelName}</div>
                          <div className="text-xs text-muted-foreground">{mapping.count} deliveries</div>
                        </div>
                        <Select 
                          value={currentContractorId} 
                          onValueChange={(v) => assignContractorToRider(mapping.mappedId!, v === 'none' ? null : v)}
                        >
                          <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="Select contractor..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No Contractor</SelectItem>
                            {systemContractors.map((c) => (
                              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>

              {systemContractors.length === 0 && (
                <div className="text-center py-4 text-muted-foreground">
                  <Building2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No contractors yet. Add one above or skip this step.</p>
                </div>
              )}
            </div>
          )}

          {/* Step 4: Importing */}
          {step === 'importing' && (
            <div className="space-y-4 py-8">
              <Loader2 className="w-12 h-12 mx-auto animate-spin text-primary" />
              <Progress value={progress} />
              <p className="text-sm text-center text-muted-foreground">
                Importing {parsedData.length.toLocaleString()} deliveries... {progress}%
              </p>
            </div>
          )}

          {/* Step 4: Result */}
          {step === 'result' && result && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 rounded-lg bg-muted">
                {result.success > 0 ? (
                  <CheckCircle className="w-10 h-10 text-green-600" />
                ) : (
                  <AlertCircle className="w-10 h-10 text-destructive" />
                )}
                <div>
                  <p className="font-medium text-lg">Import Complete</p>
                  <p className="text-muted-foreground">
                    {result.success.toLocaleString()} successful, {result.failed.toLocaleString()} failed
                  </p>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm space-y-1">
                  {result.errors.map((err, i) => (
                    <p key={i}>{err}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {step === 'upload' && (
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
          )}
          {step === 'duplicate_check' && (
            <>
              <Button variant="outline" onClick={() => { setStep('upload'); setFile(null); setParsedData([]); setDuplicateContacts([]); }}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button onClick={() => {
                // Resolutions are stored in duplicateResolutions state and applied during import
                setStep('mapping')
              }}>
                Next: Map Riders
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </>
          )}
          {step === 'mapping' && (
            <>
              <Button variant="outline" onClick={() => { 
                if (duplicateContacts.length > 0) {
                  setStep('duplicate_check')
                } else {
                  setStep('upload'); setFile(null); setParsedData([]); setRiderMappings([]); setStatusMappings([]);
                }
              }}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button onClick={() => setStep('status_mapping')}>
                Next: Map Statuses
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </>
          )}
          {step === 'status_mapping' && (
            <>
              <Button variant="outline" onClick={() => setStep('mapping')}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button onClick={() => setStep('sales_type_mapping')}>
                Next: Map Sales Types
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </>
          )}
          {step === 'sales_type_mapping' && (
            <>
              <Button variant="outline" onClick={() => setStep('status_mapping')}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button onClick={() => setStep('return_product_mapping')}>
                Next: Return Products
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </>
          )}
          {step === 'return_product_mapping' && (
            <>
              <Button variant="outline" onClick={() => setStep('sales_type_mapping')}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button onClick={() => setStep('product_mapping')}>
                Next: Map Products
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </>
          )}
          {step === 'product_mapping' && (
            <>
              <Button variant="outline" onClick={() => setStep('return_product_mapping')}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button onClick={() => setStep('contractors')}>
                Next: Assign Contractors
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </>
          )}
          {step === 'contractors' && (
            <>
              <Button variant="outline" onClick={() => setStep('product_mapping')}>
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <Button variant="outline" onClick={handleImport}>
                Skip & Import
              </Button>
              <Button onClick={handleImport}>
                Import {parsedData.length.toLocaleString()} Deliveries
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </>
          )}
          {step === 'result' && (
            <Button onClick={handleClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
