/**
 * Title Case for catalogue product names.
 *
 * Leaves genuinely uppercase tokens alone (LED, USB, 3M) and keeps short
 * joiners lowercase unless they lead. Fixes "meat slicer" -> "Meat Slicer" and
 * "Solar Led Bulb" -> "Solar LED Bulb".
 *
 * Lives in lib/ (moved out of the PO suggest-names route) so the photo reader
 * on the purchasing page can case its suggestions the way the catalogue is
 * written - a vision model returns "air fryer silicone pot", the shelf says
 * "Air Fryer Basket", and a product created in the wrong case is a second
 * spelling for the name matcher to trip over.
 */
const ACRONYMS = new Set([
  'LED', 'USB', 'TV', 'PVC', 'ABS', 'DC', 'AC', 'HD', 'SD', 'RGB',
  'BBQ', 'LCD', 'GPS', 'UV', 'XL', 'XXL', 'MM', 'CM', '3D', 'AA', 'AAA',
])
const MINOR = new Set(['and', 'or', 'for', 'to', 'of', 'with', 'in', 'on'])

export function titleCase(input: string): string {
  const words = input.trim().split(/\s+/)
  return words
    .map((w, i) => {
      const bare = w.replace(/[^A-Za-z0-9]/g, '')
      if (ACRONYMS.has(bare.toUpperCase())) return bare.toUpperCase()
      const lower = w.toLowerCase()
      if (i > 0 && MINOR.has(lower)) return lower
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(' ')
}
