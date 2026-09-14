/**
 * Meta only tells us THAT a phone-typed reply went out (a status receipt with no
 * body); GREEN-API holds the text. A receipt and a copy are the same message only
 * when Meta's own id says so: `wamid.<base64>` encodes the customer number and the
 * WhatsApp message id that GREEN-API reports as `provider_message_id`.
 * Measured 14 Sep 2026 across 21,567 stored rows: 0 number mismatches, 0 direction
 * mismatches, 0 clock differences over 5 s among 1,173 identity matches.
 * Nothing here matches by time alone.
 */

export type ReceiptRow = {
  id: string
  wa_id: string
  direction: string
  type: string
  body: string | null
  media_id?: string | null
  created_at: string | Date
  receiptOnly?: boolean
}

export type CopyRow = {
  provider_message_id: string
  wa_id: string
  direction: string
  kind: string
  body: string | null
  provider_accepted_at: string | Date | null
  deleted_observed?: boolean
  conflicted?: boolean
}

export type ReceiptFill = { providerMessageId: string; body: string }

export type ReceiptAlignment = {
  /** Meta row id -> the verified copy that supplies its text. */
  fills: Map<string, ReceiptFill>
  /** Blank Meta rows with no verified copy: still missing content. */
  unresolvedOriginalCount: number
  /** Readable copies whose original Meta row does not exist: the transcript would omit them. */
  unalignedCopyCount: number
  /**
   * Those same copies, oldest first. Journal/history imports store the text
   * under the provider id without ever creating a Meta row, so these are the
   * ONLY record of that message; the transcript folds them in as bubbles.
   */
  historyOnlyCopies: CopyRow[]
}

export const copyTime = (value: string | Date | null | undefined) => {
  if (value === null || value === undefined) return Number.NaN
  return value instanceof Date ? value.getTime() : Date.parse(value)
}

const MAX_CLOCK_SKEW_MS = 5_000

const time = (value: string | Date | null | undefined) => {
  if (value === null || value === undefined) return Number.NaN
  return value instanceof Date ? value.getTime() : Date.parse(value)
}

/** Decode the customer number and provider message id that Meta embeds in a wamid. */
export function decodeWamid(id: unknown): { waId: string; providerMessageId: string } | null {
  if (typeof id !== 'string' || !id.startsWith('wamid.') || id.length > 200) return null
  let bytes: Buffer
  try { bytes = Buffer.from(id.slice('wamid.'.length), 'base64') } catch { return null }
  const found: string[] = []
  for (let i = 0; i < bytes.length; i++) {
    const length = bytes[i]
    if (length < 8 || length > 64 || i + 1 + length > bytes.length) continue
    const candidate = bytes.subarray(i + 1, i + 1 + length).toString('latin1')
    if (!/^[0-9A-Za-z]+$/.test(candidate)) continue
    found.push(candidate)
    i += length
  }
  if (found.length < 2 || !/^\d{5,20}$/.test(found[0])) return null
  return { waId: found[0], providerMessageId: found[found.length - 1] }
}

export function isReceiptOnly(row: Pick<ReceiptRow, 'type' | 'body' | 'media_id' | 'receiptOnly'>): boolean {
  return row.receiptOnly === true || (row.type === 'external' && !(row.body ?? '').trim() && !row.media_id)
}

const readableCopy = (copy: CopyRow) =>
  copy.kind === 'text' && !copy.deleted_observed && !copy.conflicted && typeof copy.body === 'string' && copy.body.trim().length > 0

export function alignReceiptsWithCopies(receipts: readonly ReceiptRow[], copies: readonly CopyRow[]): ReceiptAlignment {
  const copiesById = new Map<string, CopyRow>()
  for (const copy of copies) {
    if (copiesById.has(copy.provider_message_id)) {
      // Two copies claiming one id is a provider conflict; neither may fill a receipt.
      copiesById.set(copy.provider_message_id, { ...copy, conflicted: true })
    } else copiesById.set(copy.provider_message_id, copy)
  }
  const fills = new Map<string, ReceiptFill>()
  const matchedCopyIds = new Set<string>()
  let unresolved = 0
  for (const receipt of receipts) {
    const decoded = decodeWamid(receipt.id)
    if (decoded && decoded.waId === receipt.wa_id) matchedCopyIds.add(decoded.providerMessageId)
    if (!isReceiptOnly(receipt)) continue
    const copy = decoded && decoded.waId === receipt.wa_id ? copiesById.get(decoded.providerMessageId) : undefined
    const accepted = copy ? time(copy.provider_accepted_at) : Number.NaN
    const created = time(receipt.created_at)
    const clockAgrees = !copy || Number.isNaN(accepted) || (Number.isFinite(created) && Math.abs(accepted - created) <= MAX_CLOCK_SKEW_MS)
    if (copy && copy.wa_id === receipt.wa_id && copy.direction === receipt.direction && readableCopy(copy) && clockAgrees) {
      fills.set(receipt.id, { providerMessageId: copy.provider_message_id, body: copy.body!.trim() })
    } else unresolved++
  }
  const historyOnlyCopies: CopyRow[] = []
  for (const copy of copiesById.values()) {
    if (readableCopy(copy) && !matchedCopyIds.has(copy.provider_message_id)) historyOnlyCopies.push(copy)
  }
  historyOnlyCopies.sort((a, b) => {
    const difference = copyTime(a.provider_accepted_at) - copyTime(b.provider_accepted_at)
    return Number.isNaN(difference) || difference === 0 ? a.provider_message_id.localeCompare(b.provider_message_id) : difference
  })
  return { fills, unresolvedOriginalCount: unresolved, unalignedCopyCount: historyOnlyCopies.length, historyOnlyCopies }
}

/** Stable synthetic thread id for a copy that has no Meta row. */
export const historyCopyId = (providerMessageId: string) => `green:${providerMessageId}`
