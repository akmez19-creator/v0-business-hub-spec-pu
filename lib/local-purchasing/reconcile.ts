import { evidenceRevision, normaliseEvidence, type ReceiptEvidence, type ReceiptLine } from './evidence'
import { round2, type PurchaseUnitAmounts } from './vat'

export const RECONCILIATION_VERSION = 'receipt-1.0'
export type DiscountTreatment = 'included' | 'apply'
export interface ReceiptOverrides {
  pricesIncludeVat?: boolean | null
  discountTreatment?: DiscountTreatment | null
  vatPercent?: number | null
}
export interface CheckIssue {
  code: string
  message: string
  lineKey?: string
  printed?: number
  calculated?: number
  difference?: number
  essential?: boolean
}
export interface NormalizedReceiptLine {
  key: string
  label: string
  qty: number
  unit: string | null
  source: ReceiptLine
  unitAmounts: PurchaseUnitAmounts
  net: number
  vat: number
  payable: number
  rawNet: number
  rawVat: number
  rawPayable: number
  printedDiscountPercent: number | null
  appliedDiscountAmount: number
  lineTotalStage: string | null
}
export interface ReceiptTotals {
  net: number
  vat: number
  payable: number
  goodsNet: number
  chargesNet: number
  chargesPayable: number
  rounding: number
  reclaimable: number
  effectiveCost: number
}
export interface ReceiptCheck {
  version: string
  inputRevision: string
  status: 'verified' | 'needs_review' | 'not_checkable'
  resolved: {
    pricesIncludeVat: boolean
    vatPercent: number
    discountTreatment: DiscountTreatment
    printedDiscountPercent: number | null
    additionalDiscountPercent: number
    roundingMethod: 'document' | 'line'
    explanation: string
  } | null
  lines: NormalizedReceiptLine[]
  totals: ReceiptTotals | null
  issues: CheckIssue[]
  checkpoints: { label: string; printed: number; calculated: number; difference: number; matches: boolean }[]
  roundingAllocation: { net: number; vat: number; payable: number }
  canRecord: boolean
}

const r4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000
const sameMoney = (a: number, b: number) => Math.abs(round2(a) - round2(b)) < 0.001
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
const moneyIssue = (code: string, message: string, printed: number, calculated: number, lineKey?: string): CheckIssue =>
  ({ code, message, printed, calculated: round2(calculated), difference: round2(calculated - printed), ...(lineKey ? { lineKey } : {}) })

interface Candidate {
  inclusive: boolean
  treatment: DiscountTreatment
  rounding: 'document' | 'line'
  lines: NormalizedReceiptLine[]
  issues: CheckIssue[]
  totals: ReceiptTotals
  checkpoints: ReceiptCheck['checkpoints']
  allocation: ReceiptCheck['roundingAllocation']
}

