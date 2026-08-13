import { generateText, Output } from 'ai'
import { z } from 'zod'

export const maxDuration = 300

interface Candidate {
  id: string
  name: string
}

interface IncomingProduct {
  name: string
}

// Classification tiers drive the whole review workflow in the UI.
//   exact  100%   identical name - safe to accept blind
//   high   >=90%  near-certain - accept in bulk
//   medium 70-89% probable - quick eyeball
//   low    50-69% doubtful - must be checked
//   none   <50%   no credible match - create new or map by hand
type MatchTier = 'exact' | 'high' | 'medium' | 'low' | 'none'

function classify(confidence: number, matched: boolean): MatchTier {
  if (!matched) return 'none'
  if (confidence >= 0.995) return 'exact'
  if (confidence >= 0.9) return 'high'
  if (confidence >= 0.7) return 'medium'
  return 'low'
}

interface Suggestion {
  id: string
  name: string
  score: number
}

interface MatchResult {
  excelProduct: string
  matchedId: string | null
  matchedName: string | null
  confidence: number // 0..1
  tier: MatchTier
  method: 'fuzzy' | 'ai' | 'none'
  reason?: string
  // Runner-up candidates so the reviewer can one-click correct a wrong pick
  // instead of hunting through a 591-item dropdown.
  alternatives: Suggestion[]
}

// ---- Local fuzzy stage (free, instant) --------------------------------------

// Normalize for comparison: lowercase, strip punctuation, drop generic filler
// words that add no discriminating signal, collapse whitespace.
const FILLER = new Set([
  'the', 'a', 'an', 'of', 'for', 'with', 'and', 'set', 'pcs', 'pc', 'pieces',
  'piece', 'pack', 'new', 'premium', 'quality', 'type', 'style',
])

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenSet(s: string): Set<string> {
  return new Set(
    normalize(s)
      .split(' ')
      .filter((t) => t.length > 1 && !FILLER.has(t)),
  )
}

