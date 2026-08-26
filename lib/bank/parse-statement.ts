/**
 * MCB CSV statement parser.
 *
 * Everything here was written against the real 385-line export rather than a
 * guessed format. The shapes it has to survive:
 *
 *   1 segment  Business Banking Subs Fee                        (no payer)
 *   2 segments JUICE Account Transfer|MR DANANDJAY MUNSAH
 *   3 segments JUICE Account Transfer|del 19 aug|ALI I H M ...   (middle = note)
 *   4 segments Instant Payment|toilet accs|URVESH GOPAUL|STCB260818004205
 *
 * The 4-segment case is why "payer = last segment" is wrong: the tail there is
 * the sending bank's own reference, not a person.
 */

/**
 * 'sales' is the only category that can ever match an order. The rest are real
 * bank activity that must stay recorded and visible, just out of the review
 * queue.
 */
export type TxnCategory = 'sales' | 'tax' | 'fee' | 'internal_transfer' | 'payout'

export interface ParsedTxn {
  txn_date: string          // ISO yyyy-mm-dd
  value_date: string | null
  bank_ref: string
  description: string
  payer_name: string | null
  note: string | null
  debit: number
  credit: number
  amount: number            // signed: credit positive, debit negative
  balance: number | null
  raw_line: string
  natural_key: string
  direction: 'in' | 'out'
  category: TxnCategory
}

/** Your own accounts. A transfer to/from these is treasury, not a sale. */
export const OWN_ACCOUNT_NAMES = ['A AKMEZ GROUP LTD']

const normaliseName = (s: string) =>
  s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()

/**
 * Categorisation is driven by DIRECTION FIRST, because the transaction type is
 * ambiguous in this statement: "IB Account Transfer" is both the outgoing
 * treasury sweep to A AKMEZ GROUP LTD *and* genuine incoming customer money
 * (SATYANAAM CONSTRUCT LTD Rs 1,474 for a ruler, APZIE LTD Rs 475 for an air
 * fryer). Tagging on the type alone would have hidden those four real sales.
 *
 * Payer tests are whole-string, never substring: searching for "MRA" inside the
 * description matches the customer NAMRATA, and "REFUND" matched nothing at
 * all. A mis-tagged customer is money that silently leaves the review queue.
 */
export function categoriseTxn(input: {
  direction: 'in' | 'out'
  payer_name: string | null
  description: string
  ownAccounts?: string[]
}): TxnCategory {
  const own = (input.ownAccounts ?? OWN_ACCOUNT_NAMES).map(normaliseName)
  const payer = input.payer_name ? normaliseName(input.payer_name) : ''
  const type = normaliseName(input.description.split('|')[0] ?? '')

  if (payer && own.includes(payer)) return 'internal_transfer'

  // Incoming money is treated as a sale unless it is provably our own. Being
  // wrong in this direction only adds a row to review; being wrong the other
  // way loses a customer payment.
  if (input.direction === 'in') return 'sales'

  if (payer === 'MAURITIUS REVENUE AUTHORITY' || type === 'DIRECT DEBIT SCHEME') return 'tax'

  // Bank's own charges: these arrive with no payer segment or a bare account
  // code, never a person.
  if (/SUBS FEE|VAT ON REFILL|REFILL AMOUNT|CHARGE|COMMISSION/.test(type)) return 'fee'

  return 'payout'
}

export interface ParseResult {
  rows: ParsedTxn[]
  /** Rows the bank sent twice inside one file (same natural key). */
  duplicatesInFile: number
  /** Lines that could not be read, with the reason. Never silently dropped. */
  errors: { line: number; reason: string; raw: string }[]
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

/** `25-Aug-26` -> `2026-08-25`. Returns null rather than an Invalid Date. */
export function parseBankDate(input: string): string | null {
  const m = input?.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/)
  if (!m) return null
  const month = MONTHS[m[2].toLowerCase()]
  if (!month) return null
  const year = m[3].length === 2 ? `20${m[3]}` : m[3]
  return `${year}-${month}-${m[1].padStart(2, '0')}`
}

