'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { syncContractorStock, getContractorIdFromPartnerDelivery } from '@/lib/stock-actions'

const REVALIDATE_PATH = '/dashboard/contractors/partner-deliveries'

// ── Column mapping for Jassam sheet ──
const JASSAM_COLUMNS = {
  'S/N': 'sheet_row_number',
  'Order Date': 'order_date',
  'Supplier': 'supplier',
  'Product': 'product',
  'Address': 'address',
  'Phone': 'phone',
  'Amount': 'amount',
  'Qty': 'qty',
  'Driver': 'driver',
  'Status': 'status',
} as const

// ── Upload Excel data ──
export async function uploadPartnerDeliveries(
  contractorId: string,
  sheetId: string,
  rows: Record<string, string>[],
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  if (!rows.length) return { error: 'No data rows found in file.' }

  // Load address -> locality mappings for this contractor
  const { data: mappingRows } = await supabase
    .from('address_region_mappings')
    .select('address_pattern, locality')
    .eq('contractor_id', contractorId)

  const addressToLocality = new Map<string, string>()
  for (const m of mappingRows || []) {
    addressToLocality.set(m.address_pattern.toLowerCase().trim(), m.locality)
  }

  // Load localities from the master table (source of truth)
  const { data: localityRows } = await supabase
    .from('localities')
    .select('name, region')
    .eq('is_active', true)

  const localityLookup = new Map<string, string>() // name -> name (canonical casing)
  for (const l of localityRows || []) {
    localityLookup.set(l.name.toLowerCase().trim(), l.name)
  }

  // Get existing deliveries for this sheet to detect updates vs inserts
  const { data: existing } = await supabase
    .from('partner_deliveries')
    .select('id, sheet_row_number, order_date')
    .eq('sheet_id', sheetId)

  const existingByKey = new Map<string, string>()
  for (const e of existing || []) {
    // Key = row_number + order_date for uniqueness
    const key = `${e.sheet_row_number || ''}_${e.order_date || ''}`
    existingByKey.set(key, e.id)
  }

  let rowsAdded = 0
  let rowsUpdated = 0
  let rowsSkipped = 0
  const now = new Date().toISOString()

  // Process in batches
  const batchSize = 50
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const toInsert: Record<string, unknown>[] = []
    const toUpdate: { id: string; data: Record<string, unknown> }[] = []

    for (const row of batch) {
      const sn = row['S/N']?.toString().trim()
      const orderDate = parseDate(row['Order Date'])
      const product = (row['Product'] || '').trim()
      const address = (row['Address'] || '').trim()

      // Skip empty rows
      if (!product && !address) {
        rowsSkipped++
        continue
      }

      // Resolve address to locality
      const resolvedLocality = resolveLocality(address, addressToLocality, localityLookup)

      const mapped: Record<string, unknown> = {
        sheet_id: sheetId,
        contractor_id: contractorId,
        sheet_row_number: sn ? parseInt(sn, 10) || null : null,
        order_date: orderDate,
        supplier: (row['Supplier'] || '').trim() || null,
        product: product || null,
        address: address || null,
        locality: resolvedLocality,
        phone: (row['Phone'] || '').toString().trim() || null,
        amount: parseAmount(row['Amount']),
        qty: parseQty(row['Qty']),
        driver: (row['Driver'] || '').trim() || null,
        status: (row['Status'] || 'pending').toString().toLowerCase().trim(),
        updated_at: now,
        synced_at: now,
      }

      // Check for existing row by S/N + order_date
      const key = `${mapped.sheet_row_number || ''}_${mapped.order_date || ''}`
      const existingId = existingByKey.get(key)

      if (existingId) {
        toUpdate.push({ id: existingId, data: mapped })
      } else {
        mapped.created_at = now
        toInsert.push(mapped)
      }
    }

    // Bulk insert
    if (toInsert.length > 0) {
      const { error } = await supabase.from('partner_deliveries').insert(toInsert)
      if (!error) rowsAdded += toInsert.length
    }

    // Update existing
    for (const { id, data } of toUpdate) {
      await supabase.from('partner_deliveries').update(data).eq('id', id)
      rowsUpdated++
    }
  }

  // Update sheet last_synced_at
  await supabase
    .from('partner_sheets')
    .update({ last_synced_at: now, updated_at: now })
    .eq('id', sheetId)

  revalidatePath(REVALIDATE_PATH)
  return { success: true, rowsAdded, rowsUpdated, rowsSkipped, total: rows.length }
}

// ── Partner Sheet CRUD ──

export async function addPartnerSheet(
  contractorId: string,
  name: string,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data, error } = await supabase
    .from('partner_sheets')
    .insert({
      contractor_id: contractorId,
      name,
      spreadsheet_id: 'excel-upload',
      gid: '0',
      column_mapping: JASSAM_COLUMNS,
    })
    .select()
    .single()

  if (error) return { error: error.message }

  revalidatePath(REVALIDATE_PATH)
  return { success: true, data }
}

