import { COMPARISON_VERSION, FACT_FIELDS, type ComparisonContext1688, type Evidence1688, type EvidenceFact, type Finding1688, type Listing1688, type OfferInterpretation, type SearchHit1688, type Sku1688, type SkuInterpretation, type SupplierQualitySummary, type Target1688, type TargetConfirmation1688 } from './1688-types'
import type { ImportReference } from './workflow'

export function stableEvidence(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableEvidence).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableEvidence((value as Record<string, unknown>)[key])}`).join(',')}}`
}
export const normalizeFact = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s,，;；:：_]/g, '').trim()

export function offerIdFrom(link: string | null): string | null {
  if (!link) return null
  try {
    const url = new URL(link)
    if (!/^https?:$/.test(url.protocol) || !/(^|\.)1688\.com$/i.test(url.hostname) || url.username || url.password) return null
    return url.pathname.match(/\/offer\/(\d{6,})/)?.[1] ?? ['id', 'offerId', 'item_id'].map(key => url.searchParams.get(key)).find(value => value && /^\d{6,}$/.test(value)) ?? null
  } catch { return null }
}
export const has1688Link = (link: string | null) => Boolean(offerIdFrom(link))

export function latestReorderReference(productId: string, references: ImportReference[], variantId: string | null = null) {
  let best: ImportReference | null = null
  for (const reference of references) {
    if (reference.product_id !== productId || (reference.variant_id ?? null) !== variantId) continue
    const stamp = reference.order_date || reference.created_at
    const priorStamp = best?.order_date || best?.created_at || ''
    if (!best || stamp > priorStamp || (stamp === priorStamp && (reference.created_at > best.created_at || reference.created_at === best.created_at && reference.id > best.id))) best = reference
  }
  return best
}

export function normalizeUnit(value: string | null | undefined): string | null {
  if (!value) return null
  const clean = value.trim().toLowerCase()
  const units: Record<string, string> = { '件': 'piece', '个': 'piece', '只': 'piece', '台': 'piece', '支': 'piece', '把': 'piece', 'pcs': 'piece', 'pc': 'piece', 'piece': 'piece', 'pieces': 'piece', '套': 'set', 'set': 'set', 'sets': 'set', '双': 'pair', 'pair': 'pair', '盒': 'box', '箱': 'box', 'box': 'box', '包': 'pack', 'pack': 'pack', '米': 'meter', 'm': 'meter', 'meter': 'meter' }
  return units[clean] ?? null
}

export function skuEvidenceText(offer: Listing1688, sku: Sku1688) {
  return [offer.title, ...offer.productProps.map(prop => `${prop.name}: ${prop.value}`), sku.name, ...sku.attributes.map(prop => `${prop.name}: ${prop.value}`), offer.unit ?? '', sku.unit ?? ''].join('\n')
}

export function citedFacts(facts: EvidenceFact[], text: string): EvidenceFact[] {
  const normalized = normalizeFact(text)
  const groups = new Map<string, EvidenceFact[]>()
  for (const fact of facts) {
    if (!FACT_FIELDS.includes(fact.field) || !fact.value.trim() || !fact.quote.trim() || !normalized.includes(normalizeFact(fact.quote))) continue
    if (fact.field === 'model' && !normalizeFact(fact.quote).includes(normalizeFact(fact.value))) continue
    if (['size', 'capacity', 'voltage', 'contents'].includes(fact.field)) {
      const statedNumbers = fact.value.normalize('NFKC').match(/\d+(?:\.\d+)?/g) ?? []
      const quotedNumbers = new Set((fact.quote.normalize('NFKC').match(/\d+(?:\.\d+)?/g) ?? []).map(Number))
      if (statedNumbers.some(number => !quotedNumbers.has(Number(number)))) continue
    }
    const group = groups.get(fact.field) ?? []
    group.push(fact)
    groups.set(fact.field, group)
  }
  // Two contradictory interpretations of one field must not be resolved by array order.
  return [...groups.values()].filter(group => new Set(group.map(fact => normalizeFact(fact.value))).size === 1).map(group => group[0])
}

