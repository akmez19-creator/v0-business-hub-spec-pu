import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { normaliseEvidence, evidenceRevision } from '../lib/local-purchasing/evidence'
import { reconcileReceipt } from '../lib/local-purchasing/reconcile'
import { parseSupplierSheet } from '../lib/local-purchasing/parse-sheet'

let checks = 0
const check = (name: string, run: () => void) => { run(); checks++; console.log(`PASS ${name}`) }
const amounts = [20,88,88,80,76,80,76,84,70,64,58,16,160,312,68,84,292,360,400,480,264,412,380,88,96,156,312,180,200,128,168,168,76,96,88,144,72,28]
const real = normaliseEvidence({ docRef: 'QN2613501', docKind: 'quote', supplierName: 'Li Ah Choon & Co.Ltd', vatNumber: 'VAT20036275',
  docDate: '2026-08-31', pricesIncludeVat: true, discountPercent: 20, declaredSubtotal: 5227.83, declaredVat: 784.17, declaredTotal: 6012,
  lines: amounts.map((price, i) => ({ label: i === 25 ? 'Chopper DT5044-MLY-805' : `QN2613501 printed row ${i + 1}`, code: null, qty: 1, unitPrice: price, lineTotal: price })) })
const r = reconcileReceipt(real, {}, true)
check('All 38 printed rows verify to Rs 6,012', () => { assert.equal(r.status, 'verified', JSON.stringify(r.issues)); assert.equal(r.lines.length, 38); assert.equal(r.totals?.payable, 6012) })
check('Printed document accounting totals and two-cent allocation survive', () => { assert.equal(r.totals?.net, 5227.83); assert.equal(r.totals?.vat, 784.17); assert.deepEqual(r.roundingAllocation, { net: 0.02, vat: -0.02, payable: 0 }) })
check('Chopper is 156 payable, 135.6522 net, no second discount', () => { const c = r.lines[25].unitAmounts; assert.equal(c.unitVat.gross, 156); assert.equal(c.unitPriceNet, 135.6522); assert.equal(c.discountPercent, 0); assert.equal(r.resolved?.additionalDiscountPercent, 0) })
const one = (price: number, total: number | null, extra: object = {}) => normaliseEvidence({ pricesIncludeVat: true, vatPercent: 15,
  declaredTotal: total, lines: [{ label: 'Product', code: null, qty: 1, unitPrice: price, lineTotal: null }], ...extra })
