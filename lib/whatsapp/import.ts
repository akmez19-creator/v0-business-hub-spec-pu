import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'

/**
 * Importer for WhatsApp history exported from another inbox (respond.io).
 *
 * The Cloud API has no endpoint for past conversations - verified: every
 * candidate edge on a phone number returns "nonexisting field" - so a file
 * export from whichever tool WAS listening is the only way to recover history.
 *
 * Two invariants matter here, because this writes into a table that a live
 * webhook is also writing to:
 *
 *  1. Imported rows are historical, so they must never drag a contact's
 *     `last_message_at` backwards, reset the 24h reply window, or inflate the
 *     unread badge. Import is silent by design.
 *  2. Re-running the same file must be a no-op, so every row gets a stable id
 *     derived from its content when the export carries no message id.
 */

export type ImportResult = {
  parsedRows: number
  imported: number
  skipped: number
  contacts: number
  /** Headers we matched, so the UI can show what was understood. */
  mapping: Record<string, string | null>
  problems: string[]
}

/**
 * Minimal RFC-4180 CSV reader.
 *
 * Hand-rolled rather than pulled from npm because exported chat logs routinely
 * contain commas, quotes and hard newlines inside the message body, and a
 * naive split() silently shreds those rows into garbage.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  // Strip a UTF-8 BOM, which otherwise corrupts the first header name.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  for (let i = 0; i < src.length; i++) {
    const c = src[i]

    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += c
      }
      continue
    }

    if (c === '"') {
      quoted = true
    } else if (c === ',' || c === ';' || c === '\t') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      // Swallow the \n of a \r\n pair.
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((f) => f.trim() !== '')) rows.push(row)
      row = []
    } else {
      field += c
    }
  }

  row.push(field)
  if (row.some((f) => f.trim() !== '')) rows.push(row)
  return rows
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Locate a column by trying aliases in priority order.
 *
 * Exports vary between tools and plans, so this matches exact-normalised names
 * first and only then falls back to substring matching - otherwise a column
 * like "contact_created_at" would win over the real "created_at".
 */
function findColumn(headers: string[], aliases: string[]): number {
  const H = headers.map(norm)
  for (const a of aliases) {
    const i = H.indexOf(norm(a))
    if (i !== -1) return i
  }
  for (const a of aliases) {
    const i = H.findIndex((h) => h.includes(norm(a)))
    if (i !== -1) return i
  }
  return -1
}

const COLUMNS = {
  phone: [
    'phone',
    'phone number',
    'contact phone',
    'whatsapp',
    'wa id',
    'waid',
    'from',
    'contact id',
    'recipient',
  ],
  name: ['contact name', 'name', 'profile name', 'first name', 'display name', 'contact'],
  text: ['message', 'text', 'body', 'message text', 'content', 'message body', 'comment'],
  direction: ['direction', 'traffic', 'type', 'message type', 'sender type', 'is incoming', 'source'],
  timestamp: ['timestamp', 'created at', 'date', 'sent at', 'time', 'datetime', 'message date'],
  id: ['message id', 'id', 'wamid', 'external id', 'message_id'],
  channel: ['channel', 'platform', 'source channel'],
}

/** Digits-only phone, which is exactly the wa_id format Meta uses. */
function toWaId(raw: string): string | null {
  const d = (raw || '').replace(/\D/g, '')
  if (d.length < 7 || d.length > 15) return null
  return d.replace(/^0+/, '')
}

function toDirection(raw: string): 'in' | 'out' {
  const v = norm(raw)
  // Anything explicitly business-side is outbound; everything else is treated
  // as inbound, because mislabelling a customer message as our own reply is
  // the more damaging error.
  if (
    v.includes('out') ||
    v.includes('sent') ||
    v.includes('agent') ||
    v.includes('business') ||
    v.includes('bot') ||
    v === 'true'
  ) {
    return 'out'
  }
  return 'in'
}

function toTimestamp(raw: string): string | null {
  const v = (raw || '').trim()
  if (!v) return null

  // Epoch seconds or milliseconds.
  if (/^\d{10}$/.test(v)) return new Date(Number(v) * 1000).toISOString()
  if (/^\d{13}$/.test(v)) return new Date(Number(v)).toISOString()

  const direct = new Date(v)
  if (!Number.isNaN(direct.getTime())) return direct.toISOString()

  // "2024-01-15 14:30:00" without a timezone - treat as UTC rather than
  // letting the server's locale silently shift every message.
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (m) {
    const [, y, mo, d, h, mi, s] = m
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0))).toISOString()
  }
  return null
}

type ParsedRow = {
  waId: string
  name: string | null
  direction: 'in' | 'out'
  body: string
  timestamp: string
  id: string
}

/** Deterministic id so re-importing the same export inserts nothing new. */
function syntheticId(r: Omit<ParsedRow, 'id'>): string {
  const h = createHash('sha1').update(`${r.waId}|${r.timestamp}|${r.direction}|${r.body}`).digest('hex')
  return `imp:${h.slice(0, 32)}`
}

