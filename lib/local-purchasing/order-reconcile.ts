import { evidenceRevision, type ReceiptEvidence } from './evidence'
import { reconcileReceipt, type ReceiptCheck, type ReceiptOverrides } from './reconcile'
import { calculateOrder, type LocalOrderLine, type OrderSnapshot } from './order-types'
import { supplierIdentityIssue, supplierIdentityKey, supplierKey } from './supplier-identity'
import { round2 } from './vat'
import { recordedVariantId, variantDescription, type VariantSelection, type VariantSnapshot } from '@/lib/products/pricing'

export interface OrderDifference {
  kind: 'supplier' | 'quantity' | 'price' | 'unit' | 'variant' | 'missing' | 'extra' | 'ambiguous' | 'vat' | 'discount' | 'charges' | 'total' | 'arithmetic'
  message: string
  lineKey?: string
  orderLineId?: string
  expected?: string | number | null
  actual?: string | number | null
  blocking?: boolean
}
export interface OrderAllocation { lineKey: string; orderLineId: string | null; method: 'auto' | 'manual' | 'extra' | 'unresolved' }
export interface OrderComparison {
  revision: string
  orderRevision: number
  allocationRevision: number
  receipt: ReceiptCheck
  allocations: OrderAllocation[]
  differences: OrderDifference[]
  rows: Array<{ orderLineId: string; label: string; unit: string | null; variantSnapshot?: VariantSnapshot | null; ordered: number; previouslyRecorded: number; thisDocument: number; remainingAfter: number }>
  canAccept: boolean
  partial: boolean
}
export function orderReviewRevision(comparisonRevision: string, source: {
  documentId: string; documentRevision: number; reviewRevision: number; reviewEpoch: number
}) {
  return evidenceRevision({ comparisonRevision, documentId: source.documentId, documentRevision: source.documentRevision,
    reviewRevision: source.reviewRevision, reviewEpoch: source.reviewEpoch })
}

export interface OrderReviewInput {
  document: ReceiptEvidence
  overrides: ReceiptOverrides
  decisions: Record<string,string | null>
  products: Record<string, VariantSelection & { productId: string | null; matchMethod: 'auto' | 'confirmed' | 'manual' | 'created' | 'alias' | 'unmatched' }>
}

function autoMatch(line: ReceiptEvidence['lines'][number], lines: LocalOrderLine[], productId: string | null, variantId: string | null): LocalOrderLine[] {
  const narrowVariant = (candidates: LocalOrderLine[]) => {
    const exactVariant = variantId ? candidates.filter((item) => recordedVariantId(item) === variantId) : []
    return exactVariant.length ? exactVariant : candidates
  }
  const identity = { supplierLabel:line.label, supplierCode:line.code, unit:line.unit }
  const exact = lines.filter((item)=>supplierIdentityKey(item)===supplierIdentityKey(identity))
  if (exact.length) return narrowVariant(exact)
  const sameUnit = (item:LocalOrderLine)=>supplierKey(item.unit)===supplierKey(line.unit)
  const byProduct = productId ? lines.filter((item)=>item.productId===productId && sameUnit(item) && (!line.code || supplierKey(item.supplierCode)===supplierKey(line.code))) : []
  if (byProduct.length) return narrowVariant(byProduct)
  const code = supplierKey(line.code)
  const byCode = code ? lines.filter((item)=>supplierKey(item.supplierCode)===code) : []
  if (byCode.length===1 && sameUnit(byCode[0])) {
    const words = (value:string)=>supplierKey(value).split(/\W+/).filter((word)=>word.length>=3 && !/\d/.test(word))
    const a=words(line.label), b=words(byCode[0].supplierLabel)
    if (a.some((word)=>b.includes(word))) return byCode
  }
  return []
}