export function excludedSkuReason(sku: Sku1688, interpretation?: SkuInterpretation): string | null {
  const explicit: [RegExp, string][] = [
    [/(?:accessor(?:y|ies)\s*only|only\s*accessor|配件(?:单卖|款|包|专用)|仅配件|单独配件)/i, 'Accessory only, not the complete product'],
    [/(?:replacement\s*(?:part|head|blade)|spare\s*part|替换(?:头|装|件)|刀头单卖|配件单拍)/i, 'Replacement part, not the complete product'],
    [/(?:empty\s*(?:box|case)|packaging\s*only|空盒|空箱|仅包装|包装盒单卖)/i, 'Empty case or packaging only'],
    [/(?:deposit|订金|定金|补差价|差价专拍)/i, 'Deposit or price adjustment, not a product price'],
    [/(?:sample\s*only|sample\s*fee|样品费|样品专拍)/i, 'Sample offer, not a comparable production order'],
  ]
  for (const [pattern, reason] of explicit) if (pattern.test(sku.name)) return reason
  if (interpretation && !['full_product', 'unknown'].includes(interpretation.kind)) return `${interpretation.kind.replaceAll('_', ' ')} · ${interpretation.reason}`
  return null
}

export function publishedPackSize(text: string): number | null {
  const values: number[] = []
  for (const pattern of [/\b(?:pack|set|box)\s+of\s+(\d+)\b/gi, /\b(\d+)\s*[- ](?:pack|piece\s+set)\b/gi, /(\d+)\s*(?:个|件|只|支|片)\s*(?:装|\/\s*(?:盒|包|套))/g, /\b(\d+)\s*(?:pcs|pieces)\s*(?:\/|per)\s*(?:pack|box|set)\b/gi]) {
    for (const match of text.normalize('NFKC').matchAll(pattern)) values.push(Number(match[1]))
  }
  const unique = [...new Set(values.filter(value => Number.isSafeInteger(value) && value > 0))]
  return unique.length === 1 ? unique[0] : null
}

export function publishedOrderMultiple(text: string): number | null {
  const match = text.normalize('NFKC').match(/(?:order\s*(?:quantity\s*)?multiple|order\s+in\s+multiples\s+of|起订倍数|起批倍数|订购倍数|下单倍数)\s*[:：=]?\s*(\d+)/i)
  const value = match ? Number(match[1]) : null
  return value != null && Number.isSafeInteger(value) && value > 0 ? value : null
}

export function skuCommercialPrice(offer: Listing1688, sku: Sku1688, target: Target1688, qty: number | null, interpretation?: SkuInterpretation) {
  const failed = (reason: string) => ({ price: null, source: null, reason })
  if (qty == null || !Number.isSafeInteger(qty) || qty < 1) return failed('Set the intended quantity before comparing quantity-specific prices')
  if (offer.soldOut || sku.stock === 0) return failed('Matching variant is out of stock')
  if (offer.moq == null) return failed('MOQ is not published; quantity applicability is unverified')
  if (qty < offer.moq) return failed(`MOQ ${offer.moq} exceeds your quantity ${qty}`)
  if (sku.stock == null) return failed('SKU stock is unknown; availability needs confirmation')
  if (qty > sku.stock) return failed(`Only ${sku.stock} published in stock for this SKU`)
  const unit = normalizeUnit(sku.unit) ?? normalizeUnit(interpretation?.unit)
  const explicitPack = publishedPackSize(sku.name)
  const pack = explicitPack ?? sku.packSize ?? interpretation?.packSize ?? null
  if (sku.unit && interpretation?.unit && normalizeUnit(sku.unit) !== normalizeUnit(interpretation.unit)) return failed('Published unit evidence is contradictory')
  if (explicitPack != null && interpretation?.packSize != null && explicitPack !== interpretation.packSize) return failed('Published pack evidence is contradictory')
  if (!unit || !target.unit || pack == null || target.packSize == null) return failed('Unit or pack contents are unknown; prices cannot be compared yet')
  if (unit !== normalizeUnit(target.unit) || pack !== target.packSize) return failed('Different unit or pack contents from the target')
  const multiple = sku.quantityMultiple ?? offer.quantityMultiple ?? publishedOrderMultiple(skuEvidenceText(offer, sku))
  if (multiple == null || !Number.isSafeInteger(multiple) || multiple < 1) return failed('Order multiple is not published; confirm the ordering terms')
  if (qty % multiple !== 0) return failed(`Order multiple is ${multiple}; your quantity is unchanged`)
  // A global ladder is not evidence that its lowest price applies to this SKU.
  const eligible = sku.tiers.filter(tier => tier.skuId === sku.id && tier.minQty <= qty && (tier.maxQty == null || tier.maxQty >= qty)).sort((a, b) => a.minQty - b.minQty)
  if (sku.tiers.length && !eligible.length) return failed('No SKU-specific price tier applies at your quantity')
  const tier = eligible.at(-1)
  if (tier && eligible.some(value => value.minQty === tier.minQty && value.price !== tier.price)) return failed('Conflicting SKU prices are published for this quantity')
  const price = tier?.price ?? sku.price
  if (price == null || price <= 0) return failed('A positive SKU-specific price is not published')
  return { price, source: tier?.source ?? sku.priceSource, reason: null }
}

