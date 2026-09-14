/**
 * Decides, with NO database access, whether a line's top candidate is safe to
 * link automatically.
 *
 * WHY THIS EXISTS: confirm-every-line was the old behaviour, and the owner is
 * right that it does not survive contact with a 30-line invoice - a protective
 * step that must be repeated 30 times is a step that gets clicked through
 * blindly, which is worse than no step at all. So linking is now AUTOMATIC.
 *
 * WHAT IT REFUSES TO DO: link when the evidence is genuinely ambiguous. The
 * measured failure on Quotation 144 was "Automatic Sweeping Robot" (a decoy
 * duplicate, 0 imports) beating the real "Sweeping Robot" (3 imports). Auto-
 * linking the raw top answer would have attached that purchase to a product the
 * business never buys, and nobody would ever have looked again. `suggest.ts`
 * already reorders duplicate groups by import history, so the top answer is far
 * better than it was - but "better" is not "certain", and the whole point of
 * automating is that no human re-reads it.
 *
 * So: automatic where the evidence is decisive, held back for a human where it
 * is not. Pure so the rules can be tested against real catalogue rows without a
 * database.
 */
import type { Candidate } from './suggest'

/**
 * Only name-level evidence qualifies.
 *
 * `suggest.ts` scores exact name 100, known alias 96, one-name-contains-the-
 * other 88, and shared-words at most 80. Everything at or above 88 is evidence
 * about the NAME; below that it is "these two strings have words in common",
 * which is how "EMS FootMassager" once surfaced "Silicone Pads" through the word
 * "empty". Shared words are fine to OFFER, never to accept unattended.
 */
const NAME_LEVEL = 88

/** A runner-up this close is a tie, not a second place. */
const DECISIVE_GAP = 8

export type AutoLinkVerdict =
  | { link: true; productId: string; productName: string; reason: string }
  | { link: false; reason: string; needsChoice: boolean }

/**
 * @param candidates Ranked best-first, exactly as `suggestForLabels` returns.
 */
export function decideAutoLink(candidates: Candidate[]): AutoLinkVerdict {
  const top = candidates[0]
  if (!top) {
    return {
      link: false,
      reason: 'Nothing in the catalogue resembles this - it may be a new product',
      // Not a choice between candidates; the answer is create-or-leave.
      needsChoice: false,
    }
  }

  if (top.fallbackOnly) {
    return { link: false, needsChoice: true, reason: 'This wording is a global alias, not a confirmed identity for this supplier. Choose the correct product once; it will be remembered when the purchase is saved.' }
  }

  if (top.score < NAME_LEVEL) {
    return {
      link: false,
      reason: `Only shared words, no name match (${top.reason.toLowerCase()})`,
      needsChoice: true,
    }
  }

  const second = candidates[1]
  const gap = second ? top.score - second.score : 100

  /*
   * A MODEL CODE ON SEVERAL PRODUCTS CANNOT PICK ONE OF THEM.
   *
   * "A9 earbuds" is both "A9 Pro Earbud" and "ANC A9 Earbuds - White" - two
   * real products in the catalogue, not a decoy pair. Whatever string
   * similarity puts one ahead, the supplier wrote the code and the code
   * names both, so this is a question for the buyer. Before the gap check for
   * the same reason as the decoy override: a gap is not evidence here.
   */
  if (top.sharedCode && top.sharedCode.productCount > 1 && top.score < 96) {
    return {
      link: false,
      reason: `Model code ${top.sharedCode.code.toUpperCase()} is on ${top.sharedCode.productCount} products - which one is this?`,
      needsChoice: true,
    }
  }

  /*
   * THE DECOY OVERRIDE, and it must come BEFORE the score-gap check.
   *
   * My first version put the gap check first and the test caught it linking the
   * decoy: "Automatic Sweeping Robot" (exact name, 100, 0 imports) beat the real
   * "Sweeping Robot" (92, 3 imports) by exactly the 8-point gap I called
   * decisive. That is the Rs 3,104 mistake reproduced in a new place.
   *
   * A SCORE GAP IS NOT EVIDENCE WHEN THE LOSER HAS THE HISTORY. The business
   * having bought the runner-up repeatedly, and the winner never, outranks any
   * amount of string similarity - a name can be a typo or a duplicate row, but
   * money actually spent cannot. So whenever the top has no history and a
   * name-level rival does, this asks.
   */
  if (
    second &&
    second.score >= NAME_LEVEL &&
    top.importCount === 0 &&
    second.importCount > 0
  ) {
    return {
      link: false,
      reason: `Two similar products: "${top.name}" has never been bought, but "${second.name}" has (${second.importCount} imports) - which is it?`,
      needsChoice: true,
    }
  }

  if (gap >= DECISIVE_GAP) {
    return {
      link: true,
      productId: top.productId,
      productName: top.name,
      reason: top.reason,
    }
  }

  /*
   * A near tie. This is either two rows for ONE real product (the decoy case)
   * or two genuinely different products with similar names. Import history is
   * what tells them apart: the business buys the real one repeatedly and has
   * never bought the decoy.
   *
   * Only decisive when exactly one side has history. Two candidates that have
   * both been imported are two real products, and guessing between them is the
   * mistake this whole module exists to avoid.
   */
  if (top.importCount > 0 && second.importCount === 0) {
    return {
      link: true,
      productId: top.productId,
      productName: top.name,
      reason: `${top.reason}, and it is the one with purchase history (${top.importCount} imports vs 0)`,
    }
  }

  return {
    link: false,
    reason:
      top.importCount === 0 && second.importCount === 0
        ? `Two possible products, neither ever imported - "${top.name}" or "${second.name}"`
        : `Two possible products, both imported before - "${top.name}" or "${second.name}"`,
    needsChoice: true,
  }
}
