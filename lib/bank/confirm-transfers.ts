/**
 * Payment confirmation: did the money we recorded actually reach the bank?
 *
 * THE UNIT IS THE TRANSFER, NOT THE ORDER. This is the correction that reshaped
 * the whole feature. Measured against orders, references looked useless: 3
 * references against 384 bank rows, so I concluded reference matching could not
 * work. That was the wrong denominator. A contractor collects juice from many
 * clients and sends ONE lump transfer, so references were never meant to exist
 * per order - there is one per transfer. Measured correctly there are 3
 * transfers and all 3 carry a reference the bank also shows: 100% coverage.
 *
 * So the question is "did this transfer arrive?", asked once per transfer -
 * never "which order explains this bank row?".
 */

/** One lump transfer a contractor sent to the bank. */
export interface Transfer {
  key: string
  contractor_id: string | null
  contractor_name: string
  transferred_at: string
  /** Reference read off the transfer screenshot. May be imperfect. */
  reference: string | null
  /** Amount the screenshot claimed. */
  declared_amount: number
  /** Sum of the juice orders in this batch - what we expected to receive. */
  expected_amount: number
  delivery_ids: string[]
  order_count: number
  screenshot_url: string | null
  first_day: string
  last_day: string
}

export interface BankRow {
  id: string
  txn_date: string
  bank_ref: string
  description: string | null
  payer_name: string | null
  credit: number
  amount: number
}

export type ConfirmStatus =
  | 'confirmed'        // found in the statement and the amount agrees
  | 'amount_differs'   // reference found, but the bank credited something else
  | 'not_found'        // the statement covers this date and has no such credit
  | 'no_statement'     // we simply have not uploaded a statement for that date
  | 'no_reference'     // the transfer was recorded without a reference at all

export interface TransferCheck {
  transfer: Transfer
  status: ConfirmStatus
  bank: BankRow | null
  /** How the reference lined up, for display. */
  refMatch: 'exact' | 'suffix_stripped' | 'one_char_off' | 'amount_only' | null
  bankAmount: number | null
  /** bankAmount - expected_amount. Non-zero is money to explain. */
  difference: number
  /** Set when the amount is right but the stored reference is not verbatim. */
  note: string | null
  /** True only for a machine-certain result; everything else wants a human. */
  auto: boolean
}

/**
 * References come off a payment screenshot, so they arrive slightly dirty.
 * Both real deviations in the live data are handled here:
 *   FT26237LC1Z6\BNK  -> bank shows FT26237LC1Z6  (trailing \BNK channel tag)
 *   FT2637Y36P2       -> bank shows FT26237Y36P2  (a dropped character)
 */
export function normaliseRef(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\\.*$/, '')        // drop the \BNK style channel suffix
    .replace(/[^A-Z0-9]/g, '')   // spaces, dashes, stray punctuation
    .trim()
}

/** True when a and b differ by exactly one inserted/deleted character. */
export function oneCharApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) !== 1) return false
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  for (let i = 0; i < long.length; i++) {
    if (long.slice(0, i) + long.slice(i + 1) === short) return true
  }
  return false
}

/** Money compared in cents so 0.1 + 0.2 can never invent a discrepancy. */
const cents = (n: number) => Math.round(n * 100)

