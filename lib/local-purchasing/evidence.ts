import { z } from 'zod'

const money = z.number().finite().min(0).max(1_000_000_000).nullable()
const percent = z.number().finite().min(0).max(100).nullable()
const text = z.string().max(2000).nullable()

export const PrintedLineSchema = z.object({
  label: z.string().max(2000).describe('Product description exactly as printed; exclude separate numeric columns.'),
  code: text.describe('Separate supplier code, if printed. Codes may repeat across different products.'),
  unit: text.describe('Printed purchasing unit, including pack size. Never convert packs to pieces.'),
  qty: z.number().finite().min(0).max(10_000_000).nullable().describe('Printed quantity; missing is null, never assume one.'),
  unitPrice: money.describe('UNIT price exactly as printed. Do not add VAT, remove VAT or apply a discount.'),
  lineTotal: money.describe('Extended line amount exactly as printed; null if absent.'),
  discountPercent: percent.describe('Printed line discount percentage; null if only a document discount exists.'),
  discountAmount: money.describe('Printed discount amount for this entire line, not per unit.'),
  unitPriceStage: z.enum(['before_discount', 'after_discount']).nullable().describe('Only when labels explicitly say whether the UNIT price is before/after discount.'),
  lineTotalStage: z.enum(['before_discount', 'after_discount', 'payable']).nullable().describe('Only when explicitly labelled; payable means the line total includes VAT.'),
  vatPercent: percent.describe('Line-specific printed VAT rate, including explicit zero/exempt; otherwise null.'),
  vatAmount: money.describe('Printed VAT amount for the entire line.'),
  pricesIncludeVat: z.boolean().nullable().describe('Line-specific inclusive/exclusive cue, else null.'),
  sourceRow: text.describe('Source row identifier or row number as text.'),
  sourcePage: z.number().int().min(1).max(1000).nullable(),
  issues: z.array(z.string().max(1000)).max(20).describe('Unreadable or ambiguous unit/column evidence on this row; empty if clear.'),
})

export const PrintedDocumentSchema = z.object({
  docKind: z.enum(['receipt', 'invoice', 'quote', 'pricelist', 'unknown']),
  supplierName: text,
  vatNumber: text.describe('VAT number only; do not substitute a BRN or invent a registration.'),
  docRef: text,
  docDate: z.string().nullable().describe('Printed date in YYYY-MM-DD; null if ambiguous.'),
  declaredSubtotal: money.describe('Printed subtotal excluding VAT, not a computed subtotal.'),
  subtotalStage: z.enum(['before_discount', 'after_discount']).nullable(),
  declaredVat: money,
  declaredTotal: money.describe('Printed final amount payable, including tax/charges/rounding.'),
  pricesIncludeVat: z.boolean().nullable().describe('Explicit document price-basis cue only, not an arithmetic guess.'),
  vatPercent: percent.describe('Document VAT rate when printed; explicit zero when tax exempt.'),
  discountPercent: percent,
  discountAmount: money.describe('Printed document discount amount. Do not calculate it from the percentage.'),
  discountIncluded: z.boolean().nullable().describe('True only if unit-price labels explicitly say discount is already reflected; false only if it is explicitly still to deduct.'),
  charges: z.array(z.object({ label: z.string().max(2000), amount: money, vatPercent: percent, pricesIncludeVat: z.boolean().nullable() })).max(50),
  roundingAmount: z.number().finite().min(-1000).max(1000).nullable().describe('Explicit printed rounding adjustment with sign, never a balancing plug.'),
  lines: z.array(PrintedLineSchema).max(2000),
  legible: z.boolean(),
  notes: text,
  issues: z.array(z.string().max(1000)).max(100),
})

type FullLine = z.infer<typeof PrintedLineSchema>
type FullDocument = z.infer<typeof PrintedDocumentSchema>
export type ReceiptLine = Pick<FullLine, 'label' | 'code' | 'qty' | 'unitPrice' | 'lineTotal'> &
  Partial<Omit<FullLine, 'label' | 'code' | 'qty' | 'unitPrice' | 'lineTotal'>> & { key?: string }
export type ReceiptEvidence = Pick<FullDocument, 'docKind' | 'supplierName' | 'vatNumber' | 'docRef' | 'docDate' | 'declaredSubtotal' | 'declaredVat' | 'declaredTotal' | 'pricesIncludeVat' | 'discountPercent' | 'legible' | 'notes'> &
  Partial<Omit<FullDocument, 'lines' | 'docKind' | 'supplierName' | 'vatNumber' | 'docRef' | 'docDate' | 'declaredSubtotal' | 'declaredVat' | 'declaredTotal' | 'pricesIncludeVat' | 'discountPercent' | 'legible' | 'notes'>> & { lines: ReceiptLine[] }

export function normaliseEvidence(value: Partial<ReceiptEvidence>): ReceiptEvidence {
  const parsed = PrintedDocumentSchema.parse({
    docKind: 'unknown', supplierName: null, vatNumber: null, docRef: null, docDate: null,
    declaredSubtotal: null, subtotalStage: null, declaredVat: null, declaredTotal: null,
    pricesIncludeVat: null, vatPercent: null, discountPercent: null, discountAmount: null,
    discountIncluded: null, charges: [], roundingAmount: null, legible: true, notes: null, issues: [],
    ...value,
    lines: (value.lines ?? []).map((line, index) => ({
      unit: null, discountPercent: null, discountAmount: null, unitPriceStage: null,
      lineTotalStage: null, vatPercent: null, vatAmount: null, pricesIncludeVat: null,
      sourceRow: String(index + 1), sourcePage: null, issues: [], ...line,
    })),
  })
  return { ...parsed, lines: parsed.lines.map((line, index) => ({ ...line, key: value.lines?.[index]?.key || `row-${index + 1}` })) }
}

export function evidenceRevision(value: unknown): string {
  const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, item]) => [k, stable(item)])) : v
  const text = JSON.stringify(stable(value))
  let hash = 2166136261
  let second = 5381
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
    second = Math.imul(second, 33) ^ text.charCodeAt(i)
  }
  return `${(hash >>> 0).toString(16)}-${(second >>> 0).toString(16)}-${text.length}`
}

export const moneyText = (n: number) => `Rs ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const nullableNumber = (value: string | number | null | undefined): number | null =>
  value == null || (typeof value === 'string' && !value.trim()) ? null : Number.isFinite(Number(value)) ? Number(value) : null
