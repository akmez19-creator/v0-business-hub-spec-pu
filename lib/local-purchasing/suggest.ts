/**
 * SERVER-ONLY. Offers RANKED CANDIDATES for a supplier's wording, instead of
 * silently picking one.
 *
 * WHY NOT JUST USE `createProductMatcher()`: it returns a single best match, and
 * measured against Quotation 144 that single answer was wrong in the most
 * dangerous way available - "Automatic Sweeping Robot" matched with `exact`
 * confidence to a duplicate decoy row with 0 imports, instead of "Sweeping Robot"
 * with 3. A screen that shows both, each annotated with its import count and
 * stock, lets the buyer see in one glance which row is the real product. The
 * decoy problem is a DISPLAY problem, not a scoring problem - no amount of
 * cleverness in the ranking can tell the two apart, because their names are
 * equally plausible.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { normalizeName } from '@/lib/products/match'
import { chooseChinaReference } from './vat'
import type { ChinaCostRow } from './vat'

export interface Candidate {
  productId: string
  name: string
  stockOnHand: number | null
  imageUrl: string | null
  /** How many China POs this product has - the decoy-vs-real tell. */
  importCount: number
  /** Most recent landed unit cost, if any. */
  landedUnitCost: number | null
  /** 0-100, only to order the list. Never used to auto-accept. */
  score: number
  /** Why it is being offered, in plain words. */
  reason: string
  /**
   * A model code (M90, A9, DT6077) the label shares with this product, and how
   * many catalogue products carry that code. One product: the code identifies
   * it. Two or more: the code alone cannot, and the auto-linker must ask -
   * "A9 earbuds" is BOTH "A9 Pro Earbud" and "ANC A9 Earbuds - White".
   */
  sharedCode?: { code: string; productCount: number }
  fallbackOnly?: boolean
}

const STOP = new Set([
  'the', 'and', 'for', 'with', 'set', 'pcs', 'pc', 'new', 'type', 'size',
  'automatic', 'auto', 'portable', 'mini', 'multi',
])

/**
 * A model code: letters then digits - M90, W2, A9, G20, T9, DT6077, X7S.
 * Digits-first tokens (10m, 220v, 3in1) are SIZES and deliberately excluded:
 * "10M Rope Ladder" sharing "10m" with "10M Hanging Rope" is not evidence.
 */
const MODEL_CODE = /^[a-z]{1,3}\d{1,5}[a-z]?$/
const hasDigit = (w: string) => /\d/.test(w)

/**
 * Words dropped from scoring because they appear on hundreds of products.
 * "Automatic" is in here deliberately: it is the ONLY difference between the
 * decoy "Automatic Sweeping Robot" and the real "Sweeping Robot", so treating it
 * as meaningful is what let the decoy score an exact hit.
 */
function tokens(value: string): string[] {
  return [
    ...new Set(
      normalizeName(value)
        .split(' ')
        // MODEL CODES ARE NEVER DROPPED FOR LENGTH. "W2", "A9", "T9" used to
        // fall to the `length > 2` rule, which reduced "W2 Earbuds" to the one
        // token "earbud" - so it scored a perfect 80 against EVERY earbuds line
        // and tied with the real M90 for "M90 earbuds". The code is the most
        // identifying word in the name; throwing it away is what made the
        // ranking look like it was guessing among a lot of products.
        .filter((w) => (w.length > 2 || (hasDigit(w) && /[a-z]/.test(w))) && !STOP.has(w))
        // Crude singularisation, so "Sprayers" meets "Sprayer".
        //
        // Only above 4 characters. MEASURED consequence of not guarding this:
        // "EMS FootMassager" had its "ems" cut to "em", which then matched
        // "Silicone Pads" through the word "empty" - a nonsense candidate at the
        // top of the list. Short words are far more likely to be acronyms
        // (EMS, ABS, LED) than plurals. Never applied to a code: "X7S" is not
        // the plural of "X7".
        .map((w) => (w.length > 4 && !hasDigit(w) ? w.replace(/ies$/, 'y').replace(/es$|s$/, '') : w)),
    ),
  ]
}

export interface SuggestOptions {
  limit?: number
  /**
   * DIAGNOSTIC ONLY. Every China PO label has already been learned as an alias,
   * so with aliases on, the shared-word ranking is never exercised by real
   * data. The benchmark holds them out to measure what the ranking would do
   * for a wording it has never seen. Never set from the app.
   */
  ignoreAliases?: boolean
}

/**
 * Ranks the catalogue against each supplier label.
 *
 * Loads products, aliases, PO counts and costs ONCE for the whole quotation - a
 * per-line query would be ~850 rows x every line.
 */
