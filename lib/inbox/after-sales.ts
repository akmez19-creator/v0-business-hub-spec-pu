/**
 * After-sales detection for the inbox AI.
 *
 * A customer who already HAS the product and writes "it's not working" /
 * "mo produit pa marche" / "je veux l'échanger" is not a lead. Without this
 * code-level guard the assist route saw ad product + WhatsApp number + locality,
 * decided "all known" and replaced the reply with a fresh ORDER CONFIRMATION
 * (Savita, EMS Foot Massager, 15 Sep). Tested against real inbox wording in
 * English, French and Mauritian Kreol.
 *
 * An exchange then follows the SAME ladder as a sale: everything is already
 * known from the delivered order (product, phone, locality), so the only open
 * question is the day - and, like a sale, the code answers it with the next
 * delivery day (or the day the customer named) and a confirmation template,
 * and the Quick order panel creates the exchange row for the rider.
 */

const RECEIVED = /\b(received|recieved|got (it|the|my)|ress?u|resevoir|resevwar|resevwar|gagn(e|é)|mo fin(n)? gagn|fin(n)? livr|delivered|livr(e|é)e?)\b/i
const FAULT = /\b(not working|doesn'?t work|does not work|stopp?ed working|isn'?t working|no longer works?|faulty|defect(ive|ueux)?|broken|kase|cass(e|é)e?|damaged|ab[iî]m(e|é)e?|ne (marche|fonctionne) (pas|plus)|pa marche|pa fonctionn|pa pe marche|pa travay|pe fer probl[eè]m|probl[eè]me? avec|not charging|pa charge|wrong (item|product|colou?r|size)|pas le bon|mauvais (produit|article)|missing part|manque)\b/i
const REMEDY = /\b(exchange|[eé]chang(e|er|é)|swap|replace(ment)?|remplac(er|ement)|return(ing)?|retourn(er|e)|renvoy(er|e)|refund|rembours(er|ement)|warranty|garantie|report|reclamation|r[eé]clamation|complain(t)?|plainte)\b/i
/** Our own side promising a swap: "we'll arrange an exchange", "replacement", "nou pou sanz li". */
const OUR_EXCHANGE = /\b(exchange|replacement|replace|remplac|[eé]chang|sanz(e|é)?)\b/i
const ORDER_CONFIRMATION_HEADER = /Order Confirmation/i

/**
 * True when the customer's latest words are about a product they already have
 * (fault, wrong item, exchange/return/refund), rather than a new purchase.
 * A remedy word alone counts; a fault word alone counts; "received" alone does not.
 */
export function isAfterSalesMessage(text: string | null | undefined): boolean {
  if (!text) return false
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return false
  return REMEDY.test(t) || FAULT.test(t) || DIFFERENT_ITEM.test(t)
}

/** True when the message mentions having received / been delivered the product. */
export function mentionsReceipt(text: string | null | undefined): boolean {
  return Boolean(text && RECEIVED.test(text))
}

/** A fault with the item they hold ("not working", "pa marche", "cassé") - they want the SAME item again. */
export function reportsFault(text: string | null | undefined): boolean {
  return Boolean(text && FAULT.test(text.replace(/\s+/g, ' ')))
}

/**
 * The customer wants a DIFFERENT item than the one they hold: the wrong product
 * was delivered ("grip tape instead of the window cleaner", "pa sa mo ti
 * komande") or they ask to swap for another model. Only this turns an exchange
 * into a trade-in; a plain fault never does (Luhmun, 16 Sep: "this apparatus is
 * not working" was wrongly priced as a trade-in against an unrelated old order).
 */
const DIFFERENT_ITEM = /\b(instead of|in place of|rather than|not what i ordered|not the (one|item|product) i ordered|wrong (item|product|article|model|colou?r|size)|sent me (the|a) (wrong|different)|(swap|change|exchange|replace) (it |this |them )?(for|with) (a |the |another |an )?(different|other|another|new model|bigger|smaller|larger)|swap (it )?for|(swap|change|exchange) (it |this )?(for|with) (a|an|the) |au lieu d|[aà] la place d|pas ce que j'?ai command|mauvais (produit|article|mod[eè]le)|autre (mod[eè]le|produit|article)|[eé]changer contre|pa sa mo ti komande|pa sa ki mo ti komande|dan plas|olie|sanz(e|é)? (li )?pou (enn )?lot)\b/i
export function wantsDifferentItem(text: string | null | undefined): boolean {
  return Boolean(text && DIFFERENT_ITEM.test(text.replace(/\s+/g, ' ')))
}

/**
 * The customer asks for something MORE on top of an order they already placed:
 * "one more", "add a floor cleaner", "2 pcs also", "mo bizin enn ousi". Only
 * these words make a reply an ADDITION with a new total. An open order on the
 * number is not evidence of one (Malini, 19 Sep: she asked to move her delivery
 * to next week at Rose Hill and was answered "Rs 375 added to your order, new
 * total Rs 750" - the row state, not her words, had chosen the reply).
 */
const ANOTHER_ITEM = /(\b(also|too|as well|additionally|on top)\b|\badd(?![^.?!]{0,20}\b(address|adress|locality|location|note|instruction)\b)\b|\b(send|bring|include|want|need|take|get|give)\b[^.?!]{0,40}\b(more|another|extra|second|one more|1 more|aussi|encore)\b|\b(one|1|two|2|three|3|another|an?)\b\s+more\b|\banother\b\s+(one|\w+)|\bencore\b|\bde plus\b|\ben plus\b|\baussi\b|\bajoute(r|z)?\b|\brajoute(r|z)?\b|\bousi\b|\bosi\b|\bencor\b|\bmet(e|é)? (enn|inn) lot\b|\bazout(e|é)?\b)/i
export function wantsAnotherItem(text: string | null | undefined): boolean {
  return Boolean(text && ANOTHER_ITEM.test(text.replace(/\s+/g, ' ')))
}

/**
 * Everything the customer has said since our last reply - "what they are
 * saying now". Their point often spans two bubbles: Malini wrote "I live at
 * rose hill. Can you do delivery next week please" and then "I dont work
 * tomorrow. I wont be at ebene", and only both together show she is
 * explaining a DATE problem, not giving a new address.
 *
 * `transcript` is the "Customer: ..." / "Business: ..." lines the model sees.
 */
export function latestCustomerRun(transcript: string): string {
  const lines = transcript.split('\n').map((l) => l.trim()).filter(Boolean)
  const run: string[] = []
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith('Customer:')) run.unshift(lines[i].slice('Customer:'.length).trim())
    else if (lines[i].startsWith('Business:')) break
  }
  return run.join(' ')
}

