import * as XLSX from 'xlsx'
import { normaliseEvidence, type ReceiptEvidence, type ReceiptLine } from './evidence'

/**
 * Spreadsheets already contain exact values. They are parsed, never sent to AI.
 * Mapping and incomplete rows stay visible; a generic amount is not a unit price.
 */
export type SheetParse =
  | { status: 'ok'; lines: ReceiptLine[]; doc: ReceiptEvidence; mapping: { label: string; code: string | null; qty: string | null; price: string | null; amount: string | null }; skipped: number; warnings: string[] }
  | { status: 'error'; message: string }

const HEADERS = {
  label: ['description', 'designation', 'product name', 'item name', 'particulars', 'article', 'product', 'item', 'name'],
  code: ['item code', 'product code', 'reference', 'ref', 'code', 'sku', 'barcode'],
  qty: ['quantity', 'qty', 'qte', 'pcs', 'nos'],
  unit: ['unit of measure', 'uom', 'unit', 'packaging'],
  price: ['unit price', 'prix unitaire', 'price per unit', 'unit cost', 'p u', 'pu', 'rate', 'price', 'cost', 'prix'],
  amount: ['line total', 'line amount', 'extended amount', 'extended price', 'montant', 'amount', 'total'],
  discountPercent: ['discount %', 'disc %', 'discount percent', 'remise %'],
  discountAmount: ['discount amount', 'disc amount', 'remise'],
  vatPercent: ['vat %', 'tax %', 'vat rate', 'tax rate'],
  vatAmount: ['vat amount', 'tax amount'],
} as const

// P.U. normalises to "p u", not "pu"; both are real supplier headers.
const norm = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[.()/\\:]/g, ' ').replace(/\s+/g, ' ').trim()

/** Accept Mauritian/French numeric cells without changing missing values to zero. */
function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v ?? '').trim()
  if (!s) return null
  let cleaned = s.replace(/rs\.?|mur|₨|%/gi, '').replace(/\s/g, '').trim()
  if (/^-?\d{1,3}(?:\.\d{3})*,\d{1,2}$/.test(cleaned) || (/^-?\d+,\d{1,2}$/.test(cleaned) && !cleaned.includes('.'))) cleaned = cleaned.replace(/\./g, '').replace(',', '.')
  else cleaned = cleaned.replace(/,/g, '')
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

function matchColumn(cells: string[], aliases: readonly string[]): number {
  for (const alias of aliases) { const i = cells.indexOf(alias); if (i >= 0) return i }
  for (const alias of aliases.filter((a) => a.includes(' '))) {
    const i = cells.findIndex((c) => c.startsWith(alias + ' '))
    if (i >= 0) return i
  }
  return -1
}

