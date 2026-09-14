export const PO_STATUSES = [
  'Message Sent',
  'Request Discount',
  'Negotiate Shipping',
  'Ordered',
  'Payment Done',
  'Shipped to Warehouse',
  'Loaded and Shipped',
  'Partially Loaded and Shipped',
  'Received',
] as const

export const DEFAULT_PO_STATUS = PO_STATUSES[0]

export type PurchaseOrderDraft = {
  product_id: string
  supplier_name: string
  link: string
  image_url: string
  status: string
  reorder: string
  order_date: string
  carton: string
  qty: string
  unit_price: string
  discounted_unit_price: string
  shipment_to_warehouse: string
  discounted_shipment_to_warehouse: string
  discounted_percentage: string
  total_payment_supplier_yuan: string
  total_payment_supplier: string
  payment_link: string
  weight_kg: string
  cbm: string
  boxes: string
  cbm_cost: string
  import_cp: string
  total_cp_import: string
  tracking_number: string
}

export const emptyPurchaseOrderDraft = (): PurchaseOrderDraft => ({
  product_id: '',
  supplier_name: '',
  link: '',
  image_url: '',
  status: DEFAULT_PO_STATUS,
  reorder: '',
  order_date: new Date().toISOString().slice(0, 10),
  carton: '',
  qty: '',
  unit_price: '',
  discounted_unit_price: '',
  shipment_to_warehouse: '',
  discounted_shipment_to_warehouse: '',
  discounted_percentage: '',
  total_payment_supplier_yuan: '',
  total_payment_supplier: '',
  payment_link: '',
  weight_kg: '',
  cbm: '',
  boxes: '',
  cbm_cost: '',
  import_cp: '',
  total_cp_import: '',
  tracking_number: '',
})

export type ReorderStatus = 'draft' | 'awaiting_supplier' | 'confirmed' | 'cancelled'
export const REORDER_LABELS: Record<ReorderStatus, string> = {
  draft: 'Draft',
  awaiting_supplier: 'Awaiting supplier',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
}

export interface ImportReference {
  id: string
  product_id: string | null
  product_name: string | null
  supplier_name: string | null
  index_no: string | null
  link: string | null
  image_url: string | null
  status: string | null
  qty: number | null
  unit_price: number | null
  discounted_unit_price: number | null
  shipment_to_warehouse: number | null
  discounted_shipment_to_warehouse: number | null
  discounted_percentage: number | null
  total_payment_supplier_yuan: number | null
  total_payment_supplier: number | null
  weight_kg: number | null
  cbm: number | null
  boxes: number | null
  import_cp: number | null
  order_date?: string | null
  created_at: string
  variant_id?: string | null
  variant_snapshot?: { id: string; attributeName: string; attributeValue: string } | null
  referenceWarning?: string | null
}

export interface ReorderLine {
  id: string
  productId: string | null
  variantId: string | null
  productName: string
  variantLabel: string | null
  imageUrl: string | null
  supplierLabel: string
  listingUrl: string
  sourceImportId: string | null
  sourceSnapshot: ImportReference | null
  refreshSource?: boolean
  sourcing?: { selectionId: string; offerId: string; skuId: string; providerId: string | null; specId: string | null; attributes: { name: string; value: string }[]; unit: string | null; packSize: number | null }
  qty: number | null
  priceCny: number | null
  priceMode: 'net' | 'discount'
  discountPercent: number
  chinaFreight: number | null
  chinaFreightBasis: 'fixed' | 'unit'
  unitsPerCarton: number | null
  kgPerUnit: number | null
  cbmPerUnit: number | null
  unavailable: boolean
  notes: string
}

export interface ReorderTerms {
  fxRate: number | null
  sharedChinaFreight: number | null
  importFreightMode: 'fixed' | 'cbm'
  importFreightMur: number | null
  cbmRateMur: number | null
  otherChargesMur: number | null
  allocationBasis: 'qty' | 'value' | 'cbm'
  landedReviewed: boolean
}

export interface ReorderSnapshot {
  supplierName: string
  notes: string
  orderDate: string | null
  expectedDate: string | null
  terms: ReorderTerms
  lines: ReorderLine[]
}

export interface ImportReorder {
  id: string
  number: string
  status: ReorderStatus
  revision: number
  draft: ReorderSnapshot
  requestedSnapshot: ReorderSnapshot | null
  supplierSnapshot: ReorderSnapshot | null
  confirmedSnapshot: (ReorderSnapshot & { imports: { id: string; index: string; lineId: string }[] }) | null
  approvedAt: string | null
  confirmedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ImportPurchaseEvent {
  id: string
  eventType: string
  createdAt: string
  actorName: string
  reason: string | null
  beforeSnapshot: unknown
  afterSnapshot: unknown
}

export interface SavedReorderItem {
  id: string
  item: ReorderLine
  supplierName: string
  status: 'active' | 'deferred' | 'excluded'
  priority: number
  reviewDate: string | null
  revision: number
  updatedAt: string
}

export interface ReorderSettings {
  id: string
  productId: string | null
  supplierName: string | null
  leadDays: number | null
  coverDays: number | null
  bufferDays: number | null
  dailyUnits: number | null
  quantityMultiple: number | null
  revision: number
}

export const emptyReorderTerms = (): ReorderTerms => ({
  fxRate: null,
  sharedChinaFreight: null,
  importFreightMode: 'fixed',
  importFreightMur: null,
  cbmRateMur: null,
  otherChargesMur: null,
  allocationBasis: 'qty',
  landedReviewed: false,
})
export const emptyReorderSnapshot = (): ReorderSnapshot => ({
  supplierName: '',
  notes: '',
  orderDate: null,
  expectedDate: null,
  terms: emptyReorderTerms(),
  lines: [],
})
export const newReorderLine = (product: { id: string; name: string; imageUrl?: string | null }): ReorderLine => ({
  id: crypto.randomUUID(),
  productId: product.id,
  variantId: null,
  productName: product.name,
  variantLabel: null,
  imageUrl: product.imageUrl ?? null,
  supplierLabel: product.name,
  listingUrl: '',
  sourceImportId: null,
  sourceSnapshot: null,
  qty: null,
  priceCny: null,
  priceMode: 'net',
  discountPercent: 0,
  chinaFreight: null,
  chinaFreightBasis: 'fixed',
  unitsPerCarton: null,
  kgPerUnit: null,
  cbmPerUnit: null,
  unavailable: false,
  notes: '',
})

export const IMPORT_REFERENCE_COLUMNS =
  'id,product_id,product_name,supplier_name,index_no,link,image_url,status,qty,unit_price,discounted_unit_price,shipment_to_warehouse,discounted_shipment_to_warehouse,discounted_percentage,total_payment_supplier_yuan,total_payment_supplier,weight_kg,cbm,boxes,import_cp,order_date,created_at,variant_id,variant_snapshot'
export const importNumber = (value: number | string) => `IR-${String(value).padStart(5, '0')}`
export const purchasingToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Indian/Mauritius',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
export const numericInput = (value: string) => (value.trim() === '' ? null : Number(value))
export const purchaseMoney = (value: number | null | undefined, currency: 'CNY' | 'MUR' = 'MUR') =>
  value == null || !Number.isFinite(value)
    ? 'Not confirmed'
    : `${currency === 'CNY' ? '¥' : 'Rs'} ${value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
