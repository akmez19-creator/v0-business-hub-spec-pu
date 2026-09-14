import { generateText, Output } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { PrintedDocumentSchema, normaliseEvidence, type ReceiptEvidence, type ReceiptLine } from './evidence'
import { reconcileReceipt, type ReceiptCheck } from './reconcile'

/**
 * Reads a LOCAL PURCHASE DOCUMENT - a paper receipt photo, a supplier's PDF
 * invoice, or a WhatsApp screenshot of a price list - into purchase lines.
 *
 * This is a harder job than `payment-proof-extract.ts`, which only had to find
 * ONE number. Here a wrong read is silently expensive: a mis-read quantity or a
 * unit price mistaken for a line total corrupts the China comparison, which is
 * the entire point of the module. So the rules are:
 *
 *  - Every line is a SUGGESTION. Nothing is written to the database and no
 *    product is linked from this file. Linking stays with the ranked-candidate
 *    flow, because the matcher provably hits a decoy duplicate with "exact"
 *    confidence.
 *  - Unreadable is NOT zero and NOT an error. A blank qty comes back as null so
 *    the screen can ask, rather than quietly buying 0 units.
 *  - The document's own DECLARED TOTAL is captured separately from the lines, so
 *    the screen can prove the extraction is complete by arithmetic instead of
 *    asking the owner to trust it.
 */

/** A single line as PRINTED on the document. */
export type DocExtraction = ReceiptEvidence
export type ExtractedLine = ReceiptLine
export type ExtractionAttempt = { evidence: ReceiptEvidence; check: ReceiptCheck; purpose: 'first_read' | 'targeted_read' }

export type ExtractResult =
  | { status: 'ok' | 'suspect'; doc: DocExtraction; original: DocExtraction; attempts: ExtractionAttempt[]; warnings: string[]; check: ReceiptCheck }
  /** We looked and genuinely could not read it. NOT an error. */
  | { status: 'unreadable'; message: string }
  /** The call itself failed. Must never look like "the document is empty". */
  | { status: 'error'; message: string }

const PROMPT = `You are reading a LOCAL SUPPLIER PURCHASE DOCUMENT from Mauritius.
It may be a photo of a paper receipt, a PDF invoice, or a WhatsApp screenshot of a price list.
Prices are in Mauritian Rupees (Rs / MUR). VAT in Mauritius is 15%.

Transcribe ONLY what is actually printed. Accuracy matters far more than completeness.

CRITICAL RULES:
- Do NOT calculate, infer, or fill in missing values. If a quantity is not printed, return null.
  Never assume a missing quantity is 1.
- Distinguish UNIT PRICE from LINE TOTAL carefully. If a row shows "10 x 210 = 2100",
  then qty=10, unitPrice=210, lineTotal=2100. If only one amount is printed and you
  cannot tell which it is, put it in lineTotal and leave unitPrice null.
- Copy product descriptions EXACTLY as printed, including odd spellings and abbreviations.
  Do not tidy them up, translate them, or expand them - they are matched against a
  catalogue later and your rewording would break that.
- The description is the WORDS that name the product. It stops where the number
  columns begin: the quantity, unit price and line total go in their own fields and
  must NEVER also appear inside label. "Washing machine cleaner  364  50.00  18200.00"
  is label="Washing machine cleaner", qty=364, unitPrice=50, lineTotal=18200 - not
  label="Washing machine cleaner 50". Sizes and models that are part of the name
  ("300G Sealer", "10M Rope", "Tile 60x60") stay in the label.
- Include EVERY product line, even ones you think are duplicates.
- Keep non-product rows out of lines: Delivery/other charges go in charges, totals in
  declared* fields, and explicitly printed signed rounding in roundingAmount.
- Unit prices are NEUTRAL printed evidence: do not presume they include or exclude VAT.
  Transcribe percentages AND amounts independently; a printed discount may already be in
  the unit price. Set inclusion/stage cues only from explicit labels, never calculations.
- Preserve line tax overrides and explicit zero/exempt tax. Flag unclear pack units or
  monetary columns in issues. Keep every row, even incomplete or repeated rows.
- Capture source row and page for each item. Do not substitute a BRN for a VAT number.
- declaredTotal is the grand total the buyer pays. Read it exactly.
- If the document is too blurry to read with confidence, set legible=false and still
  return whatever you are sure of.
- Never invent a VAT number. Only report one that is printed.`

async function runModel(file: Buffer, mediaType: string, focus = '', gatewayFallback = false): Promise<DocExtraction> {
  const asImage = mediaType.startsWith('image/')
  const content: Array<Record<string, unknown>> = [{ type: 'text', text: PROMPT + focus }]
  // A PDF must go as a FILE part, not an image part - sending a PDF buffer as
  // an image silently yields a garbage read rather than an error.
  content.push(asImage ? { type: 'image', image: file } : { type: 'file', data: file, mediaType })
  const key = process.env.GOOGLE_AI_API_KEY
  const model = key && !gatewayFallback ? createGoogleGenerativeAI({ apiKey: key })('gemini-2.5-flash') : 'google/gemini-2.5-flash'
  const { output } = await generateText({
    model, output: Output.object({ schema: PrintedDocumentSchema }), maxRetries: 0,
    abortSignal: AbortSignal.timeout(90_000),
    messages: [{ role: 'user', content: content as never }],
  })
  if (!output) throw new Error('The document reader returned no structured evidence.')
  return normaliseEvidence(output)
}

