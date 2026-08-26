'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { parseStatementCsv } from '@/lib/bank/parse-statement'
import {
  checkTransfers, type Transfer, type TransferCheck, type BankRow,
} from '@/lib/bank/confirm-transfers'

const PAGE = '/dashboard/admin/payment-confirmation'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { authorized: false as const, error: 'Not authenticated', userId: null }

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { authorized: false as const, error: 'Not authorized', userId: null }
  }
  return { authorized: true as const, error: null, userId: user.id }
}

export interface UploadSummary {
  parsed: number
  inserted: number
  alreadySeen: number
  duplicatesInFile: number
  errors: { line: number; reason: string; raw: string }[]
  dateFrom: string | null
  dateTo: string | null
}

/**
 * Ingests a statement. The statement is only EVIDENCE - it is never the thing
 * being listed. Re-uploading an overlapping period is the normal daily case,
 * so rows already seen are skipped, not treated as errors.
 */
export async function uploadStatement(csvText: string): Promise<
  { error: string } | { error: null; summary: UploadSummary }
> {
  const { authorized, error, userId } = await requireAdmin()
  if (!authorized) return { error: error! }

  const { rows, duplicatesInFile, errors } = parseStatementCsv(csvText)
  if (rows.length === 0) {
    return { error: errors[0]?.reason ?? 'No readable transactions found in this file.' }
  }

  const db = createAdminClient()

  const keys = rows.map(r => r.natural_key)
  const existing = new Set<string>()
  // Chunked so a two-month statement cannot blow the URL length limit.
  for (let i = 0; i < keys.length; i += 200) {
    const { data } = await db
      .from('bank_transactions')
      .select('natural_key')
      .in('natural_key', keys.slice(i, i + 200))
    for (const r of data ?? []) existing.add(r.natural_key)
  }

  const fresh = rows.filter(r => !existing.has(r.natural_key))

  for (let i = 0; i < fresh.length; i += 200) {
    const chunk = fresh.slice(i, i + 200).map(r => ({ ...r, uploaded_by: userId }))
    const { error: insErr } = await db
      .from('bank_transactions')
      .upsert(chunk, { onConflict: 'natural_key', ignoreDuplicates: true })
    if (insErr) return { error: `Could not save the statement: ${insErr.message}` }
  }

  const dates = rows.map(r => r.txn_date).sort()
  revalidatePath(PAGE)
  return {
    error: null,
    summary: {
      parsed: rows.length,
      inserted: fresh.length,
      alreadySeen: rows.length - fresh.length,
      duplicatesInFile,
      errors,
      dateFrom: dates[0] ?? null,
      dateTo: dates[dates.length - 1] ?? null,
    },
  }
}

export interface ConfirmationView {
  checks: (TransferCheck & { savedConfirmation: boolean })[]
  stats: Record<string, number>
  /** Days that have transfers but no uploaded statement yet. */
  daysAwaitingStatement: string[]
  statementRows: number
}

/**
 * The page is driven by OUR transfers, asking "did this money arrive?".
 * The old version asked the mirror-image question - "what order explains this
 * bank row?" - which produced 379 unanswerable rows out of 384.
 */