check('Rs 69,958 inclusive regression stays payable 69,958', () => { const c = reconcileReceipt(one(69958,69958)); assert.equal(c.status,'verified'); assert.equal(c.totals?.net,60833.04); assert.equal(c.totals?.vat,9124.96) })
check('210 exclusive less 20% = 168 net / 193.20 payable', () => { const c = reconcileReceipt(one(210,193.2,{pricesIncludeVat:false,discountPercent:20})); assert.equal(c.status,'verified'); assert.equal(c.lines[0].unitAmounts.unitPriceNet,168); assert.equal(c.totals?.payable,193.2) })
check('156 is deducted only when the evidence requires 124.80', () => { const c = reconcileReceipt(one(156,124.8,{discountPercent:20})); assert.equal(c.status,'verified'); assert.equal(c.resolved?.discountTreatment,'apply'); assert.equal(c.totals?.payable,124.8) })
check('Offsetting row errors never hide behind the matching grand total', () => { const doc = normaliseEvidence({ ...real, lines: real.lines.map((l,i) => ({...l,lineTotal:i===0 ? 21 : i===1 ? 87 : l.lineTotal})) }); const c = reconcileReceipt(doc); assert.notEqual(c.status,'verified'); assert.equal(c.issues.filter((i)=>i.code==='line_multiplication').length,2) })
check('Missing row fails completeness', () => assert.notEqual(reconcileReceipt({...real,lines:real.lines.slice(1)}).status,'verified'))
check('Missing quantity is essential, never guessed as one', () => { const c=reconcileReceipt({...real,lines:real.lines.map((l,i)=>i===0?{...l,qty:null}:l)}); assert.equal(c.canRecord,false) })
check('Line-total-only after discount is not discounted twice', () => { const c=reconcileReceipt(one(0,156,{discountPercent:20,lines:[{label:'Chopper',code:null,qty:2,unitPrice:null,lineTotal:156,lineTotalStage:'after_discount'}]})); assert.equal(c.status,'verified'); assert.equal(c.lines[0].unitAmounts.unitVat.gross,78) })
check('No printed total never verifies', () => { const c=reconcileReceipt(one(156,null)); assert.equal(c.status,'not_checkable'); assert.equal(c.canRecord,true) })
check('Contradictory VAT cue is review, not an arithmetic override', () => assert.notEqual(reconcileReceipt(one(156,156,{pricesIncludeVat:false})).status,'verified'))
check('One cent is a discrepancy, not a percentage tolerance', () => assert.notEqual(reconcileReceipt(one(69958,69958.01)).status,'verified'))
check('Explicit zero tax is supported', () => { const c=reconcileReceipt(one(100,100,{vatPercent:0,declaredVat:0})); assert.equal(c.status,'verified'); assert.equal(c.totals?.vat,0) })
check('Fixed discount amount is never made into a made-up percentage', () => { const c=reconcileReceipt(one(100,90,{discountAmount:10})); assert.equal(c.status,'verified'); assert.equal(c.lines[0].unitAmounts.discountPercent,0); assert.equal(c.totals?.payable,90) })
check('Printed charges and signed rounding are accounted separately', () => { const c=reconcileReceipt(one(100,111,{vatPercent:0,charges:[{label:'Delivery',amount:10,vatPercent:0,pricesIncludeVat:false}],roundingAmount:1})); assert.equal(c.status,'verified'); assert.equal(c.totals?.chargesPayable,10); assert.equal(c.totals?.rounding,1) })
check('Line-specific VAT override does not inherit 15%', () => { const c=reconcileReceipt(one(100,100,{lines:[{label:'Exempt',code:null,qty:1,unitPrice:100,lineTotal:100,vatPercent:0}]})); assert.equal(c.status,'verified'); assert.equal(c.totals?.vat,0) })
check('Edit revisions include source totals and supplier identity', () => { assert.notEqual(evidenceRevision(real),evidenceRevision({...real,declaredVat:783})); assert.notEqual(evidenceRevision(real),evidenceRevision({...real,supplierName:'Another'})) })
const parse = (rows: unknown[][]) => { const w=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(w,XLSX.utils.aoa_to_sheet(rows),'Receipt'); return parseSupplierSheet(XLSX.write(w,{type:'buffer',bookType:'xlsx'}),'receipt.xlsx') }
check('Amount column remains line amount, with original row and footer', () => { const c=parse([['Description','Qty','Amount'],['Chopper',2,156],['Total','',156]]); assert.equal(c.status,'ok'); if(c.status==='ok'){assert.equal(c.lines[0].unitPrice,null);assert.equal(c.lines[0].lineTotal,156);assert.equal(c.doc.declaredTotal,156);assert.equal(c.lines[0].sourceRow,'Receipt:2')} })
check('Incomplete sheet rows are retained', () => { const c=parse([['Description','Qty','Unit price'],['Good',1,10],['Unreadable',2,null]]); assert.equal(c.status,'ok'); if(c.status==='ok') assert.equal(c.lines.length,2) })
check('Ambiguous price column is flagged, not silently verified', () => { const c=parse([['Description','Qty','Price'],['Product',1,10]]); assert.equal(c.status,'ok'); if(c.status==='ok') assert.ok(c.doc.issues?.some((i)=>i.includes('per unit'))) })
console.log(`\n${checks} receipt reconciliation checks passed.`)
