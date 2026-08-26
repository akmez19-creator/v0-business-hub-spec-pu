/**
 * Matching a 1688 chat contact to suppliers in our purchase_orders table.
 *
 * WHY THIS IS NOT A TRIGRAM SEARCH
 * --------------------------------
 * Probed against the live table (690 POs, 521 distinct supplier names, 515 of
 * them Chinese): trigram similarity is actively dangerous here because Chinese
 * company names are mostly shared boilerplate.
 *
 *   similarity('深圳市硅魅电子科技有限公司', '深圳市莹宝橡塑电子科技有限公司') = 0.50
 *
 * Those are two unrelated companies, yet they score higher than many true
 * matches. Showing one supplier's order history while the purchaser negotiates
 * with a different supplier is worse than showing nothing at all - they would
 * quote a price we never paid to this factory.
 *
 * So we strip the boilerplate (省/市/科技/电子/有限公司/...) down to the
 * DISTINCTIVE core and compare that instead. 硅魅 vs 莹宝橡塑 then correctly
 * fails to match, while ruipan, 义乌创一五金 and 深圳市莹宝橡塑电子科技有限公司
 * all still match themselves.
 */

/** Legal-form and geography noise that is shared across unrelated companies. */
const BOILERPLATE =
  /(有限责任公司|有限公司|股份公司|股份|集团|科技|电子|实业|贸易|商贸|工贸|制品|用品|器材|机械|服饰|家居|日用|批发|工厂|公司|企业|商行|经营部|个体户|旗舰店|专营店|官方|自营|厂家|工厂店|厂|店|省|市|区|县|镇)/g

/** Punctuation/spacing that varies between the chat header and our records. */
const PUNCT = /[\s\u3000()（）[\]【】<>《》,，.。、_\-—+*&/\\|"'`~!?:;：；]/g

export type MatchConfidence = 'exact' | 'core' | 'none'

export interface SupplierMatch {
  name: string
  confidence: MatchConfidence
}

/** Normalize for an exact comparison: case, width and punctuation only. */
export function normalizeName(raw: string): string {
  return String(raw || '')
    .normalize('NFKC')
    .replace(PUNCT, '')
    .toLowerCase()
    .trim()
}

/**
 * Reduce a company name to its distinctive core by removing boilerplate.
 * `深圳市硅魅电子科技有限公司` -> `硅魅`
 */
export function coreName(raw: string): string {
  return normalizeName(raw).replace(BOILERPLATE, '').trim()
}

/**
 * A core is only usable as evidence when it is distinctive enough. Two Chinese
 * characters is the practical floor - a single character matches far too much.
 */
function coreIsUsable(core: string): boolean {
  if (!core) return false
  const hasCjk = /[\u4e00-\u9fa5]/.test(core)
  return hasCjk ? core.length >= 2 : core.length >= 4
}

/**
 * Find supplier names that plausibly refer to the same company.
 *
 * Returns `exact` matches when the normalized names are identical, otherwise
 * `core` matches when the distinctive cores line up. Never guesses: an
 * unrecognised supplier returns an empty list so the caller can say "no history
 * on file" rather than showing another factory's orders.
 *
 * @param queries  Candidate names for the contact (chat nickname, company name)
 * @param known    Every distinct supplier_name currently in purchase_orders
 */
export function matchSuppliers(queries: string[], known: string[]): SupplierMatch[] {
  const out = new Map<string, MatchConfidence>()

  const cleanQueries = queries.map(q => String(q || '').trim()).filter(Boolean)
  if (!cleanQueries.length) return []

  for (const q of cleanQueries) {
    const nq = normalizeName(q)
    if (!nq) continue

    for (const name of known) {
      if (!name) continue
      if (normalizeName(name) === nq) out.set(name, 'exact')
    }
  }

  // Only fall back to core matching for names we have not already pinned
  // exactly - an exact hit is always the better answer.
  for (const q of cleanQueries) {
    const cq = coreName(q)
    if (!coreIsUsable(cq)) continue

    for (const name of known) {
      if (!name || out.get(name) === 'exact') continue
      const cn = coreName(name)
      if (!coreIsUsable(cn)) continue

      // Equal cores, or one core fully contains the other (covers a chat
      // nickname that is a shortened form of the registered company name).
      const contained =
        cn === cq || (cq.length >= 2 && cn.includes(cq)) || (cn.length >= 2 && cq.includes(cn))
      if (contained) out.set(name, 'core')
    }
  }

  return [...out.entries()]
    .map(([name, confidence]) => ({ name, confidence }))
    .sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'exact' ? -1 : 1))
}
