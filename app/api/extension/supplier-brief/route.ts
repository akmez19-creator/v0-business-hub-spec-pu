import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { matchSuppliers, type MatchConfidence } from '@/lib/purchase-orders/supplier-match'

// Do NOT use the edge runtime with the AI SDK.
export const runtime = 'nodejs'

/**
 * Uses the project's own OpenAI key. The AI Gateway 429s on this account's free
 * tier, so routing through it makes the draft silently fail. Keep in step with
 * /api/extension/ai-reply.
 */
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY })

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Refresh-Token',
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

async function getUserFromToken(request: NextRequest) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const accessToken = authHeader.replace('Bearer ', '')

  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const {
    data: { user },
    error,
  } = await adminSupabase.auth.getUser(accessToken)
  if (error || !user) return null
  return { user, supabase: adminSupabase }
}

interface ChatTurn {
  from?: string
  text?: string
}

/** The PO fields a purchaser actually negotiates against. */
const PO_FIELDS =
  'id, index_no, status, product_name, qty, carton, unit_price, discounted_unit_price, ' +
  'shipment_to_warehouse, discounted_shipment_to_warehouse, discounted_percentage, ' +
  'total_payment_supplier_yuan, total_payment_supplier, weight_kg, cbm, boxes, ' +
  'link, image_url, order_date, created_at'

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getUserFromToken(request)
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401, headers: corsHeaders },
      )
    }
    const { supabase } = auth
    const body = await request.json()

    const names: string[] = (Array.isArray(body.names) ? body.names : [])
      .map((n: unknown) => String(n || '').slice(0, 120))
      .filter(Boolean)
    if (!names.length) {
      return NextResponse.json(
        { success: false, error: 'No supplier name supplied' },
        { status: 400, headers: corsHeaders },
      )
    }

    // ---- match the contact to suppliers we have actually ordered from -------
    // Never a fuzzy/trigram search: see lib/purchase-orders/supplier-match.ts
    // for why that produces confident matches between unrelated factories.
    const { data: distinctRows, error: distinctErr } = await supabase
      .from('purchase_orders')
      .select('supplier_name')
      .not('supplier_name', 'is', null)
      .limit(5000)
    if (distinctErr) throw distinctErr

    const known = [
      ...new Set((distinctRows || []).map(r => String(r.supplier_name || '')).filter(Boolean)),
    ]
    const matches = matchSuppliers(names, known)
    const confidence: MatchConfidence = matches[0]?.confidence ?? 'none'

    let orders: Record<string, unknown>[] = []
    if (matches.length) {
      const { data: poRows, error: poErr } = await supabase
        .from('purchase_orders')
        .select(PO_FIELDS)
        .in(
          'supplier_name',
          matches.map(m => m.name),
        )
        .order('created_at', { ascending: false })
        .limit(60)
      if (poErr) throw poErr
      // The select list is a runtime string, so supabase-js cannot infer a row
      // shape for it; every field is read defensively below.
      orders = (poRows || []) as unknown as Record<string, unknown>[]
    }

    // ---- aggregates the purchaser can quote in the chat ---------------------
    const prices = orders.map(o => num(o.discounted_unit_price) ?? num(o.unit_price)).filter((n): n is number => n !== null && n > 0)
    const spend = orders.map(o => num(o.total_payment_supplier_yuan)).filter((n): n is number => n !== null)
    const dates = orders
      .map(o => String(o.order_date || o.created_at || ''))
      .filter(Boolean)
      .sort()

    const summary = {
      matchedNames: matches.map(m => m.name),
      confidence,
      orderCount: orders.length,
      productCount: new Set(orders.map(o => String(o.product_name || '')).filter(Boolean)).size,
      lowestUnitPrice: prices.length ? Math.min(...prices) : null,
      highestUnitPrice: prices.length ? Math.max(...prices) : null,
      totalSpendYuan: spend.length ? Math.round(spend.reduce((a, b) => a + b, 0)) : null,
      firstOrder: dates[0] ? dates[0].slice(0, 10) : null,
      lastOrder: dates.length ? dates[dates.length - 1].slice(0, 10) : null,
    }

    // ---- the editable instruction ------------------------------------------
    const { data: settings } = await supabase
      .from('extension_settings')
      .select('purchaser_prompt')
      .eq('id', 1)
      .maybeSingle()
    const instruction = String(settings?.purchaser_prompt || '').trim()

    // ---- optional draft -----------------------------------------------------
    let draft = ''
    let draftError = ''
    if (body.draft) {
      const turns: ChatTurn[] = Array.isArray(body.turns) ? body.turns : []
      const transcript = turns
        .filter(t => t && typeof t.text === 'string' && t.text.trim())
        .slice(-25)
        .map(t => `${t.from === 'me' ? 'BUYER (us)' : 'SUPPLIER'}: ${String(t.text).slice(0, 400)}`)
        .join('\n')

      // Only real, matched history is ever shown to the model. When nothing
      // matched we say so explicitly, so it cannot imply a relationship that
      // does not exist or invent a price we never paid.
      const historyBlock = orders.length
        ? [
            `OUR PAST ORDERS WITH THIS SUPPLIER (${summary.orderCount} POs, ${confidence} name match):`,
            ...orders.slice(0, 12).map(o => {
              const unit = num(o.discounted_unit_price) ?? num(o.unit_price)
              return `- ${o.index_no || '?'} ${String(o.product_name || 'unnamed').slice(0, 50)} | qty ${o.qty ?? '?'} | unit ¥${unit ?? '?'} | status ${o.status || '?'} | ${String(o.order_date || o.created_at || '').slice(0, 10)}`
            }),
            summary.lowestUnitPrice !== null
              ? `Lowest unit price we have paid them: ¥${summary.lowestUnitPrice}`
              : '',
          ]
            .filter(Boolean)
            .join('\n')
        : 'WE HAVE NO PAST ORDERS ON FILE WITH THIS SUPPLIER. Do not imply any previous relationship, and do not reference any past price.'

      const profile =
        body.profile && typeof body.profile === 'object'
          ? Object.entries(body.profile as Record<string, unknown>)
              .filter(([, v]) => String(v || '').trim())
              .slice(0, 14)
              .map(([k, v]) => `- ${k}: ${String(v).slice(0, 80)}`)
              .join('\n')
          : ''

      try {
        const { text } = await generateText({
          model: openai('gpt-4.1'),
          system:
            instruction ||
            'You are a purchaser buying on 1688. Write the next message to the supplier in simple Simplified Chinese. Never invent prices.',
          prompt: [
            profile ? `SUPPLIER PROFILE (from their 1688 page):\n${profile}` : '',
            '',
            historyBlock,
            '',
            transcript ? `CONVERSATION SO FAR:\n${transcript}` : 'No conversation yet - open it.',
            '',
            'Write ONLY the message text to send next. No quotes, no explanation, no translation.',
          ]
            .filter(Boolean)
            .join('\n'),
        })
        draft = String(text || '').trim()
      } catch (e) {
        // A failed draft must not blank out the history the purchaser can see.
        draftError = e instanceof Error ? e.message : 'Draft failed'
      }
    }

    return NextResponse.json(
      { success: true, summary, orders, instruction, draft, draftError },
      { headers: corsHeaders },
    )
  } catch (error) {
    console.log('[v0] supplier-brief failed:', error instanceof Error ? error.message : error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed' },
      { status: 500, headers: corsHeaders },
    )
  }
}
