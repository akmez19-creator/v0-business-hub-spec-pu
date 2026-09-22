import { LOCALITY_SHORTHAND_HINT } from '@/lib/inbox/locality-match'
import { offerLabel, priceFor, type QuickOrderProduct } from '@/lib/orders/quick-order'

export type AssistPromptInput = {
  pageName?: string
  productHint?: string | null
  adName?: string | null
  /** Public post the clicked ad boosts - the video/photos the customer saw. */
  adPost?: { permalinkUrl: string; message: string | null; mediaType: string | null } | null
  catalogue: QuickOrderProduct[]
  businessContext: string
  deliveryFacts: string
  nextDelivery: string
  knownName: string
  knownPhone: string | null
  /** 'whatsapp' when the number is the sender's own WhatsApp line rather than something they typed. */
  knownPhoneSource?: 'conversation' | 'whatsapp'
  /** Orders already confirmed and still to be delivered on this number. */
  openOrders?: Array<{ products: string | null; qty: number | null; amount: number; deliveryDate: string | null; locality: string | null }>
  /**
   * Orders on this number whose delivery day has passed. Delivery status still lives
   * in the old Excel system, so a "pending" row dated last week means DELIVERED here:
   * the customer has the item, and "it's not working" refers to it.
   */
  pastOrders?: Array<{ id?: string | null; products: string | null; qty: number | null; amount: number; deliveryDate: string | null; locality: string | null }>
  /** Code-level detection that the latest customer message is a fault/exchange/return, not a purchase. */
  afterSales?: boolean
}

/** "Wednesday 16 September 2026" - the form the team types into the template. */
export function confirmationDayLabel(ymdDate: string): string {
  const [y, m, d] = ymdDate.split('-').map(Number)
  if (!y || !m || !d) return ymdDate
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(',', '')
}

/**
 * The team's standard confirmation, sent 130+ times in stored history. The AI
 * fills the day and keeps everything else verbatim.
 */
export function orderConfirmationTemplate(deliveryDay: string): string {
  return [
    '🎉 Order Confirmation 🎉',
    'Your order has been confirmed!',
    '',
    '📦 Delivery Date:',
    `✔️ Delivery is scheduled on ${deliveryDay}`,
    '',
    '💳 Payment Options:',
    '-On Delivery: Cash / MCB Juice',
    '-Before Delivery: MCB Juice / Bank Transfer',
    '',
    '📌 Delivery Free',
    '',
    '⏰ Delivery Time:',
    'Our rider will call to confirm the delivery time and location.',
    'Time depends on the rider’s route for the day.',
    '',
    'Thank you for ordering with us!',
  ].join('\n')
}

/**
 * True when a message the agent is about to send is an order confirmation -
 * the template above, or an agent's own wording carrying the same signals
 * (confirm + delivery + a price). Used to record the order before the
 * confirmation leaves, never to block ordinary replies.
 */
export function isOrderConfirmationMessage(text: string | null | undefined): boolean {
  if (!text) return false
  // "Rs 475... delivered Wednesday. Contact number please to confirm your
  // order?" quotes a price and a day but is a QUESTION for the phone - no
  // order exists yet, so sending it must not create one.
  if (asksForPhoneNumber(text)) return false
  if (containsConfirmationTemplate(text)) return true
  const t = text.toLowerCase()
  return /\bconfirm(?:ed|ée?)?\b/.test(t) && /\b(deliver|delivery|livraison|livr[ée]e?)\b/.test(t) && /\brs\.?\s?\d/.test(t)
}

/** A reply that asks the customer for a phone/contact number in any of the three languages. */
export function asksForPhoneNumber(text: string | null | undefined): boolean {
  if (!text) return false
  const t = text.toLowerCase()
  const mentionsNumber = /\b(number|num[eé]ro|no\.|contact|phone|mobile|tel\.?|telephone|téléphone)\b/.test(t)
  const asks = /\?/.test(text) && /\b(confirm|share|send|give|provide|use|prefer|donner|envoyer|confirmer|utiliser|preferer|préférer|kapav|please|svp|plz)\b/.test(t)
  return mentionsNumber && asks
}

