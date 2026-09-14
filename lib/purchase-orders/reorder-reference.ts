import { chooseChinaReference } from '@/lib/local-purchasing/vat'
import type { ImportReference, ReorderLine } from './workflow'

export function reviewImportReferences(rows: ImportReference[]): ImportReference[] {
  const groups = new Map<string, ImportReference[]>()
  for (const row of rows) {
    if (!row.product_id) continue
    const key = `${row.product_id}:${row.variant_id || ''}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  const suspectIds = new Set<string>()
  for (const group of groups.values()) {
    const costs = chooseChinaReference(
      group.map((row) => ({
        landedUnitCost: Number(row.import_cp) || 0,
        importedAt: row.order_date ?? row.created_at,
        qty: row.qty,
        supplierName: row.supplier_name,
        label: row.product_name,
      })),
      group.length,
    )
    for (const row of group)
      if (costs.suspectRows?.some((suspect) => suspect.landedUnitCost === Number(row.import_cp))) suspectIds.add(row.id)
  }
  return rows.map((row) => ({
    ...row,
    referenceWarning: suspectIds.has(row.id)
      ? 'Unusual historical cost: more than 4× from this product’s median. Check the original product link before using it.'
      : null,
  }))
}

// A reference is an ESTIMATE when it does not describe this exact product+variant:
// a different product entirely, or the same product's other variant. The cost
// columns are still copied (so the buyer sees real figures to adjust), but they
// must be verified before they become the actual landed cost.
export function referenceIsEstimate(line: ReorderLine): boolean {
  const source = line.sourceSnapshot
  return Boolean(source && (source.product_id !== line.productId || (source.variant_id || null) !== (line.variantId || null)))
}

export function copyImportReference(line: ReorderLine, reference: ImportReference): ReorderLine {
  const sameProduct = line.productId === reference.product_id
  const sameVariant = sameProduct && (line.variantId || null) === (reference.variant_id || null)
  const qty = Number(reference.qty) || 0
  const positive = (value: number | null | undefined) => (Number(value) > 0 ? Number(value) : null)
  // Copy the cost columns when this is the exact product+variant (authoritative
  // own history) OR a DIFFERENT product (a cross-product estimate the buyer will
  // verify - the whole point of referencing a comparable buy). The one case still
  // refused is the SAME product's OTHER variant: parent history must never
  // fabricate a variant's price or packaging.
  const copyFigures = sameVariant || !sameProduct
  return {
    ...line,
    // Only borrow the wording and listing link from the SAME product. A different
    // product's name/URL would mislabel this line, so keep the line's own.
    supplierLabel: sameProduct ? reference.product_name || line.productName : line.supplierLabel || line.productName,
    listingUrl: sameProduct ? safeImportLink(reference.link) : line.listingUrl,
    sourceImportId: reference.id,
    sourceSnapshot: reference,
    refreshSource: true,
    // Suspect (>4× median) costs are never seeded automatically; everything else
    // is copied as an estimate the buyer confirms.
    priceCny:
      copyFigures && !reference.referenceWarning
        ? (positive(reference.discounted_unit_price) ?? positive(reference.unit_price))
        : null,
    priceMode: 'net',
    discountPercent: 0,
    chinaFreight: copyFigures
      ? (positive(reference.discounted_shipment_to_warehouse) ?? positive(reference.shipment_to_warehouse))
      : null,
    chinaFreightBasis: 'fixed',
    unitsPerCarton: null,
    kgPerUnit: copyFigures && qty && positive(reference.weight_kg) ? Number(reference.weight_kg) / qty : null,
    cbmPerUnit: copyFigures && qty && positive(reference.cbm) ? Number(reference.cbm) / qty : null,
  }
}

export function clearSupplierReference(line: ReorderLine): ReorderLine {
  return {
    ...line,
    sourceImportId: null,
    sourceSnapshot: null,
    refreshSource: false,
    listingUrl: '',
    supplierLabel: line.productName,
    priceCny: null,
    priceMode: 'net',
    discountPercent: 0,
    chinaFreight: null,
    chinaFreightBasis: 'fixed',
    unitsPerCarton: null,
    kgPerUnit: null,
    cbmPerUnit: null,
  }
}

export function safeImportLink(value: string | null | undefined): string {
  if (!value) return ''
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''
  } catch {
    return ''
  }
}