export function mapRows(rows: string[][]): {
  parsed: ParsedRow[]
  mapping: Record<string, string | null>
  problems: string[]
} {
  const problems: string[] = []
  if (rows.length < 2) {
    return { parsed: [], mapping: {}, problems: ['The file has no data rows.'] }
  }

  const headers = rows[0]
  const idx = {
    phone: findColumn(headers, COLUMNS.phone),
    name: findColumn(headers, COLUMNS.name),
    text: findColumn(headers, COLUMNS.text),
    direction: findColumn(headers, COLUMNS.direction),
    timestamp: findColumn(headers, COLUMNS.timestamp),
    id: findColumn(headers, COLUMNS.id),
    channel: findColumn(headers, COLUMNS.channel),
  }

  const mapping: Record<string, string | null> = {}
  for (const [k, i] of Object.entries(idx)) mapping[k] = i === -1 ? null : headers[i]

  if (idx.phone === -1) problems.push('No phone/contact column found — cannot tell who each message belongs to.')
  if (idx.text === -1) problems.push('No message/text column found.')
  if (idx.phone === -1 || idx.text === -1) return { parsed: [], mapping, problems }

  if (idx.timestamp === -1) {
    problems.push('No timestamp column found — rows will be ordered by their position in the file.')
  }
  if (idx.direction === -1) {
    problems.push('No direction column found — every message is assumed to be from the customer.')
  }

  const parsed: ParsedRow[] = []
  let bad = 0
  const base = Date.now() - rows.length * 1000

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const cell = (i: number) => (i === -1 ? '' : (row[i] ?? '').trim())

    // Skip other channels when the export mixes them together.
    if (idx.channel !== -1) {
      const ch = norm(cell(idx.channel))
      if (ch && !ch.includes('whatsapp') && !ch.includes('wa')) continue
    }

    const waId = toWaId(cell(idx.phone))
    const body = cell(idx.text)
    if (!waId || !body) {
      bad++
      continue
    }

    const ts = idx.timestamp === -1 ? null : toTimestamp(cell(idx.timestamp))
    // Preserve file order when timestamps are missing or unparseable.
    const timestamp = ts ?? new Date(base + r * 1000).toISOString()

    const partial = {
      waId,
      name: idx.name === -1 ? null : cell(idx.name) || null,
      direction: idx.direction === -1 ? ('in' as const) : toDirection(cell(idx.direction)),
      body,
      timestamp,
    }

    const explicitId = idx.id === -1 ? '' : cell(idx.id)
    parsed.push({ ...partial, id: explicitId ? `imp:${explicitId}` : syntheticId(partial) })
  }

  if (bad > 0) problems.push(`${bad} row${bad === 1 ? '' : 's'} skipped for a missing phone number or empty text.`)
  return { parsed, mapping, problems }
}

/**
 * Write parsed rows into the live tables.
 *
 * Uses ignoreDuplicates so a second run of the same export is a no-op, and
 * only advances contact metadata when an imported message is genuinely newer
 * than what the webhook already recorded.
 */
export async function importRows(
  parsed: ParsedRow[],
  phoneNumberId: string,
  displayPhone: string | null,
): Promise<{ imported: number; skipped: number; contacts: number }> {
  const db = createAdminClient()
  if (parsed.length === 0) return { imported: 0, skipped: 0, contacts: 0 }

  // Collapse duplicate ids inside the file itself, or the insert rejects the
  // whole batch on a primary-key conflict.
  const unique = new Map<string, ParsedRow>()
  for (const p of parsed) if (!unique.has(p.id)) unique.set(p.id, p)
  const rows = [...unique.values()]

  let imported = 0
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK)
    const { data, error } = await db
      .from('whatsapp_messages')
      .upsert(
        chunk.map((p) => ({
          id: p.id,
          wa_id: p.waId,
          phone_number_id: phoneNumberId,
          direction: p.direction,
          type: 'text',
          body: p.body,
          created_at: p.timestamp,
          raw: { imported: true } as never,
        })),
        { onConflict: 'id', ignoreDuplicates: true },
      )
      .select('id')
    if (error) throw new Error(error.message)
    imported += data?.length ?? 0
  }

  // One contact row per conversation, carrying the newest imported message.
  const byContact = new Map<string, { name: string | null; last: string; snippet: string }>()
  for (const p of rows) {
    const cur = byContact.get(p.waId)
    if (!cur || p.timestamp > cur.last) {
      byContact.set(p.waId, { name: p.name ?? cur?.name ?? null, last: p.timestamp, snippet: p.body.slice(0, 200) })
    } else if (!cur.name && p.name) {
      cur.name = p.name
    }
  }

  const waIds = [...byContact.keys()]
  const existing = new Map<string, { last_message_at: string | null; profile_name: string | null }>()
  for (let i = 0; i < waIds.length; i += 200) {
    const { data } = await db
      .from('whatsapp_contacts')
      .select('wa_id,last_message_at,profile_name')
      .in('wa_id', waIds.slice(i, i + 200))
    for (const r of data ?? []) {
      existing.set(r.wa_id as string, {
        last_message_at: r.last_message_at as string | null,
        profile_name: r.profile_name as string | null,
      })
    }
  }

  const upserts = [...byContact.entries()].map(([waId, v]) => {
    const prev = existing.get(waId)
    const prevLast = prev?.last_message_at ?? null
    // Never let historical data overwrite a newer live conversation.
    const isNewer = !prevLast || v.last > prevLast
    return {
      wa_id: waId,
      profile_name: prev?.profile_name ?? v.name,
      phone_number_id: phoneNumberId,
      display_phone: displayPhone,
      last_message_at: isNewer ? v.last : prevLast,
      last_snippet: isNewer ? v.snippet : undefined,
      // unread_count and last_inbound_at are deliberately untouched: importing
      // history must not light up the badge or reopen the 24h reply window.
    }
  })

  for (let i = 0; i < upserts.length; i += 200) {
    const { error } = await db.from('whatsapp_contacts').upsert(upserts.slice(i, i + 200), { onConflict: 'wa_id' })
    if (error) throw new Error(error.message)
  }

  return { imported, skipped: rows.length - imported, contacts: byContact.size }
}
