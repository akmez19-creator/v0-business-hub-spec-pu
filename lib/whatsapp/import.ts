import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { persistWhatsAppMessage } from './persistence'
import { requireWhatsAppNumber, validateWhatsAppScope, WhatsAppScopeError } from './number-scope'
import { connectInboxDatabase } from '@/lib/messenger/pg'

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
  legacyId?: string
}

export function scopedImportId(id:string,phoneNumberId:string):string {
  return /^wamid\.[A-Za-z0-9+/=_-]+$/.test(id)?id
    :'imp:scope:'+createHash('sha256').update(JSON.stringify([phoneNumberId,id])).digest('hex')
}

export function assertImportedIdentity(existing:any,row:ParsedRow,phoneNumberId:string) {
  if(existing.wa_id!==row.waId || existing.phone_number_id!==phoneNumberId || existing.direction!==row.direction ||
    existing.body!==row.body || new Date(existing.created_at).getTime()!==Date.parse(row.timestamp))
    throw new WhatsAppScopeError('An imported message conflicts with its saved owner or content. Nothing was overwritten.',409)
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
    const legacyId=explicitId?`imp:${explicitId}`:syntheticId(partial)
    parsed.push({ ...partial, id: /^wamid\.[A-Za-z0-9+/=_-]+$/.test(explicitId)?explicitId:legacyId,legacyId })
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
export async function importRows(parsed:ParsedRow[],phoneNumberId:string,displayPhone:string|null):Promise<{imported:number;skipped:number;contacts:number}> {
  const binding=await requireWhatsAppNumber(phoneNumberId)
  const db=createAdminClient()
  const unique=new Map<string,ParsedRow>()
  for(const row of parsed) {
    validateWhatsAppScope(row.waId,phoneNumberId)
    const duplicate=unique.get(row.id)
    if(duplicate && (duplicate.waId!==row.waId || duplicate.direction!==row.direction || duplicate.body!==row.body || duplicate.timestamp!==row.timestamp))
      throw new WhatsAppScopeError('The import contains conflicting rows with the same message ID.',409)
    unique.set(row.id,row)
  }
  const rows=[...unique.values()]
  const existing=new Map<string,any>()
  // A prior import may have used the legacy unscoped ID. Respect it only when the original account and content match.
  const candidateIds=[...new Set(rows.flatMap(row=>[row.id,row.legacyId??row.id,scopedImportId(row.id,phoneNumberId)]))]
  for(let offset=0;offset<candidateIds.length;offset+=200) {
    const {data,error}=await db.from('whatsapp_messages').select('id,wa_id,phone_number_id,body,direction,created_at')
      .in('id',candidateIds.slice(offset,offset+200))
    if(error) throw new WhatsAppScopeError('Could not verify existing imported messages.',503)
    for(const item of data??[]) existing.set(item.id,item)
  }
  // Validate every exact scoped/provider match before starting this import's writes.
  for(const row of rows) {
    const exact=existing.get(scopedImportId(row.id,phoneNumberId))
    if(exact) assertImportedIdentity(exact,row,phoneNumberId)
    const legacy=existing.get(row.legacyId??row.id)
    if(legacy?.phone_number_id===phoneNumberId) assertImportedIdentity(legacy,row,phoneNumberId)
  }
  let imported=0,skipped=0
  // Reuse the transport connection; each row still commits its exact-owner content and summary atomically.
  const connection=await connectInboxDatabase()
  try { for(const row of rows) {
    validateWhatsAppScope(row.waId,phoneNumberId)
    const legacy=existing.get(row.legacyId??row.id)
    if(legacy?.phone_number_id===phoneNumberId) {
      skipped++;continue
    }
    const scopedId=scopedImportId(row.id,phoneNumberId)
    const result=await persistWhatsAppMessage({messageId:scopedId,waId:row.waId,phoneNumberId,
      profileName:row.name,displayPhone:binding.display_phone??displayPhone,
      direction:row.direction,type:'text',body:row.body,timestamp:row.timestamp,
      historical:true,source:'import',raw:{imported:true,originalImportId:row.id}},connection)
    if(result.inserted) imported++;else skipped++
  } } finally {await connection.end().catch(()=>{})}
  return {imported,skipped,contacts:new Set(rows.map(row=>row.waId)).size}
}
