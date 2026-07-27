import { NextResponse } from 'next/server'
import { generateText } from 'ai'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// Product Master merge engine.
// GET  -> list unmatched product names from purchase orders + deliveries
// POST action=suggest -> AI matches unmatched names to canonical products
// POST action=confirm -> save validated aliases + backfill product_id links

interface UnmatchedName {
  name: string
  source: 'po' | 'delivery'
  occurrences: number
}

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

const norm = (s: string) => s.trim().toLowerCase()

export async function GET() {
  try {
    const user = await requireUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const admin = createAdminClient()

    const [{ data: products }, { data: aliases }, { data: pos }, { data: deliveries }] = await Promise.all([
      admin.from('products').select('id, name'),
      admin.from('product_aliases').select('alias_name'),
      admin.from('purchase_orders').select('product_name, product_id'),
      admin.from('deliveries').select('products, product_id').not('products', 'is', null),
    ])

    const productNames = new Set((products || []).map((p) => norm(p.name)))
    const aliasNames = new Set((aliases || []).map((a) => norm(a.alias_name)))
    const known = (n: string) => productNames.has(norm(n)) || aliasNames.has(norm(n))

    const counts = new Map<string, UnmatchedName>()
    const add = (raw: string | null, source: 'po' | 'delivery') => {
      const name = (raw || '').trim()
      if (!name || known(name)) return
      const key = `${source}:${norm(name)}`
      const existing = counts.get(key)
      if (existing) existing.occurrences += 1
      else counts.set(key, { name, source, occurrences: 1 })
    }

    for (const po of pos || []) {
      if (!po.product_id) add(po.product_name, 'po')
    }
    for (const d of deliveries || []) {
      if (!d.product_id) add(d.products, 'delivery')
    }

    const unmatched = Array.from(counts.values()).sort((a, b) => b.occurrences - a.occurrences)

    return NextResponse.json({
      success: true,
      unmatched,
      products: (products || []).map((p) => ({ id: p.id, name: p.name })),
    })
  } catch (error) {
    console.error('merge GET error:', error)
    return NextResponse.json({ success: false, error: 'Failed to load unmatched names' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = await request.json()
    const action = body?.action

    if (action === 'suggest') {
      const names: { name: string; source: string }[] = Array.isArray(body?.names) ? body.names.slice(0, 120) : []
      const products: { id: string; name: string }[] = Array.isArray(body?.products) ? body.products.slice(0, 500) : []
      if (names.length === 0 || products.length === 0) {
        return NextResponse.json({ success: false, error: 'names and products are required' }, { status: 400 })
      }

      const productList = products.map((p, i) => `${i}: ${p.name}`).join('\n')
      const nameList = names.map((n, i) => `${i}: ${n.name}`).join('\n')

      const { text } = await generateText({
        model: 'openai/gpt-5.4-mini',
        system:
          'You match messy product names from purchase orders and delivery records to a canonical product catalog. ' +
          'Names may differ by: variant suffixes ("- B1G1", "- Medium", "x2"), word order, abbreviations, plural forms, ' +
          'French/English mixes, or typos. Match on the underlying product identity, not exact text. ' +
          'OUTPUT FORMAT - one line per input name, exactly:\n' +
          '<inputIndex>|<catalogIndex or -1>|<high|medium|low|none>|<short reason>\n' +
          'Use -1 and "none" when no catalog product plausibly matches. No other text.',
        prompt: `CATALOG:\n${productList}\n\nINPUT NAMES TO MATCH:\n${nameList}`,
      })

      const suggestions = names.map((n, i) => ({
        name: n.name,
        suggestedProductId: null as string | null,
        suggestedProductName: null as string | null,
        confidence: 'none' as string,
        reason: '',
      }))
      for (const line of text.split('\n')) {
        const parts = line.split('|')
        if (parts.length < 3) continue
        const inputIdx = Number.parseInt(parts[0].trim(), 10)
        const catalogIdx = Number.parseInt(parts[1].trim(), 10)
        const confidence = ['high', 'medium', 'low', 'none'].includes(parts[2]?.trim()) ? parts[2].trim() : 'none'
        if (Number.isNaN(inputIdx) || inputIdx < 0 || inputIdx >= suggestions.length) continue
        const product = catalogIdx >= 0 && catalogIdx < products.length ? products[catalogIdx] : null
        suggestions[inputIdx] = {
          name: names[inputIdx].name,
          suggestedProductId: product?.id ?? null,
          suggestedProductName: product?.name ?? null,
          confidence: product ? confidence : 'none',
          reason: (parts[3] || '').trim().slice(0, 160),
        }
      }

      return NextResponse.json({ success: true, suggestions })
    }

    if (action === 'confirm') {
      const matches: { aliasName: string; productId: string; source: string }[] = Array.isArray(body?.matches)
        ? body.matches.filter((m: any) => m?.aliasName && m?.productId).slice(0, 200)
        : []
      if (matches.length === 0) {
        return NextResponse.json({ success: false, error: 'No matches to confirm' }, { status: 400 })
      }

      const admin = createAdminClient()
      let saved = 0
      let backfilledPOs = 0
      let backfilledDeliveries = 0

      for (const m of matches) {
        const aliasName = String(m.aliasName).trim().slice(0, 300)
        const productId = String(m.productId)
        const source = m.source === 'po' ? 'po' : 'delivery'

        const { error: aliasError } = await admin
          .from('product_aliases')
          .insert({ alias_name: aliasName, product_id: productId, source })
        if (aliasError && !aliasError.message?.includes('duplicate')) {
          console.error('alias insert failed:', aliasError.message)
          continue
        }
        saved += 1

        // Backfill both tables regardless of source - the same alias can appear in each
        const { data: poRows } = await admin
          .from('purchase_orders')
          .update({ product_id: productId })
          .ilike('product_name', aliasName)
          .is('product_id', null)
          .select('id')
        backfilledPOs += poRows?.length || 0

        const { data: dRows } = await admin
          .from('deliveries')
          .update({ product_id: productId })
          .ilike('products', aliasName)
          .is('product_id', null)
          .select('id')
        backfilledDeliveries += dRows?.length || 0
      }

      return NextResponse.json({ success: true, saved, backfilledPOs, backfilledDeliveries })
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('merge POST error:', error)
    return NextResponse.json({ success: false, error: 'Merge operation failed' }, { status: 500 })
  }
}
