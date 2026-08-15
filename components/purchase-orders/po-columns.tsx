import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { ProductThumb } from '@/components/ui/product-thumb'
import { ExternalLink, DollarSign } from 'lucide-react'

export interface PurchaseOrder {
  id: string
  status: string | null
  reorder: string | null
  link: string | null
  supplier_name: string | null
  index_no: string | null
  carton: string | null
  image_url: string | null
  product_name: string | null
  product_id: string | null
  products?: { id: string; name: string; image_url: string | null } | null
  qty: number
  unit_price: number
  discounted_unit_price: number
  shipment_to_warehouse: number
  discounted_shipment_to_warehouse: number
  discounted_percentage: number
  total_payment_supplier_yuan: number
  total_payment_supplier: number
  payment_link: string | null
  weight_kg: number
  cbm: number
  boxes: number
  cbm_cost: number
  import_cp: number
  total_cp_import: number
  tracking_number: string | null
  batch_id: string | null
  created_at: string
}

export function statusColor(status: string | null): string {
  switch (status?.toLowerCase()) {
    case 'ordered':
    case 'confirmed': return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    case 'shipped':
    case 'in transit': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    case 'delivered':
    case 'received': return 'bg-green-500/20 text-green-400 border-green-500/30'
    case 'pending': return 'bg-muted text-muted-foreground border-border'
    case 'cancelled': return 'bg-red-500/20 text-red-400 border-red-500/30'
    default: return 'bg-muted text-muted-foreground border-border'
  }
}

