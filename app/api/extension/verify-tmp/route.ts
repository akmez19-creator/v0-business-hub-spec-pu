import { NextResponse } from 'next/server'
// Import the REAL handlers so this exercises the shipped code path,
// not a copy of its logic. Temporary - deleted after verification.
import { GET as logosGet, POST as logosPost } from '@/app/api/page-logos/route'
import { createAdminClient } from '@/lib/supabase/server'

const TEST_PAGE = '__verify_tmp_page__'

export async function GET() {
  const steps: Record<string, unknown> = {}

  // 1. Baseline: what the studio sees before any page has its own logo
  const before = await (await logosGet()).json()
  steps.beforeFallback = before.fallback ? `${String(before.fallback).slice(0, 48)}...` : '(none)'
  steps.beforePageCount = Object.keys(before.logos || {}).length

  // 2. Save a logo for a specific page through the real POST
  const saveRes = await logosPost(
    new Request('http://local/api/page-logos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageId: TEST_PAGE,
        pageName: 'Verify Page',
        logoUrl: 'https://example.com/verify-logo.png',
      }),
    }),
  )
  steps.saveStatus = saveRes.status
  steps.saveBody = await saveRes.json()

  // 3. Read it back - this is what a page switch resolves against
  const after = await (await logosGet()).json()
  steps.roundTripped = after.logos?.[TEST_PAGE] ?? null
  steps.otherPagesUnaffected = Object.keys(after.logos || {}).filter((k) => k !== TEST_PAGE)
  steps.fallbackStillIntact = Boolean(after.fallback)

  // 4. Rejects a bad payload instead of writing junk
  const bad = await logosPost(
    new Request('http://local/api/page-logos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId: '', logoUrl: '' }),
    }),
  )
  steps.rejectsEmpty = bad.status

  // 5. Confirm how Postgres numerics actually arrive through supabase-js
  const admin = createAdminClient()
  const { data: prod } = await admin
    .from('products')
    .select('name, price, promo_price')
    .not('price', 'is', null)
    .limit(1)
    .single()
  steps.priceSample = prod
  steps.priceRuntimeType = typeof (prod as { price?: unknown } | null)?.price

  // Cleanup so the verification leaves nothing behind
  await admin.from('page_logos').delete().eq('page_id', TEST_PAGE)
  const cleaned = await (await logosGet()).json()
  steps.cleanedUp = !(TEST_PAGE in (cleaned.logos || {}))

  return NextResponse.json(steps)
}
