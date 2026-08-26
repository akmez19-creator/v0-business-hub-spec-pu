import { createClient as createAdminClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { matchSuppliers } from '@/lib/purchase-orders/supplier-match'

export const runtime = 'nodejs'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Refresh-Token',
}

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders })
}

function admin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

async function getUserFromToken(request: NextRequest) {
  const authHeader = request.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const { data, error } = await admin().auth.getUser(authHeader.replace('Bearer ', ''))
  return error ? null : data.user
}

type Turn = { from: 'me' | 'them'; text: string }

/**
 * Stores the messages of a 1688 conversation against a supplier we already buy
 * from.
 *
 * The purchaser chose to keep this table limited to suppliers that appear in
 * purchase_orders, so an unmatched chat handle (hsmart4, rjxjj801215 - most of
 * the sidebar) is NOT an error and NOT stored. It is reported back as
 * `matched: false` so the panel can say so plainly; silently returning success
 * would look identical to a working capture and leave the purchaser believing
 * a history was being built that does not exist.
 */
export async function POST(request: NextRequest) {
  const user = await getUserFromToken(request)
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401, headers: corsHeaders })
  }

  let body: { names?: unknown; turns?: unknown; complete?: unknown; company?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Bad request body' }, { status: 400, headers: corsHeaders })
  }

  const names = Array.isArray(body.names) ? body.names.filter((n): n is string => typeof n === 'string' && !!n.trim()) : []
  const rawTurns = Array.isArray(body.turns) ? body.turns : []
  const turns: Turn[] = rawTurns
    .filter((t): t is Turn => !!t && typeof t === 'object' && typeof (t as Turn).text === 'string')
    .map<Turn>(t => ({
      from: t.from === 'me' ? 'me' : 'them',
      text: String(t.text).replace(/\s+/g, ' ').trim(),
    }))
    .filter(t => t.text.length >= 2 && t.text.length <= 2000)

  if (!names.length) {
    return NextResponse.json({ success: true, matched: false, reason: 'no-name' }, { headers: corsHeaders })
  }

  const db = admin()

  // Which of our real suppliers is this? Reuses the strict coreName matcher -
  // trigram similarity rates two DIFFERENT Chinese firms at 0.50, so it must
  // never be used to decide who we are talking to.
  const { data: poRows, error: poErr } = await db
    .from('purchase_orders')
    .select('supplier_name')
    .not('supplier_name', 'is', null)

  if (poErr) {
    return NextResponse.json({ success: false, error: poErr.message }, { status: 500, headers: corsHeaders })
  }

  const known = [...new Set((poRows ?? []).map(r => String(r.supplier_name || '')).filter(Boolean))]
  const matches = matchSuppliers(names, known)
  if (!matches.length) {
    return NextResponse.json(
      { success: true, matched: false, reason: 'unknown-supplier', tried: names },
      { headers: corsHeaders },
    )
  }
  const supplierName = matches[0].name

  const handle = names[0].slice(0, 200)
  const company = typeof body.company === 'string' ? body.company.slice(0, 200) : null

  const { data: thread, error: threadErr } = await db
    .from('supplier_threads')
    .upsert(
      {
        platform: '1688',
        chat_handle: handle,
        supplier_name: supplierName,
        company_name: company,
        last_captured_at: new Date().toISOString(),
        history_complete: body.complete === true,
      },
      { onConflict: 'platform,chat_handle' },
    )
    .select('id')
    .single()

  if (threadErr || !thread) {
    return NextResponse.json(
      { success: false, error: threadErr?.message || 'Could not save the conversation.' },
      { status: 500, headers: corsHeaders },
    )
  }

  // Identical messages recur legitimately ("好的" twice), so the key counts
  // which occurrence this is. Hashing text alone would silently collapse them
  // and quietly delete real history on every re-capture.
  const seen = new Map<string, number>()
  const rows = turns.map((t, i) => {
    const base = `${t.from}|${t.text}`
    const nth = (seen.get(base) ?? 0) + 1
    seen.set(base, nth)
    return {
      thread_id: thread.id,
      from_side: t.from,
      body: t.text,
      seq: i,
      dedupe_key: createHash('sha1').update(`${base}|${nth}`).digest('hex'),
    }
  })

  if (rows.length) {
    const { error: msgErr } = await db.from('supplier_messages').upsert(rows, { onConflict: 'thread_id,dedupe_key' })
    if (msgErr) {
      return NextResponse.json({ success: false, error: msgErr.message }, { status: 500, headers: corsHeaders })
    }
  }

  const { count } = await db
    .from('supplier_messages')
    .select('id', { count: 'exact', head: true })
    .eq('thread_id', thread.id)

  await db.from('supplier_threads').update({ message_count: count ?? 0 }).eq('id', thread.id)

  return NextResponse.json(
    { success: true, matched: true, supplier: supplierName, stored: rows.length, total: count ?? 0 },
    { headers: corsHeaders },
  )
}
