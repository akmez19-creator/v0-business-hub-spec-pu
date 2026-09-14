import { recordedVariantId, variantDescription, type VariantSnapshot } from '@/lib/products/pricing'

export const supplierKey = (value: string | null | undefined) => (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
export const supplierIdentityKey = (line: { supplierLabel: string; supplierCode?: string | null; unit?: string | null }) =>
  JSON.stringify([supplierKey(line.supplierLabel), supplierKey(line.supplierCode), supplierKey(line.unit)])

export interface SupplierProductIdentity {
  id: string
  productId: string
  supplierLabel: string
  supplierCode: string | null
  unit: string | null
  provenance: string
  variantId?: string | null
  variantSnapshot?: VariantSnapshot | null
}

export function conflictingSupplierSelections(lines: Array<{
  supplierLabel: string; supplierCode?: string | null; unit?: string | null;
  productId?: string | null; variantId?: string | null;
}>): Set<string> {
  const choices = new Map<string, Set<string>>()
  for (const line of lines) {
    if (!line.productId) continue
    const key = supplierIdentityKey(line)
    const group = choices.get(key) ?? new Set<string>()
    group.add(JSON.stringify([line.productId, recordedVariantId(line)]))
    choices.set(key, group)
  }
  return new Set([...choices].filter(([, group]) => group.size > 1).map(([key]) => key))
}

export function supplierSelectionConflict(selected: { productId?: string | null; variantId?: string | null }, match: SupplierProductIdentity & { productName: string }): string | null {
  const savedVariant = recordedVariantId(match)
  if (!selected.productId || (selected.productId === match.productId && (!selected.variantId || !savedVariant || selected.variantId === savedVariant))) return null
  return `This supplier identity is already saved as “${match.productName}${savedVariant ? ` — ${variantDescription(match.variantSnapshot)}` : ''}”. Record another product or variant only with a reason; the existing mapping will not be repointed.`
}

export function supplierIdentityMatch<T extends SupplierProductIdentity>(line: {
  supplierLabel: string; supplierCode?: string | null; unit?: string | null
}, catalogue: T[]): { match: T | null; ambiguous: boolean; candidates: T[] } {
  const key = supplierIdentityKey(line)
  const exact = catalogue.filter((item) => supplierIdentityKey(item) === key)
  if (exact.length === 1) return { match: exact[0], ambiguous: false, candidates: exact }
  // Missing fields may only narrow an identity, never turn a repeated code into a match.
  const candidates = catalogue.filter((item) => supplierKey(item.supplierLabel) === supplierKey(line.supplierLabel) &&
    (!line.supplierCode || supplierKey(item.supplierCode) === supplierKey(line.supplierCode)) &&
    (!line.unit || supplierKey(item.unit) === supplierKey(line.unit)))
  return { match: null, ambiguous: candidates.length > 0 || exact.length > 1, candidates }
}

export function supplierIdentityIssue(document: { supplierName: string | null; vatNumber: string | null }, supplier: { name: string; vatNumber: string | null }): string | null {
  const vat = (text: string | null) => (text ?? '').replace(/\D/g, '')
  const clean = (text: string | null) => (text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const a = vat(document.vatNumber), b = vat(supplier.vatNumber)
  if (a && b) return a === b ? null : 'The VAT number on the returned document belongs to a different supplier.'
  const name = clean(document.supplierName), selected = clean(supplier.name)
  if (!name) return 'The returned document does not identify its supplier. Verify the original before accepting it.'
  return name.length >= 4 && selected.length >= 4 && (name.includes(selected) || selected.includes(name)) ? null : 'The printed supplier name differs from the chosen supplier.'
}