function evaluate(doc: ReceiptEvidence, inclusive: boolean, treatment: DiscountTreatment, rate: number,
  rounding: 'document' | 'line', totalOnlyStage: 'before_discount' | 'after_discount', reclaimable: boolean): Candidate {
  const issues: CheckIssue[] = []
  const lines: NormalizedReceiptLine[] = []
  const headerPercent = doc.discountPercent ?? 0
  const headerAmount = doc.discountAmount ?? 0
  const hasHeaderPercent = headerPercent > 0
  const bases = doc.lines.map((line) => {
    const qty = line.qty ?? 0
    const totalOnly = line.unitPrice == null
    const after = line.unitPriceStage === 'after_discount' || (totalOnly && (line.lineTotalStage === 'after_discount' || line.lineTotalStage === 'payable' || (!line.lineTotalStage && totalOnlyStage === 'after_discount')))
    const raw = totalOnly ? line.lineTotal ?? 0 : (line.unitPrice ?? 0) * qty
    const dp = line.discountPercent ?? 0
    const da = line.discountAmount ?? 0
    const lineDiscount = after ? 0 : dp > 0 ? raw * dp / 100 : da
    if (dp > 0 && da > 0 && !sameMoney(raw * dp / 100, da)) {
      issues.push(moneyIssue('line_discount', 'The printed discount amount does not match its percentage.', da, raw * dp / 100, line.key))
    }
    const afterLine = raw - lineDiscount
    return { qty, totalOnly, after, raw, lineDiscount, afterLine }
  })
  const headerBase = sum(bases.filter((b) => !b.after).map((b) => b.afterLine))
  if (hasHeaderPercent && headerAmount > 0 && treatment === 'apply' && !sameMoney(headerBase * headerPercent / 100, headerAmount)) {
    issues.push(moneyIssue('document_discount', 'Printed discount amount and percentage disagree.', headerAmount, headerBase * headerPercent / 100))
  }

  for (let index = 0; index < doc.lines.length; index++) {
    const source = doc.lines[index]
    const key = source.key!
    const b = bases[index]
    const lineRate = source.vatPercent ?? rate
    const lineInclusive = source.lineTotalStage === 'payable' && b.totalOnly ? true : source.pricesIncludeVat ?? inclusive
    const headerDeduction = treatment === 'apply' && !b.after
      ? hasHeaderPercent ? b.afterLine * headerPercent / 100 : headerBase > 0 ? headerAmount * b.afterLine / headerBase : 0
      : 0
    const finalPrintedBasis = b.afterLine - headerDeduction
    if (finalPrintedBasis < -0.001) issues.push({ code: 'negative_line', lineKey: key, message: 'Discount exceeds the line value.', essential: true })
    const rawNet = lineInclusive ? finalPrintedBasis / (1 + lineRate / 100) : finalPrintedBasis
    const rawVat = lineInclusive ? finalPrintedBasis - rawNet : rawNet * lineRate / 100
    const rawPayable = rawNet + rawVat
    const net = round2(rawNet)
    const vat = lineInclusive ? round2(round2(rawPayable) - net) : round2(rawVat)
    const payable = round2(net + vat)
    let observedStage: string | null = source.lineTotalStage ?? null

    if (source.unitPrice != null && source.lineTotal != null && b.qty > 0) {
      const afterLineNet = lineInclusive ? b.afterLine / (1 + lineRate / 100) : b.afterLine
      const possible: Array<[string, number]> = source.lineTotalStage === 'before_discount'
        ? [['before_discount', b.raw]]
        : source.lineTotalStage === 'payable' ? [['payable', rawPayable]]
        : source.lineTotalStage === 'after_discount' ? [['after_discount', finalPrintedBasis]]
        : [['before_discount', b.raw], ['after_line_discount', b.afterLine], ['after_discount', finalPrintedBasis],
          ...(lineInclusive ? [] : [['payable', afterLineNet * (1 + lineRate / 100)] as [string, number]])]
      const matched = possible.find(([, amount]) => sameMoney(amount, source.lineTotal!))
      observedStage = matched?.[0] ?? observedStage
      if (!matched) {
        const closest = possible.slice().sort((a, c) => Math.abs(a[1] - source.lineTotal!) - Math.abs(c[1] - source.lineTotal!))[0]
        issues.push(moneyIssue('line_multiplication', 'Quantity × unit price, with the printed terms, does not match this line total.', source.lineTotal, closest[1], key))
      }
    }
    if (source.vatAmount != null && !sameMoney(source.vatAmount, vat)) {
      issues.push(moneyIssue('line_vat', 'Printed line VAT differs from calculated VAT.', source.vatAmount, vat, key))
    }

    // Fixed-amount discounts cannot be represented by an invented percentage.
    // Store the already-discounted net input at four decimals, with zero left to apply.
    const percentOnly = b.lineDiscount === 0 || (source.discountPercent ?? 0) > 0
    const headerPercentOnly = headerDeduction === 0 || hasHeaderPercent
    const appliedPercent = b.after ? 0 : 100 * (1 - (1 - (source.discountPercent ?? 0) / 100) *
      (1 - (treatment === 'apply' ? headerPercent : 0) / 100))
    const representable = percentOnly && headerPercentOnly && sameMoney(appliedPercent * 1000, Math.round(appliedPercent * 1000))
    const exactNetUnit = b.qty > 0 ? rawNet / b.qty : 0
    const listNet = b.qty > 0 ? (lineInclusive ? b.raw / (1 + lineRate / 100) : b.raw) / b.qty : 0
    const discountToStore = representable ? Math.round(appliedPercent * 1000) / 1000 : 0
    const listToStore = representable ? r4(listNet) : r4(exactNetUnit)
    const storedNet = r4(listToStore * (1 - discountToStore / 100))
    const unitPayable = b.qty > 0 ? round2(rawPayable / b.qty) : 0
    const unitNet = r4(exactNetUnit)
    lines.push({
      key, label: source.label, qty: b.qty, unit: source.unit || null, source,
      net, vat, payable, rawNet, rawVat, rawPayable,
      printedDiscountPercent: source.discountPercent ?? doc.discountPercent ?? null,
      appliedDiscountAmount: round2(b.lineDiscount + headerDeduction), lineTotalStage: observedStage,
      unitAmounts: {
        enteredPrice: source.unitPrice ?? (b.qty > 0 ? (source.lineTotal ?? 0) / b.qty : 0),
        listPriceNet: listToStore, unitPriceNet: storedNet,
        discountPercent: discountToStore, vatPercent: lineRate, pricesIncludeVat: lineInclusive,
        printedDiscountPercent: source.discountPercent ?? doc.discountPercent ?? null,
        discountAlreadyIncluded: b.after || (treatment === 'included' && (doc.discountPercent ?? 0) > 0),
        unitVat: { net: round2(unitNet), vat: round2(unitPayable - round2(unitNet)), gross: unitPayable,
          reclaimable: reclaimable ? round2(unitPayable - round2(unitNet)) : 0,
          effectiveCost: reclaimable ? round2(unitNet) : unitPayable },
      },
    })
  }

  const charges = (doc.charges ?? []).map((charge) => {
    const cr = charge.vatPercent ?? rate
    const ci = charge.pricesIncludeVat ?? inclusive
    const net = ci ? (charge.amount ?? 0) / (1 + cr / 100) : charge.amount ?? 0
    const vat = net * cr / 100
    return { net, vat, payable: net + vat }
  })
  const rawGoodsNet = sum(lines.map((l) => l.rawNet))
  const rawChargesNet = sum(charges.map((c) => c.net))
  const rawTotalNet = rawGoodsNet + rawChargesNet
  const rawTotalPayable = sum(lines.map((l) => l.rawPayable)) + sum(charges.map((c) => c.payable))
  const lineNet = round2(sum(lines.map((l) => l.net)) + sum(charges.map((c) => round2(c.net))))
  const lineVat = round2(sum(lines.map((l) => l.vat)) + sum(charges.map((c) => round2(c.vat))))
  const net = rounding === 'document' ? round2(rawTotalNet) : lineNet
  const vat = rounding === 'document'
    ? inclusive ? round2(round2(rawTotalPayable) - net) : round2(sum(lines.map((l) => l.rawVat)) + sum(charges.map((c) => c.vat)))
    : lineVat
  const payable = round2(net + vat + (doc.roundingAmount ?? 0))
  const totals: ReceiptTotals = { net, vat, payable,
    goodsNet: rounding === 'document' ? round2(rawGoodsNet) : round2(sum(lines.map((l) => l.net))),
    chargesNet: round2(rawChargesNet), chargesPayable: round2(sum(charges.map((c) => c.payable))),
    rounding: doc.roundingAmount ?? 0, reclaimable: reclaimable ? vat : 0, effectiveCost: round2(payable - (reclaimable ? vat : 0)) }
  const checkpoints: ReceiptCheck['checkpoints'] = []
  const addCheckpoint = (label: string, printed: number | null | undefined, calculated: number) => {
    if (printed == null) return
    const matches = sameMoney(printed, calculated)
    checkpoints.push({ label, printed, calculated: round2(calculated), difference: round2(calculated - printed), matches })
    if (!matches) issues.push(moneyIssue('checkpoint', `${label} does not reconcile.`, printed, calculated))
  }
  const preDiscountNet = sum(bases.map((b, i) => (doc.lines[i].pricesIncludeVat ?? inclusive)
    ? b.raw / (1 + (doc.lines[i].vatPercent ?? rate) / 100) : b.raw))
  const printedSubtotal = doc.subtotalStage === 'before_discount' ? round2(preDiscountNet + rawChargesNet) : net
  addCheckpoint('Subtotal excluding VAT', doc.declaredSubtotal, printedSubtotal)
  addCheckpoint('VAT', doc.declaredVat, vat)
  addCheckpoint('Total payable', doc.declaredTotal, payable)
  return { inclusive, treatment, rounding, lines, issues, totals, checkpoints,
    allocation: { net: round2(net - lineNet), vat: round2(vat - lineVat), payable: round2(net + vat - lineNet - lineVat) } }
}