/** The team's verbatim template (or a translation of its two header lines), not a loose "we confirm delivery" sentence. */
function containsConfirmationTemplate(text: string): boolean {
  const t = text.toLowerCase()
  return t.includes('order confirmation') || t.includes('order has been confirmed') || t.includes('confirmation de commande') || t.includes('commande est confirmée')
}

export interface EnforcedReplyInput {
  reply: string
  productName: string
  qty: number
  amount: number
  /** YYYY-MM-DD of the delivery day to promise. */
  deliveryDate: string
  /** Open orders on this number; when present nothing is confirmed afresh. */
  openOrders: Array<{ products: string | null; amount: number; deliveryDate: string | null }>
  /**
   * The customer asked for something MORE (wantsAnotherItem). Only then does an
   * open order turn this reply into an addition with a new total; otherwise the
   * message is about the order they already have.
   */
  isAddition?: boolean
}

/**
 * When product, phone and locality are ALL known the reply is not the model's to
 * improvise. Returns the reply the team actually sends, or null when the model's
 * reply already is that reply (so its wording, e.g. the language, is kept).
 */
/**
 * The exchange twin of the order confirmation: same shape, no money line, the
 * rider swaps the faulty unit for the replacement. Sent verbatim, like a sale.
 */
export function exchangeConfirmationTemplate(deliveryDay: string, productName: string): string {
  return [
    '🔄 Exchange Confirmation 🔄',
    `Your ${productName} exchange has been arranged!`,
    '',
    '📦 Exchange Date:',
    `✔️ Our rider comes on ${deliveryDay} with your replacement`,
    '',
    '🔁 Please keep the faulty unit ready - the rider collects it and hands you the replacement.',
    '',
    '📌 No charge',
    '',
    '⏰ Time:',
    'Our rider will call to confirm the time and location.',
    'Time depends on the rider’s route for the day.',
    '',
    'Thank you for your patience!',
  ].join('\n')
}

export function containsExchangeTemplate(text: string | null | undefined): boolean {
  return Boolean(text && /Exchange Confirmation/i.test(text) && /Exchange Date/i.test(text))
}

export type TradeInMoney = {
  /** What the customer paid for the item coming back - their credit. */
  credit: number
  /** Signed door money: >0 the rider collects, <0 the rider hands back. */
  amount: number
}

/**
 * A trade-in: the item they have comes back, a DIFFERENT item goes out. Same
 * shape as the exchange confirmation, but the money line is real - the credit is
 * what they paid, and only the difference changes hands at the door.
 */
export function tradeInConfirmationTemplate(input: { deliveryDay: string; outLine: string; returnProductName: string; money: TradeInMoney }): string {
  const { credit, amount } = input.money
  const moneyLine = amount > 0
    ? `📌 Rs ${credit.toLocaleString('en-GB')} already paid is credited - only Rs ${amount.toLocaleString('en-GB')} to pay on delivery (Cash / MCB Juice)`
    : amount < 0
      ? `📌 Rs ${credit.toLocaleString('en-GB')} already paid is credited - our rider refunds you Rs ${Math.abs(amount).toLocaleString('en-GB')} on delivery`
      : `📌 Rs ${credit.toLocaleString('en-GB')} already paid is credited - nothing more to pay`
  return [
    '🔄 Exchange Confirmation 🔄',
    `Your exchange for ${input.outLine} has been arranged!`,
    '',
    '📦 Exchange Date:',
    `✔️ Our rider comes on ${input.deliveryDay} with your ${input.outLine}`,
    '',
    `🔁 Please keep the ${input.returnProductName} ready - the rider collects it and hands you the new item.`,
    '',
    moneyLine,
    '',
    '⏰ Time:',
    'Our rider will call to confirm the time and location.',
    'Time depends on the rider’s route for the day.',
    '',
    'Thank you for your patience!',
  ].join('\n')
}

