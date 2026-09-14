import type { ComparisonContext1688, Listing1688, SavedCheck1688, Sku1688 } from './1688-types'
import type { ImportReference, ReorderSnapshot } from './workflow'

export type SourcingPreference = {
  product_id: string; link_id: string; offer_id: string; supplier_id: string; supplier_name: string
  listing_url: string; revision: number; selected_by: string | null; selected_at: string
}
export type SourcingVariant = {
  id: string; product_id: string; attribute_name: string; attribute_value: string; image_url: string | null
  quantity: number | null; price_override: number | null; sku: string | null; is_active: boolean | null; updated_at: string | null
}
export type SkuLink = {
  product_id: string; offer_id: string; sku_key: string; target_kind: 'parent' | 'variant'; variant_id: string | null
  source_spec: Sku1688; confirmed_by: string | null; confirmed_at: string
}
export type SourcingGuard = {
  item: { id: string; revision: number; product_id: string; variant_id: string | null; item: ComparisonContext1688['savedItem'] }
  product: { id: string; name: string; image_url: string | null; has_variants: boolean | null; quantity: number | null; is_active: boolean | null; updated_at: string | null }
  variants: SourcingVariant[]; references: ImportReference[]; mappings: SkuLink[]; preference?: SourcingPreference | null
}
export type SkuReview = {
  skuId: string; include: boolean; reviewed: boolean; destination: 'review' | 'parent' | 'existing' | 'new'
  variantId: string | null; attributeName: string; attributeValue: string; qty: number | null
  keepPhoto: boolean; samePreviousUnit: boolean
}
export type PreparedPhoto = { source: string | null; url: string | null; status: 'ready' | 'failed'; error: string | null }
export type SourcingInput = {
  itemId: string; itemRevision: number; generation: number; checkVersion: number; offerId: string; guardHash: string
  selectionId: string; selectionRevision: number; preferenceRevision: number; convertToVariants: boolean
  quantityDifferenceAccepted: boolean; unverifiedTermsAccepted: boolean; reviews: SkuReview[]; requestKey: string
}
export type PurchaseDifference = {
  previousList: number | null; previousNet: number | null; proposed: number | null; baselineKind: 'negotiated' | 'list' | null
  perUnit: number | null; percent: number | null; goods: number | null; reason: string | null; reference: ImportReference | null
}
export type ReviewedSku = {
  review: SkuReview; sku: Sku1688; inventory: SourcingVariant | null; photo: PreparedPhoto | null
  price: number | null; priceSource: string | null; warnings: string[]; blockers: string[]; difference: PurchaseDifference
}
export type SourcingSnapshot = {
  check: SavedCheck1688; source: Listing1688; input: SourcingInput; rows: ReviewedSku[]
  intendedQty: number | null; orderedQty: number; guard: SourcingGuard
}
export type SourcingSelection = {
  id: string; item_id: string; product_id: string; revision: number; status: 'pending' | 'confirmed' | 'cancelled'
  preference_revision: number; snapshot: SourcingSnapshot; guard: SourcingGuard; photos: Record<string, PreparedPhoto>
  result: SourcingConfirmation | null; created_at: string; updated_at: string; created_by: string | null
}
export type SourcingConfirmation = { id: string; revision: number; number: number; status: string; imports: { id: string; index: string; lineId: string }[] }
export type SourcingWorkspace = { guard: SourcingGuard; guardHash: string; selection: SourcingSelection | null; preference: SourcingPreference | null }
export type SourcingTerms = { orderDate: string | null; chinaFreight: number | null; fxRate: number | null }
export type SourcingPurchasePreview = {
  snapshot: ReorderSnapshot; rows: ReviewedSku[]; blockers: string[]; warnings: string[]
  goods: number | null; difference: number | null; covered: number; ordered: number; units: number
}
export type ResearchRun = {
  id: string; request_key: string; actor_id: string | null; workflow_id: string | null
  status: 'accepted' | 'running' | 'stopping' | 'complete' | 'paused' | 'dispatch_unknown'
  stop_requested: boolean; reason: string | null; created_at: string; updated_at: string
}
export type ResearchJob = {
  id: string; run_id: string; item_id: string; position: number; mode: 'fresh' | 'resume'
  status: 'queued' | 'running' | 'complete' | 'partial' | 'failed' | 'stopped' | 'stale' | 'interrupted'
  item_revision: number; generation: number; version: number; check_generation: number | null
  context: ComparisonContext1688; guard: SourcingGuard; lease_key: string | null; lease_until: string | null
  tmapi_reserved: number; ai_reserved: number; tmapi_actual: number; ai_actual: number
  attempts: { key: string; stage: string; state: string; tmapi: number; ai: number; at: string }[]
  reason: string | null; created_at: string; updated_at: string
}
export type ResearchQueueStatus = { runs: ResearchRun[]; jobs: ResearchJob[]; checks: SavedCheck1688[] }
