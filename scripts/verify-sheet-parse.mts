/**
 * Tests the supplier spreadsheet parser against the messes real suppliers send.
 *
 * Every assertion PINS AN ACTUAL VALUE. A previous version of this module
 * shipped a wrong number behind "9 passed, 0 failed" because every assertion
 * only checked guard rails, so here the parsed prices and quantities themselves
 * are asserted.
 */
import * as XLSX from 'xlsx'
import { parseSupplierSheet } from '../lib/local-purchasing/parse-sheet'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++
    console.log(`  ok   ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name}${detail ? ` - ${detail}` : ''}`)
  }
}

/** Builds a real .xlsx buffer from rows, so we test the actual library path. */
function xlsxOf(rows: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

console.log('\n=== a clean price list ===')
{
  const buf = xlsxOf([
    ['Description', 'Item Code', 'Unit Price'],
    ['Automatic Sweeping Robot', 'DT1057', 210],
    ['Hanging Rope With Hooks', 'DT2001', 89.5],
  ])
  const r = parseSupplierSheet(buf)
  check('parses', r.status === 'ok')
  if (r.status === 'ok') {
    check('finds both product rows', r.lines.length === 2, `got ${r.lines.length}`)
    check(
      'the label is copied EXACTLY, not tidied up',
      r.lines[0].label === 'Automatic Sweeping Robot',
      r.lines[0].label,
    )
    check('reads the real price 210', r.lines[0].unitPrice === 210, `${r.lines[0].unitPrice}`)
    check('reads the decimal price 89.5', r.lines[1].unitPrice === 89.5, `${r.lines[1].unitPrice}`)
    check('reads the supplier code DT1057', r.lines[0].code === 'DT1057', `${r.lines[0].code}`)
    check(
      'NO quantity column => qty is null, never assumed to be 1',
      r.lines[0].qty === null,
      `${r.lines[0].qty}`,
    )
    check(
      'and the owner is told to enter quantities',
      r.warnings.some((w) => w.includes('no quantity column')),
      r.warnings.join(' | '),
    )
  }
}

console.log('\n=== logo rows, blank rows, and a total row (the normal case) ===')
{
  const buf = xlsxOf([
    ['MORIS TRADING LTD'],
    ['Royal Road, Port Louis   VAT: VAT20456789'],
    [],
    ['Invoice INV 144', '', '', ''],
    ['Designation', 'Ref', 'Qty', 'P.U.'],
    ['Automatic Sweeping Robot', 'DT1057', 10, 210],
    ['Silicone Pads', 'DT9002', 24, 12.5],
    [],
    ['TOTAL', '', '', 2400],
    ['VAT 15%', '', '', 360],
  ])
  const r = parseSupplierSheet(buf)
  check(
    'finds the header BELOW the letterhead',
    r.status === 'ok',
    r.status === 'error' ? r.message : '',
  )
  if (r.status === 'ok') {
    check('takes exactly the 2 product rows', r.lines.length === 2, `got ${r.lines.length}`)
    check('reads qty 10 from the "Qty" column', r.lines[0].qty === 10, `${r.lines[0].qty}`)
    check('reads price 210 from the French "P.U." column', r.lines[0].unitPrice === 210)
    check('reads the second line qty 24 / price 12.5', r.lines[1].qty === 24 && r.lines[1].unitPrice === 12.5)
    check(
      'the TOTAL and VAT rows are NOT treated as products',
      !r.lines.some((l) => /total|vat/i.test(l.label)),
      r.lines.map((l) => l.label).join(' | '),
    )
    // The mapping echoes the NORMALISED header text, which is what matching
    // actually used - "p.u." reads as "p u" once punctuation is stripped.
    check(
      'reports which columns it used, so a wrong guess is visible',
      r.mapping.qty === 'qty' && (r.mapping.price ?? '').startsWith('p'),
      JSON.stringify(r.mapping),
    )
  }
}

console.log('\n=== "Rs 1,234.50" and decimal commas ===')
{
  const buf = xlsxOf([
    ['Item', 'Price'],
    ['Big Item', 'Rs 1,234.50'],
    ['French Item', '1 234,50'],
    ['Plain', '75'],
  ])
  const r = parseSupplierSheet(buf)
  check('parses currency-formatted text prices', r.status === 'ok')
  if (r.status === 'ok') {
    check('"Rs 1,234.50" -> 1234.5', r.lines[0].unitPrice === 1234.5, `${r.lines[0].unitPrice}`)
    check('"1 234,50" (decimal comma) -> 1234.5', r.lines[1].unitPrice === 1234.5, `${r.lines[1].unitPrice}`)
    check('"75" -> 75', r.lines[2].unitPrice === 75, `${r.lines[2].unitPrice}`)
  }
}

console.log('\n=== "unit price" must beat a merely-similar column ===')
{
  const buf = xlsxOf([
    ['Description', 'Amount Paid Last Year', 'Unit Price'],
    ['Widget', 9999, 42],
  ])
  const r = parseSupplierSheet(buf)
  if (r.status === 'ok') {
    check(
      'picks "Unit Price" (42), not "Amount Paid Last Year" (9999)',
      r.lines[0].unitPrice === 42,
      `got ${r.lines[0].unitPrice} from column "${r.mapping.price}"`,
    )
  } else {
    check('picks the unit price column', false, r.message)
  }
}

console.log('\n=== CSV goes through the same path ===')
{
  const csv = Buffer.from(
    'Product,Qty,Price\nAutomatic Sweeping Robot,10,210\nRope,5,89\n',
    'utf8',
  )
  const r = parseSupplierSheet(csv, 'list.csv')
  check('a plain CSV parses too', r.status === 'ok')
  if (r.status === 'ok') {
    check('CSV qty 10 and price 210 are exact', r.lines[0].qty === 10 && r.lines[0].unitPrice === 210)
  }
}

console.log('\n=== failures explain themselves ===')
{
  const noHeader = xlsxOf([['just'], ['some'], ['words']])
  const r1 = parseSupplierSheet(noHeader)
  check(
    'a sheet with no recognisable header is refused with a reason',
    r1.status === 'error' && r1.message.includes('header row'),
    r1.status === 'error' ? r1.message : 'parsed anyway',
  )

  const noPrice = xlsxOf([
    ['Description', 'Colour'],
    ['Widget', 'red'],
  ])
  const r2 = parseSupplierSheet(noPrice)
  check(
    'a sheet with no price column names the columns it DID see',
    r2.status === 'error' && r2.message.includes('Colour'.toLowerCase()),
    r2.status === 'error' ? r2.message : 'parsed anyway',
  )

  const r3 = parseSupplierSheet(Buffer.from('not a spreadsheet at all', 'utf8'), 'junk.pdf')
  check(
    'junk input never throws, it returns a message',
    r3.status === 'error',
    r3.status === 'error' ? r3.message : 'parsed junk',
  )
}

console.log('\n=== supplier identity and tax rate are not tax amounts ===')
{
  const result = parseSupplierSheet(xlsxOf([
    ['Supplier', 'Fixture supplier'],
    ['VAT number', 'VAT00123456'],
    ['VAT %', 15],
    ['Prices', 'VAT exclusive'],
    ['Description', 'Code', 'Qty', 'Unit price', 'Amount'],
    ['Widget', 'W1', 1, 100, 100],
    ['Total', '', '', '', 115],
  ]))
  check('tax metadata sheet parses', result.status === 'ok')
  if (result.status === 'ok') {
    check('retains the printed supplier VAT number', result.doc.vatNumber === 'VAT00123456', String(result.doc.vatNumber))
    check('VAT % is a rate, not a declared tax amount', result.doc.vatPercent === 15 && result.doc.declaredVat === null, JSON.stringify({ rate: result.doc.vatPercent, amount: result.doc.declaredVat }))
  }
}

console.log('\n=== product descriptions must not become document footers ===')
{
  const result = parseSupplierSheet(xlsxOf([
    ['Description', 'Code', 'Qty', 'Unit price', 'Amount'],
    ['Delivery bag', 'BAG', 2, 100, 200],
    ['Discount stamp', 'STAMP', 1, 30, 30],
    ['VAT calculator', 'CALC', 1, 40, 40],
    ['Rounding tool', 'TOOL', 1, 50, 50],
    ['Total care kit', 'KIT', 1, 60, 60],
    ['Delivery bag spare', 'SPARE', null, null, 20],
    ['Delivery', '', '', '', 10],
    ['Total', '', '', '', 410],
  ]))
  check('footer-like product names parse', result.status === 'ok')
  if (result.status === 'ok') {
    check('retains all six product rows, including an incomplete row', result.lines.length === 6, result.lines.map((line) => line.label).join(' | '))
    check('delivery bag retains its actual quantity and price', result.lines[0].label === 'Delivery bag' && result.lines[0].qty === 2 && result.lines[0].unitPrice === 100)
    check('only the true delivery footer becomes a charge', result.doc.charges?.length === 1 && result.doc.charges[0].amount === 10, JSON.stringify(result.doc.charges))
    check('product names do not invent VAT or discount evidence', result.doc.declaredVat === null && result.doc.discountAmount === null)
  }
}

console.log('\n=== supplier codes and source row numbers survive parsing ===')
{
  const csv = parseSupplierSheet(Buffer.from('Description,Code,Qty,Unit price,Amount\nCable,000123,2,10,20\n'), 'codes.csv')
  check('CSV supplier code keeps leading zeroes', csv.status === 'ok' && csv.lines[0].code === '000123', csv.status === 'ok' ? String(csv.lines[0].code) : csv.message)
  const workbook = XLSX.utils.book_new()
  const sheet: XLSX.WorkSheet = {}
  XLSX.utils.sheet_add_aoa(sheet, [['Description', 'Code', 'Qty', 'Unit price'], ['Cable', 123, 2, 10]], { origin: 'C5' })
  sheet.D6.z = '000000'
  sheet['!ref'] = 'C5:F6'
  XLSX.utils.book_append_sheet(workbook, sheet, 'Invoice')
  const result = parseSupplierSheet(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
  check('formatted Excel code keeps the supplier’s displayed zeroes', result.status === 'ok' && result.lines[0].code === '000123', result.status === 'ok' ? String(result.lines[0].code) : result.message)
  check('source row is the worksheet row, not the extracted array index', result.status === 'ok' && result.lines[0].sourceRow === 'Invoice:6', result.status === 'ok' ? String(result.lines[0].sourceRow) : result.message)
}

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
