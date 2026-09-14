import type { ImportReference, SavedReorderItem } from './workflow'

export const COMPARISON_VERSION = 2
const CHECK_LIMITS = {
  searches: 2,
  hitsPerSearch: 20,
  candidates: 5,
  tmapiCalls: 15,
  aiCalls: 7,
  workers: 3,
} as const

export { CHECK_LIMITS }
export const FACT_FIELDS = ['product', 'brand', 'model', 'size', 'capacity', 'voltage', 'plug', 'material', 'contents', 'color'] as const
export type FactField = (typeof FACT_FIELDS)[number]
export type EvidenceFact = { field: FactField; value: string; quote: string }
export type Rating1688 = { type: string; title: string; score: number }
export type PriceTier1688 = { minQty: number; maxQty: number | null; price: number; skuId: string | null; source: string }
export type Sku1688 = {
  id: string
  providerId: string | null
  specId: string | null
  propsIds: string | null
  name: string
  attributes: { name: string; value: string }[]
  imageUrl: string | null
  price: number | null
  regularPrice: number | null
  priceSource: string | null
  stock: number | null
  unit: string | null
  packSize: number | null
  quantityMultiple: number | null
  tiers: PriceTier1688[]
}
export type Shop1688 = {
  memberId: string
  names: string[]
  rating: number | null
  ratings: Rating1688[]
  observedAt: string
  error: string | null
  years: number | null
  isFactory: boolean
  location: string | null
}
export type Listing1688 = {
  offerId: string
  title: string
  pageUrl: string
  imageUrl: string | null
  images: string[]
  observedAt: string
  soldOut: boolean
  moq: number | null
  unit: string | null
  quantityMultiple: number | null
  productProps: { name: string; value: string }[]
  skus: Sku1688[]
  supplier: { name: string | null; memberId: string | null }
  price: { min: number | null; max: number | null; promotion: number | null; tiers: PriceTier1688[] }
  freight: { fee: number | null; shipsFrom: string | null }
}
export type SearchHit1688 = {
  offerId: string
  title: string
  imageUrl: string | null
  memberId: string | null
  supplierName: string | null
  source: 'image' | 'keyword'
  position: number
}
export type SkuInterpretation = {
  skuId: string
  kind: 'full_product' | 'accessory' | 'replacement' | 'packaging' | 'deposit' | 'sample' | 'unknown'
  kindQuote: string
  facts: EvidenceFact[]
  unit: string | null
  packSize: number | null
  unitQuote: string | null
  reason: string
}
export type OfferInterpretation = {
  offerId: string
  variants: SkuInterpretation[]
  observedAt: string
  error: string | null
}
export type Target1688 = {
  status: 'needs_confirmation' | 'established'
  summary: string
  facts: EvidenceFact[]
  requiredFields: FactField[]
  sourceSku: { offerId: string; skuId: string } | null
  unit: string | null
  packSize: number | null
  specification: string
  confirmedBy: string | null
  confirmedAt: string | null
  reason: string
}
export type ComparisonContext1688 = {
  comparisonVersion: number
  itemId: string
  itemRevision: number
  productId: string | null
  variantId: string | null
  productName: string
  productImage: string | null
  productDescription: string | null
  productSku: string | null
  productUpdatedAt: string | null
  variantLabel: string | null
  variantImage: string | null
  variantUpdatedAt: string | null
  sourceLink: string | null
  sourcePreference?: { offerId: string; revision: number } | null
  reference: ImportReference | null
  savedItem: SavedReorderItem['item']
  supplierName: string
  qty: number | null
  comparisonTarget: TargetConfirmation1688 | null
}
export type CheckStage1688 =
  | 'listing' | 'current-shop' | 'target' | 'current-interpret' | 'image-prepare' | 'image-search' | 'keyword-search' | 'shortlist' | 'finish'
  | `detail:${number}` | `interpret:${number}` | `shop:${number}`
export type StageOutcome1688 = { status: 'ok' | 'skipped' | 'error'; at: string; message: string | null; terminal?: boolean }
export type Finding1688 = {
  offerId: string
  skuId: string | null
  status: 'matching' | 'possible' | 'excluded' | 'unavailable'
  reason: string
  applicablePrice: number | null
  publishedPrice: number | null
  priceSource: string | null
  sameSeller: boolean | null
}
export type Evidence1688 = {
  stages: CheckStage1688[]
  outcomes: Partial<Record<CheckStage1688, StageOutcome1688>>
  current: Listing1688 | null
  currentStatus: 'pending' | 'available' | 'missing-link' | 'gone' | 'failed'
  target: Target1688
  query: string
  imageRef: string | null
  searchHits: SearchHit1688[]
  shortlist: SearchHit1688[]
  offers: Record<string, Listing1688>
  shops: Record<string, Shop1688>
  interpretations: Record<string, OfferInterpretation>
  findings: Finding1688[]
  remarks: string[]
  paid: { tmapi: number; ai: number }
}
export type SavedCheck1688 = {
  item_id: string
  item_revision: number
  generation: number
  version: number
  context_hash: string
  context: ComparisonContext1688
  run_key: string
  actor_id: string | null
  status: 'running' | 'paused' | 'complete' | 'partial' | 'failed'
  cursor: number
  evidence: Evidence1688
  previous_success: { evidence: Evidence1688; context: ComparisonContext1688; checkedAt: string } | null
  started_at: string
  updated_at: string
  finished_at: string | null
  lease_key: string | null
  lease_until: string | null
  stop_requested: boolean
  last_control_key: string
  last_control_hash: string
  last_stage_key: string | null
  isCurrent?: boolean
}
export type SupplierQualitySummary = {
  id: string
  name: string
  memberId: string | null
  aliases: string[]
  internalRating: number | null
  revision: number
  noteCount: number
  defectCount: number
  latestNote: string | null
  latestNoteAt: string | null
  latestNoteAuthor: string | null
  platformRating: number | null
  platformRatings: Rating1688[]
  platformObservedAt: string | null
  platformAttemptAt: string | null
  platformStatus: 'not_checked' | 'available' | 'unavailable'
  platformError: string | null
}
export type QualityNote = {
  id: string
  body: string
  kind: 'general' | 'defect'
  authorName: string
  createdAt: string
  productCaption: string | null
  importCaption: string | null
  ratingBefore: number | null
  ratingAfter: number | null
  ratingChanged: boolean
}
export type QualityPage = { summary: SupplierQualitySummary | null; notes: QualityNote[]; nextCursor: string | null }
export type QualityImportOption = { id: string; caption: string; productId: string | null }
export type QualityNoteInput = {
  name: string
  revision: number
  rating: number | null
  body: string
  kind: 'general' | 'defect'
  productId: string | null
  importId: string | null
  requestKey: string
}
export type TargetConfirmation1688 = {
  sourceSku: { offerId: string; skuId: string } | null
  specification: string
  unit: string
  packSize: number
}
export type CheckCommand1688 = {
  operation: 'start' | 'next' | 'stop' | 'confirm-target'
  itemId: string
  revision: number
  generation: number
  version: number
  requestKey: string
  runKey: string
  mode?: 'fresh' | 'resume'
  target?: TargetConfirmation1688
}
export type CheckResponse1688 = {
  success: boolean
  check?: SavedCheck1688
  quality?: SupplierQualitySummary[]
  error?: string
  reason?: string
  stopReason?: string
  checkedButNotSaved?: boolean
}