/** Words that make a sentence about WHERE THE ORDER GOES rather than where the customer is. */
const DELIVERY_VERB = /\b(deliver\w*|send|sent|bring|drop|leave|ship|collect|livr\w*|apport\w*|amenn?\w*|depoz\w*|adresse?|address|adress)\b/i

/**
 * Did they ask for the order to go to `locality`, or merely mention the place?
 *
 * "I live at rose hill" says where she sleeps; "deliver at ebene" says where
 * the rider goes. Only a sentence that names the place AND talks about
 * delivering moves the address - otherwise a customer explaining herself
 * silently redirects her own parcel (Malini, 19 Sep: she postponed to Monday
 * and was answered "We'll deliver to Rose Hill instead", losing the Ebene
 * workplace she had chosen).
 */
export function asksDeliveryAt(text: string | null | undefined, locality: string | null | undefined): boolean {
  const name = locality?.trim().toLowerCase()
  if (!text || !name) return false
  const needle = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  const names = new RegExp(`\\b${needle}\\b`, 'i')
  return text.split(/(?<=[.?!])\s+|\n/).some((sentence) => names.test(sentence) && DELIVERY_VERB.test(sentence))
}

/**
 * True when the thread is in an exchange conversation: since our last ORDER
 * CONFIRMATION (or from the start), the customer reported a fault / asked for a
 * remedy, or WE promised an exchange. Keeps the mode alive through "When?",
 * "Pls come on Saturday", "ok" - turns that carry no fault word themselves
 * (Preety, 15 Sep: the model fell back to selling her a second massager).
 * `transcript` is the "Customer: ..." / "Business: ..." lines the model sees.
 */
export function isExchangeThread(transcript: string): boolean {
  const lines = transcript.split('\n')
  let lastConfirmation = -1
  lines.forEach((line, i) => {
    if (line.startsWith('Business:') && ORDER_CONFIRMATION_HEADER.test(line)) lastConfirmation = i
  })
  const tail = lines.slice(lastConfirmation + 1)
  return tail.some((line) => {
    if (line.startsWith('Customer:')) return isAfterSalesMessage(line.slice('Customer:'.length))
    if (line.startsWith('Business:')) return OUR_EXCHANGE.test(line) && !ORDER_CONFIRMATION_HEADER.test(line)
    return false
  })
}

const WEEKDAYS: Array<{ day: number; pattern: RegExp }> = [
  { day: 0, pattern: /\b(sunday|dimanche|dimans)\b/i },
  { day: 1, pattern: /\b(monday|lundi|lindi)\b/i },
  { day: 2, pattern: /\b(tuesday|mardi)\b/i },
  { day: 3, pattern: /\b(wednesday|mercredi|merkredi)\b/i },
  { day: 4, pattern: /\b(thursday|jeudi|zedi)\b/i },
  { day: 5, pattern: /\b(friday|vendredi|vandredi)\b/i },
  { day: 6, pattern: /\b(saturday|samedi|samdi)\b/i },
]

/**
 * The delivery day the customer asked for, as one of OUR delivery options
 * ("Pls come on Saturday" -> the first Saturday in `options`). Null when they
 * named no day or we do not deliver on it - the caller falls back to the next
 * delivery day exactly as a sale does.
 */
export function requestedDeliveryDay(text: string | null | undefined, options: string[]): string | null {
  if (!text || !options.length) return null
  for (const { day, pattern } of WEEKDAYS) {
    if (!pattern.test(text)) continue
    const hit = options.find((iso) => new Date(`${iso}T12:00:00`).getDay() === day)
    if (hit) return hit
  }
  return null
}