/**
 * Removes a line's own figures from the end of its description.
 *
 * The owner's screenshot: "washing machine cleaner 50", "toothpaste, Niacinamide
 * 140", "Waterproof Spray 85" - every description had its list price glued on,
 * and "Washing Machine Cleaner" went from "Name matches exactly" to the weaker
 * "One name contains the other". The reader was told to copy descriptions
 * "EXACTLY as printed" and on that run it kept copying into the price column.
 * The prompt now says where a description ends, but a model is not a parser:
 * the same document read twice comes back differently, so the rule has to be
 * enforced here too, or it is enforced on the runs where the model felt like it.
 *
 * EVIDENCE, NOT PATTERN: a trailing number is removed only when it EQUALS one of
 * this line's own printed money figures (unit price or line total). "300G
 * Waterproof Sealer" leads with a number, "Tile 60x60" is not a bare number,
 * and "Cable Tie 100" at Rs 55 keeps its 100 - none of them touched. The
 * quantity is only stripped once a money figure has already come off the same
 * label (the receipt's columns run qty, price, total, so "cleaner 364 50.00"
 * loses both), because a quantity alone is too often part of a real name.
 * Never strips a label down to nothing.
 */
// [1] = everything before the trailing figure, [2] = the figure itself.
const TRAIL = /^(.*?\S)\s+(?:rs\.?\s*)?(\d[\d,]*(?:\.\d+)?)\s*$/i

function stripCopiedFigures(line: ExtractedLine): { label: string; stripped: number } {
  let label = line.label.trim()
  let stripped = 0
  let moneyGone = false
  const money = [line.unitPrice, line.lineTotal].filter((n): n is number => n != null)
  for (let guard = 0; guard < 4; guard++) {
    const m = TRAIL.exec(label)
    if (!m) break
    const n = Number(m[2].replace(/,/g, ''))
    if (!Number.isFinite(n)) break
    const isMoney = money.some((v) => Math.abs(v - n) < 0.005)
    const isQty = moneyGone && line.qty != null && Math.abs(line.qty - n) < 0.005
    if (!isMoney && !isQty) break
    label = m[1].trim()
    stripped++
    if (isMoney) moneyGone = true
  }
  return { label, stripped }
}

/** Applies `stripCopiedFigures` to every line; says how many it touched. */
export function cleanCopiedFigures(doc: DocExtraction): { doc: DocExtraction; touched: number } {
  let touched = 0
  const lines = doc.lines.map((l) => {
    const { label, stripped } = stripCopiedFigures(l)
    if (stripped === 0) return l
    touched++
    return { ...l, label }
  })
  return { doc: touched ? { ...doc, lines } : doc, touched }
}

/**
 * Checks the extraction against ITSELF by arithmetic.
 *
 * This is what makes an AI read trustworthy enough to spend money against: if
 * the lines sum to the declared total, the extraction is almost certainly
 * complete. If they do not, a line was probably missed or a unit price was read
 * as a line total - and the owner is told which, rather than discovering it in
 * his accounts.
 */
export function auditDoc(doc: DocExtraction): string[] {
  return [...reconcileReceipt(doc).issues.map((issue) => issue.message), ...(doc.notes ? [doc.notes] : [])]
}

/** Reads a photo, screenshot or PDF into purchase lines. */
export async function extractPurchaseDocument(
  file: Buffer,
  mediaType: string,
): Promise<ExtractResult> {
  let original: DocExtraction
  let calls = 0
  try {
    calls++
    original = await runModel(file, mediaType)
  } catch {
    // A failed CALL is not evidence that the document is unreadable.
    try { calls++; original = await runModel(file, mediaType, '', true) }
    catch { return { status: 'error', message: 'Could not reach the document reader. Your document has not been classified as empty; try again.' } }
  }
  let check = reconcileReceipt(original)
  const attempts: ExtractionAttempt[] = [{ evidence: original, check, purpose: 'first_read' }]
  const warnings: string[] = []
  if (check.status === 'needs_review' && calls < 2) {
    const focus = '\nSECOND AND FINAL READ: Re-examine these locations/labels in the ORIGINAL file: ' +
      check.issues.slice(0, 15).map((issue) => `${issue.lineKey || 'document totals'}: ${issue.message}`).join('; ') +
      '\nReturn a fresh transcription of ALL rows. Do not invent, alter or infer figures to make arithmetic balance. Missing/unreadable remains null.'
    try {
      calls++
      const second = await runModel(file, mediaType, focus)
      const secondCheck = reconcileReceipt(second)
      attempts.push({ evidence: second, check: secondCheck, purpose: 'targeted_read' })
      if (secondCheck.status === 'verified' || secondCheck.issues.length < check.issues.length) { original = second; check = secondCheck }
      warnings.push('The unclear evidence was read a second time. Both transcriptions are retained; arithmetic is checked separately.')
    } catch { warnings.push('The second read was unavailable. The first transcription is retained for your review.') }
  }
  if (!original.lines.length) return { status: 'unreadable', message: 'No product lines could be read. Try a clearer photo or the original PDF.' }
  // Descriptions first, arithmetic second: retain the original alongside any cleanup.
  const cleaned = cleanCopiedFigures(original)
  if (cleaned.touched) warnings.push(`Removed copied numeric columns from ${cleaned.touched} description(s). Original wording remains in the evidence.`)
  if (original.notes) warnings.push(original.notes)
  check = reconcileReceipt(cleaned.doc)
  return { status: check.status === 'verified' ? 'ok' : 'suspect', doc: cleaned.doc, original, attempts, warnings, check }
}
