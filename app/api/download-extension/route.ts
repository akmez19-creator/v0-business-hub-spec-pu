import { NextResponse } from 'next/server'
import JSZip from 'jszip'
import { promises as fs } from 'fs'
import path from 'path'

// Single source of truth: public/extension/
// This route zips the REAL extension files so the downloaded zip
// is always synchronized with the folder used in dev mode.

export const dynamic = 'force-dynamic'

const EXTENSION_DIR = path.join(process.cwd(), 'public', 'extension')

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

    for (const file of FILES) {
      const filePath = path.join(EXTENSION_DIR, file)
      try {
        const content = await fs.readFile(filePath)
        zip.file(file, content)
      } catch {
        console.error('[download-extension] Missing file:', file)
      }
    }

    // Read version from the real manifest for the filename
    let version = '0.0.0'
    try {
      const manifest = JSON.parse(
        await fs.readFile(path.join(EXTENSION_DIR, 'manifest.json'), 'utf-8')
      )
      version = manifest.version || version
    } catch {
      // Use fallback version if manifest can't be parsed
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' })

    return new NextResponse(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="akmez-quick-order-v${version}.zip"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    })
  } catch (error) {
    console.error('[download-extension] Error:', error)
    return NextResponse.json(
      { error: 'Failed to build extension zip' },
      { status: 500 }
    )
  }
}
