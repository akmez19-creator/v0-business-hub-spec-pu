import { NextResponse } from 'next/server'

// TEMPORARY diagnostic. Deleted once the identify crash is understood.
// Every import is dynamic and individually wrapped, so a module that fails to
// load reports its real message instead of taking the route down with it.
export const runtime = 'nodejs'
export const maxDuration = 30

async function probe(name: string, load: () => Promise<unknown>) {
  try {
    await load()
    return { module: name, ok: true }
  } catch (error) {
    const e = error as Error & { code?: string }
    return {
      module: name,
      ok: false,
      code: e.code ?? null,
      message: (e.message || String(error)).slice(0, 400),
    }
  }
}

export async function GET() {
  const results = [
    await probe('sharp', () => import('sharp')),
    await probe('ai', () => import('ai')),
    await probe('@ai-sdk/google', () => import('@ai-sdk/google')),
    await probe('zod', () => import('zod')),
    await probe('lib/product-match', () => import('@/lib/product-match')),
    await probe('lib/product-identify', () => import('@/lib/product-identify')),
  ]

  return NextResponse.json({
    node: process.version,
    hasGoogleKey: Boolean(process.env.GOOGLE_AI_API_KEY),
    results,
  })
}
