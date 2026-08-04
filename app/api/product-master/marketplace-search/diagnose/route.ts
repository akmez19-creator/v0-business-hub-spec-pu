import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PLATFORMS, TMAPI_BASE, apiError, extractList } from '@/lib/product-master/tmapi'

export const maxDuration = 60

/**
 * Probes every configured TMAPI path with a throwaway keyword and reports what
 * came back.
 *
 * The endpoint paths in lib/product-master/tmapi.ts could not be verified when
 * they were written - api.tmapi.top is unreachable from the build sandbox and
 * the docs are client-rendered. Rather than leave that to be discovered as a
 * silent empty grid, this route names the platforms that answer, the ones whose
 * path is wrong, and the field names of the first row so the normaliser can be
 * corrected against real data.
 *
 * Visit /api/product-master/marketplace-search/diagnose while signed in.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

  const token = process.env.TMAPI_TOKEN
  if (!token) return NextResponse.json({ success: false, error: 'TMAPI_TOKEN is not set' }, { status: 503 })

  const checks = await Promise.all(
    PLATFORMS.map(async (p) => {
      const qs = new URLSearchParams({ keyword: 'neck massage pillow', page: '1', apiToken: token })
      const started = Date.now()
      try {
        const res = await fetch(`${TMAPI_BASE}${p.path}?${qs}`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(20_000),
          cache: 'no-store',
        })
        const text = await res.text()
        let json: unknown = null
        try {
          json = JSON.parse(text)
        } catch {
          // Non-JSON usually means an HTML error page, which is itself the clue
        }
        const rows = json ? extractList(json) : []
        const first = rows[0] as Record<string, unknown> | undefined
        return {
          platform: p.id,
          path: p.path,
          ok: res.ok && !apiError(json),
          httpStatus: res.status,
          ms: Date.now() - started,
          bodyError: json ? apiError(json) : 'Response was not JSON',
          rows: rows.length,
          // The field names are what matter for fixing the normaliser
          sampleFields: first ? Object.keys(first).slice(0, 30) : [],
          // A short snippet makes a wrong-path HTML page obvious at a glance
          snippet: rows.length ? undefined : text.slice(0, 200),
        }
      } catch (e) {
        return {
          platform: p.id,
          path: p.path,
          ok: false,
          httpStatus: 0,
          ms: Date.now() - started,
          bodyError: e instanceof Error ? e.message : 'Request failed',
          rows: 0,
          sampleFields: [],
        }
      }
    }),
  )

  const working = checks.filter((c) => c.ok && c.rows > 0).map((c) => c.platform)
  return NextResponse.json({
    success: true,
    hint: 'Paths live in lib/product-master/tmapi.ts (PLATFORMS). Correct any platform listed in `broken`.',
    working,
    broken: checks.filter((c) => !c.ok || c.rows === 0).map((c) => c.platform),
    checks,
  })
}