export function checkTransfers(input: {
  transfers: Transfer[]
  bankRows: BankRow[]
  /** Dates the uploaded statements actually cover. */
  coveredDates: Set<string>
}): { checks: TransferCheck[]; stats: Record<string, number> } {
  const { transfers, bankRows, coveredDates } = input

  // Credits only. A transfer is money arriving; a debit can never be one.
  const credits = bankRows.filter(r => r.amount > 0)
  const byRef = new Map<string, BankRow>()
  for (const r of credits) {
    const n = normaliseRef(r.bank_ref ?? '')
    if (n && !byRef.has(n)) byRef.set(n, r)
  }

  // A bank row may only ever confirm ONE transfer. Contention like this is
  // invisible when you look at a single row, and it is exactly how the earlier
  // version let two credits both claim the same day.
  const claimed = new Set<string>()

  const checks: TransferCheck[] = []

  for (const t of transfers) {
    const day = t.transferred_at.slice(0, 10)
    const expected = cents(t.expected_amount)

    const base = {
      transfer: t, bank: null, refMatch: null, bankAmount: null,
      difference: 0, note: null, auto: false,
    } as const

    if (!t.reference) {
      // No reference recorded. Fall back to amount on the day, but this can
      // never auto-confirm - an amount alone is not evidence.
      const cand = credits.find(r =>
        !claimed.has(r.id) && r.txn_date === day && cents(r.credit) === expected)
      if (cand) {
        claimed.add(cand.id)
        checks.push({
          ...base, status: 'no_reference', bank: cand, refMatch: 'amount_only',
          bankAmount: cand.credit,
          note: 'No reference was saved for this transfer. A credit of the right amount landed the same day, but confirm it yourself.',
        })
      } else {
        checks.push({
          ...base,
          status: coveredDates.has(day) ? 'no_reference' : 'no_statement',
          note: 'No reference was saved for this transfer, so it cannot be looked up automatically.',
        })
      }
      continue
    }

    const want = normaliseRef(t.reference)
    let hit = byRef.get(want) ?? null
    let refMatch: TransferCheck['refMatch'] = hit ? null : null
    let note: string | null = null

    if (hit) {
      refMatch = normaliseRef(t.reference) === (t.reference ?? '').toUpperCase()
        ? 'exact' : 'suffix_stripped'
      if (refMatch === 'suffix_stripped') {
        note = `Saved as "${t.reference}"; the bank shows "${hit.bank_ref}". Same transfer.`
      }
    } else {
      // Single dropped/added character - a screenshot read that slipped.
      for (const [n, row] of byRef) {
        if (!claimed.has(row.id) && oneCharApart(n, want)) { hit = row; refMatch = 'one_char_off'; break }
      }
      if (hit) {
        note = `Saved as "${t.reference}"; the bank shows "${hit.bank_ref}" - one character different, and the amount agrees.`
      }
    }

    if (!hit) {
      // Never say "not found" for a day we never loaded. That would read as
      // missing money when it is really a missing statement.
      checks.push({
        ...base,
        status: coveredDates.has(day) ? 'not_found' : 'no_statement',
        note: coveredDates.has(day)
          ? 'No credit with this reference in the uploaded statement.'
          : `No statement uploaded covering ${day}, so this has not been checked yet.`,
      })
      continue
    }

    if (claimed.has(hit.id)) {
      checks.push({
        ...base, status: 'not_found',
        note: 'The matching bank credit is already assigned to another transfer. Check both.',
      })
      continue
    }

    const got = cents(hit.credit)
    const diff = (got - expected) / 100

    if (got === expected) {
      claimed.add(hit.id)
      checks.push({
        transfer: t, status: 'confirmed', bank: hit, refMatch,
        bankAmount: hit.credit, difference: 0, note,
        // Auto-confirm needs BOTH the reference and the amount. A reference
        // alone would silently bless a short transfer as fully received.
        auto: true,
      })
    } else {
      claimed.add(hit.id)
      checks.push({
        transfer: t, status: 'amount_differs', bank: hit, refMatch,
        bankAmount: hit.credit, difference: diff,
        note: `Reference matches, but the bank credited Rs ${hit.credit.toLocaleString()} against Rs ${t.expected_amount.toLocaleString()} expected.`,
        auto: false,
      })
    }
  }

  const stats: Record<string, number> = {
    transfers: checks.length,
    confirmed: checks.filter(c => c.status === 'confirmed').length,
    amount_differs: checks.filter(c => c.status === 'amount_differs').length,
    not_found: checks.filter(c => c.status === 'not_found').length,
    no_statement: checks.filter(c => c.status === 'no_statement').length,
    no_reference: checks.filter(c => c.status === 'no_reference').length,
    confirmed_value: checks
      .filter(c => c.status === 'confirmed')
      .reduce((s, c) => s + c.transfer.expected_amount, 0),
    unconfirmed_value: checks
      .filter(c => c.status !== 'confirmed')
      .reduce((s, c) => s + c.transfer.expected_amount, 0),
  }

  return { checks, stats }
}