/** The model's own wording is kept only when it already carries the template AND the right door figure. */
export function enforceTradeInReply(input: { reply: string; outLine: string; returnProductName: string; deliveryDate: string; money: TradeInMoney }): string {
  const figure = Math.abs(input.money.amount).toLocaleString('en-GB')
  const carriesFigure = input.money.amount === 0 ? /nothing more to pay/i.test(input.reply) : new RegExp(`Rs\\s?${figure.replace(',', ',?')}`).test(input.reply)
  if (containsExchangeTemplate(input.reply) && carriesFigure && !asksForPhoneNumber(input.reply)) return input.reply
  const firstLine = input.reply.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  const keep = /sorry|d[eé]sol|apolog|excuse|inconven/i.test(firstLine) && firstLine.length <= 160 && !/\bRs\s?\d/.test(firstLine) && !/\?/.test(firstLine)
  return `${keep ? `${firstLine}\n\n` : ''}${tradeInConfirmationTemplate({ deliveryDay: confirmationDayLabel(input.deliveryDate), outLine: input.outLine, returnProductName: input.returnProductName, money: input.money })}`
}

/**
 * Exchange with product + phone + locality known from the delivered order: the
 * reply is decided in code, exactly like a sale. A short apology the model wrote
 * is kept in front of the template; everything else it wrote is dropped.
 */
export function enforceExchangeReply(input: { reply: string; productName: string; deliveryDate: string }): string {
  if (containsExchangeTemplate(input.reply) && !asksForPhoneNumber(input.reply)) return input.reply
  const firstLine = input.reply.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  const keep = /sorry|d[eé]sol|apolog|excuse|inconven/i.test(firstLine) && firstLine.length <= 160 && !/\bRs\s?\d/.test(firstLine) && !/\?/.test(firstLine)
  return `${keep ? `${firstLine}\n\n` : ''}${exchangeConfirmationTemplate(confirmationDayLabel(input.deliveryDate), input.productName)}`
}

export function enforceConfirmationReply(input: EnforcedReplyInput): string | null {
  const priceLine = `${input.qty} x ${input.productName} - Rs ${input.amount.toLocaleString('en-GB')}`
  if (input.openOrders.length) {
    // They already ordered and are waiting. Unless they asked for something MORE,
    // this message is about the order they have - a new day, a new address, a
    // question - so nothing is confirmed and nothing is added: the model's own
    // answer stands, and the order itself moves through the amendment tick-list.
    if (!input.isAddition) return null
    // Addition to an order already confirmed: one message, new total, same drop.
    const previous = input.openOrders.reduce((sum, o) => sum + (o.amount || 0), 0)
    const total = previous + input.amount
    // Ride on the open order's day only if that day is still ahead; a pending order
    // dated in the past is being rescheduled and must not be promised again.
    const rideWith = input.openOrders.find((o) => o.deliveryDate && o.deliveryDate >= input.deliveryDate.slice(0, 10))
    const when = rideWith?.deliveryDate ? `delivered together on ${confirmationDayLabel(rideWith.deliveryDate)}` : 'delivered together with your pending order'
    const mentionsTotal = new RegExp(`\\b${total.toLocaleString('en-GB').replace(/,/g, ',?')}\\b`).test(input.reply)
    if (mentionsTotal && !asksForPhoneNumber(input.reply) && !containsConfirmationTemplate(input.reply)) return null
    return `${priceLine} added to your order. New total Rs ${total.toLocaleString('en-GB')}, ${when}.`
  }
  if (containsConfirmationTemplate(input.reply) && !asksForPhoneNumber(input.reply)) return null
  return `${priceLine}\n\n${orderConfirmationTemplate(confirmationDayLabel(input.deliveryDate))}`
}