// Jaccard similarity over meaningful token sets, blended with a containment
// bonus so "Facial Hair Remover" scores high against "Facial Hair Removal Agent".
function fuzzyScore(a: string, b: string): number {
  const na = normalize(a)
  const nb = normalize(b)
  if (na === nb) return 1
  const ta = tokenSet(a)
  const tb = tokenSet(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  const union = ta.size + tb.size - inter
  const jaccard = inter / union
  const containment = inter / Math.min(ta.size, tb.size)
  return jaccard * 0.6 + containment * 0.4
}

// ---- AI semantic stage ------------------------------------------------------

// How many fuzzy-ranked candidates to show the model per product. A tight
// shortlist is the key to quality: the model reranks a handful of plausible
// items instead of guessing across the whole catalog.
const SHORTLIST_SIZE = 20
// Products per AI request. Each carries its own shortlist, so batches stay small.
const AI_BATCH_SIZE = 15

// Top-N fuzzy candidates for one product, above a minimal signal floor.
function shortlist(name: string, candidates: Candidate[]): { c: Candidate; score: number }[] {
  return candidates
    .map((c) => ({ c, score: fuzzyScore(name, c.name) }))
    .filter((x) => x.score > 0.12)
    .sort((a, b) => b.score - a.score)
    .slice(0, SHORTLIST_SIZE)
}

interface BatchItem {
  name: string
  options: { c: Candidate; score: number }[]
}

async function aiMatchBatch(
  items: BatchItem[],
): Promise<Map<string, { id: string | null; confidence: number; reason: string }>> {
  // Each product gets its own numbered shortlist. The model only chooses among
  // pre-filtered plausible options, which massively improves match rate and
  // keeps token cost low even with a large catalog.
  const block = items
    .map((it, pi) => {
      const opts = it.options.map((o, oi) => `    ${oi}: ${o.c.name}`).join('\n')
      return `PRODUCT ${pi}: "${it.name}"\n  OPTIONS:\n${opts || '    (none)'}`
    })
    .join('\n\n')

  const { output } = await generateText({
    model: 'openai/gpt-4o-mini',
    output: Output.object({
      schema: z.object({
        matches: z.array(
          z.object({
            productIndex: z.number().describe('The PRODUCT number'),
            optionIndex: z.number().describe('The chosen OPTION number for that product, or -1 if none is a genuine match'),
            confidence: z.number().describe('0 to 1, how confident the match is'),
            reason: z.string().describe('Very brief justification'),
          }),
        ),
      }),
    }),
    prompt: `You match supplier product names to an existing inventory catalog. Each product has its own pre-filtered list of candidate OPTIONS.

${block}

RULES:
- For each PRODUCT, pick the SINGLE best OPTION number, or -1 if none is truly the same item.
- Match the same physical product even when wording differs: synonyms ("Remover" vs "Removal Agent"), word order ("Cleaner Vacuum" vs "Vacuum Cleaner"), abbreviations ("Mini Iron" vs "Mini Ironing Machine"), extra descriptors, or minor typos.
- Do NOT match merely related or same-category items (a "Coffee Cup" is not a "Coffee Maker").
- confidence: 0.9+ = clearly the same item, 0.7-0.9 = likely same, below 0.5 = unsure (prefer -1).
- Return exactly one entry per PRODUCT.`,
  })

  const map = new Map<string, { id: string | null; confidence: number; reason: string }>()
  for (const m of output?.matches || []) {
    const item = items[m.productIndex]
    if (!item) continue
    const opt = m.optionIndex >= 0 ? item.options[m.optionIndex] : null
    map.set(item.name, {
      id: opt ? opt.c.id : null,
      confidence: opt ? m.confidence : 0,
      reason: m.reason,
    })
  }
  return map
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      products?: IncomingProduct[]
      candidates?: Candidate[]
    }
    const products = body.products || []
    const candidates = body.candidates || []

    if (products.length === 0 || candidates.length === 0) {
      return Response.json({ matches: [], stats: { total: products.length, fuzzy: 0, ai: 0, unmatched: 0 } })
    }

    const results: MatchResult[] = []
    const needsAi: BatchItem[] = []

    // Stage 1: local fuzzy. Auto-accept strong matches; build a shortlist for
    // the rest. Products whose shortlist is empty have no plausible match at
    // all, so we skip the AI call entirely (saves tokens, avoids false hits).
    const STRONG = 0.9
    // Top runner-ups (excluding the chosen one) offered as one-click corrections.
    const altsFrom = (options: { c: Candidate; score: number }[], excludeId?: string | null): Suggestion[] =>
      options
        .filter((o) => o.c.id !== excludeId)
        .slice(0, 3)
        .map((o) => ({ id: o.c.id, name: o.c.name, score: Number(o.score.toFixed(3)) }))

    for (const p of products) {
      const options = shortlist(p.name, candidates)
      const best = options[0]
      if (best && best.score >= STRONG) {
        const confidence = Math.min(1, best.score)
        results.push({
          excelProduct: p.name,
          matchedId: best.c.id,
          matchedName: best.c.name,
          confidence,
          tier: classify(confidence, true),
          method: 'fuzzy',
          reason: `Name similarity ${(confidence * 100).toFixed(0)}%`,
          alternatives: altsFrom(options, best.c.id),
        })
      } else if (options.length > 0) {
        needsAi.push({ name: p.name, options })
      } else {
        results.push({
          excelProduct: p.name,
          matchedId: null,
          matchedName: null,
          confidence: 0,
          tier: 'none',
          method: 'none',
          reason: 'No similar name in inventory',
          alternatives: [],
        })
      }
    }

    console.log(`[v0] ai-match: ${results.length} decided by fuzzy, ${needsAi.length} to AI, ${candidates.length} candidates`)

    // Stage 2: AI reranks each product's shortlist, in batches.
    let aiCount = 0
    for (let i = 0; i < needsAi.length; i += AI_BATCH_SIZE) {
      const batch = needsAi.slice(i, i + AI_BATCH_SIZE)
      try {
        const matched = await aiMatchBatch(batch)
        for (const item of batch) {
          const m = matched.get(item.name)
          if (m && m.id && m.confidence >= 0.5) {
            const chosen = item.options.find((o) => o.c.id === m.id)
            results.push({
              excelProduct: item.name,
              matchedId: m.id,
              matchedName: chosen?.c.name ?? null,
              confidence: m.confidence,
              tier: classify(m.confidence, true),
              method: 'ai',
              reason: m.reason,
              alternatives: altsFrom(item.options, m.id),
            })
            aiCount++
          } else {
            // Rejected by the AI, but the shortlist is still the best evidence
            // we have - surface it so the reviewer can pick without searching.
            results.push({
              excelProduct: item.name,
              matchedId: null,
              matchedName: null,
              confidence: 0,
              tier: 'none',
              method: 'none',
              reason: m?.reason || 'AI found no confident match',
              alternatives: altsFrom(item.options, null),
            })
          }
        }
      } catch (err) {
        console.error(`[v0] ai-match batch ${i / AI_BATCH_SIZE + 1} failed:`, err)
        for (const item of batch) {
          results.push({
            excelProduct: item.name,
            matchedId: null,
            matchedName: null,
            confidence: 0,
            tier: 'none',
            method: 'none',
            reason: 'Matching failed for this batch',
            alternatives: altsFrom(item.options, null),
          })
        }
      }
    }

    const unmatched = results.filter((r) => !r.matchedId).length
    const tierOf = (t: MatchTier) => results.filter((r) => r.tier === t).length
    const matchedCount = products.length - unmatched
    return Response.json({
      matches: results,
      stats: {
        total: products.length,
        fuzzy: results.filter((r) => r.method === 'fuzzy').length,
        ai: aiCount,
        unmatched,
        // Percentage of incoming products the classifier could place.
        coverage: products.length ? Math.round((matchedCount / products.length) * 100) : 0,
        tiers: {
          exact: tierOf('exact'),
          high: tierOf('high'),
          medium: tierOf('medium'),
          low: tierOf('low'),
          none: tierOf('none'),
        },
      },
    })
  } catch (error) {
    console.error('[v0] ai-match error:', error)
    return Response.json({ error: 'AI matching failed' }, { status: 500 })
  }
}
