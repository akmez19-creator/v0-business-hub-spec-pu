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
  source: 'manual' | 'import' | 'website' | 'facebook'
  created_by: string | null
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