export async function getConfirmations(
  dateFrom: string,
  dateTo: string,
): Promise<{ error: string } | { error: null; view: ConfirmationView }> {
  const { authorized, error } = await requireAdmin()
  if (!authorized) return { error: error! }

  const db = createAdminClient()

  // Transfers in the window, assembled from the delivery rows that carry them.
  const { data: dels, error: delErr } = await db
    .from('deliveries')
    .select('id, delivery_date, amount, payment_method, contractor_id, contractors(name),' +
            ' juice_transferred_at, juice_transfer_reference, juice_transfer_amount,' +
            ' juice_transfer_screenshot')
    .not('juice_transferred_at', 'is', null)
    .gte('delivery_date', dateFrom)
    .lte('delivery_date', dateTo)
  if (delErr) return { error: delErr.message }

  // The embedded contractors(name) join defeats Supabase's row inference, so
  // the shape is declared here rather than fighting the generated types.
  type DelRow = {
    id: string
    delivery_date: string
    amount: number | null
    payment_method: string | null
    contractor_id: string | null
    contractors: { name: string | null } | { name: string | null }[] | null
    juice_transferred_at: string | null
    juice_transfer_reference: string | null
    juice_transfer_amount: number | null
    juice_transfer_screenshot: string | null
  }

  const groups = new Map<string, Transfer>()
  for (const d of (dels ?? []) as unknown as DelRow[]) {
    if (!d.juice_transferred_at) continue
    const key = `${d.contractor_id ?? 'none'}|${d.juice_transferred_at}`
    const amount = Number(d.amount ?? 0)
    const isJuice = (d.payment_method ?? '') === 'juice'

    let t = groups.get(key)
    if (!t) {
      t = {
        key,
        contractor_id: d.contractor_id ?? null,
        // A to-one embed comes back as an object, but the same query shape can
        // yield an array. Handle both so the name never silently reads Unknown.
        contractor_name:
          (Array.isArray(d.contractors) ? d.contractors[0]?.name : d.contractors?.name)
          ?? 'Unknown',
        transferred_at: d.juice_transferred_at,
        reference: null,
        declared_amount: 0,
        expected_amount: 0,
        delivery_ids: [],
        order_count: 0,
        screenshot_url: null,
        first_day: d.delivery_date,
        last_day: d.delivery_date,
      }
      groups.set(key, t)
    }
    // The reference and the screenshot are written to only ONE row of a batch,
    // so take whichever row carries them rather than assuming the first.
    if (d.juice_transfer_reference) t.reference = d.juice_transfer_reference
    if (d.juice_transfer_amount) t.declared_amount = Number(d.juice_transfer_amount)
    if (d.juice_transfer_screenshot) t.screenshot_url = d.juice_transfer_screenshot
    if (isJuice) {
      t.expected_amount = Number((t.expected_amount + amount).toFixed(2))
      t.order_count += 1
    }
    t.delivery_ids.push(d.id)
    if (d.delivery_date < t.first_day) t.first_day = d.delivery_date
    if (d.delivery_date > t.last_day) t.last_day = d.delivery_date
  }

  const transfers = [...groups.values()]
    .sort((a, b) => b.transferred_at.localeCompare(a.transferred_at))

  // Statement rows across a slightly wider window: a transfer sent late in the
  // evening can settle on the bank's next day.
  const wide = (d: string, days: number) =>
    new Date(Date.parse(`${d}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

  const { data: txnRows } = await db
    .from('bank_transactions')
    .select('id, txn_date, bank_ref, description, payer_name, credit, amount')
    .gte('txn_date', wide(dateFrom, -3))
    .lte('txn_date', wide(dateTo, 3))

  const bankRows: BankRow[] = (txnRows ?? []).map(r => ({
    id: r.id,
    txn_date: r.txn_date,
    bank_ref: r.bank_ref ?? '',
    description: r.description,
    payer_name: r.payer_name,
    credit: Number(r.credit ?? 0),
    amount: Number(r.amount ?? 0),
  }))

  // Which dates a statement actually covers. Without this the page would
  // report "not found" for money it has simply never looked at.
  const { data: coverRows } = await db
    .from('bank_transactions').select('txn_date')
  const coveredDates = new Set((coverRows ?? []).map(r => r.txn_date))

  const { checks, stats } = checkTransfers({ transfers, bankRows, coveredDates })

  const { data: saved } = await db
    .from('transfer_confirmations').select('transfer_key')
  const savedKeys = new Set((saved ?? []).map(s => s.transfer_key))

  const daysAwaitingStatement = [...new Set(
    checks.filter(c => c.status === 'no_statement')
      .map(c => c.transfer.transferred_at.slice(0, 10)),
  )].sort()

  return {
    error: null,
    view: {
      checks: checks.map(c => ({ ...c, savedConfirmation: savedKeys.has(c.transfer.key) })),
      stats,
      daysAwaitingStatement,
      statementRows: bankRows.length,
    },
  }
}

/**
 * Records a confirmation. Re-derived server-side rather than trusting the
 * client's view of the amounts, and the unique index on bank_transaction_id
 * stops the same credit being used twice even under a race.
 */
export async function confirmTransfer(input: {
  transferKey: string
  bankTransactionId: string
  contractorId: string | null
  transferredAt: string
  expectedAmount: number
  bankAmount: number
  matchType: 'exact' | 'suffix_stripped' | 'one_char_off' | 'amount_only' | 'manual'
  auto: boolean
  note?: string | null
}): Promise<{ error: string | null }> {
  const { authorized, error, userId } = await requireAdmin()
  if (!authorized) return { error: error! }

  const db = createAdminClient()

  const { data: clash } = await db
    .from('transfer_confirmations')
    .select('transfer_key')
    .eq('bank_transaction_id', input.bankTransactionId)
    .maybeSingle()

  if (clash && clash.transfer_key !== input.transferKey) {
    return { error: 'That bank credit is already confirming another transfer.' }
  }

  const { error: upErr } = await db
    .from('transfer_confirmations')
    .upsert({
      transfer_key: input.transferKey,
      contractor_id: input.contractorId,
      transferred_at: input.transferredAt,
      bank_transaction_id: input.bankTransactionId,
      expected_amount: input.expectedAmount,
      bank_amount: input.bankAmount,
      match_type: input.matchType,
      auto: input.auto,
      note: input.note ?? null,
      confirmed_by: userId,
    }, { onConflict: 'transfer_key' })

  if (upErr) {
    return upErr.message.includes('bank_transaction_id')
      ? { error: 'That bank credit is already confirming another transfer.' }
      : { error: upErr.message }
  }

  revalidatePath(PAGE)
  return { error: null }
}

export async function unconfirmTransfer(transferKey: string): Promise<{ error: string | null }> {
  const { authorized, error } = await requireAdmin()
  if (!authorized) return { error: error! }

  const db = createAdminClient()
  const { error: delErr } = await db
    .from('transfer_confirmations').delete().eq('transfer_key', transferKey)
  if (delErr) return { error: delErr.message }

  revalidatePath(PAGE)
  return { error: null }
}
