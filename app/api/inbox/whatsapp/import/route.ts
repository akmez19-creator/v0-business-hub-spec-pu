import { NextResponse } from 'next/server'
import { requireWhatsAppInboxUser, requireWhatsAppNumber, WhatsAppScopeError } from '@/lib/whatsapp/number-scope'
import { importRows, mapRows, parseCsv } from '@/lib/whatsapp/import'

/**
 * Import WhatsApp history from a CSV exported by another inbox.
 *
 * Meta offers no way to read past conversations, so a file export is the only
 * recovery path. Defaults to a DRY RUN: column names differ between tools, and
 * a silent mis-map would write thousands of wrong rows into a live table, so
 * the mapping is shown for confirmation before anything is written.
 */

export const maxDuration = 60

export async function POST(request: Request) {
  try {
    await requireWhatsAppInboxUser()

    const form = await request.formData()
    const file = form.get('file')
    const phoneNumberId = String(form.get('phoneNumberId') ?? '').trim()
    // Display/owner information comes from server configuration, never the uploaded form.
    const commit = String(form.get('commit') ?? '') === 'true'

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'No file uploaded.' }, { status: 400 })
    }
    if (!phoneNumberId) {
      return NextResponse.json(
        { success: false, error: 'Choose which of your numbers this history belongs to.' },
        { status: 400 },
      )
    }
    const binding=await requireWhatsAppNumber(phoneNumberId)
    const displayPhone=binding.display_phone??null
    if (file.size > 25 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: 'File is larger than 25MB.' }, { status: 400 })
    }

    const rows = parseCsv(await file.text())
    const { parsed, mapping, problems } = mapRows(rows)

    if (!commit) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        parsedRows: parsed.length,
        contacts: new Set(parsed.map((p) => p.waId)).size,
        mapping,
        problems,
        // A few real rows beat a column list for spotting a bad mapping.
        sample: parsed.slice(0, 5).map((p) => ({
          waId: p.waId,
          name: p.name,
          direction: p.direction,
          body: p.body.slice(0, 120),
          timestamp: p.timestamp,
        })),
      })
    }

    if (parsed.length === 0) {
      return NextResponse.json({ success: false, error: 'Nothing importable in this file.', problems }, { status: 400 })
    }

    const result = await importRows(parsed, phoneNumberId, displayPhone)
    return NextResponse.json({ success: true, dryRun: false, ...result, mapping, problems })
  } catch (e) {
    if(e instanceof WhatsAppScopeError) return NextResponse.json({success:false,error:e.message},{status:e.status})
    const message = e instanceof Error ? e.message : 'Import failed'
    console.log('[v0] whatsapp import failed:', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