export async function suggestForLabels(
  labels: string[],
  options: SuggestOptions = {},
): Promise<Map<string, Candidate[]>> {
  const limit = options.limit ?? 6
  const db = createAdminClient()

  /*
   * All three are WHOLE-TABLE reads, and Supabase silently returns only the
   * first 1000 rows. Products are at 853 and the catalogue grows; purchase
   * orders are at 690 and every China shipment adds rows. The import count
   * below is what tells a real product from a decoy - a cut here would not
   * error, it would quietly make the decoy check blind to the oldest orders.
   * `id` as the sole order key is a total order, so pages cannot overlap.
   */
  const [products, aliases, pos] = await Promise.all([
    fetchAll<{ id: string; name: string | null; quantity: number | null; image_url: string | null }>((from, to) =>
      db.from('products').select('id,name,quantity,image_url').order('id').range(from, to),
    ),
    fetchAll<{ alias_name: string | null; product_id: string | null }>((from, to) =>
      db.from('product_aliases').select('alias_name,product_id').order('id').range(from, to),
    ),
    fetchAll<{ product_id: string | null; product_name: string | null; import_cp: number | null; imported_at: string | null }>(
      (from, to) =>
        db.from('purchase_orders').select('product_id,product_name,import_cp,imported_at').order('id').range(from, to),
    ),
  ])

  // Import counts + reference cost per product.
  //
  // The cost MUST come from `chooseChinaReference`, the same function the
  // comparison uses. Writing a second "latest by date" here is how the first
  // version of this file ended up showing the Sweeping Robot at Rs 3,104.55/u
  // (the mis-linked "Cleaning Cart" PO) while the comparison panel correctly
  // showed Rs 133.56. One number, derived in ONE place, or the two screens
  // disagree and neither can be trusted.
  const grouped = new Map<string, { rows: ChinaCostRow[]; total: number }>()
  for (const po of pos ?? []) {
    const pid = po.product_id as string | null
    if (!pid) continue
    const slot = grouped.get(pid) ?? { rows: [], total: 0 }
    slot.total += 1
    const cp = Number(po.import_cp) || 0
    if (cp > 0) {
      slot.rows.push({
        landedUnitCost: cp,
        importedAt: po.imported_at ? String(po.imported_at).slice(0, 10) : null,
        qty: null,
        supplierName: null,
        label: (po.product_name as string) ?? null,
      })
    }
    grouped.set(pid, slot)
  }
  const stats = new Map<string, { count: number; cost: number | null }>()
  for (const [pid, slot] of grouped) {
    const ref = chooseChinaReference(slot.rows, slot.total)
    stats.set(pid, { count: slot.total, cost: ref.landedUnitCost > 0 ? ref.landedUnitCost : null })
  }

  // Aliases are a REAL signal, not noise: "Drum Paint" -> "Roller Paint" is a
  // genuine row in product_aliases, and I wrongly called it a false positive
  // before checking the table.
  const aliasToProduct = new Map<string, string>()
  if (!options.ignoreAliases) {
    for (const a of aliases ?? []) {
      if (a.alias_name && a.product_id) aliasToProduct.set(normalizeName(a.alias_name), a.product_id as string)
    }
  }

  const indexed = (products ?? []).map((p) => ({
    id: p.id as string,
    name: (p.name as string) ?? '',
    stockOnHand: p.quantity == null ? null : Number(p.quantity),
    imageUrl: (p.image_url as string) ?? null,
    norm: normalizeName((p.name as string) ?? ''),
    toks: tokens((p.name as string) ?? ''),
  }))

  /*
   * HOW MANY PRODUCTS CARRY EACH WORD - used ONLY to tell whether a model code
   * identifies one product ("m90": 1) or several ("a9": 4).
   *
   * I first used these counts to weight every shared word by rarity (IDF) and
   * it looked right in principle. MEASURED on 310 held-out PO labels it was
   * WORSE: top-3 fell from 73.5% to 69.0% while top-1 did not move. The
   * reason is that this catalogue is not prose - a supplier's "Dumpling making
   * artifact" and our "Dumpling Artifact" share the common word, and rare
   * words are more often noise ("artifact", "bursh") than signal. The plain
   * shared-word count stays. The model-code tier below is what fixes M90.
   */
  const df = new Map<string, number>()
  for (const p of indexed) for (const t of p.toks) df.set(t, (df.get(t) ?? 0) + 1)

  const out = new Map<string, Candidate[]>()

  for (const label of [...new Set(labels.filter(Boolean))]) {
    const ln = normalizeName(label)
    const lt = tokens(label)
    const aliasTarget = aliasToProduct.get(ln)
    const labelCodes = lt.filter((t) => MODEL_CODE.test(t))

    const scored = indexed.map((p) => {
      let score = 0
      let reason = ''
      let sharedCode: Candidate['sharedCode']

      // A model code both sides carry, and how many products carry it.
      const code = labelCodes.find((c) => p.toks.includes(c))
      if (code) sharedCode = { code, productCount: df.get(code) ?? 1 }

      if (p.norm === ln) {
        score = 100
        reason = 'Name matches exactly'
      } else if (aliasTarget === p.id) {
        score = 96
        reason = 'Known alias for this product'
      } else {
        const shared = lt.filter((t) => p.toks.includes(t))
        // Substring containment needs a real label: "m9" is inside "m90
        // wireless earbuds" and "set" is inside half the catalogue.
        const contains = ln.length >= 3 && (p.norm.includes(ln) || ln.includes(p.norm))
        if (!shared.length && !contains) return null

        const otherWords = shared.filter((t) => t !== code)

        if (sharedCode && sharedCode.productCount === 1 && otherWords.length > 0) {
          /*
           * UNIQUE MODEL CODE + a word of the same kind = this product, named.
           * "M90 earbuds" against a catalogue where exactly one product is an
           * M90, and it is an earbud. Above containment (88) because the code
           * was written by the supplier and exists nowhere else in the
           * catalogue; below alias (96) because a person has not confirmed it.
           * The code ALONE is not enough - a supplier's "T9 phone case" must
           * not link to our "T9 Trimmer" - hence `otherWords`.
           */
          score = 90
          reason = `Model code ${sharedCode.code.toUpperCase()} is unique to this product (also shares: ${otherWords.join(', ')})`
        } else if (contains) {
          // "Sweeping Robot" inside "Automatic Sweeping Robot". Strong, NOT exact -
          // this is precisely the decoy case, so it must not outrank a real check.
          score = 88
          reason = 'One name contains the other'
        } else {
          // Overlap relative to the SHORTER token set, so a long catalogue name is
          // not penalised for extra descriptive words.
          const denom = Math.min(lt.length, p.toks.length) || 1
          score = Math.round((shared.length / denom) * 80)
          reason = `Shares: ${shared.join(', ')}`
        }

        if (sharedCode && sharedCode.productCount > 1) {
          reason += ` - model code ${sharedCode.code.toUpperCase()} is on ${sharedCode.productCount} products`
        }
      }

      const s = stats.get(p.id)
      return {
        productId: p.id,
        name: p.name,
        stockOnHand: p.stockOnHand,
        imageUrl: p.imageUrl,
        importCount: s?.count ?? 0,
        landedUnitCost: s?.cost ?? null,
        score,
        reason,
        fallbackOnly: reason === 'Known alias for this product',
        ...(sharedCode ? { sharedCode } : {}),
        // Not part of the public shape - only used to detect duplicate pairs
        // below, then stripped.
        sig: p.toks.slice().sort().join('|'),
      }
    })

    const found = scored.filter(Boolean) as (Candidate & { sig: string })[]

    /*
     * DUPLICATE RESOLUTION - the decoy fix.
     *
     * "Automatic Sweeping Robot" (0 imports, qty 1) and "Sweeping Robot"
     * (3 imports, qty 4) are two rows for one real product. The supplier wrote
     * the first, so it scores a perfect 100 on exact name while the real product
     * scores 88 on containment. No scoring tweak can separate them, because as
     * NAMES both are equally plausible - "automatic" is a real adjective.
     *
     * What does separate them is that they carry the SAME meaningful tokens
     * (automatic is a stop word, so both reduce to sweeping|robot). Two catalogue
     * rows with an identical token signature are duplicates of each other, and
     * among duplicates the one with purchase history is the one the business
     * actually uses. So the whole group is lifted to the group's best score and
     * ordered by import history.
     *
     * Deliberately narrow: it only ever reorders rows WITHIN one signature, so a
     * heavily-imported unrelated product can never climb over a genuine match.
     */
    const byId = new Map<string, Candidate & { sig: string }>()
    const bestBySig = new Map<string, number>()
    for (const c of found) {
      byId.set(c.productId, c)
      bestBySig.set(c.sig, Math.max(bestBySig.get(c.sig) ?? 0, c.score))
    }

    const list = [...byId.values()]
      .map((c) => ({ ...c, groupScore: bestBySig.get(c.sig) ?? c.score }))
      .sort(
        (a, b) =>
          b.groupScore - a.groupScore ||
          // Within a duplicate group: history wins.
          b.importCount - a.importCount ||
          // Then stock, so an empty duplicate sinks below a stocked one.
          (b.stockOnHand ?? 0) - (a.stockOnHand ?? 0) ||
          b.score - a.score ||
          a.name.localeCompare(b.name),
      )
      .slice(0, limit)
      // Strip the internal fields so the shape handed to the UI stays honest.
      .map(({ sig: _sig, groupScore: _groupScore, ...rest }) => rest satisfies Candidate)

    out.set(label, list)
  }

  return out
}
