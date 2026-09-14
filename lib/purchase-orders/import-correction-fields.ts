export const IMPORT_CORRECTION_FIELDS = [
  { key: 'product_name', label: 'Supplier product wording', kind: 'text', group: 'details' },
  { key: 'supplier_name', label: 'China supplier name', kind: 'text', group: 'details' },
  { key: 'link', label: 'Supplier listing URL', kind: 'url', group: 'details' },
  { key: 'order_date', label: 'Actual order date', kind: 'date', group: 'details' },
  { key: 'expected_arrival_date', label: 'Expected arrival date', kind: 'date', group: 'details' },
  { key: 'qty', label: 'Quantity · physical units', kind: 'number', group: 'details' },
  { key: 'status', label: 'Import status', kind: 'status', group: 'details' },
  { key: 'unit_price', label: 'Unit price · CNY', kind: 'number', group: 'pricing' },
  { key: 'discounted_unit_price', label: 'Discounted unit price · CNY', kind: 'number', group: 'pricing' },
  { key: 'shipment_to_warehouse', label: 'China freight · CNY', kind: 'number', group: 'pricing' },
  {
    key: 'discounted_shipment_to_warehouse',
    label: 'Discounted China freight · CNY',
    kind: 'number',
    group: 'pricing',
  },
  { key: 'discounted_percentage', label: 'Historical signed discount · %', kind: 'number', group: 'pricing' },
  { key: 'total_payment_supplier_yuan', label: 'Total supplier payable · CNY', kind: 'number', group: 'pricing' },
  { key: 'total_payment_supplier', label: 'Total supplier payable · MUR', kind: 'number', group: 'pricing' },
  { key: 'import_cp', label: 'Landed cost per unit · MUR', kind: 'number', group: 'pricing' },
  { key: 'total_cp_import', label: 'Total landed cost · MUR', kind: 'number', group: 'pricing' },
  { key: 'cbm_cost', label: 'Recorded CBM cost · MUR', kind: 'number', group: 'pricing' },
  { key: 'carton', label: 'Carton description', kind: 'text', group: 'logistics' },
  { key: 'weight_kg', label: 'Total weight · kg', kind: 'number', group: 'logistics' },
  { key: 'cbm', label: 'Total volume · CBM', kind: 'number', group: 'logistics' },
  { key: 'boxes', label: 'Number of boxes', kind: 'number', group: 'logistics' },
  { key: 'tracking_number', label: 'Tracking number', kind: 'text', group: 'logistics' },
  { key: 'payment_link', label: 'Payment reference URL', kind: 'url', group: 'logistics' },
  { key: 'image_url', label: 'Listing image URL', kind: 'url', group: 'logistics' },
  { key: 'reorder', label: 'Legacy reorder reference', kind: 'text', group: 'logistics' },
] as const
export type ImportRecord = Record<string, unknown> & {
  id: string
  index_no: string | null
  product_id: string | null
  variant_id: string | null
  product_name: string | null
  supplier_name: string | null
}
export function importCorrectionPatch(before: ImportRecord, after: ImportRecord) {
  const keys = [...IMPORT_CORRECTION_FIELDS.map((field) => field.key), 'product_id', 'variant_id']
  return Object.fromEntries(
    keys
      .filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
      .map((key) => [key, after[key] ?? null]),
  )
}
export function correctionImpact(before: ImportRecord, after: ImportRecord) {
  const patch = importCorrectionPatch(before, after),
    warnings: string[] = []
  if (['product_id', 'variant_id', 'status', 'qty'].some((key) => key in patch))
    warnings.push(
      'Quantity, product or status corrections may change Initial / In China summaries. No physical stock adjustment will be posted.',
    )
  if (IMPORT_CORRECTION_FIELDS.some((field) => field.group === 'pricing' && field.key in patch))
    warnings.push(
      'These are actual historical figures. Changing costs can change Inventory valuation and Local Purchasing reference comparisons. Unknown or estimated landed costs should stay blank.',
    )
  if (['qty', 'import_cp', 'total_cp_import'].some((key) => key in patch)) {
    const qty = Number(after.qty),
      cost = Number(after.import_cp),
      total = Number(after.total_cp_import)
    if (qty > 0 && cost > 0 && total > 0 && Math.abs(qty * cost - total) > qty * 0.005 + 0.02)
      warnings.push(
        'Landed unit cost × quantity does not reconcile with total landed cost. Correct both figures if needed, or explicitly explain the discrepancy in your reason.',
      )
  }
  if (
    ['qty', 'unit_price', 'discounted_unit_price', 'shipment_to_warehouse', 'discounted_shipment_to_warehouse'].some(
      (key) => key in patch,
    )
  )
    warnings.push(
      'Existing supplier totals are preserved unless you edit them. Review their arithmetic against the original supplier document; discounts are not applied automatically.',
    )
  return warnings
}