export function formatCurrency(value: number, currency = 'Rs') {
  if (!value) return '-'
  return `${currency} ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Order date is the created_at timestamp - there is no separate PO date field.
export function formatDate(value: string | null): string {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * The table carries 20 columns - about 1920px of min-widths, which overflows
 * even a wide monitor and pushes Inventory Match and everything after it off
 * the right edge. The columns are not arbitrary though: they fall into three
 * jobs (what was ordered / what it cost / how it ships), so each column
 * declares its group and the table renders one group at a time.
 *
 * `pinned` columns identify the row and therefore appear in every view -
 * without them a price column is just a number with no product attached.
 */
export type ColumnGroup = 'pricing' | 'logistics'
export type ViewKey = 'overview' | 'pricing' | 'logistics' | 'all'

export interface ColumnDef {
  key: string
  label: string
  /** Tailwind min-width + alignment for both the header and the cell. */
  className: string
  /** Omitted for pinned columns, which show in every view. */
  group?: ColumnGroup
  /** Shown in the default overview alongside the pinned columns. */
  overview?: boolean
  render: (o: PurchaseOrder) => ReactNode
}

export const COLUMNS: ColumnDef[] = [
  // --- Pinned: identify the row in every view ---
  {
    key: 'index',
    label: 'Index',
    className: 'min-w-[70px]',
    render: (o) => (
      <span className="text-sm font-mono text-muted-foreground">{o.index_no || '-'}</span>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    className: 'min-w-[90px]',
    render: (o) => (
      <Badge variant="outline" className={statusColor(o.status)}>
        {o.status || 'pending'}
      </Badge>
    ),
  },
  {
    key: 'product',
    label: 'Product',
    className: 'min-w-[180px]',
    render: (o) => (
      <div className="flex items-center gap-2">
        {/* Always rendered, so the column keeps its alignment whether or not
            a photo exists - and 1688 photos are proxied so they load at all. */}
        <ProductThumb
          src={o.products?.image_url || o.image_url}
          className="w-8 h-8 flex-shrink-0 rounded"
        />
        <span className="font-medium truncate max-w-[150px]" title={o.product_name || undefined}>
          {o.product_name || '-'}
        </span>
      </div>
    ),
  },

  // --- Overview ---
  {
    key: 'date',
    label: 'Date',
    className: 'min-w-[110px]',
    overview: true,
    render: (o) => (
      <span className="whitespace-nowrap text-sm text-muted-foreground">
        {formatDate(o.created_at)}
      </span>
    ),
  },
  {
    key: 'match',
    label: 'Inventory Match',
    className: 'min-w-[150px]',
    overview: true,
    render: (o) =>
      o.products ? (
        // Badge centres its text, so a plain `truncate` clipped BOTH ends and
        // produced "eless Vacuum Clea". Left-align the inner span and let the
        // ellipsis fall at the end only; the title exposes the full name.
        <Badge variant="secondary" className="max-w-[130px] text-xs" title={o.products.name}>
          <span className="block w-full truncate text-left">{o.products.name}</span>
        </Badge>
      ) : (
        <span className="text-xs text-muted-foreground">Unmatched</span>
      ),
  },
  {
    key: 'supplier',
    label: 'Supplier',
    className: 'min-w-[140px]',
    overview: true,
    render: (o) => (
      <span className="block truncate max-w-[140px]" title={o.supplier_name || undefined}>
        {o.supplier_name || '-'}
      </span>
    ),
  },
  {
    key: 'qty',
    label: 'Qty',
    className: 'min-w-[60px] text-right',
    overview: true,
    render: (o) => <span className="font-medium">{o.qty || 0}</span>,
  },

  // --- Pricing: what we pay the supplier ---
  {
    key: 'unit_price',
    label: 'Unit Price',
    className: 'min-w-[100px] text-right',
    group: 'pricing',
    render: (o) => formatCurrency(o.unit_price),
  },
  {
    key: 'disc_price',
    label: 'Disc. Price',
    className: 'min-w-[100px] text-right',
    group: 'pricing',
    render: (o) => formatCurrency(o.discounted_unit_price),
  },
  {
    key: 'shipment',
    label: 'Shipment',
    className: 'min-w-[100px] text-right',
    group: 'pricing',
    render: (o) => formatCurrency(o.shipment_to_warehouse),
  },
  {
    key: 'disc_pct',
    label: 'Disc %',
    className: 'min-w-[80px] text-right',
    group: 'pricing',
    render: (o) => (o.discounted_percentage ? `${o.discounted_percentage}%` : '-'),
  },
  {
    key: 'total_yuan',
    label: 'Total (Yuan)',
    className: 'min-w-[120px] text-right',
    group: 'pricing',
    render: (o) =>
      o.total_payment_supplier_yuan
        ? `¥ ${Number(o.total_payment_supplier_yuan).toLocaleString()}`
        : '-',
  },
  {
    key: 'total_supplier',
    label: 'Total Supplier',
    className: 'min-w-[120px] text-right',
    group: 'pricing',
    overview: true,
    render: (o) => <span className="font-medium">{formatCurrency(o.total_payment_supplier)}</span>,
  },

  // --- Logistics: how it ships and what it lands at ---
  {
    key: 'weight',
    label: 'Weight',
    className: 'min-w-[80px] text-right',
    group: 'logistics',
    render: (o) => (o.weight_kg ? `${o.weight_kg} kg` : '-'),
  },
  {
    key: 'cbm',
    label: 'CBM',
    className: 'min-w-[70px] text-right',
    group: 'logistics',
    render: (o) => o.cbm || '-',
  },
  {
    key: 'boxes',
    label: 'Boxes',
    className: 'min-w-[70px] text-right',
    group: 'logistics',
    render: (o) => o.boxes || '-',
  },
  {
    key: 'import_cp',
    label: 'Import CP',
    className: 'min-w-[100px] text-right',
    group: 'logistics',
    render: (o) => formatCurrency(o.import_cp),
  },
  {
    key: 'total_cp',
    label: 'Total CP',
    className: 'min-w-[110px] text-right',
    group: 'logistics',
    render: (o) => <span className="font-medium">{formatCurrency(o.total_cp_import)}</span>,
  },
  {
    key: 'tracking',
    label: 'Tracking',
    className: 'min-w-[140px]',
    group: 'logistics',
    overview: true,
    render: (o) => (
      <span className="block truncate max-w-[130px] text-xs font-mono">
        {o.tracking_number || '-'}
      </span>
    ),
  },
  {
    key: 'links',
    label: 'Links',
    className: 'min-w-[60px]',
    overview: true,
    render: (o) => (
      <div className="flex items-center gap-1">
        {o.link && (
          <a
            href={o.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
            aria-label="Open supplier listing"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
        {o.payment_link && (
          <a
            href={o.payment_link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-green-500 hover:underline"
            aria-label="Open payment link"
          >
            <DollarSign className="w-4 h-4" />
          </a>
        )}
        {!o.link && !o.payment_link && <span className="text-muted-foreground">-</span>}
      </div>
    ),
  },
]

export const VIEWS: { key: ViewKey; label: string; hint: string }[] = [
  { key: 'overview', label: 'Overview', hint: 'What was ordered, from whom, and the total' },
  { key: 'pricing', label: 'Pricing', hint: 'Unit prices, discounts and supplier payment' },
  { key: 'logistics', label: 'Logistics', hint: 'Weight, volume, landed cost and tracking' },
  { key: 'all', label: 'All columns', hint: 'Every field, scrolls horizontally' },
]

/** A column with no group is pinned: it identifies the row in every view. */
const isPinned = (c: ColumnDef) => !c.group && !c.overview

export function columnsForView(view: ViewKey): ColumnDef[] {
  if (view === 'all') return COLUMNS
  if (view === 'overview') {
    // Everything ungrouped, plus the two grouped columns worth surfacing up
    // front (supplier total and tracking).
    return COLUMNS.filter((c) => !c.group || c.overview)
  }
  return COLUMNS.filter((c) => isPinned(c) || c.group === view)
}