export function compareOrderDocument(snapshot: OrderSnapshot, input: OrderReviewInput, received: Record<string,number>, allocationRevision: number, reclaimable: boolean): OrderComparison {
  const receipt = reconcileReceipt(input.document,input.overrides,reclaimable)
  const expected = calculateOrder(snapshot.lines,snapshot.terms,snapshot.supplier)
  const expectedAmounts = new Map(expected.lines.map((line)=>[line.key,line]))
  const actualAmounts = new Map(receipt.lines.map((line)=>[line.key,line]))
  const differences: OrderDifference[]=[]
  const allocations: OrderAllocation[]=[]
  const supplierIssue=supplierIdentityIssue(input.document,snapshot.supplier)
  if(supplierIssue) differences.push({kind:'supplier',message:supplierIssue,expected:snapshot.supplier.name,actual:input.document.supplierName})
  for(const line of input.document.lines){
    const key=line.key!
    const explicit=Object.prototype.hasOwnProperty.call(input.decisions,key)
    const decision=input.decisions[key]
    const productId=input.products[key]?.productId??null
    const variantId=input.products[key]?.variantId??null
    const candidates=explicit? snapshot.lines.filter((item)=>item.id===decision) : autoMatch(line,snapshot.lines,productId,variantId)
    if(explicit && decision===null){
      allocations.push({lineKey:key,orderLineId:null,method:'extra'})
      differences.push({kind:'extra',lineKey:key,message:`“${line.label}” is an extra item, not allocated to an ordered quantity.`,actual:line.qty})
      continue
    }
    if(candidates.length!==1){
      allocations.push({lineKey:key,orderLineId:null,method:'unresolved'})
      differences.push({kind:'ambiguous',lineKey:key,message:candidates.length>1?`“${line.label}” could belong to several order lines. Choose its allocation.`:`Choose the ordered item for “${line.label}”, or explicitly mark it as an extra.`,blocking:true})
      continue
    }
    const item=candidates[0]
    const variantMismatch=recordedVariantId(item)!==variantId
    const identityMismatch=variantMismatch || Boolean(item.productId && productId!==item.productId) || supplierKey(item.unit)!==supplierKey(line.unit)
    allocations.push({lineKey:key,orderLineId:item.id,method:identityMismatch?'unresolved':explicit?'manual':'auto'})
    if(variantMismatch) differences.push({kind:'variant',lineKey:key,orderLineId:item.id,message:'The selected variant does not match the ordered item. Correct the variant, revise the order, or explicitly record it as an extra; it cannot fulfil this ordered quantity.',expected:variantDescription(item.variantSnapshot),actual:variantId?'Different selected variant':'Variant not specified',blocking:true})
    if(supplierKey(item.unit)!==supplierKey(line.unit)) differences.push({kind:'unit',lineKey:key,orderLineId:item.id,message:'Purchasing units differ or are missing. Correct the unit; packs are never silently converted to pieces.',expected:item.unit,actual:line.unit,blocking:true})
    if(item.productId && productId!==item.productId) differences.push({kind:'ambiguous',lineKey:key,orderLineId:item.id,message:productId ? 'The chosen Inventory product disagrees with the allocated order item.' : 'Link this row to the Inventory product on the allocated order item, or revise the order.',blocking:true})
    const wanted=expectedAmounts.get(item.id), actual=actualAmounts.get(key)
    if(wanted && actual){
      if(Math.abs(wanted.unitAmounts.unitPriceNet-actual.unitAmounts.unitPriceNet)>0.00011 ||
        Math.abs(wanted.unitAmounts.unitVat.gross-actual.unitAmounts.unitVat.gross)>0.001) differences.push({kind:'price',lineKey:key,orderLineId:item.id,message:`Unit price changed for “${line.label}” (like-for-like payable; accounting net is checked too).`,expected:wanted.unitAmounts.unitVat.gross,actual:actual.unitAmounts.unitVat.gross})
      if(wanted.unitAmounts.vatPercent!==actual.unitAmounts.vatPercent || wanted.unitAmounts.pricesIncludeVat!==actual.unitAmounts.pricesIncludeVat) differences.push({kind:'vat',lineKey:key,orderLineId:item.id,message:'VAT rate or price basis differs from the order.',expected:`${wanted.unitAmounts.vatPercent}% ${wanted.unitAmounts.pricesIncludeVat?'included':'added'}`,actual:`${actual.unitAmounts.vatPercent}% ${actual.unitAmounts.pricesIncludeVat?'included':'added'}`})
      const printedDiscount=line.discountPercent??input.document.discountPercent??0
      if(item.discountPercent!==printedDiscount || wanted.unitAmounts.discountPercent!==actual.unitAmounts.discountPercent) differences.push({kind:'discount',lineKey:key,orderLineId:item.id,message:'Printed discount terms differ. Comparison prices use only the discount still applicable.',expected:item.discountPercent,actual:printedDiscount})
    }
  }
  const rows=snapshot.lines.map((item)=>{
    const keys=new Set(allocations.filter((a)=>a.orderLineId===item.id && a.method!=='unresolved').map((a)=>a.lineKey))
    const quantity=input.document.lines.filter((line)=>keys.has(line.key!)).reduce((total,line)=>total+(line.qty??0),0)
    const previous=received[item.id]??0
    const remainingBefore=Math.max(0,item.qty-previous)
    if(!keys.size && remainingBefore>0) differences.push({kind:'missing',orderLineId:item.id,message:`“${item.supplierLabel}” is not in this document. Its outstanding quantity stays open.`,expected:remainingBefore,actual:0})
    else if(quantity!==remainingBefore) differences.push({kind:'quantity',orderLineId:item.id,message:quantity>remainingBefore?'This document exceeds the outstanding order quantity.':'This is a partial quantity; the remainder stays open.',expected:remainingBefore,actual:quantity})
    return {orderLineId:item.id,label:item.supplierLabel,unit:item.unit,variantSnapshot:item.variantSnapshot??null,ordered:item.qty,previouslyRecorded:previous,thisDocument:quantity,remainingAfter:Math.max(0,item.qty-previous-quantity)}
  })
  if(receipt.totals && expected.totals){
    if(receipt.totals.chargesPayable!==expected.totals.chargesPayable) differences.push({kind:'charges',message:'Delivery or other charges changed.',expected:expected.totals.chargesPayable,actual:receipt.totals.chargesPayable})
    if(receipt.totals.payable!==expected.totals.payable) differences.push({kind:'total',message:'This document total differs from the full issued order (including partial quantities).',expected:expected.totals.payable,actual:receipt.totals.payable})
  }
  if(receipt.status!=='verified') differences.push({kind:'arithmetic',message:'The returned document is not arithmetically verified. Review its separate receipt checks.',blocking:!receipt.canRecord})
  return {revision:evidenceRevision({snapshot,input,received,allocationRevision,receiptRevision:receipt.inputRevision}),orderRevision:snapshot.revision,
    allocationRevision,receipt,allocations,differences,rows,canAccept:receipt.canRecord&&!differences.some((d)=>d.blocking),partial:rows.some((row)=>row.remainingAfter>0)}
}