export function parseSupplierSheet(file: Buffer, filename = 'sheet'): SheetParse {
  let rows: unknown[][]
  let sheetName: string
  let sheetCount: number
  let worksheet: XLSX.WorkSheet
  let sourceStart: XLSX.CellAddress
  try {
    const workbook = XLSX.read(file, { type: 'buffer', cellDates: true, raw: true })
    sheetName = workbook.SheetNames[0]
    sheetCount = workbook.SheetNames.length
    if (!sheetName) return { status: 'error', message: 'That file has no sheets in it.' }
    worksheet = workbook.Sheets[sheetName]
    sourceStart = XLSX.utils.decode_range(worksheet['!ref'] ?? 'A1').s
    rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, blankrows: true, defval: null })
  } catch { return { status: 'error', message: `Could not open ${filename} as a spreadsheet or CSV.` } }
  if (!rows.length) return { status: 'error', message: 'That file is empty.' }
  if (rows.length > 10_000) return { status: 'error', message: 'This sheet exceeds 10,000 rows. Import a single invoice at a time.' }
  const headers = rows.slice(0, 30).map((row, index) => {
    const cells = row.map(norm)
    return { index, cells, score: Object.values(HEADERS).filter((group) => matchColumn(cells, group) >= 0).length }
  }).sort((a, b) => b.score - a.score)
  const header = headers[0]
  if (!header?.score) return { status: 'error', message: 'Could not find a header row with a description and unit price or line amount.' }
  const columns = Object.fromEntries(Object.entries(HEADERS).map(([field, aliases]) => [field, matchColumn(header.cells, aliases)])) as Record<keyof typeof HEADERS, number>
  if (columns.label < 0) return { status: 'error', message: `No product description column. Columns seen: ${header.cells.filter(Boolean).join(', ')}` }
  if (columns.price < 0 && columns.amount < 0) return { status: 'error', message: `No price or line amount column. Columns seen: ${header.cells.filter(Boolean).join(', ')}` }
  const doc = normaliseEvidence({ lines: [], docKind: 'pricelist' })
  const warnings: string[] = []
  let skipped = 0
  const cell = (row: unknown[], field: keyof typeof HEADERS) => columns[field] < 0 ? null : row[columns[field]]
  const displayedCell = (row: number, column: number) => {
    if (column < 0) return ''
    const source = worksheet[XLSX.utils.encode_cell({ r: sourceStart.r + row, c: sourceStart.c + column })]
    return source ? XLSX.utils.format_cell(source).trim() : ''
  }
  const lastNumber = (row: unknown[]) => row.map(toNumber).filter((v): v is number => v != null).at(-1) ?? null
  if (sheetCount > 1) doc.issues!.push(`Only worksheet "${sheetName}" was parsed; this file has ${sheetCount} sheets. Import the other invoice pages separately or supply one complete sheet.`)
  if (['price', 'cost', 'prix'].includes(header.cells[columns.price])) doc.issues!.push('The price column does not explicitly say per unit. Check the unit price versus line amount columns.')
  for (const field of ['price', 'amount', 'qty'] as const) {
    if (header.cells.filter((c) => (HEADERS[field] as readonly string[]).includes(c)).length > 1) doc.issues!.push(`More than one possible ${field} column exists. Check the selected mapping.`)
  }
  const allText = rows.flat().map((v) => String(v ?? '')).join(' ')
  if (/\b(?:vat|tax)\s*(?:inclusive|included)|\bincl\.?\s*vat/i.test(allText)) doc.pricesIncludeVat = true
  if (/\b(?:vat|tax)\s*exclusive|\bexcl\.?\s*vat/i.test(allText)) {
    if (doc.pricesIncludeVat) doc.issues!.push('Both inclusive and exclusive VAT labels appear in the sheet.')
    else doc.pricesIncludeVat = false
  }
  for (let r = 0; r < rows.length; r++) {
    if (r === header.index) continue
    const row = rows[r] ?? []
    if (!row.some((v) => v != null && String(v).trim())) { skipped++; continue }
    const first = String(row.find((v) => v != null && String(v).trim()) ?? '').trim()
    const label = String(cell(row, 'label') ?? '').trim()
    const footer = label || first
    const n = lastNumber(row)
    const remaining = row.map((_, column) => displayedCell(r, column)).filter(Boolean).slice(1).join(' ')
    const hasProductEvidence = r > header.index && (toNumber(cell(row, 'qty')) != null ||
      Boolean(String(cell(row, 'code') ?? '').trim()) || Boolean(String(cell(row, 'unit') ?? '').trim()))
    const registration = /^(?:vat|tax)\s*(?:registration\s*)?(?:number|no\.?|#)(?=\s|:|$)\s*:?\s*(.*)$/i.exec(footer)
    if (!hasProductEvidence && registration) {
      doc.vatNumber = registration[1].trim() || remaining || null
      skipped++; continue
    }
    if (!hasProductEvidence && (/^(?:vat|tax)\s*(?:%|percent|rate(?:\s*%)?)\s*:?$/i.test(footer) ||
      (/^(vat|tax)\s*:?$/i.test(footer) && /^\d+(?:\.\d+)?\s*%$/.test(remaining)))) {
      doc.vatPercent = n
      skipped++; continue
    }
    if (!hasProductEvidence && /^(grand total|total payable|amount due|net payable|total\s*(?:incl|ttc)|total\s*$)/i.test(footer)) { doc.declaredTotal = n; skipped++; continue }
    if (!hasProductEvidence && /^(sub[ -]?total|total\s*(?:excl|ht))/i.test(footer)) { doc.declaredSubtotal = n; doc.subtotalStage = /before discount/i.test(footer) ? 'before_discount' : 'after_discount'; skipped++; continue }
    if (!hasProductEvidence && /^(?:vat|tax)(?:\s+(?:amount|total|\d+(?:\.\d+)?\s*%))?\s*:?$/i.test(footer)) {
      const rate = /(?:vat|tax)\s*(\d+(?:\.\d+)?)\s*%/i.exec(footer)
      if (rate) doc.vatPercent = Number(rate[1])
      if (!/%\s*$/.test(footer) || row.filter((v) => toNumber(v) != null).length) doc.declaredVat = n
      skipped++; continue
    }
    if (!hasProductEvidence && /^(?:discount|disc\.?|remise)(?:\s+(?:amount|percent|[\d.%]+|already|included|reflected))*\s*:?$/i.test(footer)) {
      const pct = /(\d+(?:\.\d+)?)\s*%/.exec(footer)
      doc.discountPercent = pct ? Number(pct[1]) : /%|percent/i.test(footer) ? n : null
      if (!/%|percent/i.test(footer) || (pct && n != null)) doc.discountAmount = n
      if (/already|included|reflected/i.test(footer)) doc.discountIncluded = true
      skipped++; continue
    }
    if (!hasProductEvidence && /^(?:(?:delivery|transport|freight|shipping)(?:\s+(?:fee|charge|charges|cost))?|other charges?(?:\s*[:\-].*)?)\s*:?$/i.test(footer)) {
      doc.charges!.push({ label: footer, amount: n, vatPercent: null, pricesIncludeVat: null }); skipped++; continue
    }
    if (!hasProductEvidence && /^rounding(?:\s+(?:adjustment|difference))?\s*:?$/i.test(footer)) { doc.roundingAmount = n; skipped++; continue }
    if (r < header.index) {
      if (/^(supplier|vendor|shop)\b/i.test(first) && remaining) doc.supplierName = remaining
      if (/^(invoice|receipt|quotation|reference|ref)\b/i.test(first) && remaining) {
        doc.docRef = remaining
        doc.docKind = /^invoice/i.test(first) ? 'invoice' : /^receipt/i.test(first) ? 'receipt' : /^quotation/i.test(first) ? 'quote' : doc.docKind
      }
      if (/^(date|invoice date)\b/i.test(first)) {
        const date = row.find((v) => v instanceof Date)
        const iso = /\b\d{4}-\d{2}-\d{2}\b/.exec(remaining)?.[0]
        doc.docDate = date instanceof Date ? date.toISOString().slice(0, 10) : iso ?? null
      }
      skipped++; continue
    }
    if (norm(label) === header.cells[columns.label] && toNumber(cell(row, 'price')) == null) { skipped++; continue }
    const unitPrice = toNumber(cell(row, 'price'))
    const lineTotal = toNumber(cell(row, 'amount'))
    const qty = toNumber(cell(row, 'qty'))
    if (!label && unitPrice == null && lineTotal == null && qty == null) { skipped++; continue }
    doc.lines.push({ key: `sheet-${sourceStart.r + r + 1}`, label, code: displayedCell(r, columns.code) || null,
      unit: String(cell(row, 'unit') ?? '').trim() || null, qty, unitPrice, lineTotal,
      discountPercent: toNumber(cell(row, 'discountPercent')), discountAmount: toNumber(cell(row, 'discountAmount')),
      vatPercent: toNumber(cell(row, 'vatPercent')), vatAmount: toNumber(cell(row, 'vatAmount')),
      sourceRow: `${sheetName}:${sourceStart.r + r + 1}`, sourcePage: null, issues: [],
    })
  }
  if (!doc.lines.length) return { status: 'error', message: 'No product rows found under the header.' }
  if (doc.lines.length > 2000) return { status: 'error', message: 'Import at most 2,000 product rows per document.' }
  const incomplete = doc.lines.filter((l) => !l.label || l.qty == null || (l.unitPrice == null && l.lineTotal == null)).length
  if (incomplete) warnings.push(`${incomplete} incomplete product row(s) retained for correction, not silently dropped.`)
  if (columns.qty < 0) warnings.push('This sheet has no quantity column. Enter the quantities; none were assumed.')
  if (skipped) warnings.push(`${skipped} blank, header or footer row(s) are not product lines. Printed totals and charges are retained separately.`)
  const mappedName = (field: keyof typeof HEADERS) => columns[field] >= 0 ? header.cells[columns[field]] : null
  return { status: 'ok', lines: doc.lines, doc, skipped, warnings,
    mapping: { label: mappedName('label')!, code: mappedName('code'), qty: mappedName('qty'), price: mappedName('price'), amount: mappedName('amount') } }
}
