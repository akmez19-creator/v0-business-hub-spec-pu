import { put } from '@vercel/blob'
import { NextResponse } from 'next/server'

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Callers may group their uploads; existing callers keep the original
    // folder so nothing already stored moves.
    const requested = String(formData.get('folder') || 'juice-transfers')
    const folder = /^[a-z0-9-]+$/i.test(requested) ? requested : 'juice-transfers'

    // Upload to Vercel Blob (public store)
    const filename = `${folder}/${Date.now()}-${file.name}`
    const blob = await put(filename, file, {
      access: 'public',
    })

    return NextResponse.json({ url: blob.url })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 },
    )
  }
}
