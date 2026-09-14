import 'server-only'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { connectInboxDatabase } from '@/lib/messenger/pg'

export class WhatsAppScopeError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

export function validateWhatsAppScope(waId: unknown, phoneNumberId: unknown): asserts waId is string {
  if (typeof waId !== 'string' || !/^\d{5,20}$/.test(waId) ||
      typeof phoneNumberId !== 'string' || !/^\d{5,30}$/.test(phoneNumberId))
    throw new WhatsAppScopeError('A customer and an explicit WhatsApp business number are required.')
}

/** Match app/dashboard/layout.tsx: approved profile or admin. The inbox page has no narrower role guard. */
export async function requireWhatsAppInboxUser() {
  const auth = await createClient()
  const { data: { user } } = await auth.auth.getUser()
  if (!user) throw new WhatsAppScopeError('Not authenticated', 401)
  const { data: profile, error } = await createAdminClient().from('profiles')
    .select('role,approved').eq('id', user.id).maybeSingle()
  if (error) throw new WhatsAppScopeError('Could not verify inbox access.', 503)
  if (!profile || (!profile.approved && profile.role !== 'admin'))
    throw new WhatsAppScopeError('This account cannot access the WhatsApp inbox.', 403)
  return user
}

/** Configuration is server-owned. Observed/history-only numbers are never silently enabled for sending. */
export async function requireWhatsAppNumber(phoneNumberId: string, sending = false) {
  if (!/^\d{5,30}$/.test(phoneNumberId ?? '')) throw new WhatsAppScopeError('Choose a valid WhatsApp business number.')
  const db = await connectInboxDatabase()
  try {
    const number = (await db.query('SELECT * FROM whatsapp_inbox_numbers WHERE phone_number_id=$1', [phoneNumberId])).rows[0]
    if (!number?.can_read) throw new WhatsAppScopeError('This WhatsApp business number is not available.', 403)
    if (sending && !number.can_send) throw new WhatsAppScopeError('This number is available for history only. Sending is disabled.', 403)
    return number
  } finally { await db.end().catch(() => {}) }
}

export function encodeWhatsAppCursor(row: { createdAt: string; id: string }): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(row.createdAt) || !Number.isFinite(Date.parse(row.createdAt)))
    throw new WhatsAppScopeError('The conversation timestamp is invalid.')
  return Buffer.from(JSON.stringify([row.createdAt, row.id])).toString('base64url')
}

export function decodeWhatsAppCursor(value?: string): [string, string] | null {
  if (!value) return null
  try {
    if (value.length > 4096 || !/^[\w-]+$/.test(value)) throw new Error()
    const result = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!Array.isArray(result) || result.length !== 2 || typeof result[0] !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(result[0]) || !Number.isFinite(Date.parse(result[0])) ||
        typeof result[1] !== 'string' || !result[1] || result[1].length > 2048) throw new Error()
    return [result[0], result[1]]
  } catch { throw new WhatsAppScopeError('The conversation cursor is invalid. Reopen this conversation.') }
}
