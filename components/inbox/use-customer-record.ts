'use client'

/**
 * One SWR read of /api/clients/rating shared by the history card and the
 * Quick Order prefill, so both always describe the same customer record.
 */

import useSWR from 'swr'
import { rideableOrders } from '@/lib/inbox/ride-with'

export type OpenOrder = {
  id: string
  products: string | null
  qty: number | null
  amount: number
  deliveryDate: string | null
  createdAt: string
  status: string
  agent: string | null
  customerName: string | null
  contact2: string | null
  locality: string | null
  notes: string | null
  business: string | null
  /** Set when this row is itself an add-on riding with another open order. */
  parentDeliveryId: string | null
}

/**
 * The open order a new item should ride with: the earliest root order (not an
 * add-on itself) that is still ahead and in the same business, so every add-on
 * points at the same drop. Past-dated pending orders and the other business's
 * orders stay listed for duplicate checks but are never the target.
 */
export function primaryOpenOrder(open: OpenOrder[] | undefined, today: string, business?: string | null): OpenOrder | null {
  const candidates = rideableOrders(open, today, business)
  if (!candidates.length) return null
  const roots = candidates.filter(o => !o.parentDeliveryId)
  const pool = roots.length ? roots : candidates
  return [...pool].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0] ?? null
}

/** Fields an add-on inherits from the order it rides with; the agent may still edit them. */
export function prefillFromOpenOrder(order: OpenOrder, regions: readonly string[]) {
  const wanted = order.locality?.trim().toLowerCase()
  const region = wanted ? regions.find(r => r.trim().toLowerCase() === wanted) ?? '' : ''
  return {
    customerName: order.customerName?.trim() ?? '',
    contact2: localMobile(order.contact2) ?? '',
    region,
    notes: order.notes?.trim() ?? '',
    deliveryDate: order.deliveryDate ?? '',
  }
}

export type LastDelivery = {
  id: string
  customerName: string | null
  contact2: string | null
  locality: string | null
  notes: string | null
  products: string | null
  status: string
  createdAt: string
  pastOrders: number
}

export type CustomerRecord = {
  found: boolean
  rating?: string
  name?: string | null
  totalOrders?: number
  delivered?: number
  cms?: number
  lastOrderDate?: string | null
  openOrders?: OpenOrder[]
  lastDelivery?: LastDelivery | null
}

/** Local Mauritian mobile (8 digits from 5), from the order phone or the wa_id. */
export function localMobile(raw: string | null | undefined): string | null {
  if (!raw) return null
  let digits = raw.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('230')) digits = digits.slice(3)
  return /^5\d{7}$/.test(digits) ? digits : null
}

const fetcher = async (url: string): Promise<CustomerRecord> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error('lookup failed')
  return res.json()
}

export function useCustomerRecord(lookup: string | null) {
  return useSWR<CustomerRecord>(
    lookup ? `/api/clients/rating?phone=${encodeURIComponent(lookup)}` : null,
    fetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false },
  )
}

/** The order fields a past delivery can prefill; `region` only when it is in the active locality list. */
export function prefillFromLastDelivery(last: LastDelivery, regions: readonly string[]) {
  const wanted = last.locality?.trim().toLowerCase()
  const region = wanted ? regions.find(r => r.trim().toLowerCase() === wanted) ?? '' : ''
  return {
    fields: {
      customerName: last.customerName?.trim() ?? '',
      contact2: localMobile(last.contact2) ?? '',
      region,
      notes: last.notes?.trim() ?? '',
    },
    localityNotInList: Boolean(wanted) && !region,
  }
}
