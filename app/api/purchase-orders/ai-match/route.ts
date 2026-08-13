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

interface MatchResult {
  excelProduct: string
  matchedId: string | null
  confidence: number // 0..1
  method: 'fuzzy' | 'ai' | 'none'
  reason?: string
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

function bestFuzzy(name: string, candidates: Candidate[]): { c: Candidate; score: number } | null {
  let best: { c: Candidate; score: number } | null = null
  for (const c of candidates) {
    const score = fuzzyScore(name, c.name)
    if (!best || score > best.score) best = { c, score }
  }
  return best
}

// ---- AI semantic stage ------------------------------------------------------

const AI_BATCH_SIZE = 40

async function aiMatchBatch(
  products: string[],
  candidates: Candidate[],
): Promise<Map<string, { index: number; confidence: number; reason: string }>> {
  // Present candidates by integer index to keep tokens down and prevent the
  // model from inventing malformed UUIDs. We map the index back to a real id.
  const candidateList = candidates.map((c, i) => `${i}: ${c.name}`).join('\n')

  const { output } = await generateText({
    model: 'openai/gpt-4o-mini',
    output: Output.object({
      schema: z.object({
        matches: z.array(
          z.object({
            product: z.string(),
            candidateIndex: z.number().describe('Index of the best matching inventory item, or -1 if none is a genuine match'),
            confidence: z.number().describe('0 to 1, how confident the match is'),
            reason: z.string().describe('Very brief justification'),
          }),
        ),
      }),
    }),
    prompt: `You match supplier product names to an existing inventory catalog.

INVENTORY CATALOG (index: name):
${candidateList}

PRODUCTS TO MATCH:
${products.map((p) => `- ${p}`).join('\n')}

RULES:
- For each product, pick the SINGLE best matching inventory index, or -1 if nothing is truly the same item.
- Match the same physical product even when wording differs: synonyms ("Remover" vs "Removal Agent"), word order ("Cleaner Vacuum" vs "Vacuum Cleaner"), abbreviations ("Mini Iron" vs "Mini Ironing Machine"), extra descriptors, or minor typos.
- Do NOT match merely related or same-category items (a "Coffee Cup" is not a "Coffee Maker").
- confidence: 0.9+ = clearly the same item, 0.7-0.9 = likely same, below 0.5 = unsure (prefer -1).
- Return exactly one entry per product, echoing the product name verbatim.`,
  })

  const map = new Map<string, { index: number; confidence: number; reason: string }>()
  for (const m of output?.matches || []) {
    map.set(m.product, { index: m.candidateIndex, confidence: m.confidence, reason: m.reason })
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
    const needsAi: string[] = []

    // Stage 1: local fuzzy. Auto-accept strong matches; defer the rest to AI.
    const STRONG = 0.9
    for (const p of products) {
      const best = bestFuzzy(p.name, candidates)
      if (best && best.score >= STRONG) {
        results.push({
          excelProduct: p.name,
          matchedId: best.c.id,
          confidence: Math.min(1, best.score),
          method: 'fuzzy',
          reason: `Name similarity ${(best.score * 100).toFixed(0)}%`,
        })
      } else {
        needsAi.push(p.name)
      }
    }

    console.log(`[v0] ai-match: ${results.length} matched by fuzzy, ${needsAi.length} to AI, ${candidates.length} candidates`)

    // Stage 2: AI semantic matching for the leftovers, in batches.
    let aiCount = 0
    for (let i = 0; i < needsAi.length; i += AI_BATCH_SIZE) {
      const batch = needsAi.slice(i, i + AI_BATCH_SIZE)
      try {
        const matched = await aiMatchBatch(batch, candidates)
        for (const name of batch) {
          const m = matched.get(name)
          if (m && m.index >= 0 && m.index < candidates.length && m.confidence >= 0.5) {
            results.push({
              excelProduct: name,
              matchedId: candidates[m.index].id,
              confidence: m.confidence,
              method: 'ai',
              reason: m.reason,
            })
            aiCount++
          } else {
            results.push({ excelProduct: name, matchedId: null, confidence: 0, method: 'none' })
          }
        }
      } catch (err) {
        console.error(`[v0] ai-match batch ${i / AI_BATCH_SIZE + 1} failed:`, err)
        for (const name of batch) {
          results.push({ excelProduct: name, matchedId: null, confidence: 0, method: 'none' })
        }
      }
    }

    const unmatched = results.filter((r) => !r.matchedId).length
    return Response.json({
      matches: results,
      stats: {
        total: products.length,
        fuzzy: results.filter((r) => r.method === 'fuzzy').length,
        ai: aiCount,
        unmatched,
      },
    })
  } catch (error) {
    console.error('[v0] ai-match error:', error)
    return Response.json({ error: 'AI matching failed' }, { status: 500 })
  }
}