export function reconcileReceipt(value: ReceiptEvidence, overrides: ReceiptOverrides = {}, reclaimable = false): ReceiptCheck {
  const inputRevision = evidenceRevision({ document: value, overrides, reclaimable })
  const empty: ReceiptCheck = { version: RECONCILIATION_VERSION, inputRevision, status: 'needs_review', resolved: null,
    lines: [], totals: null, issues: [], checkpoints: [], roundingAllocation: { net: 0, vat: 0, payable: 0 }, canRecord: false }
  let doc: ReceiptEvidence
  try { doc = normaliseEvidence(value) } catch {
    return { ...empty, issues: [{ code: 'invalid_evidence', message: 'A number, rate or field is outside the supported range. Correct the source figures.', essential: true }] }
  }
  const issues: CheckIssue[] = []
  if (!doc.lines.length) issues.push({ code: 'empty', message: 'Add at least one product line.', essential: true })
  if (new Set(doc.lines.map((l) => l.key)).size !== doc.lines.length) issues.push({ code: 'duplicate_key', message: 'The document contains duplicate row identifiers. Import it again.', essential: true })
  for (const line of doc.lines) {
    if (!(line.qty != null && line.qty > 0)) issues.push({ code: 'missing_quantity', lineKey: line.key, message: 'Enter the printed quantity; a missing quantity is not one.', essential: true })
    if (!line.label.trim()) issues.push({ code: 'missing_description', lineKey: line.key, message: 'A product row has no description.', essential: true })
    if (line.unitPrice == null && line.lineTotal == null) issues.push({ code: 'missing_price', lineKey: line.key, message: 'Enter a unit price or a printed extended amount.', essential: true })
    for (const message of line.issues ?? []) issues.push({ code: 'source_row', lineKey: line.key, message })
  }
  for (const charge of doc.charges ?? []) if (charge.amount == null) issues.push({ code: 'missing_charge', message: `Enter the amount printed for ${charge.label}.`, essential: true })
  for (const message of doc.issues ?? []) issues.push({ code: 'source_document', message })
  if (!doc.legible) issues.push({ code: 'legibility', message: 'The reader could not read every field clearly. Check the original.' })
  const rate = overrides.vatPercent ?? doc.vatPercent ?? (doc.declaredVat === 0 ? 0 : 15)
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return { ...empty, issues: [{ code: 'vat_rate', message: 'Enter a VAT rate from 0 to 100%.', essential: true }] }
  const taxEvidence = overrides.vatPercent != null || doc.vatPercent != null || doc.pricesIncludeVat != null || doc.declaredVat != null || doc.lines.every((l) => l.vatPercent != null)
  if (!taxEvidence) issues.push({ code: 'tax_evidence', message: 'No VAT rate or tax treatment is printed clearly. Confirm the tax terms instead of assuming a rate.' })
  const hasDiscount = (doc.discountPercent ?? 0) > 0 || (doc.discountAmount ?? 0) > 0
  const inclusives = overrides.pricesIncludeVat != null ? [overrides.pricesIncludeVat] : rate === 0 ? [false] : [true, false]
  const treatments: DiscountTreatment[] = overrides.discountTreatment ? [overrides.discountTreatment] : hasDiscount ? ['included', 'apply'] : ['included']
  const stages: Array<'before_discount' | 'after_discount'> = doc.lines.some((l) => l.unitPrice == null && l.lineTotal != null && !l.lineTotalStage && (hasDiscount || (l.discountPercent ?? 0) > 0 || (l.discountAmount ?? 0) > 0))
    ? ['after_discount', 'before_discount'] : ['after_discount']
  const candidates: Candidate[] = []
  for (const incl of inclusives) for (const treatment of treatments) for (const rounding of ['document', 'line'] as const) for (const stage of stages) {
    candidates.push(evaluate(doc, incl, treatment, rate, rounding, stage, reclaimable))
  }
  const monetaryMatches = candidates.filter((c) => c.issues.length === 0)
  const labelled = (c: Candidate) => (doc.pricesIncludeVat == null || rate === 0 || c.inclusive === doc.pricesIncludeVat) &&
    (doc.discountIncluded == null || !hasDiscount || (c.treatment === 'included') === doc.discountIncluded)
  const exact = monetaryMatches.filter(labelled)
  const pool = exact.length ? exact : monetaryMatches
  const signatures = new Map<string, Candidate>()
  for (const candidate of pool) {
    const signature = JSON.stringify(candidate.lines.map((l) => [l.unitAmounts.unitPriceNet, l.unitAmounts.unitVat.gross, l.unitAmounts.vatPercent]))
    if (!signatures.has(signature)) signatures.set(signature, candidate)
  }
  let chosen: Candidate | undefined
  if (signatures.size === 1) chosen = [...signatures.values()][0]
  else if (signatures.size > 1) issues.push({ code: 'ambiguous_treatment', message: 'Several different price treatments fit the available evidence. Check the missing totals or explicitly confirm the terms.' })
  else {
    // A failed fit is a proposal only if the source or buyer gives the terms.
    // Never turn the smallest numerical discrepancy into a confident default.
    const explicit = candidates.filter((c) => (overrides.pricesIncludeVat != null || doc.pricesIncludeVat != null || rate === 0) &&
      (overrides.pricesIncludeVat != null || doc.pricesIncludeVat == null || c.inclusive === doc.pricesIncludeVat) &&
      (!hasDiscount || overrides.discountTreatment != null || doc.discountIncluded != null) &&
      (overrides.discountTreatment != null || doc.discountIncluded == null || (c.treatment === 'included') === doc.discountIncluded))
    if (explicit.length) chosen = explicit.sort((a, b) => a.issues.length - b.issues.length)[0]
    if (!chosen) issues.push({ code: 'unresolved_treatment', message: 'The printed figures do not establish a safe VAT/discount treatment. Correct the highlighted evidence or confirm the terms with a reason.' })
  }
  const closest = chosen ?? candidates.slice().sort((a, b) => a.issues.length - b.issues.length ||
    sum(a.issues.map((i) => Math.abs(i.difference ?? 0))) - sum(b.issues.map((i) => Math.abs(i.difference ?? 0))))[0]
  if (chosen && !labelled(chosen)) issues.push({ code: 'conflicting_labels', message: 'The arithmetic fits, but contradicts a printed VAT/discount label. Check the original; this is not verified.' })
  if (closest) issues.push(...closest.issues)
  const hasTotal = doc.declaredTotal != null
  if (!hasTotal) issues.push({ code: 'no_printed_total', message: 'No printed total payable: the figures can be calculated, but document completeness cannot be verified.' })
  if (doc.declaredSubtotal != null && doc.declaredVat != null && doc.declaredTotal != null && doc.subtotalStage !== 'before_discount' &&
    !sameMoney(doc.declaredSubtotal + doc.declaredVat + (doc.roundingAmount ?? 0), doc.declaredTotal)) {
    issues.push(moneyIssue('printed_totals', 'Printed subtotal + VAT + rounding does not equal the printed total.', doc.declaredTotal, doc.declaredSubtotal + doc.declaredVat + (doc.roundingAmount ?? 0)))
  }
  const status: ReceiptCheck['status'] = !hasTotal && issues.every((i) => i.code === 'no_printed_total') ? 'not_checkable'
    : issues.length || !chosen ? 'needs_review' : 'verified'
  const resolved = chosen ? {
    pricesIncludeVat: chosen.inclusive, vatPercent: rate, discountTreatment: chosen.treatment,
    printedDiscountPercent: doc.discountPercent,
    additionalDiscountPercent: chosen.treatment === 'apply' ? doc.discountPercent ?? 0 : 0,
    roundingMethod: chosen.rounding,
    explanation: `${chosen.inclusive ? 'VAT is already included; it is separated out, not added again.' : rate === 0 ? 'No VAT is charged.' : `${rate}% VAT is added to the net prices.`} ${hasDiscount
      ? chosen.treatment === 'included' ? 'The printed discount is already reflected. No second deduction.' : 'The printed discount still applies to the pre-discount figures.'
      : 'No additional document discount.'}`,
  } : null
  return { ...empty, status: !hasTotal && status !== 'verified' ? (issues.some((i) => i.code !== 'no_printed_total') ? 'needs_review' : 'not_checkable') : status,
    resolved, lines: chosen?.lines ?? [], totals: chosen?.totals ?? null, issues,
    checkpoints: closest?.checkpoints ?? [], roundingAllocation: chosen?.allocation ?? empty.roundingAllocation,
    canRecord: Boolean(chosen) && !issues.some((i) => i.essential) }
}
