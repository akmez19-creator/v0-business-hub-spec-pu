import { generateObject } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { z } from 'zod'

/**
 * Reads a Juice / bank transfer receipt and cross-checks it against the order.
 *
 * MEASURED BEHAVIOUR (10 runs on a real rider photo, gemini-2.5-flash):
 *  - the AMOUNT was read correctly and identically on every single run.
 *  - the REFERENCE was NOT stable. On the full uncropped screenshot the model
 *    returned two different strings across 5 runs and reported legible:true
 *    both times. Photos of phone screens have moire and the digits genuinely
 *    are not resolvable.
 * Hence: the amount is trusted enough to gate on, the reference is NEVER
 * presented as confirmed - it is a suggestion a human must check.
 */

const ProofSchema = z.object({
  // A bare number, not a range-checked one. Same trap as product-identify:
  // the model answers on whatever scale it likes and a .min()/.max() throws
  // away an otherwise correct read.
  amount: z.number().nullable().describe('The transfer amount in rupees, digits only. null if not clearly readable.'),
  reference: z.string().nullable().describe('The transaction / reference number exactly as printed. null if not clearly readable.'),
  referenceLegible: z.boolean().describe('True ONLY if every character of the reference is sharp and unambiguous.'),
  amountLegible: z.boolean().describe('True ONLY if the amount digits are sharp and unambiguous.'),
  sender: z.string().nullable().describe('Sender name if visible, else null.'),
  paidAt: z.string().nullable().describe('Date/time printed on the receipt, else null.'),
})

export type ProofExtraction = z.infer<typeof ProofSchema>

export type ProofCheck = {
  /** match = amount confirmed equal, mismatch = confidently different,
   *  unreadable = could not read (NEVER treated as a mismatch), error = call failed */
  status: 'match' | 'mismatch' | 'unreadable' | 'error'
  expected: number
  readAmount: number | null
  reference: string | null
  /** false whenever the model was unsure - drives the "check this" badge */
  referenceLegible: boolean
  sender: string | null
  paidAt: string | null
  message: string
}

const PROMPT = `You are reading a payment receipt (Mauritian Juice / MCB / bank transfer),
usually a PHOTO OF A PHONE SCREEN, so it may be blurry, skewed or have moire patterns.

Extract only what you can actually SEE:
- amount: the transfer amount in rupees. Digits only, no "Rs" and no thousands separator.
- reference: the transaction reference / transaction number exactly as printed.
- referenceLegible / amountLegible: be STRICT. If any character is ambiguous,
  or you are inferring a plausible-looking code rather than reading it, set the
  matching legible flag to FALSE. A guess that looks confident is worse than
  admitting it is unreadable - a wrong reference goes into bank reconciliation.

Never invent a value to fill the field. Use null when you cannot read it.`

/** Number of retries. The Gateway/free tier intermittently returns capacity
 *  errors; those are transient and must not surface as "unreadable". */
const ATTEMPTS = 3

async function runModel(image: Buffer) {
  // DIRECT KEY FIRST. This account is free tier: every Gateway vision call is
  // either paywalled or rate-limited, and leading with it silently cost two
  // failed round-trips per photo.
  const direct = process.env.GOOGLE_AI_API_KEY
  let lastErr: unknown = null

  if (direct) {
    const google = createGoogleGenerativeAI({ apiKey: direct })
    for (let i = 0; i < ATTEMPTS; i++) {
      try {
        // generateObject, NOT generateText+experimental_output: the latter
        // throws AI_NoObjectGeneratedError on every request carrying an image.
        const { object } = await generateObject({
          model: google('gemini-2.5-flash'),
          schema: ProofSchema,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              { type: 'image', image },
            ],
          }],
        })
        return object
      } catch (e) {
        lastErr = e
        await new Promise(r => setTimeout(r, 400 * (i + 1)))
      }
    }
  }

  // Gateway fallback only.
  try {
    const { object } = await generateObject({
      model: 'google/gemini-2.5-flash',
      schema: ProofSchema,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image', image },
        ],
      }],
    })
    return object
  } catch (e) {
    throw lastErr ?? e
  }
}

/**
 * Compares a receipt against the amount the client actually owes.
 * `expected` is the order total; a null/unreadable amount is NEVER a mismatch.
 */
export async function checkPaymentProof(
  image: Buffer,
  expected: number,
): Promise<ProofCheck> {
  let read: ProofExtraction
  try {
    read = await runModel(image)
  } catch (e) {
    // A failed call is an ERROR, not a verdict. Reporting "could not find the
    // amount" here would tell a rider the receipt was bad when in fact we
    // never managed to look at it.
    return {
      status: 'error',
      expected,
      readAmount: null,
      reference: null,
      referenceLegible: false,
      sender: null,
      paidAt: null,
      message: e instanceof Error ? e.message : 'Could not reach the reader',
    }
  }

  const reference = read.referenceLegible ? read.reference : null

  // Unreadable amount => explicitly NOT a mismatch. Blocking here would strand
  // a rider whose camera simply cannot resolve a phone screen.
  if (read.amount == null || !read.amountLegible) {
    return {
      status: 'unreadable',
      expected,
      readAmount: null,
      reference,
      referenceLegible: read.referenceLegible,
      sender: read.sender,
      paidAt: read.paidAt,
      message: 'Could not read the amount on this receipt',
    }
  }

  // Tolerance of 1 rupee absorbs rounding/decimal rendering, nothing more.
  const diff = Math.abs(read.amount - expected)
  if (diff <= 1) {
    return {
      status: 'match',
      expected,
      readAmount: read.amount,
      reference,
      referenceLegible: read.referenceLegible,
      sender: read.sender,
      paidAt: read.paidAt,
      message: `Receipt shows Rs ${read.amount}`,
    }
  }

  return {
    status: 'mismatch',
    expected,
    readAmount: read.amount,
    reference,
    referenceLegible: read.referenceLegible,
    sender: read.sender,
    paidAt: read.paidAt,
    message: `Receipt shows Rs ${read.amount} but this order is Rs ${expected}`,
  }
}