export async function removePartnerSheet(sheetId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Delete partner deliveries first
  await supabase
    .from('partner_deliveries')
    .delete()
    .eq('sheet_id', sheetId)

  const { error } = await supabase
    .from('partner_sheets')
    .delete()
    .eq('id', sheetId)

  if (error) return { error: error.message }

  revalidatePath(REVALIDATE_PATH)
  return { success: true }
}

// ── Partner Deliveries Queries ──

export async function getPartnerDeliveries(contractorId: string, date?: string) {
  const supabase = await createClient()
  let query = supabase
    .from('partner_deliveries')
    .select('*, riders(name)')
    .eq('contractor_id', contractorId)
    .order('sheet_row_number', { ascending: true })

  if (date) {
    query = query.eq('order_date', date)
  }

  const { data, error } = await query
  if (error) return { error: error.message, data: [] }
  return { data: data || [] }
}

export async function getPartnerDeliveryDates(contractorId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('partner_deliveries')
    .select('order_date')
    .eq('contractor_id', contractorId)
    .not('order_date', 'is', null)
    .order('order_date', { ascending: false })

  if (error) return { data: [] }
  const dates = [...new Set((data || []).map(r => r.order_date).filter(Boolean))]
  return { data: dates as string[] }
}

export async function assignPartnerDelivery(deliveryId: string, riderId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('partner_deliveries')
    .update({
      rider_id: riderId,
      status: 'assigned',
      updated_at: new Date().toISOString(),
    })
    .eq('id', deliveryId)

  if (error) return { error: error.message }

  revalidatePath(REVALIDATE_PATH)
  return { success: true }
}

export async function updatePartnerDeliveryStatus(deliveryId: string, status: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('partner_deliveries')
    .update({
      status: status.toLowerCase().trim(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', deliveryId)

  if (error) return { error: error.message }

  revalidatePath(REVALIDATE_PATH)
  revalidatePath('/dashboard/contractors/stock')

  // Sync contractor stock on any partner delivery status change
  try {
    const contractorId = await getContractorIdFromPartnerDelivery(deliveryId)
    if (contractorId) {
      await syncContractorStock(contractorId)
    }
  } catch {
    // Don't block status update if stock sync fails
  }

  return { success: true }
}

// ── Partner Rider-Region Defaults ──

export async function savePartnerRiderDefaults(
  contractorId: string,
  riderId: string,
  regions: string[],
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Delete existing defaults for this rider
  await supabase
    .from('partner_rider_region_defaults')
    .delete()
    .eq('contractor_id', contractorId)
    .eq('rider_id', riderId)

  // Insert new defaults with sort_order preserved from array index
  if (regions.length > 0) {
    const rows = regions.map((region, idx) => ({
      contractor_id: contractorId,
      rider_id: riderId,
      region,
      sort_order: idx + 1,
    }))
    const { error } = await supabase
      .from('partner_rider_region_defaults')
      .insert(rows)
    if (error) return { error: error.message }
  }

  revalidatePath(REVALIDATE_PATH)
  revalidatePath('/dashboard/contractors/my-deliveries')
  return { success: true }
}

export async function clearAllPartnerDefaults(contractorId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('partner_rider_region_defaults')
    .delete()
    .eq('contractor_id', contractorId)

  if (error) return { error: error.message }

  revalidatePath(REVALIDATE_PATH)
  revalidatePath('/dashboard/contractors/my-deliveries')
  return { success: true }
}

// ── Auto-Assign Partner Deliveries by Defaults ──

export async function autoAssignPartnerByDefaults(contractorId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Get unassigned partner deliveries
  const { data: unassigned } = await supabase
    .from('partner_deliveries')
    .select('id, locality')
    .eq('contractor_id', contractorId)
    .is('rider_id', null)

  if (!unassigned || unassigned.length === 0) {
    return { error: 'No unassigned partner deliveries.' }
  }

  return applyPartnerRegionDefaults(supabase, user.id, contractorId, unassigned)
}

export async function syncPartnerDefaults(contractorId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // Get ALL partner deliveries for this contractor
  const { data: allDeliveries } = await supabase
    .from('partner_deliveries')
    .select('id, locality')
    .eq('contractor_id', contractorId)

  if (!allDeliveries || allDeliveries.length === 0) {
    return { error: 'No partner deliveries found.' }
  }

  return applyPartnerRegionDefaults(supabase, user.id, contractorId, allDeliveries)
}

async function applyPartnerRegionDefaults(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  contractorId: string,
  deliveries: { id: string; locality: string | null }[]
) {
  // Get PARTNER rider locality defaults (separate from main)
  const { data: defaults } = await supabase
    .from('partner_rider_region_defaults')
    .select('rider_id, locality')
    .eq('contractor_id', contractorId)

  if (!defaults || defaults.length === 0) {
    return { error: 'No rider-region defaults set.' }
  }

  // Build locality -> rider map (case-insensitive)
  const localityToRider = new Map<string, string>()
  for (const d of defaults) {
    localityToRider.set(d.locality.toLowerCase().trim(), d.rider_id)
  }

  // Match deliveries to riders
  const riderBatch = new Map<string, string[]>()
  let matched = 0
  const unmatchedLocalities = new Set<string>()

  for (const del of deliveries) {
    const rawLocality = (del.locality || '').trim()
    const locality = rawLocality.toLowerCase()
    const riderId = localityToRider.get(locality)
    if (riderId) {
      if (!riderBatch.has(riderId)) riderBatch.set(riderId, [])
      riderBatch.get(riderId)!.push(del.id)
      matched++
    } else if (rawLocality) {
      unmatchedLocalities.add(rawLocality)
    }
  }

  // Bulk update partner_deliveries
  const now = new Date().toISOString()
  for (const [riderId, ids] of riderBatch) {
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200)
      await supabase
        .from('partner_deliveries')
        .update({
          rider_id: riderId,
          status: 'assigned',
          updated_at: now,
        })
        .in('id', batch)
    }
  }

  revalidatePath(REVALIDATE_PATH)
  revalidatePath('/dashboard/contractors/my-deliveries')
  return {
    success: true,
    matched,
    unmatched: unmatchedLocalities.size,
    unmatchedLocalities: [...unmatchedLocalities].slice(0, 10),
  }
}

// ── Address Region Mapping ──

export async function getAddressRegionMappings(contractorId: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('address_region_mappings')
    .select('*')
    .eq('contractor_id', contractorId)
    .order('address_pattern')
  return data || []
}

export async function saveAddressRegionMapping(
  contractorId: string,
  addressPattern: string,
  locality: string,
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { error } = await supabase
    .from('address_region_mappings')
    .upsert({
      contractor_id: contractorId,
      address_pattern: addressPattern.toLowerCase().trim(),
      locality: locality.trim(),
    }, { onConflict: 'address_pattern,contractor_id' })

  if (error) return { error: error.message }

  // Re-map all partner deliveries with this address
  await supabase
    .from('partner_deliveries')
    .update({ locality: locality.trim(), updated_at: new Date().toISOString() })
    .eq('contractor_id', contractorId)
    .ilike('address', addressPattern.trim())

  revalidatePath(REVALIDATE_PATH)
  return { success: true }
}

export async function getLocalities() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('localities')
    .select('name, region')
    .eq('is_active', true)
    .order('name')
  return data || []
}

