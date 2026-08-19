export type UserRole = 'admin' | 'manager' | 'marketing_agent' | 'marketing_back_office' | 'marketing_front_office' | 'contractor' | 'rider' | 'storekeeper'

export type DeliveryStatus = 'pending' | 'assigned' | 'picked_up' | 'delivered' | 'nwd' | 'cms'

export type SalesType = 'sale' | 'exchange' | 'trade_in' | 'refund' | 'drop_off'

export interface Profile {
  id: string
  email: string
  name: string | null
  role: UserRole
  approved: boolean
  email_verified: boolean
  contractor_id: string | null
  rider_id: string | null
  phone: string | null
  created_at: string
  updated_at: string
  last_login: string | null
  password_plain: string | null
}

export interface Delivery {
  id: string
  rte: string | null
  entry_date: string
  delivery_date: string | null
  index_no: string | null
  customer_name: string
  contact_1: string | null
  contact_2: string | null
  locality: string | null
  qty: number
  products: string | null
  amount: number
  payment_method: string | null
  sales_type: SalesType | string | null
  return_product: string | null
  notes: string | null
  medium: string | null
  rider_id: string | null
  contractor_id: string | null
  assigned_at: string | null
  assigned_by: string | null
  status: DeliveryStatus
  status_updated_at: string | null
  rider_fee: number
  rider_paid: boolean
  rider_paid_at: string | null
  picked_up_at: string | null
  delivered_at: string | null
  delivery_notes: string | null
  client_response: string | null
  payment_juice: number
  payment_cash: number
  payment_bank: number
  payment_status: string
  import_batch_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  latitude: number | null
  longitude: number | null
  delivery_sequence: number
  reply_token: string | null
  reply_token_created_at: string | null
  // Modification tracking
  original_amount: number | null
  is_modified: boolean
  modification_count: number
  // Joined fields
  rider?: Profile
  contractor?: Profile
  agent_name?: string | null
}