function compareOne(offer: Listing1688, sku: Sku1688, target: Target1688, qty: number | null, interpretation: SkuInterpretation | undefined, currentMember: string | null): Finding1688 {
  const base: Finding1688 = { offerId: offer.offerId, skuId: sku.id, status: 'possible', reason: '', applicablePrice: null, publishedPrice: sku.price, priceSource: sku.priceSource, sameSeller: currentMember && offer.supplier.memberId ? currentMember === offer.supplier.memberId : null }
  const reject = excludedSkuReason(sku, interpretation)
  if (reject) return { ...base, status: 'excluded', reason: reject }
  if (offer.soldOut || sku.stock === 0) return { ...base, status: 'unavailable', reason: 'Published as out of stock' }
  if (!interpretation || interpretation.kind !== 'full_product') return { ...base, reason: 'Complete-product contents have not been verified; photo similarity is not enough' }
  const facts = citedFacts(interpretation.facts, skuEvidenceText(offer, sku))
  const required = new Set([...target.requiredFields, ...target.facts.map(fact => fact.field), 'product'])
  const unresolved: string[] = []
  for (const field of required) {
    const wanted = target.facts.find(fact => fact.field === field)?.value
    const found = facts.find(fact => fact.field === field)?.value
    if (!wanted || !found) { unresolved.push(field); continue }
    if (normalizeFact(wanted) !== normalizeFact(found)) return { ...base, status: 'excluded', reason: `Different ${field}: ${found}; target ${wanted}` }
  }
  if (unresolved.length) return { ...base, reason: `Unverified ${unresolved.join(', ')}` }
  if (target.status !== 'established') return { ...base, reason: 'Needs variant confirmation before price ranking' }
  const price = skuCommercialPrice(offer, sku, target, qty, interpretation)
  if (price.reason) return { ...base, reason: price.reason }
  return { ...base, status: 'matching', applicablePrice: price.price, priceSource: price.source, reason: 'Published full-product specifications, unit, quantity and stock match the target; physical quality is not assessed' }
}

export function compareOffer(offer: Listing1688, target: Target1688, qty: number | null, interpretation: OfferInterpretation | undefined, currentMember: string | null = null): Finding1688[] {
  if (!offer.skus.length) return [{ offerId: offer.offerId, skuId: null, status: 'possible', reason: 'No SKU-specific evidence published; headline price is not comparable', applicablePrice: null, publishedPrice: null, priceSource: null, sameSeller: null }]
  return offer.skus.map(sku => compareOne(offer, sku, target, qty, interpretation?.variants.find(value => value.skuId === sku.id), currentMember))
}

export function rankFindings(findings: Finding1688[]): Finding1688[] {
  const rank = { matching: 0, possible: 1, unavailable: 2, excluded: 3 }
  return [...findings].sort((a, b) => rank[a.status] - rank[b.status] || (a.status === 'matching' && b.status === 'matching' ? (a.applicablePrice ?? Infinity) - (b.applicablePrice ?? Infinity) : 0) || a.offerId.localeCompare(b.offerId) || (a.skuId ?? '').localeCompare(b.skuId ?? ''))
}

