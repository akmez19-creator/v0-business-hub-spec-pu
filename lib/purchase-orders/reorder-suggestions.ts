import type { ImportReference, ReorderSettings } from './workflow'

export interface PlanningStock {
  id: string
  name: string
  quantity: number | null
  sold_out: boolean
  last_counted_at: string | null
  zone: string | null
  is_active: boolean | null
}
export interface StockGuidance {
  productId: string
  stock: number | null
  stockLabel: string
  warnings: string[]
  suggestedQty: number | null
  baselineQty: number | null
  dailyUnits: number | null
  alreadyOrdered: number
  leadDays: number | null
  coverDays: number | null
  bufferDays: number | null
}

export function suggestedQuantity(
  dailyUnits: number | null,
  stock: number | null,
  lead: number | null,
  cover: number | null,
  buffer: number | null,
  multiple: number | null = null,
) {
  if ([dailyUnits, stock, lead, cover, buffer].some((value) => value == null || !Number.isFinite(value) || value < 0))
    return { baseline: null, rounded: null }
  const baseline = Math.max(0, Math.ceil(dailyUnits! * (lead! + cover! + buffer!) - stock!))
  const rounded =
    multiple != null && Number.isInteger(multiple) && multiple > 0
      ? Math.ceil(baseline / multiple) * multiple
      : baseline
  return { baseline, rounded }
}

export function stockGuidance(
  product: PlanningStock,
  settings: ReorderSettings[],
  history: ImportReference[],
  now = new Date(),
): StockGuidance {
  const global = settings.find((row) => !row.productId && !row.supplierName)
  const productSettings = settings.find((row) => row.productId === product.id)
  const productHistory = history.filter((row) => row.product_id === product.id)
  const supplierNames = [...new Set(productHistory.map((row) => row.supplier_name).filter(Boolean))]
  const supplierSettings =
    supplierNames.length === 1 ? settings.find((row) => row.supplierName === supplierNames[0]) : undefined
  const leadDays = productSettings?.leadDays ?? supplierSettings?.leadDays ?? global?.leadDays ?? null
  const coverDays = productSettings?.coverDays ?? supplierSettings?.coverDays ?? global?.coverDays ?? null
  const bufferDays = productSettings?.bufferDays ?? supplierSettings?.bufferDays ?? global?.bufferDays ?? null
  const dailyUnits = productSettings?.dailyUnits ?? null
  const recorded = product.quantity == null ? null : Number(product.quantity)
  const stock =
    recorded != null && (recorded > 0 || product.sold_out || product.last_counted_at) ? Math.max(0, recorded) : null
  const warnings: string[] = []
  if (stock == null) warnings.push('No confirmed stock count. Zero has not been assumed.')
  else if (!product.last_counted_at) warnings.push('Recorded quantity has no count date. Verify on the shelf.')
  else if (now.getTime() - Date.parse(product.last_counted_at) > 30 * 86400000)
    warnings.push('Stock count is over 30 days old.')
  if (product.sold_out && (recorded ?? 0) > 0) warnings.push('Sold-out flag conflicts with the recorded quantity.')
  if (stock && !product.zone) warnings.push('No warehouse zone is recorded.')
  if (dailyUnits == null)
    warnings.push('Set your own daily planning rate for a quantity suggestion. Customer deliveries are not read.')
  if ([leadDays, coverDays, bufferDays].some((value) => value == null))
    warnings.push('Lead time, coverage and buffer assumptions are not all set.')
  const incomingStatuses = [
    'ordered',
    'payment done',
    'shipped to warehouse',
    'loaded and shipped',
    'partially loaded and shipped',
  ]
  const alreadyOrdered = productHistory
    .filter((row) => incomingStatuses.includes(row.status?.toLowerCase() ?? ''))
    .reduce((sum, row) => sum + (Number(row.qty) || 0), 0)
  if (alreadyOrdered)
    warnings.push(
      `${alreadyOrdered.toLocaleString()} units appear in open imports. Check these before buying again; they are not deducted automatically.`,
    )
  const quantities = suggestedQuantity(
    dailyUnits,
    stock,
    leadDays,
    coverDays,
    bufferDays,
    productSettings?.quantityMultiple,
  )
  return {
    productId: product.id,
    stock,
    stockLabel: product.last_counted_at
      ? `Counted ${product.last_counted_at.slice(0, 10)}`
      : 'Recorded stock, unverified date',
    warnings,
    suggestedQty: product.sold_out && (recorded ?? 0) > 0 ? null : quantities.rounded,
    baselineQty: quantities.baseline,
    dailyUnits,
    alreadyOrdered,
    leadDays,
    coverDays,
    bufferDays,
  }
}