// ── Helpers ──

function resolveLocality(
  address: string,
  addressToLocality: Map<string, string>,
  localityLookup: Map<string, string>,
): string | null {
  if (!address) return null
  const lower = address.toLowerCase().trim()

  // 1. Exact match in address_region_mappings
  const mapped = addressToLocality.get(lower)
  if (mapped) return mapped

  // 2. Check if address itself matches a locality (case-insensitive)
  const locality = localityLookup.get(lower)
  if (locality) return locality

  // 3. Fuzzy: strip extra details (after comma, slash, parens) and re-check
  const stripped = lower.replace(/[,\/\(].*/g, '').trim()
  if (stripped !== lower) {
    const mappedStripped = addressToLocality.get(stripped)
    if (mappedStripped) return mappedStripped
    const localityStripped = localityLookup.get(stripped)
    if (localityStripped) return localityStripped
  }

  // 4. Check if any locality is a substring of the address
  for (const [key, loc] of localityLookup) {
    if (lower.includes(key) && key.length >= 4) return loc
  }

  // 5. Check if address is a substring of any locality
  for (const [key, loc] of localityLookup) {
    if (key.includes(lower) && lower.length >= 4) return loc
  }

  return null
}

function parseDate(val: string | undefined | null): string | null {
  if (!val) return null
  const s = val.toString().trim()

  // Try DD/MM/YYYY or DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (dmy) {
    const [, d, m, y] = dmy
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  // Try YYYY-MM-DD
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`

  // Try Excel serial date number
  const num = Number(s)
  if (!isNaN(num) && num > 40000 && num < 60000) {
    const date = new Date((num - 25569) * 86400 * 1000)
    return date.toISOString().split('T')[0]
  }

  // Try Date.parse as last resort
  const parsed = new Date(s)
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0]
  }

  return null
}

function parseAmount(val: string | undefined | null): number | null {
  if (!val) return null
  const cleaned = val.toString().replace(/[^0-9.\-]/g, '')
  const num = parseFloat(cleaned)
  return isNaN(num) ? null : num
}

function parseQty(val: string | undefined | null): number {
  if (!val) return 1
  const num = parseInt(val.toString(), 10)
  return isNaN(num) ? 1 : num
}