export function matchingQuality(offer: Listing1688, quality: SupplierQualitySummary[], names: string[] = []): SupplierQualitySummary | null {
  if (offer.supplier.memberId) {
    const verified = quality.find(profile => profile.memberId === offer.supplier.memberId)
    if (verified) return verified
  }
  const exact = new Set([offer.supplier.name, ...names].filter((name): name is string => Boolean(name)).map(name => name.trim()))
  const candidates = quality.filter(profile => (!profile.memberId || profile.memberId === offer.supplier.memberId) && profile.aliases.some(alias => exact.has(alias)))
  return candidates.length === 1 ? candidates[0] : null
}

export function shortlistOffers(hits: SearchHit1688[], currentId: string | null, query: string): SearchHit1688[] {
  const tokens = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(value => value.length > 1)
  const unique = new Map<string, SearchHit1688>()
  for (const hit of hits) if (hit.offerId !== currentId && !unique.has(hit.offerId)) unique.set(hit.offerId, hit)
  const relevance = (hit: SearchHit1688) => (hit.source === 'image' ? 20 : 0) + tokens.filter(token => hit.title.toLowerCase().includes(token)).length * 8 - hit.position / 20
  return [...unique.values()].sort((a, b) => relevance(b) - relevance(a) || a.offerId.localeCompare(b.offerId)).slice(0, 5)
}

export function emptyEvidence(context: ComparisonContext1688): Evidence1688 {
  return {
    stages: ['listing', 'current-shop', 'target', 'current-interpret', 'image-prepare', 'image-search', 'keyword-search', 'shortlist', 'finish'], outcomes: {},
    current: null, currentStatus: 'pending',
    target: { status: 'needs_confirmation', summary: [context.productName, context.variantLabel].filter(Boolean).join(' · '), facts: [], requiredFields: ['product'], sourceSku: null, unit: null, packSize: null, specification: '', confirmedBy: null, confirmedAt: null, reason: 'Establish the actual variant, specifications and purchasing unit; the old price is never used to guess a SKU' },
    query: [context.productName, context.variantLabel].filter(Boolean).join(' ').slice(0, 200), imageRef: null,
    searchHits: [], shortlist: [], offers: {}, shops: {}, interpretations: {}, findings: [], remarks: [], paid: { tmapi: 0, ai: 0 },
  }
}

export function recomputeFindings(evidence: Evidence1688, context: ComparisonContext1688): Evidence1688 {
  const target = evidence.target
  const findings = rankFindings(Object.values(evidence.offers).flatMap(offer => compareOffer(offer, target, context.qty, evidence.interpretations[offer.offerId], evidence.current?.supplier.memberId ?? null)))
  const remarks: string[] = []
  if (evidence.currentStatus === 'gone') remarks.push('Original listing unavailable; this does not mean the supplier stopped trading')
  if (evidence.currentStatus === 'missing-link') remarks.push('No original 1688 link; alternatives searched from saved product evidence')
  if (evidence.currentStatus === 'failed') remarks.push('Current listing lookup failed; alternative findings are separate')
  if (target.status !== 'established') remarks.push('Needs variant confirmation')
  const winner = findings.find(finding => finding.status === 'matching')
  const listPrice = context.reference?.referenceWarning ? null : context.reference?.unit_price
  if (winner?.applicablePrice != null) remarks.push(`Lowest matching price found ¥${winner.applicablePrice.toFixed(2)}${listPrice != null && winner.applicablePrice < listPrice ? ' · below previous list unit price' : ''}${winner.sameSeller ? ' · another offer from the same seller' : ''}`)
  else if (Object.keys(evidence.offers).length) remarks.push('No quantity-ready equivalent verified; possible matches are not savings')
  if (evidence.current?.moq != null && context.qty != null && context.qty < evidence.current.moq) remarks.push(`Original listing MOQ ${evidence.current.moq} exceeds your quantity`)
  for (const [stage, outcome] of Object.entries(evidence.outcomes)) if (outcome?.status === 'error') remarks.push(`${stageLabel(stage)}: ${outcome.message}`)
  return { ...evidence, findings, remarks }
}

