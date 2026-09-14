import { citedFacts, excludedSkuReason, latestReorderReference, normalizeFact, normalizeUnit, publishedPackSize, skuEvidenceText, stableEvidence } from './1688-comparison'
import { reviewImportReferences } from './reorder-reference'
import { calculateReorder, roundMoney } from './reorder-calculations'
import { emptyReorderTerms, type ImportReference, type ReorderLine } from './workflow'
import type { Listing1688, SavedCheck1688, Sku1688 } from './1688-types'
import type { PreparedPhoto, PurchaseDifference, ReviewedSku, SkuReview, SourcingGuard, SourcingInput, SourcingPurchasePreview, SourcingSelection, SourcingSnapshot, SourcingTerms } from './1688-sourcing-types'

export const skuKey = (sku: Sku1688) => sku.providerId ? `sku:${sku.providerId}` : sku.specId ? `spec:${sku.specId}` : sku.propsIds ? `props:${sku.propsIds}` : null
export const skuDescription = (sku: Sku1688) => sku.attributes.length ? sku.attributes.map(attribute => `${attribute.name}: ${attribute.value}`).join(' · ') : sku.name || 'Specifications not published'
export const supplierPhoto = (offer: Listing1688, sku: Sku1688) => sku.imageUrl || (offer.skus.length === 1 ? offer.imageUrl : null)
export function catalogueMembership(check: SavedCheck1688, offer: Listing1688, sku: Sku1688) {
  const interpretation = check.evidence.interpretations[offer.offerId]?.variants.find(value => value.skuId === sku.id)
  const excluded = excludedSkuReason(sku, interpretation)
  if (excluded) return { verified: false, excluded }
  const facts = interpretation ? citedFacts(interpretation.facts, skuEvidenceText(offer, sku)) : []
  const wanted = check.evidence.target.facts
  const product = facts.find(fact => fact.field === 'product')?.value
  const actualProduct = wanted.find(fact => fact.field === 'product')?.value
  const conflicts = ['brand', 'model'].some(field => { const a = wanted.find(fact => fact.field === field)?.value; const b = facts.find(fact => fact.field === field)?.value; return a && b && normalizeFact(a) !== normalizeFact(b) })
  return { verified: !!product && !!actualProduct && normalizeFact(product) === normalizeFact(actualProduct) && interpretation?.kind === 'full_product' && !conflicts, excluded: null }
}
export function initialSkuReviews(check: SavedCheck1688, offer: Listing1688, guard: SourcingGuard): SkuReview[] {
  return offer.skus.map(sku => {
    const key = skuKey(sku)
    const mapping = guard.mappings.find(link => link.offer_id === offer.offerId && link.sku_key === key)
    const name = sku.attributes.map(attribute => attribute.name.trim()).join(' / ')
    const value = sku.attributes.map(attribute => attribute.value.trim()).join(' / ')
    const complete = sku.attributes.length > 0 && sku.attributes.every(attribute => attribute.name.trim() && attribute.value.trim())
    const matches = complete ? guard.variants.filter(variant => normalizeFact(variant.attribute_name) === normalizeFact(name) && normalizeFact(variant.attribute_value) === normalizeFact(value)) : []
    const mapped = mapping?.target_kind === 'variant' ? guard.variants.find(variant => variant.id === mapping.variant_id) : null
    const exact = mapped ?? (matches.length === 1 ? matches[0] : null)
    const member = catalogueMembership(check, offer, sku)
    const isParent = mapping?.target_kind === 'parent' && !guard.product.has_variants
    const destination = isParent ? 'parent' : exact ? 'existing' : guard.product.has_variants && complete && member.verified && key ? 'new' : 'review'
    return { skuId: sku.id, include: !!key && !member.excluded && (isParent || !!mapping && !!mapped || guard.product.has_variants === true && member.verified), reviewed: !!mapping || !!exact && member.verified,
      destination, variantId: exact?.id ?? null, attributeName: exact?.attribute_name ?? name, attributeValue: exact?.attribute_value ?? value,
      qty: null, keepPhoto: false, samePreviousUnit: false }
  })
}
export function aggregateSkuReviews(reviews: SkuReview[]) {
  const unique = new Map<string, SkuReview>()
  for (const row of reviews) {
    const previous = unique.get(row.skuId)
    if (!previous) { unique.set(row.skuId, { ...row }); continue }
    if (stableEvidence({ ...previous, qty: null }) !== stableEvidence({ ...row, qty: null })) throw new Error('Duplicate supplier SKU has conflicting Inventory destinations or review choices.')
    unique.set(row.skuId, { ...row, qty: (previous.qty ?? 0) + (row.qty ?? 0) || null })
  }
  return [...unique.values()]
}
export function sourcingPrice(offer: Listing1688, sku: Sku1688, qty: number | null, totalQty: number) {
  const warnings: string[] = []; const blockers: string[] = []
  const unit = normalizeUnit(sku.unit)
  const pack = publishedPackSize(sku.name) ?? sku.packSize
  const multiple = sku.quantityMultiple ?? offer.quantityMultiple
  if (offer.moq == null) warnings.push('Supplier MOQ is unverified')
  else if (totalQty > 0 && totalQty < offer.moq) blockers.push(`Listing MOQ is ${offer.moq}; allocated total is ${totalQty}`)
  if (sku.stock == null) warnings.push('Supplier SKU stock is unverified')
  if (!unit || pack == null) warnings.push('Purchasing unit / pack is unverified')
  if (multiple == null) warnings.push('Order multiple is unverified')
  if (qty != null && qty > 0) {
    if (!Number.isSafeInteger(qty) || qty > 10_000_000) blockers.push('Enter a valid whole-unit quantity')
    if (offer.soldOut || sku.stock === 0) blockers.push('This SKU is unavailable')
    else if (sku.stock != null && qty > sku.stock) blockers.push(`Only ${sku.stock} published in stock`)
    if (multiple != null && (multiple < 1 || qty % multiple !== 0)) blockers.push(`Order quantity must be a multiple of ${multiple}`)
  }
  const eligible = qty ? sku.tiers.filter(tier => tier.skuId === sku.id && tier.minQty <= qty && (tier.maxQty == null || qty <= tier.maxQty)).sort((a, b) => a.minQty - b.minQty) : []
  const tier = eligible.at(-1)
  let price = tier?.price ?? sku.price
  if (sku.tiers.length && qty && !tier) { price = null; blockers.push('No SKU-specific price tier applies to this quantity') }
  if (tier && eligible.some(value => value.minQty === tier.minQty && value.price !== tier.price)) { price = null; blockers.push('Conflicting SKU prices at this quantity') }
  if (price == null || price <= 0 || !Number.isFinite(price)) { price = null; if (qty) blockers.push('A positive SKU purchase price is required') }
  return { price, source: tier?.source ?? sku.priceSource, warnings, blockers, verified: !!qty && !warnings.length && !blockers.length }
}
export function purchaseDifference(reference: ImportReference | null, price: number | null, qty: number | null, comparable: boolean, reason?: string): PurchaseDifference {
  const previousList = reference && !reference.referenceWarning && Number(reference.unit_price) > 0 ? Number(reference.unit_price) : null
  const previousNet = reference && !reference.referenceWarning && Number(reference.discounted_unit_price) > 0 ? Number(reference.discounted_unit_price) : null
  const baseline = previousNet ?? previousList
  const verified = comparable && baseline != null && price != null && qty != null && qty > 0
  const perUnit = verified ? roundMoney(price! - baseline!) : null
  return { reference, previousList, previousNet, baselineKind: previousNet != null ? 'negotiated' : previousList != null ? 'list' : null, proposed: price, perUnit, percent: verified ? (price! - baseline!) / baseline! * 100 : null, goods: perUnit == null ? null : roundMoney((price! - baseline!) * qty!), reason: verified ? null : !reference ? 'No comparable previous price' : reference.referenceWarning || reason || 'Same variant, purchasing unit and quantity terms need verification' }
}
export function reviewSourcing(input: SourcingInput, check: SavedCheck1688, guard: SourcingGuard, photos: Record<string, PreparedPhoto> = {}): SourcingSnapshot {
  const source = check.evidence.current?.offerId === input.offerId ? check.evidence.current : check.evidence.offers[input.offerId]
  if (!source) throw new Error('Choose a supplier listing from the saved research evidence.')
  const reviews = aggregateSkuReviews(input.reviews)
  if (reviews.length !== source.skus.length || source.skus.some(sku => !reviews.some(review => review.skuId === sku.id))) throw new Error('Review the complete saved SKU list; missing or fabricated SKUs are not accepted.')
  const orderedQty = reviews.filter(review => review.include).reduce((sum, review) => sum + (review.qty ?? 0), 0)
  const references = reviewImportReferences(guard.references)
  const rows: ReviewedSku[] = reviews.map(review => {
    const sku = source.skus.find(value => value.id === review.skuId)!
    const inventory = guard.variants.find(variant => variant.id === review.variantId) ?? null
    const price = sourcingPrice(source, sku, review.qty, orderedQty)
    const blockers: string[] = []
    if (review.include) {
      const membership = catalogueMembership(check, source, sku)
      if (!skuKey(sku)) blockers.push('Stable supplier SKU/specification identity is missing')
      if (membership.excluded) blockers.push(membership.excluded)
      if (!review.reviewed) blockers.push('Confirm this is a complete same-product Inventory variant')
      if (review.destination === 'review') blockers.push('Choose its Inventory destination')
      if (review.destination === 'parent' && (guard.product.has_variants || input.convertToVariants)) blockers.push('A variant-managed product must stay variant-based')
      if (review.destination === 'existing' && !inventory) blockers.push('Choose an existing variant of this product')
      if (review.destination === 'existing' && inventory && (review.attributeName !== inventory.attribute_name || review.attributeValue !== inventory.attribute_value)) blockers.push('Inventory labels changed; choose the existing destination again to preserve its labels')
      if (review.destination === 'new' && (!review.attributeName.trim() || !review.attributeValue.trim())) blockers.push('A complete attribute combination is required')
      if ((review.destination === 'new' || review.destination === 'existing') && !guard.product.has_variants && !input.convertToVariants) blockers.push('Explicitly choose conversion before adding Inventory variants')
      if (input.convertToVariants && !guard.product.has_variants && guard.product.quantity !== 0) blockers.push('Allocate existing or unknown parent stock in Inventory before converting; stock will not be zeroed')
      if ((review.qty ?? 0) > 0 && inventory && inventory.is_active !== true) blockers.push('The linked Inventory variant is inactive; sourcing will not reactivate it')
      if ((review.qty ?? 0) > 0) blockers.push(...price.blockers)
      const oldLink = guard.mappings.find(link => link.offer_id === source.offerId && link.sku_key === skuKey(sku))
      if (oldLink && (oldLink.target_kind === 'parent' ? review.destination !== 'parent' : oldLink.variant_id !== review.variantId)) blockers.push('Saved SKU identity conflicts with this destination; existing mappings cannot silently move')
    }
    const reference = review.destination === 'parent' ? latestReorderReference(guard.product.id, references) : review.destination === 'existing' && inventory ? latestReorderReference(guard.product.id, references, inventory.id) : null
    const photo = photos[sku.id]?.source === supplierPhoto(source, sku) ? photos[sku.id] : null
    return { review, sku, inventory, photo, price: price.price, priceSource: price.source, blockers, warnings: price.warnings,
      difference: purchaseDifference(reference, price.price, review.qty, review.include && review.samePreviousUnit && price.verified, !review.samePreviousUnit ? 'Confirm the same previously purchased variant and unit / pack' : price.warnings[0] || price.blockers[0]) }
  })
  const destinations = new Set<string>()
  for (const row of rows.filter(row => row.review.include)) {
    const review = row.review
    const destination = review.destination === 'new' ? `new:${normalizeFact(review.attributeName)}:${normalizeFact(review.attributeValue)}` : review.destination === 'parent' ? 'parent' : review.variantId
    if (destination && destinations.has(destination)) row.blockers.push('More than one supplier SKU points to the same Inventory destination')
    if (destination) destinations.add(destination)
    if (review.destination === 'new' && guard.variants.some(variant => normalizeFact(variant.attribute_name) === normalizeFact(review.attributeName) && normalizeFact(variant.attribute_value) === normalizeFact(review.attributeValue))) row.blockers.push('This attribute combination already exists; link that Inventory variant instead')
  }
  return { source, check, input: { ...input, reviews }, rows, intendedQty: guard.item.item.qty, orderedQty, guard }
}
export function sourcingPurchasePreview(selection: SourcingSelection, terms: SourcingTerms): SourcingPurchasePreview {
  const reviewed = reviewSourcing(selection.snapshot.input, selection.snapshot.check, selection.guard, selection.photos)
  const included = reviewed.rows.filter(row => row.review.include)
  const ordered = included.filter(row => (row.review.qty ?? 0) > 0)
  const blockers = included.flatMap(row => row.blockers.map(message => `${row.sku.name || row.sku.id}: ${message}`))
  const warnings = [...new Set(ordered.flatMap(row => row.warnings))]
  if (!ordered.length) blockers.push('Enter a purchase quantity for at least one SKU')
  if (ordered.length > 200) blockers.push('Record at most 200 purchased SKUs in one confirmation; catalogue-only variants do not count toward this limit')
  if (reviewed.orderedQty !== reviewed.intendedQty && !reviewed.input.quantityDifferenceAccepted) blockers.push(`Review the allocated ${reviewed.orderedQty} units versus ${reviewed.intendedQty ?? 'unset'} intended units`)
  if (warnings.length && !reviewed.input.unverifiedTermsAccepted) blockers.push('Acknowledge unverified supplier terms before recording the purchase; they are not verified savings')
  if (!terms.orderDate || !/^\d{4}-\d{2}-\d{2}$/.test(terms.orderDate)) blockers.push('Enter the actual order date')
  if (terms.chinaFreight != null && (!Number.isFinite(terms.chinaFreight) || terms.chinaFreight < 0)) blockers.push('Enter a non-negative whole-order freight amount or leave it unknown')
  if (terms.fxRate != null && (!Number.isFinite(terms.fxRate) || terms.fxRate <= 0)) blockers.push('Enter a positive MUR per CNY rate or leave it unknown')
  for (const row of included) if (!row.review.keepPhoto && row.photo?.status !== 'ready') blockers.push(`${row.sku.name || row.sku.id}: prepare the final photo or explicitly retain the existing / missing photo`)
  const lines: ReorderLine[] = ordered.map(row => {
    const ref = row.difference.reference
    return { id: row.review.skuId, productId: selection.product_id, variantId: row.review.destination === 'parent' ? null : row.review.variantId,
      productName: selection.guard.product.name, variantLabel: row.review.destination === 'parent' ? null : `${row.review.attributeName}: ${row.review.attributeValue}`,
      supplierLabel: `${selection.guard.product.name} · ${skuDescription(row.sku)}`, listingUrl: reviewed.source.pageUrl,
      imageUrl: row.review.keepPhoto ? row.review.destination === 'parent' ? selection.guard.product.image_url : row.inventory?.image_url ?? null : row.photo?.url ?? null,
      sourceImportId: ref?.id ?? null, sourceSnapshot: ref, qty: row.review.qty, priceCny: row.price, priceMode: 'net', discountPercent: 0,
      chinaFreight: terms.chinaFreight == null ? null : 0, chinaFreightBasis: 'fixed', unitsPerCarton: null, kgPerUnit: null, cbmPerUnit: null, unavailable: false,
      notes: `Buyer-confirmed sourcing from ${reviewed.source.offerId}; ${skuKey(row.sku)}. Not an automated 1688 order.` }
  })
  const snapshot = { supplierName: reviewed.source.supplier.name ?? '', notes: 'Explicit buyer sourcing confirmation. Original imports unchanged.', orderDate: terms.orderDate, expectedDate: null, terms: { ...emptyReorderTerms(), fxRate: terms.fxRate, sharedChinaFreight: terms.chinaFreight }, lines }
  const calculation = calculateReorder(snapshot)
  if (calculation.lines.some(line => [line.goods, line.supplierCny, line.supplierMur].some(amount => amount != null && amount > 999_999_999.99))) blockers.push('Purchase amount exceeds the supported import record limit')
  const comparable = ordered.filter(row => row.difference.goods != null)
  return { snapshot, rows: reviewed.rows, blockers: [...new Set(blockers)], warnings, goods: calculation.goodsCny, difference: comparable.length ? roundMoney(comparable.reduce((sum, row) => sum + row.difference.goods!, 0)) : null, covered: comparable.length, ordered: ordered.length, units: reviewed.orderedQty }
}
