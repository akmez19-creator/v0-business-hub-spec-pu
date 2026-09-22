/**
 * Deterministic fence between the model and the customer: a follow-up may not carry
 * any figure, date, offer or link that our own earlier messages did not already say.
 * Pure so scripts/check-followup-ladder.ts can pin it.
 */
import type { LadderMessage } from './followup-schedule'

export type FollowupVerdict = { ok: true; text: string } | { ok: false; reason: 'text_empty' | 'text_too_long' | 'text_has_link' | 'text_unverified_figure' | 'text_unverified_offer' | 'text_confirms_order' | 'text_asks_payment' }
const normal = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const OFFER_WORDS = /\b(?:discount|remise|rabais|promo(?:tion)?|reduction|réduction|special offer|offre speciale|gratuit|gratis|free|b1g1|buy one|cadeau|gift|special price|prix special)\b|%/i
const CONFIRMS_ORDER = /\b(?:order (?:is |has been )?(?:confirmed|placed|booked|registered)|commande (?:est )?(?:confirmee|enregistree|validee)|komann (?:finn )?(?:konfirme|anrezistre))\b/i
const ASKS_PAYMENT = /\b(?:pay(?:ment)?|paiement|payer|juice|mcb|transfer|virement|deposit|acompte|iban|account number)\b/i
const LINK = /https?:\/\/|www\.|\.(?:com|mu|net|org|ly|io)\b/i
const FIGURE = /\d[\d.,]*/g

/** Owner-approved promo wording that may appear even when our earlier messages did not say it. */
const FREE_DELIVERY = /\b(?:free delivery|delivery is free|livraison (?:est )?gratuite|livrezon gratis)\b/gi

export function verifyFollowupText(candidate: string, thread: readonly LadderMessage[], options: { allowFreeDelivery?: boolean } = {}): FollowupVerdict {
  const text = candidate.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim()
  if (text.length < 8) return { ok: false, reason: 'text_empty' }
  if (text.length > 400) return { ok: false, reason: 'text_too_long' }
  if (LINK.test(text)) return { ok: false, reason: 'text_has_link' }
  const ours = normal(thread.filter(m => m.direction === 'out' && m.text).map(m => m.text).join('\n'))
  // Numbers are compared as digit runs so "Rs 1,290", "1290" and "1.290" are the same figure.
  const oursFigures = new Set([...ours.matchAll(FIGURE)].map(m => m[0].replace(/\D/g, '')).filter(Boolean))
  for (const match of text.matchAll(FIGURE)) {
    const digits = match[0].replace(/\D/g, '')
    if (digits && !oursFigures.has(digits)) return { ok: false, reason: 'text_unverified_figure' }
  }
  const lower = normal(text)
  const checked = options.allowFreeDelivery ? lower.replace(FREE_DELIVERY, ' ') : lower
  const offers = checked.match(new RegExp(OFFER_WORDS.source, 'gi')) ?? []
  for (const word of offers) if (!ours.includes(normal(word))) return { ok: false, reason: 'text_unverified_offer' }
  if (CONFIRMS_ORDER.test(lower)) return { ok: false, reason: 'text_confirms_order' }
  if (ASKS_PAYMENT.test(lower) && !ASKS_PAYMENT.test(ours)) return { ok: false, reason: 'text_asks_payment' }
  return { ok: true, text }
}