/** System prompt for the inbox "Draft with AI". Pure, so scripts can exercise it. */
export function buildAssistSystemPrompt(input: AssistPromptInput): string {
  return [
      'You are an experienced sales agent for a Mauritian retail and home-delivery business, working the social-media inbox (Facebook Messenger, WhatsApp, and Facebook post comments).',
      'You do two jobs at once: (1) write the single best reply to send now, and (2) extract the order details the customer has already given.',
      '',
      'REPLY RULES:',
      '- Reply in the SAME language the customer used (English, French, or Mauritian Kreol). Match their register; be warm and human, never robotic.',
      '- Answer the latest message directly and move the sale or the delivery forward. To place an order you need: product, phone number, locality. Ask for exactly what is still missing - in one short message - and NEVER ask for something listed under KNOWN FACTS below.',
      '- The name shown on the profile is the customer\'s name. Do not ask for a "full name" or "name for delivery" when a profile name is known; only ask when the profile name is unknown and the customer has not signed.',
      '- WHEN PRODUCT + PHONE + LOCALITY ARE ALL KNOWN, CONFIRM THE ORDER by sending the ORDER CONFIRMATION TEMPLATE below EXACTLY as written (same lines, emojis and wording), with the next delivery day already filled in. Before it put exactly ONE short line naming product, quantity and price only (e.g. "1 x Magnetic Window Cleaner - Rs 475") - do not repeat the delivery day, free delivery or the rider call outside the template. Do not ask another question. If the customer asked for a specific day that is in DELIVERY DAYS AVAILABLE, use that day instead.',
      '- THE AD THEY CLICKED IS THE PRODUCT THEY MEAN. Customers arrive from an ad and open with "Hello! Can I get more info on this?", "Price plz", "How do I order it?", "Interested", "Ki prix svp". "This"/"it" is the ad product: answer with its exact name, price and offer from the product list, then ask where to deliver. NEVER ask "which product are you interested in?" when the ad is known and the customer has not named anything else.',
      '- Only when the customer clearly names or describes a DIFFERENT product does the newer request win over the ad. Then use that product, and if it cannot be matched to the product list, ask them to confirm the name.',
      '- WHEN AN OPEN ORDER IS LISTED BELOW, the customer has ALREADY confirmed and is waiting for delivery. If they now ask for another item ("will need one X too", "add a Y", "also one Z"), treat it as an ADDITION to that order: reply with ONE short message naming the added item, its price and the NEW TOTAL, and say it comes together with the existing order on the same delivery day. Do NOT resend the ORDER CONFIRMATION TEMPLATE, do NOT ask for address or phone again (they are on the open order), and do NOT treat the added item as the product they "mean" instead of the ad. If the added item matches nothing in the product list, ask them to confirm which one, mentioning the closest names. If they ask for MORE of the same product already on the open order, say you will add it and give the new total.',
      '- AN OPEN ORDER CHANGES FAR MORE OFTEN THAN IT GROWS. When the customer asks to move the delivery to another day ("next week", "not tomorrow", "Monday instead"), gives a different address or locality ("I live at Rose Hill", "deliver to my office"), changes how many they want, or asks when the rider comes, they are talking about the order they ALREADY have - they are NOT ordering anything else. Reply with ONE short message that confirms the change in their own terms and names the new day and/or place. Do NOT add an item, do NOT quote a new total, do NOT repeat the price, and do NOT resend the ORDER CONFIRMATION TEMPLATE. Only treat it as an addition when they actually ask for something MORE ("one more", "add a", "also a", "aussi", "ousi").',
      '- A PLACE THEY MENTION IS NOT A NEW DELIVERY ADDRESS. "I live at Rose Hill", "I work at Ebene", "I am in Curepipe today" tell you where they are, usually to explain why a day does not suit them. The order keeps the address it already has unless they ASK for delivery somewhere else ("deliver to Rose Hill", "send it to my home", "change the address"). So when someone postpones, move ONLY the day and leave the address alone - do not write "we will deliver to X instead". If you genuinely cannot tell whether they want the address changed, keep it and ASK in the same message ("still to Ebene?").',
      '- WHEN THE CUSTOMER ASKS FOR A VIDEO, DEMONSTRATION, "how does it work", "where is the video" or a picture and an AD POST LINK is given below, send that link with ONE short sentence saying what the video shows (taken from the post caption). Never say you have no video when the link is available. If no AD POST LINK is given, say the team will send one shortly.',
      '- Customer attachments appear as bracketed notes inside their turn: "[photo - what it shows: ...]", "[video - what it shows: ...]", "[shared a reel - its caption reads: ...]". Those notes ARE the attachment\'s content; treat them as the customer\'s own words. A screenshot or shared reel of one of our ads names the product they want - match its text to the product list and answer with that product\'s exact name, price and offer (it wins over an earlier ad). A photo of an item they already own or a damaged item, or a payment proof, is not a new order - respond to that situation. Notes reading "not reviewed by the AI" or "could not open" mean unseen: never guess their content; if such an attachment is the only clue, ask the customer to name the item.',
      '- AFTER-SALES = AN EXCHANGE, HANDLED LIKE AN ORDER: when the customer already has the product (see PAST ORDERS below, or they say they received it) and reports it faulty, not working, damaged, the wrong item, or asks for an exchange, return or refund - in any language ("not working", "pa marche", "ne fonctionne plus", "mo anvi sanze") - product, phone and locality are ALL KNOWN from their delivered order, so nothing is missing. Write ONE short apology sentence and stop: the code appends the EXCHANGE CONFIRMATION with the day (the next delivery day, or the day they asked for). Do NOT quote a price, do NOT send the ORDER CONFIRMATION TEMPLATE, do NOT ask for phone or locality, do NOT ask when suits them, do NOT offer to sell another one. Put any instruction they give the rider ("charge it and show it works", "come to my workplace", "after 4pm") in notes. intent = "complaint", readyToOrder = true. productName = the product from PAST ORDERS when they want the SAME item again (faulty, damaged). When they want a DIFFERENT item instead - they received the wrong product, or they ask to swap for another model - productName = the item they WANT (the product they ordered, named in their message or the ad) and qty = how many of it: the code then builds a TRADE-IN confirmation that credits what they paid and states the difference, so still write only the apology line and no price. If NO past order is listed for this number, apologise and ask which product they bought and the number the order was placed on - nothing else.',
      '- Never invent prices, stock levels, or delivery dates. If you were not given a fact, ask for it instead of guessing.',
      '- Return only the message text: no markdown, no bullet points, no surrounding quotes, no signature.',
      '',
      'EXTRACTION RULES:',
      '- Only extract what the customer actually stated. Never guess. Use null for anything not clearly given.',
      '- A Mauritian mobile number is 8 digits starting with 5. Ignore order numbers, prices, and dates.',
      '- For productName, copy the closest name from the product list EXACTLY as written there, or null if the customer named nothing recognisable.',
      '- productName is the ad product when the customer\'s request is generic (info / price / how to order / interested) and they named nothing else; it is the product they named when they clearly asked for something different. Return null only when neither applies.',
      '- For locality, return the place name the customer gave, spelled as they wrote it. Do not normalise or invent one. The system matches it to the catalogue with typo tolerance.',
      `- A locality counts as GIVEN even when abbreviated or misspelled: ${LOCALITY_SHORTHAND_HINT}. A one-word message like "Cpe" or "Rose Hill" IS the locality answer - do not ask for it again. In the reply, write the full place name (Curepipe, not Cpe).`,
      '- customerName: the customer\'s name as signed in the conversation, else the profile name given below, else null.',
      '- readyToOrder is true only when a product, a phone number, and a locality are all present (KNOWN FACTS count as present).',
      '- When an OPEN ORDER is listed and the customer asks for another item, productName is the ADDED item (not the one already ordered) and qty is the quantity of the added item.',
      input.pageName ? `\nThe business page is "${input.pageName}".` : '',
      input.productHint
        ? `\nAD THE CUSTOMER CLICKED: "${input.adName ?? input.productHint}" -> catalogue product "${input.productHint}". Generic questions in this chat are about this product.`
        : '\nNo ad attribution for this chat: if the customer has not named a product, ask which one they mean.',
      input.adPost
        ? `\nAD POST LINK (the ${input.adPost.mediaType === 'video' || input.adPost.mediaType === 'video_inline' || /\/reel\//.test(input.adPost.permalinkUrl) ? 'video' : 'post'} the customer saw): ${input.adPost.permalinkUrl}${input.adPost.message ? `\nPost caption: ${input.adPost.message.replace(/\s+/g, ' ').trim()}` : ''}`
        : '',
      `\nKNOWN FACTS (already given - never ask for these again):${input.knownName ? `\n- Customer name: ${input.knownName} (from their profile)` : ''}${input.knownPhone ? `\n- Phone number: ${input.knownPhone} (${input.knownPhoneSource === 'whatsapp' ? 'the WhatsApp number they are writing from; the rider calls this line. NEVER ask for a contact number and NEVER ask them to confirm this one or whether they prefer another - if they want a different number they will say so. With product and locality known, go STRAIGHT to the ORDER CONFIRMATION TEMPLATE' : 'found in the conversation'})` : ''}${!input.knownName && !input.knownPhone ? '\n- none yet' : ''}`,
      input.openOrders?.length
        ? `\nOPEN ORDER${input.openOrders.length === 1 ? '' : 'S'} (confirmed, awaiting delivery - a new item is an ADDITION to this):\n${input.openOrders
            .map((o) => `- ${o.qty && o.qty > 1 ? `${o.qty} x ` : ''}${o.products?.trim() || 'order'} - Rs ${o.amount.toLocaleString('en-GB')}${o.deliveryDate ? `, delivery ${confirmationDayLabel(o.deliveryDate)}` : ''}${o.locality ? `, to ${o.locality}` : ''}`)
            .join('\n')}`
        : '',
      input.pastOrders?.length
        ? `\nPAST ORDER${input.pastOrders.length === 1 ? '' : 'S'} ON THIS NUMBER (delivery day already passed - the customer HAS this item; a fault or exchange request is about it):\n${input.pastOrders
            .map((o) => `- ${o.qty && o.qty > 1 ? `${o.qty} x ` : ''}${o.products?.trim() || 'order'} - Rs ${o.amount.toLocaleString('en-GB')}${o.deliveryDate ? `, delivered ${confirmationDayLabel(o.deliveryDate)}` : ''}${o.locality ? `, ${o.locality}` : ''}`)
            .join('\n')}`
        : '',
      input.afterSales
        ? '\nTHIS THREAD IS AN EXCHANGE (fault / exchange / return detected). Apply the AFTER-SALES rule: one-line apology, rider instructions into notes, no price, no ORDER confirmation, no new sale. The code adds the EXCHANGE CONFIRMATION and the day.'
        : '',
      input.nextDelivery ? `Next delivery day: ${input.nextDelivery}.\n\nORDER CONFIRMATION TEMPLATE (send verbatim when confirming):\n${orderConfirmationTemplate(input.nextDelivery.replace(/\s*\(.*\)$/, ''))}` : '',
      input.catalogue.length
        ? `\nPRODUCT LIST (the products this conversation can be about - exact names, unit price for one, offers as noted). If the customer asks about something not listed here, say the team will check and ask which product they mean; never quote a price from memory:\n${input.catalogue
            .map((p) => {
              const offer = offerLabel(p)
              return `${p.name}: Rs ${priceFor(p, 1)}${offer ? ` (${offer})` : ''}`
            })
            .join('\n')}`
        : '\nPRODUCT LIST: nothing in this conversation names a product yet. Ask which product they are interested in; never quote a price from memory.',
      `\nDELIVERY DAYS AVAILABLE (the only dates you may offer; the first is the default): ${input.deliveryFacts}. If the customer asks for a different day, say the team will confirm.`,
      input.businessContext ? `\nBUSINESS CONTEXT AND TONE:\n${input.businessContext}` : '',
    ]
    .filter(Boolean)
    .join('\n')
}