export interface Rider {
  id: string
  name: string
  phone: string | null
  profile_id: string | null
  contractor_id: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface Contractor {
  id: string
  name: string
  phone: string | null
  email: string | null
  profile_id: string | null
  is_active: boolean
  has_partners: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface Client {
  id: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  notes: string | null
  source: 'manual' | 'import' | 'website' | 'facebook' | 'history_import' | 'delivery'
  created_by: string | null
  created_at: string
  updated_at: string
  // Aggregate order history stats (from imports + live deliveries)
  total_orders: number
  delivered_orders: number
  cms_orders: number
  total_sales: number
  total_qty: number
  first_order_date: string | null
  last_order_date: string | null
  region: string | null
  client_status: 'good' | 'average' | 'bad' | 'new'
}

export interface ClientOrderHistoryItem {
  id: string
  delivery_date: string | null
  entry_date: string | null
  status: DeliveryStatus
  sales_type: SalesType | null
  products: string | null
  qty: number | null
  amount: number | null
  locality: string | null
  medium: string | null
  return_product: string | null
  notes: string | null
  created_at: string
}

export type ClientSortKey = 'total_sales' | 'total_orders' | 'delivered_rate'

export const CLIENT_STATUS_LABELS: Record<Client['client_status'], string> = {
  good: 'Good',
  average: 'Average',
  bad: 'Bad',
  new: 'New',
}

export const CLIENT_STATUS_COLORS: Record<Client['client_status'], string> = {
  good: 'bg-success/10 text-success',
  average: 'bg-warning/10 text-warning-foreground',
  bad: 'bg-destructive/10 text-destructive',
  new: 'bg-muted text-muted-foreground',
}

// How bad is a "bad" client, graded by the number of failed (CMS / non-delivered)
// orders they have caused. More failed orders = more costly repeat offender.
export type BadSeverityLevel = 'low' | 'moderate' | 'high' | 'critical'

export interface BadSeverity {
  level: BadSeverityLevel
  label: string
  failedOrders: number
}

export function getBadSeverity(cmsOrders: number): BadSeverity {
  const failed = Math.max(0, cmsOrders || 0)
  if (failed >= 10) return { level: 'critical', label: 'Critical', failedOrders: failed }
  if (failed >= 6) return { level: 'high', label: 'High risk', failedOrders: failed }
  if (failed >= 3) return { level: 'moderate', label: 'Moderate', failedOrders: failed }
  return { level: 'low', label: 'Low', failedOrders: failed }
}

export const BAD_SEVERITY_COLORS: Record<BadSeverityLevel, string> = {
  low: 'bg-destructive/10 text-destructive',
  moderate: 'bg-destructive/20 text-destructive',
  high: 'bg-destructive/30 text-destructive',
  critical: 'bg-destructive text-destructive-foreground',
}

export interface Product {
  id: string
  name: string
  image_url: string | null
  sku: string | null
  price: number
  category: string | null
  description: string | null
  is_active: boolean
  created_at: string
  updated_at?: string
  // Inventory tracking
  quantity: number
  // Set when a storekeeper's physical warehouse count was approved by an admin.
  // Null means `quantity` has never been physically verified - it may still hold
  // a real book figure carried over from before stock counting existed.
  last_counted_at?: string | null
  // Warehouse shelf label, e.g. "E1" - letter prefix is the zone, number is the
  // shelf within it. Null means the location has not been recorded yet.
  shelf_code?: string | null
  // Derived in Postgres from shelf_code's letter prefix ("E1" -> "E").
  // Read-only: writing it is rejected by the database.
  zone?: string | null
  // Bundle pricing - flexible tiers stored as JSON {"2": 900, "3": 1200, "6": 2000}
  bundle_prices: Record<string, number>
  // B1G1 offer flag
  is_b1g1: boolean
  // Legacy fields (to be removed after full migration)
  price_spx2?: number | null
  price_spx3?: number | null
  price_b1g1?: number | null
  // Notes
  remarks: string | null
  // Variants support
  has_variants: boolean
  variants?: ProductVariant[]
}

/**
 * One product the AI thinks a photo might be, with the reason it thinks so.
 * The reason is shown to the agent verbatim - a bare percentage is not
 * checkable, but "text on box reads VESLEE" is.
 */
export interface MatchCandidate {
  product_id: string
  name: string
  image_url: string | null
  /** 0-1. Below MATCH_CONFIDENCE_FLOOR the whole capture is left unmatched. */
  confidence: number
  reason: string
  /**
   * True when this candidate was judged on its catalogue photo. Text-only
   * candidates (66 products have no image) are inherently weaker guesses and
   * are labelled as such in the UI.
   */
  visually_compared: boolean
}

/**
 * A photo counted before the product was identified.
 * Staging only: on confirmation it becomes a normal `stock_count_items` row.
 */
export interface StockCountCapture {
  id: string
  count_id: string
  photo_url: string
  counted_qty: number
  shelf_code: string | null
  /** Generated in Postgres from shelf_code. Read-only. */
  zone: string | null
  status: 'analysing' | 'suggested' | 'unmatched' | 'resolved'
  matched_product_id: string | null
  /** What the AI thought the item was, in its own words. */
  ai_label: string | null
  ai_confidence: number | null
  ai_candidates: MatchCandidate[] | null
  ai_error: string | null
  created_by: string | null
  created_at: string
  resolved_by: string | null
  resolved_at: string | null
}

/** One purchase-order batch behind a product's initial stock. */
export interface StockPoBatch {
  id: string
  qty: number
  /** purchase_orders.order_date - null until someone fills it in. */
  date: string | null
  status: string
}

/**
 * Per-product stock breakdown from the get_product_stock_summary() RPC.
 *
 * Deliberately does NOT carry an "in store" figure: products.quantity is
 * already the counted Mauritius on-hand, and PO status 'Received' describes
 * that same stock, so adding the two would double-count it.
 */
export interface ProductStock {
  /** Everything ever ordered, all PO statuses. */
  initialQty: number
  /** Ordered / Payment Done / Loaded and Shipped - not yet in Mauritius. */
  chinaQty: number
  /** Pending + assigned deliveries. Committed, not deducted from on-hand. */
  undeliveredQty: number
  /** Most recent non-null order_date across this product's POs. */
  latestOrderDate: string | null
  poBatches: StockPoBatch[]
}

export interface ProductVariant {
  id: string
  product_id: string
  attribute_name: string  // e.g., "Size", "Color", "Material"
  attribute_value: string // e.g., "Medium", "Large", "X-Large"
  quantity: number
  price_override: number | null  // Optional: different price for this variant
  sku: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface DeliveryImport {
  id: string
  filename: string
  total_rows: number
  successful_rows: number
  failed_rows: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
  error_message: string | null
  imported_by: string | null
  created_at: string
  completed_at: string | null
}

export interface ClientImportLog {
  id: string
  filename: string
  total_rows: number
  successful_rows: number
  failed_rows: number
  status: string
  error_message: string | null
  imported_by: string | null
  created_at: string
  completed_at: string | null
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  manager: 'Manager',
  marketing_agent: 'Marketing Agent',
  marketing_back_office: 'Marketing Back Office',
  marketing_front_office: 'Marketing Front Office',
  contractor: 'Contractor',
  rider: 'Rider',
  storekeeper: 'Storekeeper'
}

export const STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: 'Pending',
  assigned: 'Assigned',
  picked_up: 'Picked Up',
  delivered: 'Delivered',
  nwd: 'NWD',
  cms: 'CMS'
}

/** Full descriptions for delivery statuses - useful for tooltips and client-facing UI */
export const STATUS_DESCRIPTIONS: Record<DeliveryStatus, string> = {
  pending: 'Awaiting assignment to a rider',
  assigned: 'Assigned to a rider for delivery',
  picked_up: 'Rider has picked up the order',
  delivered: 'Successfully delivered to customer',
  nwd: 'Next Working Day - delivery rescheduled',
  cms: 'Customer Service Center - under CS care'
}

/** Check if a status represents a failed/incomplete delivery attempt */
export function isFailedStatus(status: DeliveryStatus | string): boolean {
  return ['nwd', 'cms'].includes(status)
}

/** Check if a status represents a completed delivery (only 'delivered') */
export function isCompletedStatus(status: DeliveryStatus | string): boolean {
  return status === 'delivered'
}

export const STATUS_COLORS: Record<DeliveryStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  assigned: 'bg-primary/10 text-primary',
  picked_up: 'bg-warning/10 text-warning-foreground',
  delivered: 'bg-success/10 text-success',
  nwd: 'bg-destructive/10 text-destructive',
  cms: 'bg-accent text-accent-foreground'
}

export const SALES_TYPE_LABELS: Record<SalesType, string> = {
  sale: 'Sale',
  exchange: 'Exchange',
  trade_in: 'Trade In',
  refund: 'Refund',
  drop_off: 'Drop Off'
}

export const SALES_TYPE_COLORS: Record<SalesType, string> = {
  sale: 'bg-muted text-muted-foreground',
  exchange: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  trade_in: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  refund: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  drop_off: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400'
}

/** Sales types where the rider must return a product */
export const RETURN_SALES_TYPES: SalesType[] = ['exchange', 'trade_in', 'refund']

/** Sales types that do NOT count toward rider/contractor payout (done free of charge) */
export const NON_PAYOUT_SALES_TYPES: SalesType[] = ['exchange', 'trade_in', 'drop_off', 'refund']

/** Supabase .not() filter value for excluding non-payout types from queries */
export const NON_PAYOUT_FILTER = '("exchange","trade_in","drop_off","refund")'

/** Check if a delivery's sales_type is a payout-eligible (regular sale) delivery */
export function isPayoutEligible(salesType: string | null | undefined): boolean {
  return !NON_PAYOUT_SALES_TYPES.includes((salesType || 'sale') as SalesType)
}

/** Normalize raw sales_type strings from Excel into our SalesType */
export function normalizeSalesType(raw: string | null | undefined): SalesType {
  if (!raw) return 'sale'
  const v = raw.toLowerCase().trim()
  if (v === 'exchange' || v === 'exchg') return 'exchange'
  if (v === 'trade in' || v === 'trade-in' || v === 'tradein' || v === 'trade_in') return 'trade_in'
  if (v === 'refund' || v === 'refnd') return 'refund'
  if (v === 'drop off' || v === 'dropoff' || v === 'drop-off' || v === 'drop_off') return 'drop_off'
  if (v === 'sale' || v === 'normal' || v === 'delivery') return 'sale'
  return 'sale'
}
