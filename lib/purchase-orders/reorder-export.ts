import type { ReorderSnapshot } from './workflow'

export function safeSpreadsheetText(value: string) {
  return /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

export function supplierRequestRows(number: string, snapshot: ReorderSnapshot): Record<string, string | number>[] {
  return snapshot.lines.map((line, index) => ({
    Request: safeSpreadsheetText(number),
    Supplier: safeSpreadsheetText(snapshot.supplierName),
    Product: safeSpreadsheetText(line.supplierLabel || line.productName),
    Variant: safeSpreadsheetText(line.variantLabel || 'Not specified'),
    'Requested quantity (physical units)': line.qty ?? '',
    'Expected unit price (CNY)': line.priceCny ?? 'Please quote',
    'Price basis':
      line.priceMode === 'discount' ? `Apply ${line.discountPercent}% discount` : 'Net price; no additional discount',
    'China freight (CNY)': line.chinaFreight ?? 'Please quote',
    'China freight basis': line.chinaFreightBasis,
    'Shared China freight (CNY, once per request)': index === 0 ? snapshot.terms.sharedChinaFreight ?? 'Please quote' : '',
    'Units per carton': line.unitsPerCarton ?? 'Please confirm',
    'Requested arrival': snapshot.expectedDate ?? 'Please confirm',
    Listing: safeSpreadsheetText(line.listingUrl),
    'Product notes': safeSpreadsheetText(line.notes),
    'Request notes': safeSpreadsheetText(snapshot.notes),
  }))
}
