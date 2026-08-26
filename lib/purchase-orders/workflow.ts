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
  product_id: '', supplier_name: '', link: '', image_url: '', status: DEFAULT_PO_STATUS,
  reorder: '', order_date: new Date().toISOString().slice(0, 10), carton: '', qty: '',
  unit_price: '', discounted_unit_price: '', shipment_to_warehouse: '',
  discounted_shipment_to_warehouse: '', discounted_percentage: '',
  total_payment_supplier_yuan: '', total_payment_supplier: '', payment_link: '',
  weight_kg: '', cbm: '', boxes: '', cbm_cost: '', import_cp: '', total_cp_import: '',
  tracking_number: '',
})
