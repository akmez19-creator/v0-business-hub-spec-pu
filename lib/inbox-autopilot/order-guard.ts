/**
 * "Order already placed" stop rule for the follow-up ladder.
 * `deliveries` has no phone column - `contact_1` / `contact_2` hold local numbers
 * (`57692493`) while WhatsApp ids carry the country code (`23057692493`), so
 * identity is the LAST 7 DIGITS (measured 95 of 252 Green chats match this way).
 */
import type { LadderMessage } from './followup-schedule'

export type OrderGuardDb = { query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, any>[] }> }
const digits = (v: unknown) => typeof v === 'string' ? v.replace(/\D/g, '') : ''
/** Mauritian mobiles are 8 digits starting with 5; the last 7 survive every prefix convention seen in the data. */
export const phoneKey = (v: unknown): string | null => { const d = digits(v); return d.length >= 7 ? d.slice(-7) : null }
export const CONFIRMED_ORDER = /\b(?:order (?:is )?(?:confirmed|placed|delivered)|commande (?:est )?confirmee|komann (?:finn )?konfirme|delivery completed|livraison effectuee)\b/i
const normal = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** Phone numbers a customer typed into the thread - the only identity Messenger has. */
export function phonesInThread(messages: readonly LadderMessage[]): string[] {
  const keys = new Set<string>()
  for (const m of messages) {
    if (m.direction !== 'in' || !m.text) continue
    for (const match of m.text.matchAll(/(?:\+?230[\s.-]?)?5(?:[\s.-]?\d){7}\b/g)) { const key = phoneKey(match[0]); if (key) keys.add(key) }
  }
  return [...keys]
}
export function threadConfirmsOrder(messages: readonly LadderMessage[]): boolean {
  return messages.some(m => m.text && CONFIRMED_ORDER.test(normal(m.text)))
}

/** Any delivery for these phone keys created from 7 days before the anchor onward, cancelled ones excluded. */
export async function deliveriesExistFor(db: OrderGuardDb, keys: readonly string[], anchorAt: string): Promise<boolean> {
  const clean = [...new Set(keys.filter(k => /^\d{7}$/.test(k)))]
  if (!clean.length || !Number.isFinite(Date.parse(anchorAt))) return false
  const r = await db.query(`SELECT 1 FROM public.deliveries
    WHERE created_at >= $2::timestamptz - interval '7 days'
      AND COALESCE(status,'') NOT ILIKE '%cancel%' AND COALESCE(status,'') NOT ILIKE '%annul%'
      AND (RIGHT(regexp_replace(COALESCE(contact_1,''),'\\D','','g'),7) = ANY($1::text[])
        OR RIGHT(regexp_replace(COALESCE(contact_2,''),'\\D','','g'),7) = ANY($1::text[]))
    LIMIT 1`, [clean, anchorAt])
  return r.rows.length > 0
}

export async function hasExistingOrder(db: OrderGuardDb, input: { channel: 'messenger' | 'whatsapp'; customerId: string; messages: readonly LadderMessage[]; anchorAt: string }): Promise<boolean> {
  if (threadConfirmsOrder(input.messages)) return true
  const keys = input.channel === 'whatsapp' ? [phoneKey(input.customerId)].filter((k): k is string => !!k) : phonesInThread(input.messages)
  return deliveriesExistFor(db, keys, input.anchorAt)
}
