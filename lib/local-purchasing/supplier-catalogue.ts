import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase/fetch-all'
import type { SupplierProductIdentity } from './supplier-identity'
import type { VariantSnapshot } from '@/lib/products/pricing'

export interface SupplierCatalogueProduct extends SupplierProductIdentity {
  supplierId: string
  productName: string
  imageUrl: string | null
  lastPurchaseDate: string | null
  sourcePurchaseLineId: string | null
  lastUnitPriceNet: number | null
  lastUnitPayable: number | null
  vatPercent: number | null
}

export async function loadSupplierCatalogue(db: SupabaseClient, supplierId: string): Promise<SupplierCatalogueProduct[]> {
  const rows = await fetchAll<Record<string, unknown>>((from, to) => db.from('local_supplier_products')
    .select('id,supplier_id,product_id,supplier_label,supplier_code,unit,provenance,last_purchase_date,source_purchase_line_id,last_unit_price_net,last_unit_payable,vat_percent,variant_id,variant_snapshot,products(name,image_url)')
    .eq('supplier_id', supplierId).order('supplier_label').order('id').range(from, to))
  return rows.map((row) => {
    const product = (Array.isArray(row.products) ? row.products[0] : row.products) as { name?: string; image_url?: string } | null
    return { id: String(row.id), supplierId: String(row.supplier_id), productId: String(row.product_id),
      supplierLabel: String(row.supplier_label), supplierCode: row.supplier_code as string | null, unit: row.unit as string | null,
      variantId: row.variant_id as string | null, variantSnapshot: row.variant_snapshot as VariantSnapshot | null,
      provenance: String(row.provenance), productName: product?.name ?? 'Unavailable Inventory product', imageUrl: product?.image_url ?? null,
      lastPurchaseDate: row.last_purchase_date as string | null, sourcePurchaseLineId: row.source_purchase_line_id as string | null,
      lastUnitPriceNet: row.last_unit_price_net == null ? null : Number(row.last_unit_price_net),
      lastUnitPayable: row.last_unit_payable == null ? null : Number(row.last_unit_payable),
      vatPercent: row.vat_percent == null ? null : Number(row.vat_percent) }
  })
}
