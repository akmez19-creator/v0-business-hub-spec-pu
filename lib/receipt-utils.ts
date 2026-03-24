'use server'

import { createAdminClient } from '@/lib/supabase/server'

// Generate next receipt number
export async function generateReceiptNumber(): Promise<string> {
  const adminDb = createAdminClient()
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  
  // Get count of receipts this month
  const monthStart = `${year}-${month}-01`
  const { count } = await adminDb
    .from('receipts')
    .select('*', { count: 'exact', head: true })
    .gte('issued_at', monthStart)
  
  const sequence = String((count || 0) + 1).padStart(4, '0')
  return `RCP-${year}-${month}-${sequence}`
}

// Create a receipt
export async function createReceipt({
  fromPartyType,
  fromPartyId,
  toPartyType,
  toPartyId,
  transactionType,
  referenceType,
  referenceId,
  amount,
  description
}: {
  fromPartyType: 'admin' | 'contractor' | 'rider' | 'system'
  fromPartyId: string
  toPartyType: 'admin' | 'contractor' | 'rider'
  toPartyId: string
  transactionType: 'payment' | 'deduction' | 'collection' | 'stock_return'
  referenceType?: string
  referenceId?: string
  amount: number
  description?: string
}) {
  const adminDb = createAdminClient()
  const receiptNumber = await generateReceiptNumber()
  
  const { data, error } = await adminDb
    .from('receipts')
    .insert({
      receipt_number: receiptNumber,
      from_party_type: fromPartyType,
      from_party_id: fromPartyId,
      to_party_type: toPartyType,
      to_party_id: toPartyId,
      transaction_type: transactionType,
      reference_type: referenceType,
      reference_id: referenceId,
      amount,
      description,
      issued_at: new Date().toISOString()
    })
    .select()
    .single()
  
  if (error) {
    console.error('Failed to create receipt:', error)
    return null
  }
  
  return data
}

// Get receipt details for PDF generation
export async function getReceiptDetails(receiptId: string) {
  const adminDb = createAdminClient()
  
  const { data: receipt, error } = await adminDb
    .from('receipts')
    .select('*')
    .eq('id', receiptId)
    .single()
  
  if (error || !receipt) return null
  
  // Get party names
  let fromPartyName = 'System'
  let toPartyName = 'Unknown'
  
  if (receipt.from_party_type === 'contractor') {
    const { data } = await adminDb.from('contractors').select('name').eq('id', receipt.from_party_id).single()
    fromPartyName = data?.name || 'Contractor'
  } else if (receipt.from_party_type === 'rider') {
    const { data } = await adminDb.from('riders').select('name').eq('id', receipt.from_party_id).single()
    fromPartyName = data?.name || 'Rider'
  } else if (receipt.from_party_type === 'admin') {
    fromPartyName = 'Company Admin'
  }
  
  if (receipt.to_party_type === 'contractor') {
    const { data } = await adminDb.from('contractors').select('name').eq('id', receipt.to_party_id).single()
    toPartyName = data?.name || 'Contractor'
  } else if (receipt.to_party_type === 'rider') {
    const { data } = await adminDb.from('riders').select('name').eq('id', receipt.to_party_id).single()
    toPartyName = data?.name || 'Rider'
  } else if (receipt.to_party_type === 'admin') {
    toPartyName = 'Company Admin'
  }
  
  // Get company settings
  const { data: company } = await adminDb.from('company_settings').select('*').limit(1).single()
  
  return {
    ...receipt,
    from_party_name: fromPartyName,
    to_party_name: toPartyName,
    company
  }
}