export function confirmTarget(evidence: Evidence1688, context: ComparisonContext1688, input: TargetConfirmation1688, actor: string): Target1688 {
  const offer = input.sourceSku ? input.sourceSku.offerId === evidence.current?.offerId ? evidence.current : evidence.offers[input.sourceSku.offerId] : null
  const sku = offer?.skus.find(value => value.id === input.sourceSku?.skuId)
  if (input.sourceSku && (!offer || !sku)) throw new Error('Choose a SKU from this saved check, not another listing')
  if (sku && !sku.providerId && !sku.specId && !sku.propsIds) throw new Error('This SKU has no stable published identity. Confirm its specifications instead.')
  const interpreted = offer && sku ? evidence.interpretations[offer.offerId]?.variants.find(value => value.skuId === sku.id) : undefined
  if (sku && excludedSkuReason(sku, interpreted)) throw new Error('This is an accessory, deposit, sample or packaging variant, not the complete product')
  let facts = offer && sku && interpreted ? citedFacts(interpreted.facts, skuEvidenceText(offer, sku)) : [...evidence.target.facts]
  for (const part of input.specification.split(/[;\n]+/)) {
    const [label, ...value] = part.split(':')
    const field = FACT_FIELDS.find(key => key === label.trim().toLowerCase())
    if (field && value.join(':').trim()) facts = [...facts.filter(fact => fact.field !== field), { field, value: value.join(':').trim(), quote: part.trim() }]
  }
  if (!facts.some(fact => fact.field === 'product')) facts.push({ field: 'product', value: context.productName, quote: context.productName })
  const requiredFields = [...new Set([...evidence.target.requiredFields, ...facts.map(fact => fact.field)])]
  return {
    ...evidence.target, status: 'established', summary: sku?.name || context.variantLabel || context.productName,
    facts, requiredFields, sourceSku: input.sourceSku, unit: normalizeUnit(input.unit), packSize: input.packSize,
    specification: input.specification, confirmedBy: actor, confirmedAt: new Date().toISOString(),
    reason: 'Buyer-confirmed comparison target only. Planned quantities, supplier and costs are unchanged.',
  }
}

export function stageLabel(stage: string | undefined) {
  if (!stage) return 'Saved findings'
  if (stage.startsWith('detail:')) return `Checking alternative ${Number(stage.split(':')[1]) + 1}`
  if (stage.startsWith('interpret:')) return `Verifying variants · alternative ${Number(stage.split(':')[1]) + 1}`
  if (stage.startsWith('shop:')) return `Checking supplier · alternative ${Number(stage.split(':')[1]) + 1}`
  return ({ listing: 'Checking listing', 'current-shop': 'Checking original supplier', target: 'Establishing target specifications', 'current-interpret': 'Verifying original variants', 'image-prepare': 'Preparing product photo', 'image-search': 'Searching alternatives by photo', 'keyword-search': 'Searching alternatives by product', shortlist: 'Selecting relevant offers', finish: 'Saving findings' } as Record<string, string>)[stage] ?? stage
}

export function currentRangeLabel(offer: Listing1688 | null, target: Target1688, qty: number | null, interpretation?: OfferInterpretation) {
  if (!offer) return 'Current listing not available'
  const matching = compareOffer(offer, target, qty, interpretation).filter(finding => finding.status === 'matching' && (!target.sourceSku || target.sourceSku.offerId !== offer.offerId || finding.skuId === target.sourceSku.skuId))
  if (matching.length === 1) return `Matching variant ¥${matching[0].applicablePrice!.toFixed(2)}`
  const { min, max } = offer.price
  return min == null ? 'SKU price not published' : `Published ¥${min.toFixed(2)}${max != null && max !== min ? `–¥${max.toFixed(2)}` : ''} · verify variant / terms`
}

export const sameBaseContext = (a: ComparisonContext1688, b: ComparisonContext1688) => a.comparisonVersion === COMPARISON_VERSION && stableEvidence({ ...a, sourcePreference: a.sourcePreference ?? null, comparisonTarget: null }) === stableEvidence({ ...b, sourcePreference: b.sourcePreference ?? null, comparisonTarget: null })