/**
 * A trailing inter-bank reference such as STCB260818004205 / BARC181106750100.
 * Letters then a long digit run, and crucially no spaces - real payer names in
 * this file always contain a space or are pure letters.
 */
function isBankCode(segment: string): boolean {
  return /^[A-Z]{2,5}\d{8,}$/i.test(segment.replace(/\s+/g, ''))
    && !/\s/.test(segment.trim())
}

export function parseDescription(description: string): {
  payer_name: string | null
  note: string | null
} {
  const segments = description.split('|').map(s => s.trim()).filter(Boolean)
  if (segments.length <= 1) return { payer_name: null, note: null }

  const rest = segments.slice(1)          // drop the transaction type
  if (rest.length > 1 && isBankCode(rest[rest.length - 1])) rest.pop()

  const payer_name = rest.length ? rest[rest.length - 1] : null
  const noteParts = rest.slice(0, -1)
  return {
    payer_name,
    note: noteParts.length ? noteParts.join(' | ') : null,
  }
}

/** Minimal RFC-4180 splitter - handles quoted fields containing commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      out.push(cur); cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map(s => s.trim())
}

function toNumber(raw: string | undefined): number {
  if (!raw) return 0
  const n = Number(raw.replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}

export function parseStatementCsv(text: string): ParseResult {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/)
  const errors: ParseResult['errors'] = []
  const rows: ParsedTxn[] = []
  const seen = new Set<string>()
  let duplicatesInFile = 0

  if (lines.length === 0) return { rows, duplicatesInFile, errors }

  // Locate columns by header name so a re-ordered export does not silently
  // load amounts into the wrong field.
  const header = splitCsvLine(lines[0]).map(h => h.toLowerCase())
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = header.findIndex(h => h.includes(n))
      if (i !== -1) return i
    }
    return -1
  }
  const iDate = col('transaction date')
  const iValue = col('value date')
  const iRef = col('transaction reference', 'reference')
  const iDesc = col('description', 'transaction details')
  const iDebit = col('debit')
  const iCredit = col('credit')
  const iBal = col('balance')

  if (iDate === -1 || iRef === -1 || (iDebit === -1 && iCredit === -1)) {
    errors.push({
      line: 1,
      reason: 'Unrecognised header - expected Transaction date, Transaction reference and Debit/Credit columns.',
      raw: lines[0],
    })
    return { rows, duplicatesInFile, errors }
  }

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw.trim()) continue
    const cells = splitCsvLine(raw)

    const txn_date = parseBankDate(cells[iDate] ?? '')
    if (!txn_date) {
      errors.push({ line: i + 1, reason: `Unreadable date "${cells[iDate] ?? ''}"`, raw })
      continue
    }

    const bank_ref = (cells[iRef] ?? '').trim()
    if (!bank_ref) {
      errors.push({ line: i + 1, reason: 'Missing transaction reference', raw })
      continue
    }

    const debit = toNumber(cells[iDebit])
    const credit = toNumber(cells[iCredit])
    if (debit === 0 && credit === 0) {
      errors.push({ line: i + 1, reason: 'Row has neither a debit nor a credit', raw })
      continue
    }

    const description = cells[iDesc] ?? ''
    const { payer_name, note } = parseDescription(description)
    const amount = Number((credit - debit).toFixed(2))

    // bank_ref alone is NOT unique - a transfer's two legs share it. ref+date
    // +amount had zero collisions across the whole sample.
    const natural_key = `${bank_ref}|${txn_date}|${amount.toFixed(2)}`
    if (seen.has(natural_key)) { duplicatesInFile++; continue }
    seen.add(natural_key)

    const direction: 'in' | 'out' = amount >= 0 ? 'in' : 'out'

    rows.push({
      txn_date,
      value_date: parseBankDate(cells[iValue] ?? '') ?? null,
      bank_ref,
      description,
      payer_name,
      note,
      debit,
      credit,
      amount,
      balance: cells[iBal] ? toNumber(cells[iBal]) : null,
      raw_line: raw,
      natural_key,
      direction,
      category: categoriseTxn({ direction, payer_name, description }),
    })
  }

  return { rows, duplicatesInFile, errors }
}
