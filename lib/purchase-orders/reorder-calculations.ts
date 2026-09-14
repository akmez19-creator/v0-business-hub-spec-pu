import type { ReorderLine, ReorderSnapshot } from './workflow'

export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const known = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value) && value >= 0
const total = (values: (number | null)[]) =>
  values.length && values.every(known) ? roundMoney((values as number[]).reduce((sum, value) => sum + value, 0)) : null

export function allocateMoney(amount: number | null, weights: (number | null)[]): (number | null)[] {
  if (!known(amount) || weights.some((weight) => !known(weight)) || !weights.length) return weights.map(() => null)
  if (amount === 0) return weights.map(() => 0)
  const sum = (weights as number[]).reduce((a, b) => a + b, 0)
  if (sum <= 0) return weights.map(() => null)
  const cents = Math.round(amount * 100)
  const shares = (weights as number[]).map((weight, index) => ({
    index,
    exact: (cents * weight) / sum,
    cents: Math.floor((cents * weight) / sum),
  }))
  let remainder = cents - shares.reduce((n, share) => n + share.cents, 0)
  for (const share of [...shares].sort((a, b) => b.exact - b.cents - (a.exact - a.cents) || a.index - b.index)) {
    if (remainder-- > 0) share.cents++
  }
  return shares.map((share) => share.cents / 100)
}

export function calculateImportLine(line: ReorderLine) {
  const qty = known(line.qty) && Number.isInteger(line.qty) && line.qty > 0 ? line.qty : null
  const unitPrice =
    known(line.priceCny) && known(line.discountPercent) && line.discountPercent <= 100
      ? line.priceCny * (line.priceMode === 'discount' ? 1 - line.discountPercent / 100 : 1)
      : null
  const goods = qty != null && unitPrice != null ? roundMoney(qty * unitPrice) : null
  const chinaFreight =
    known(line.chinaFreight) && (line.chinaFreightBasis === 'fixed' || qty != null)
      ? roundMoney(line.chinaFreight * (line.chinaFreightBasis === 'unit' ? qty! : 1))
      : null
  const cbm = qty != null && known(line.cbmPerUnit) ? Math.round(qty * line.cbmPerUnit * 1e6) / 1e6 : null
  const weight = qty != null && known(line.kgPerUnit) ? Math.round(qty * line.kgPerUnit * 1e4) / 1e4 : null
  const cartons =
    qty != null && known(line.unitsPerCarton) && line.unitsPerCarton > 0 ? Math.ceil(qty / line.unitsPerCarton) : null
  return { id: line.id, qty, unitPrice, goods, chinaFreight, cbm, weight, cartons }
}

export function calculateReorder(snapshot: ReorderSnapshot) {
  const active = snapshot.lines.filter((line) => !line.unavailable)
  const base = active.map(calculateImportLine)
  const terms = snapshot.terms
  const weights = base.map((line) =>
    terms.allocationBasis === 'value' ? line.goods : terms.allocationBasis === 'cbm' ? line.cbm : line.qty,
  )
  const chinaShares = allocateMoney(terms.sharedChinaFreight, weights)
  const supplier = base.map((line, index) => total([line.goods, line.chinaFreight, chinaShares[index]]))
  const supplierCny = total(supplier)
  const supplierMur =
    supplierCny != null && known(terms.fxRate) && terms.fxRate > 0 ? roundMoney(supplierCny * terms.fxRate) : null
  const supplierMurShares = allocateMoney(supplierMur, supplier)
  const totalCbm =
    base.length && base.every((line) => line.cbm != null) ? base.reduce((sum, line) => sum + line.cbm!, 0) : null
  const freight =
    terms.importFreightMode === 'cbm'
      ? totalCbm != null && known(terms.cbmRateMur)
        ? roundMoney(totalCbm * terms.cbmRateMur)
        : null
      : known(terms.importFreightMur)
        ? roundMoney(terms.importFreightMur)
        : null
  const importShares = allocateMoney(freight, weights)
  const otherShares = allocateMoney(terms.otherChargesMur, weights)
  const lines = base.map((line, index) => {
    const landed = total([supplierMurShares[index], importShares[index], otherShares[index]])
    return {
      ...line,
      sharedChinaFreight: chinaShares[index],
      supplierCny: supplier[index],
      supplierMur: supplierMurShares[index],
      importFreight: importShares[index],
      otherCharges: otherShares[index],
      landed,
      landedPerUnit: landed != null && line.qty ? landed / line.qty : null,
    }
  })
  const missing: string[] = []
  if (!active.length) missing.push('At least one available product')
  if (base.some((line) => line.qty == null)) missing.push('Positive whole-unit quantities')
  if (base.some((line) => line.goods == null)) missing.push('Supplier unit prices')
  if (base.some((line) => line.chinaFreight == null)) missing.push('Line freight within China (enter 0 if none)')
  if (!known(terms.sharedChinaFreight)) missing.push('Shared China freight (enter 0 if none)')
  if (!known(terms.fxRate) || terms.fxRate <= 0) missing.push('MUR per CNY exchange rate')
  if (freight == null) missing.push(terms.importFreightMode === 'cbm' ? 'CBM and freight rate' : 'Import freight')
  if (!known(terms.otherChargesMur)) missing.push('Other import charges (enter 0 if none)')
  if (
    weights.some((weight) => weight == null) ||
    (weights.every((weight) => weight === 0) &&
      (terms.sharedChinaFreight ?? 0) + (freight ?? 0) + (terms.otherChargesMur ?? 0) > 0)
  )
    missing.push('Shared-charge allocation inputs')
  const landed = total(lines.map((line) => line.landed))
  return {
    lines,
    supplierCny,
    supplierMur,
    freight,
    landed,
    totalCbm,
    missing: [...new Set(missing)],
    complete: landed != null && missing.length === 0,
    goodsCny: total(base.map((line) => line.goods)),
    knownGoodsCny: roundMoney(base.reduce((sum, line) => sum + (line.goods ?? 0), 0)),
    units: base.reduce((sum, line) => sum + (line.qty ?? 0), 0),
  }
}

export function legacyConfirmedAmounts(snapshot: ReorderSnapshot) {
  const calculation = calculateReorder(snapshot)
  return calculation.lines.map((cost) => {
    const line = snapshot.lines.find((item) => item.id === cost.id)!
    const finalLanded = snapshot.terms.landedReviewed && calculation.complete
    return {
      line_id: line.id,
      product_id: line.productId,
      variant_id: line.variantId,
      qty: cost.qty,
      product_name: line.supplierLabel || line.productName,
      link: line.listingUrl || null,
      image_url: line.imageUrl,
      unit_price: line.priceCny,
      discounted_unit_price: cost.unitPrice,
      discounted_percentage: line.priceMode === 'discount' ? -line.discountPercent : null,
      shipment_to_warehouse: total([cost.chinaFreight, cost.sharedChinaFreight]),
      discounted_shipment_to_warehouse: null,
      total_payment_supplier_yuan: cost.supplierCny,
      total_payment_supplier: cost.supplierMur,
      weight_kg: cost.weight,
      cbm: cost.cbm,
      boxes: cost.cartons,
      carton: line.unitsPerCarton ? `${line.unitsPerCarton} units/carton` : null,
      cbm_cost: finalLanded ? cost.importFreight : null,
      import_cp: finalLanded ? cost.landedPerUnit : null,
      total_cp_import: finalLanded ? cost.landed : null,
      reorder: line.sourceSnapshot?.index_no || null,
    }
  })
}
