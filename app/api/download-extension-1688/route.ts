import { NextResponse } from 'next/server'
import JSZip from 'jszip'
import { promises as fs } from 'fs'
import path from 'path'

// Single source of truth: public/extension-1688/
// Mirrors /api/download-extension so the downloaded zip always matches the
// folder that is loaded unpacked during development.

export const dynamic = 'force-dynamic'

const EXTENSION_DIR = path.join(process.cwd(), 'public', 'extension-1688')

const FILES = [
  'manifest.json',
  'popup.html',
  'popup.js',
  'content.js',
  'content.css',
  'background.js',
  'icon16.png',
  'icon48.png',
  'icon128.png',
]

export async function GET() {
  try {
    const zip = new JSZip()
    const missing: string[] = []

    for (const file of FILES) {
      try {
        zip.file(file, await fs.readFile(path.join(EXTENSION_DIR, file)))
      } catch {
        missing.push(file)
      }
    }

    // A manifest or content script that failed to read would produce a zip that
    // Chrome silently refuses to load, so fail loudly instead of shipping it.
    if (missing.includes('manifest.json') || missing.includes('content.js')) {
      console.error('[download-extension-1688] Missing required files:', missing)
      return NextResponse.json({ error: 'Extension files are incomplete' }, { status: 500 })
    }
    if (missing.length) console.error('[download-extension-1688] Missing optional files:', missing)

    let version = '0.0.0'
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(EXTENSION_DIR, 'manifest.json'), 'utf-8'))
      version = manifest.version || version
    } catch {
      // Fall back to the placeholder version for the filename only.
    }

    // JSZip returns Uint8Array<ArrayBufferLike>, which is not a BlobPart (it may
    // be backed by a SharedArrayBuffer). Copy into a plain ArrayBuffer-backed
    // view so the body is a valid BodyInit for the underlying web Response.
    const zipBytes = await zip.generateAsync({ type: 'uint8array' })
    const body = new Uint8Array(zipBytes.byteLength)
    body.set(zipBytes)

    return new NextResponse(new Blob([body], { type: 'application/zip' }), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="akmez-guide-v${version}.zip"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    })
  } catch (error) {
    console.error('[download-extension-1688] Error:', error)
    return NextResponse.json({ error: 'Failed to build extension zip' }, { status: 500 })
  }
}
