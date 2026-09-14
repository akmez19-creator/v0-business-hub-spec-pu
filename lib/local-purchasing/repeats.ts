/**
 * Repeated descriptions inside ONE imported document.
 *
 * PURE - no server imports. The client component uses it on every keystroke and
 * `lib/shop/catalog.ts` taught me that a `next/headers` import two hops away
 * crashes at runtime while `tsc` stays clean.
 *
 * WHY THIS EXISTS - measured against the PO imports the owner called "okay":
 *   po_1787167921665  179 rows -> 173 decisions  (6 names repeat, 12 rows)
 *   po_1786975311459  152 rows -> 138 decisions  (14 names repeat, 28 rows)
 * Every row was KEPT. What made 179 rows tolerable was that the PO import asks
 * ONE question per distinct product name and applies the answer to every row
 * carrying it. Local purchasing asked per ROW, so on a 470-line sheet the buyer
 * would answer the same question for every repeat of a description.
 *
 * Two different things are measured here and must not be confused:
 *   - a REPEATED DESCRIPTION (same wording, any qty/price) is normal - a supplier
 *     lists the same item in two sections, or at two prices. One decision covers
 *     the group; the rows stay separate because the document's printed total
 *     includes all of them, and `detectVatBasis` reconciles against that total.
 *   - an IDENTICAL ROW (same wording AND qty AND price, more than once) is the
 *     copy-paste smell. Also kept - the PO data has a genuine 4-row case and
 *     dropping it would break the total reconciliation - but flagged so the
 *     buyer checks the paper.
 */
import { normalizeName } from '@/lib/products/match'
import { supplierIdentityKey } from './supplier-identity'

export interface RepeatableLine {
  key: string
  supplierLabel: string
  supplierCode?: string | null
  unit?: string | null
  qty: string | number
  unitPriceGross: string | number
}

export interface RepeatGroup {
  /** Normalised description - the identity every row in the group shares. */
  groupKey: string
  /** The wording as it first appeared, for display. */
  label: string
  /** Line keys, in document order. */
  keys: string[]
  /** How many rows are byte-for-byte identical (same qty AND price) to another. */
  identicalRows: number
}

export interface RepeatSummary {
  /** Distinct descriptions that appear on more than one row. */
  repeatedDescriptions: number
  /** Rows covered by those repeated descriptions. */
  rowsInRepeats: number
  /** Rows that duplicate another row exactly (qty + price too). */
  identicalRows: number
  /** Number of distinct descriptions = number of decisions the buyer can face. */
  decisions: number
  groups: RepeatGroup[]
}

/** The identity two rows must share to be "the same description". */
export function repeatKey(label: string): string {
  return normalizeName(label ?? '')
}

function moneyKey(line: RepeatableLine): string {
  // Compared as numbers so "210", "210.0" and 210 are one price.
  const q = Number(line.qty) || 0
  const p = Number(line.unitPriceGross) || 0
  return `${q}|${p}`
}

type WorkingGroup = RepeatGroup & { money: Map<string, number> }

export function summariseRepeats(lines: RepeatableLine[]): RepeatSummary {
  const groups = new Map<string, WorkingGroup>()

  for (const line of lines) {
    const label = (line.supplierLabel ?? '').trim()
    if (!label) continue
    const gk = supplierIdentityKey(line)
    const g: WorkingGroup =
      groups.get(gk) ?? { groupKey: gk, label, keys: [], identicalRows: 0, money: new Map<string, number>() }
    g.keys.push(line.key)
    const mk = moneyKey(line)
    g.money.set(mk, (g.money.get(mk) ?? 0) + 1)
    groups.set(gk, g)
  }

  let repeatedDescriptions = 0
  let rowsInRepeats = 0
  let identicalRows = 0
  const out: RepeatGroup[] = []

  for (const g of groups.values()) {
    // Rows beyond the first of each identical (qty, price) pair.
    let identical = 0
    for (const n of g.money.values()) if (n > 1) identical += n - 1
    g.identicalRows = identical
    identicalRows += identical

    if (g.keys.length > 1) {
      repeatedDescriptions += 1
      rowsInRepeats += g.keys.length
    }
    const { money: _money, ...pub } = g
    out.push(pub)
  }

  return {
    repeatedDescriptions,
    rowsInRepeats,
    identicalRows,
    decisions: groups.size,
    groups: out,
  }
}

/**
 * Every line key that carries the same description as `key` - INCLUDING `key`.
 * This is what turns a per-row confirmation into a per-description one.
 */
export function sameDescriptionKeys(lines: RepeatableLine[], key: string): string[] {
  const me = lines.find((l) => l.key === key)
  if (!me) return [key]
  if (!me.supplierLabel.trim()) return [key]
  const gk = supplierIdentityKey(me)
  return lines.filter((l) => supplierIdentityKey(l) === gk).map((l) => l.key)
}
