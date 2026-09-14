import { houseName } from '@/lib/products/house-name'

export const maxDuration = 300

interface IncomingItem {
  key: string // the Excel product name, used to correlate the response
  currentName: string // name shown today (inventory name if mapped, else Excel name)
  imageUrl?: string | null // product photo - the strongest naming signal
}

interface NameSuggestion {
  key: string
  suggested: string
  reason: string
  source: 'vision' | 'text'
}

// The naming rules (two words, Title Case, reuse the shop vocabulary) live in
// lib/products/house-name.ts and are shared with the purchasing page's "Create
// in inventory" dialog. They used to be defined here, which meant the other
// place that mints products could not use them - and named things differently.

async function nameOne(item: IncomingItem, vocabulary: string[]): Promise<NameSuggestion | null> {
  try {
    const result = await houseName({ imageUrl: item.imageUrl, currentName: item.currentName, vocabulary })
    if (!result) return null
    return { key: item.key, suggested: result.name, reason: result.reason, source: result.source }
  } catch (err) {
    console.error('[v0] suggest-names failed for', item.key, err instanceof Error ? err.message : err)
    return null
  }
}

/** Run with a small concurrency cap so vision calls do not get rate limited. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      out[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return out
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      items?: IncomingItem[]
      inventoryNames?: string[]
    }
    const items = (body.items || []).filter(i => i && i.key && i.currentName)
    if (!items.length) {
      return Response.json({ success: false, error: 'No products supplied' }, { status: 400 })
    }
    // Cap per request so a 591-product import is paged by the client instead
    // of firing hundreds of vision calls in one function invocation.
    if (items.length > 60) {
      return Response.json(
        { success: false, error: 'Too many products in one request (max 60)' },
        { status: 400 },
      )
    }

    // The real inventory names teach the model the house style. The shared
    // module caps the joined text itself, so the whole list goes in.
    const vocabulary = (body.inventoryNames || []).filter(Boolean)

    const settled = await mapLimited(items, 4, item => nameOne(item, vocabulary))
    const suggestions = settled.filter((s): s is NameSuggestion => !!s)

    // Only surface names that actually differ from what is there today.
    const changed = suggestions.filter(
      s => s.suggested.toLowerCase() !== (items.find(i => i.key === s.key)?.currentName || '').toLowerCase(),
    )

    return Response.json({
      success: true,
      suggestions,
      stats: {
        requested: items.length,
        named: suggestions.length,
        changed: changed.length,
        failed: items.length - suggestions.length,
      },
    })
  } catch (err) {
    console.error('[v0] suggest-names route error:', err)
    return Response.json(
      { success: false, error: err instanceof Error ? err.message : 'Naming failed' },
      { status: 500 },
    )
  }
}
