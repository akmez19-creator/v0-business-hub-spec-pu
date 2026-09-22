/**
 * Reads a conversation and returns BOTH a draft reply and the order fields the
 * customer has already given, so opening a lead pre-fills the Quick Order form
 * instead of the agent re-reading the thread and retyping it.
 *
 * Nothing here sends or saves anything - the agent approves every action. The
 * model is deliberately not trusted with the final values either: whatever it
 * returns for product and locality is re-matched against the real catalogue
 * below, because a hallucinated locality becomes a real failed delivery.
 */

import { productFromAdName } from '@/lib/facebook/ad-product-name'
import { generateText, Output } from 'ai'
import { standbyNotice, withStandbyModel, type StandbyTier } from '@/lib/ai/standby'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { matchLocality } from '@/lib/inbox/locality-match'
import { asksForPhoneNumber, buildAssistSystemPrompt, confirmationDayLabel, enforceConfirmationReply, enforceExchangeReply, enforceTradeInReply } from '@/lib/inbox/assist-prompt'
import { settle } from '@/lib/orders/follow-up'
import { asksDeliveryAt, latestCustomerRun, reportsFault, wantsAnotherItem, wantsDifferentItem } from '@/lib/inbox/after-sales'
import { getAdPostLink } from '@/lib/inbox/ad-post-link'
import { shortlistForPrompt } from '@/lib/inbox/prompt-catalogue'
import { rideableOrders } from '@/lib/inbox/ride-with'
import { isAfterSalesMessage, isExchangeThread, requestedDeliveryDay } from '@/lib/inbox/after-sales'
import { readCustomerAttachments, type AttachmentTurn } from '@/lib/inbox/attachment-reader'
import { todayInMauritius } from '@/lib/business-date'
import { loadWhatsAppDraftContext, assertWhatsAppDraftContextCurrent, type WhatsAppDraftContext } from '@/lib/whatsapp/draft-context'
import { ATTACHMENT_MARKER, MISSING_TEXT_MARKER, TRUNCATED_MARKER, UNAVAILABLE_MARKER, WhatsAppDraftBlocked } from '@/lib/whatsapp/draft-policy'
import { WhatsAppScopeError } from '@/lib/whatsapp/number-scope'
import {
  deliveryDayLabel,
  extractPhone,
  offerLabel,
  priceFor,
  upcomingDeliveryDates,
  type Holiday,
  type QuickOrderProduct,
} from '@/lib/orders/quick-order'

// The AI SDK must not run on the edge runtime.
export const runtime = 'nodejs'

/**
 * Model choice and the standby order (own OpenAI key -> same model via AI
 * Gateway -> Gemini) live in lib/ai/standby.ts. The shop's key is limited to
 * 30k tokens/minute, which two agents drafting together exhaust in a few clicks.
 */

type Turn = AttachmentTurn

/**
 * Lines Meta or our own automation inject into a Messenger thread. Nobody said them,
 * and their links carry long digit ids that read as phone numbers (the opt-in notice
 * ends in .../564030381383143 -> "5640 3038" filled a stranger's number into an order).
 */
const PLATFORM_NOTICE = /would like to send you messages|Auto-label added:|You are responding to a user comment|facebook\.com\/help\/messenger-app/i
const isPlatformNotice = (text: string) => PLATFORM_NOTICE.test(text)

/** Strip accents, punctuation and spacing so "Riviere-du-Rempart" matches "riviere du rempart". */
function normalise(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Resolve a free-text guess to a real catalogue entry.
 *
 * Returns null rather than a wrong-but-close answer: an unmatched field shows
 * as empty in the form, which the agent notices, whereas a confidently wrong
 * locality silently routes the parcel to the wrong contractor.
 */
function matchName<T>(guess: string | null | undefined, rows: T[], nameOf: (r: T) => string): T | null {
  if (!guess?.trim()) return null
  const g = normalise(guess)
  if (!g) return null

  const scored = rows.map((r) => ({ row: r, n: normalise(nameOf(r)) }))
  const exact = scored.find((s) => s.n === g)
  if (exact) return exact.row

  const prefix = scored.filter((s) => s.n.startsWith(g) || g.startsWith(s.n))
  if (prefix.length === 1) return prefix[0].row

  const contains = scored.filter((s) => s.n.includes(g) || g.includes(s.n))
  if (contains.length === 1) return contains[0].row

  // Ambiguous or unknown - let the agent choose.
  return null
}

/** Turn an unknown failure into something the agent can act on, without leaking internals. */
function describeAssistFailure(err: { name?: string; message?: string; statusCode?: number }): string {
  const name = err?.name ?? ''
  const message = err?.message ?? ''
  if (/NoObjectGenerated|JSONParse|TypeValidation|InvalidResponseData/i.test(name) || /schema|parse/i.test(message) && /output|object/i.test(message)) {
    return 'The AI reply did not come back in the expected shape. Retry AI assistance once; if it repeats, reply manually.'
  }
  // AI_RetryError wraps the provider message ("You have no credits remaining ...").
  if (/no credits|insufficient_quota|billing|exceeded your current quota/i.test(message)) {
    return 'AI drafting is paused: the OpenAI account has no credits left. Reply manually and tell the admin to top up the balance.'
  }
  if (err?.statusCode === 429 || /rate limit|quota/i.test(message)) return 'All AI providers are at their limit right now (main, Gateway and standby). Retry in a few seconds.'
  if (err?.statusCode === 401 || err?.statusCode === 403 || /api key|unauthori[sz]ed/i.test(message)) return 'The AI service rejected our credentials. Tell the admin.'
  if (/timeout|timed out|ECONNRESET|fetch failed|network/i.test(message)) return 'The AI service did not answer in time. Retry AI assistance.'
  if (/relation|column|function .* does not exist|permission denied/i.test(message)) return 'A database read behind the draft failed. Tell the admin.'
  return 'Failed to analyse conversation. Retry AI assistance; if it repeats, reply manually.'
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })

    const body = (await request.json()) as {
      messages?: Turn[]
      customerName?: string
      pageName?: string
      /** Messenger Page id: needed to refresh expired media links with the page token. */
      pageId?: string | null
      channel?: string
      waId?: string
      phoneNumberId?: string
      expectedContextVersion?: number
      productHint?: string | null
      adName?: string | null
      adId?: string | null
      /** The agent has looked at the photos/stickers in this thread and asked to draft anyway. */
      attachmentsReviewed?: boolean
      /** Business code of the Quick order (MBM/DBM): open orders of the other business are not additions. */
      business?: string | null
    }

    let whatsappContext: WhatsAppDraftContext | null = null
    if (body.channel === 'whatsapp') {
      whatsappContext = await loadWhatsAppDraftContext(body.waId, body.phoneNumberId, body.expectedContextVersion, { attachmentsReviewed: body.attachmentsReviewed === true })
    }
    const rawTurns = Array.isArray(body.messages) ? body.messages : []
    // Messenger: look at the customer's photos, videos and shared reels first,
    // so the draft works from what they actually sent rather than pausing.
    const attachmentRead = body.channel !== 'whatsapp'
      ? await readCustomerAttachments(typeof body.pageId === 'string' ? body.pageId : null, rawTurns.slice(-25))
      : null
    if (attachmentRead && attachmentRead.latestUnread > 0 && body.attachmentsReviewed !== true) {
      return NextResponse.json(
        { success: false, code: 'ATTACHMENT_UNREAD', error: 'The customer\u2019s latest photo or video could not be opened by the AI. Review it yourself, then use "draft anyway".' },
        { status: 422 },
      )
    }
    if (attachmentRead && attachmentRead.latestUnreadable > 0 && body.attachmentsReviewed !== true) {
      return NextResponse.json(
        { success: false, code: 'ATTACHMENT_UNREAD', error: 'The customer\u2019s latest message is a voice note or file the AI cannot read. Listen to or open it yourself, then use "draft anyway".' },
        { status: 422 },
      )
    }
    const turns = attachmentRead ? attachmentRead.turns.slice(-25) : rawTurns
    const transcript = whatsappContext?.transcript ?? turns
      .filter((t) => t && typeof t.text === 'string' && t.text.trim() && !isPlatformNotice(t.text))
      .slice(-25)
      .map(
        (t) =>
          `${t.from === 'business' || t.from === 'agent' || t.from === 'out' ? 'Business' : 'Customer'}: ${t
            .text!.trim()
            .slice(0, 500)}`,
      )
      .join('\n')

    if (!transcript) {
      return NextResponse.json(
        { success: false, error: 'No conversation to read yet.' },
        { status: 400 },
      )
    }

    // Catalogue + settings, loaded in parallel - all three ground the model.
    const [{ data: products }, { data: localities }, { data: settingsRow }] = await Promise.all([
      supabase
        .from('products')
        .select('id, name, price, bundle_prices, is_b1g1')
        .eq('is_active', true)
        .order('name'),
      supabase.from('localities').select('name').eq('is_active', true).order('name'),
      supabase
        .from('extension_settings')
        .select('ai_reply_prompt, cutoff_time, delivery_day_scheme, holidays, pinned_delivery_date')
        .eq('id', 1)
        .single(),
    ])

    const catalogue = (products ?? []) as QuickOrderProduct[]
    const businessContext =
      typeof settingsRow?.ai_reply_prompt === 'string' ? settingsRow.ai_reply_prompt.trim() : ''

    // Real delivery days, computed from the admin's cut-off/scheme/closures, handed to the
    // model as facts. Without them "never invent delivery dates" leaves it unable to answer
    // the most common question in the inbox.
    const holidays: Holiday[] = Array.isArray(settingsRow?.holidays) ? settingsRow.holidays : []
    const scheme = (settingsRow?.delivery_day_scheme as Record<string, string>) || {}
    const cutoff = settingsRow?.cutoff_time || '20:00'
    const pinned = typeof settingsRow?.pinned_delivery_date === 'string' ? settingsRow.pinned_delivery_date : null
    const deliveryOptions = upcomingDeliveryDates(new Date(), cutoff, scheme, holidays, 4, pinned)
    const deliveryFacts = deliveryOptions.map((d) => `${deliveryDayLabel(d)} (${d})`).join(', ')
    const nextDelivery = deliveryOptions[0] ? `${confirmationDayLabel(deliveryOptions[0])} (${deliveryOptions[0]})` : ''

    // Facts the model must not ask for again. The phone is read by regex from the
    // transcript (the model kept overlooking "tel.57026126"), and on Messenger the
    // profile name IS the customer's name - the team never asks for a "full name".
    // On WhatsApp the customer is writing FROM their number (the thread's waId), so it
    // is known before they type anything - asking "contact number please?" reads as odd.
    const waPhone = body.channel === 'whatsapp' && body.waId ? extractPhone(body.waId.replace(/^230/, '')) : null
    const knownPhone = extractPhone(transcript) ?? waPhone
    const knownName = body.customerName && body.customerName !== 'Facebook user' && !/^\+?\d[\d\s]*$/.test(body.customerName) ? body.customerName : ''

    // The post the clicked ad boosts (usually a Reel): lets the model answer
    // "where is the video?" with the real link instead of "we don't have one".
    // Orders already confirmed on this number and still to be delivered. Without them
    // "Will need one floor cleaner too" reads as a fresh lead and the model restarts the
    // whole flow (asks which product, re-asks the address, resends the confirmation).
    // Only orders the new item can actually ride with count: delivery day today or
    // later (Mauritius) and the same business. A pending order dated last week, or
    // the other page's order, is a fresh-order situation, not an addition.
    // Orders whose day has passed are NOT dropped: delivery status still lives in the
    // Excel panel, so a "pending" row dated last week means the customer has the item.
    // They go to the model as PAST ORDERS so "it's not working" is read as after-sales.
    const loadOrders = async () => {
      if (!knownPhone) return { open: [], past: [] }
      try {
        const { data } = await supabase.rpc('get_client_open_orders', { p_phone: knownPhone })
        const rows = (data ?? []) as Array<{ id: string | null; products: string | null; qty: number | null; amount: number | string | null; delivery_date: string | null; locality: string | null; medium: string | null }>
        const all = rows.map((o) => ({ id: o.id, products: o.products, qty: o.qty, amount: Number(o.amount || 0), deliveryDate: o.delivery_date, locality: o.locality, business: o.medium }))
        const open = rideableOrders(all, todayInMauritius(), typeof body.business === 'string' ? body.business : null)
        const today = todayInMauritius()
        const past = all.filter((o) => o.deliveryDate && o.deliveryDate.slice(0, 10) < today)
        return { open, past }
      } catch {
        return { open: [], past: [] }
      }
    }
    // The ad's product is resolved HERE from the ad id, not trusted from the row
    // the client had: a freshly opened lead can carry the ad id before the list
    // has cached its product, and a draft fired in that gap let the model guess.
    const adProductFromId = async (): Promise<string | null> => {
      if (!body.adId) return null
      const { data } = await supabase.from('page_post_ads').select('product').eq('ad_id', body.adId).not('product', 'is', null).limit(1).maybeSingle()
      return (data?.product as string | null) ?? null
    }
    const [adPost, orders, cachedAdProduct] = await Promise.all([getAdPostLink(body.adId).catch(() => null), loadOrders(), adProductFromId().catch(() => null)])
    const adName = body.adName || adPost?.adName || null
    // A Click-to-WhatsApp ad has no page post, so page_post_ads may never hold
    // it; its name ("MBM - EMS Foot Massager - 3") still names the product.
    const productHint = body.productHint || cachedAdProduct || productFromAdName(adName) || null
    const openOrders = orders.open
    const lastCustomerText = transcript.split('\n').reverse().find((line) => line.startsWith('Customer:'))?.slice('Customer:'.length).trim() ?? ''
    // Their whole point, not just the final bubble: an address or a new day is
    // often written one message before the one that closes the thought.
    const customerNow = latestCustomerRun(transcript) || lastCustomerText
    // The whole thread since our last order confirmation, not just the latest line:
    // "When?" / "Pls come on Saturday" carry no fault word but are still the exchange.
    const afterSales = isAfterSalesMessage(lastCustomerText) || isExchangeThread(transcript)

    const attachmentNote = whatsappContext?.attachmentsReviewed && (whatsappContext.attachmentCount > 0 || transcript.startsWith(TRUNCATED_MARKER))
      ? `\n\nGAPS IN THE TRANSCRIPT: ${whatsappContext.attachmentCount} turn(s) are markers instead of words. The agent has read the whole thread in WhatsApp and asked you to draft anyway. "${ATTACHMENT_MARKER}" = a photo or sticker you cannot see: work from the caption, the ad and the text; a screenshot of our own ad simply means the ad's product; never describe or guess what a photo shows. "${UNAVAILABLE_MARKER}" = a reaction or a deleted message: treat it as if nothing was said there. "${MISSING_TEXT_MARKER}" = a message whose words did not reach you: do not guess them; answer the readable turns and, if the missing words would change the answer (e.g. an address or product you need), ask the customer to repeat that one thing in a natural way. "${TRUNCATED_MARKER}" at the top = older turns omitted: the readable ones are the most recent. If the text alone does not identify the product, ask which product they mean instead of inventing one.`
      : ''
    // Only products this thread can be about go to the model; the full
    // catalogue stays on the server for re-grounding its answer below.
    const promptCatalogue = shortlistForPrompt({
      catalogue, productHint, adName, transcript,
      orderProductNames: [...openOrders, ...orders.past].map((o) => o.products),
    })
    console.log('[v0] ai-assist prompt catalogue:', promptCatalogue.length, 'of', catalogue.length, 'products')
    const system = buildAssistSystemPrompt({ pageName: body.pageName, productHint, adName, adPost, catalogue: promptCatalogue, businessContext, deliveryFacts, nextDelivery, knownName, knownPhone, knownPhoneSource: knownPhone && knownPhone === waPhone && !extractPhone(transcript) ? 'whatsapp' : 'conversation', openOrders, pastOrders: orders.past, afterSales }) + attachmentNote

    // nullable(), not optional() - OpenAI strict mode requires every key present.
    const schema = z.object({
      reply: z.string().describe('The message to send to the customer now.'),
      customerName: z.string().nullable(),
      phone: z.string().nullable(),
      phone2: z.string().nullable(),
      locality: z.string().nullable(),
      productName: z.string().nullable(),
      qty: z.number().int().min(1).max(50),
      notes: z.string().nullable().describe('Delivery instructions or special requests only.'),
      intent: z.enum(['price_enquiry', 'ready_to_order', 'delivery_question', 'complaint', 'other']),
      readyToOrder: z.boolean(),
      missing: z.array(z.enum(['product', 'name', 'phone', 'locality'])),
    })

    const generate = () =>
      withStandbyModel((model) =>
        generateText({
          model,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(25_000),
          system,
          messages: [
            {
              role: 'user',
              content: `Conversation so far (newest last):\n\n${transcript}\n\nWrite the reply to send now and extract the order details.`,
            },
          ],
          experimental_output: Output.object({ schema }),
        }),
      )
    // A thin, ad-less opener ("Can I get more info on this?") occasionally yields an
    // object that fails the schema; one retry recovers it far more often than it costs.
    let out: z.infer<typeof schema>
    let servedBy: StandbyTier
    try {
      const first = await generate()
      out = first.value.experimental_output
      servedBy = first.tier
    } catch (first) {
      const name = (first as { name?: string })?.name ?? ''
      if (!/NoObjectGenerated|JSONParse|TypeValidation/i.test(name)) throw first
      console.warn('[ai-assist] structured output failed once, retrying', { name })
      const second = await generate()
      out = second.value.experimental_output
      servedBy = second.tier
    }

    // A draft from an older conversation must not replace current agent work.
    if (whatsappContext) await assertWhatsAppDraftContextCurrent(whatsappContext)

    // Re-ground the model's guesses against the real catalogue. On a FRESH LEAD
    // the ad the customer clicked outranks the model when their own words never
    // touch the product the model picked (Roshni, 16 Sep: "2 pou moi a Mare Tabac"
    // on a Magnetic Window Cleaner ad was drafted as 2 x Cat Cardboard Cutter).
    // "Touch" is by word, not by full name: "ems massager" names the EMS Foot
    // Massager (16 Sep: that thread's older Whitening Toothpaste ad was wrongly
    // swapped in). After-sales never uses the ad - the customer holds the item
    // they describe, and a past order for the model's pick is proof enough.
    const adProduct = matchName(productHint, catalogue, (p) => p.name) ?? matchName(adName, catalogue, (p) => p.name)
    const customerWords = new Set(normalise(transcript.split('\n').filter((l) => l.startsWith('Customer:')).map((l) => l.slice('Customer:'.length)).join(' ')).split(/\s+/))
    const modelProduct = matchName(out.productName, catalogue, (p) => p.name)
    const customerNamesIt = (p: { name: string } | null) => {
      if (!p) return false
      const tokens = normalise(p.name).split(/\s+/).filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !['b1g1', 'set', 'pcs', 'the', 'and', 'with', 'for'].includes(t))
      const hits = tokens.filter((t) => customerWords.has(t)).length
      return tokens.length > 0 && hits >= Math.min(2, tokens.length)
    }
    const heldBefore = (p: { name: string } | null) => Boolean(p && orders.past.some((o) => matchName(o.products, [p], (x) => x.name)))
    const product = !afterSales && adProduct && modelProduct && adProduct !== modelProduct && !customerNamesIt(modelProduct) && !heldBefore(modelProduct)
      ? adProduct
      : modelProduct ?? (afterSales ? null : adProduct)
    // Localities get typo tolerance and Mauritian shorthand ("Cpe", "Vallee des
    // pretres"); products keep the strict matcher because a near-miss there is money.
    const modelLocality = matchLocality(out.locality, (localities ?? []) as { name: string }[], (l) => l.name)?.row ?? null
    // An order already has an address the customer chose. Naming another place
    // ("I live at rose hill", "I work at ebene") explains where they are; it
    // does not re-route the parcel. Hold the order's address unless they
    // actually ask for delivery somewhere else. A fresh lead has no open order,
    // so the place they mention is still the one we deliver to.
    const openLocality = openOrders.find((o) => o.locality)?.locality ?? null
    const holdLocality = Boolean(openLocality && !asksDeliveryAt(customerNow, out.locality))
    const locality = holdLocality
      ? matchLocality(openLocality, (localities ?? []) as { name: string }[], (l) => l.name)?.row ?? modelLocality
      : modelLocality

    // Trust a regex over the model for phone numbers: the transcript is the
    // source of truth and a digit-perfect match matters more than fluency.
    const phone = extractPhone(out.phone ?? '') ?? knownPhone ?? null
    const phone2 = extractPhone(out.phone2 ?? '') ?? null

    const qty = Math.min(Math.max(1, out.qty || 1), 50)
    const delivery = { date: deliveryOptions[0] }

    // Product + phone + locality known = the reply is decided, not drafted. The
    // model still asked "confirm the contact number?" on WhatsApp threads where the
    // number is the line they write from; the team's confirmation is built here.
    let reply = (out.reply || '').trim()
    let readyToOrder = out.readyToOrder
    let missing = out.missing ?? []
    // An after-sales message (fault / exchange / return) is never a sale: the code
    // decides, not the model's intent field, so an ORDER confirmation can never overwrite it.
    const allKnown = Boolean(product && phone && locality && delivery.date) && out.intent !== 'complaint' && !afterSales

    // EXCHANGE, SAME LADDER AS A SALE. The delivered order already holds product,
    // phone and locality, so the only unknown is the day: the one the customer
    // named ("Pls come on Saturday") when we deliver then, else the next delivery
    // day - exactly what a sale does. The confirmation is built here, and the
    // panel gets an exchange prefill (Rs 0, faulty unit collected) instead of a
    // second sale of the same item (Preety, 15 Sep).
    // Newest delivered order first: "I ordered on Sunday" points at the latest one.
    const pastNewestFirst = [...orders.past].sort((a, b) => (b.deliveryDate ?? '').localeCompare(a.deliveryDate ?? ''))
    const sameItemSource = product ? pastNewestFirst.find((o) => matchName(o.products, [product], (p) => p.name)) ?? null : null
    // TRADE-IN, NOT EXCHANGE - decided by the customer's WORDS, never by which
    // rows happen to be reachable: the wrong item was delivered (Vinaye got Grip
    // Tape for a Magnetic Window Cleaner) or they ask to swap for another model.
    // The delivered item comes back, the named one goes out, and the money is the
    // house rule from lib/orders/follow-up: credit = what they paid, only the
    // difference changes hands. A plain fault ("this apparatus is not working") is
    // an EXCHANGE of the item they name or the ad's item - even when its order row
    // is already delivered and out of reach (Luhmun, 16 Sep: his vacuum cleaner was
    // priced as a trade-in against an unrelated Aluminium Tape order).
    const isTradeIn = Boolean(afterSales && product && !sameItemSource && pastNewestFirst.length > 0 && wantsDifferentItem(lastCustomerText))
    const exchangeSource = !afterSales ? null : isTradeIn ? pastNewestFirst[0] : sameItemSource ?? (product ? null : pastNewestFirst[0] ?? null)
    const exchangeProduct = isTradeIn ? product : product ?? (exchangeSource ? matchName(exchangeSource.products, catalogue, (p) => p.name) : null)
    const exchangeLocality = exchangeSource?.locality
      ? matchLocality(exchangeSource.locality, (localities ?? []) as { name: string }[], (l) => l.name)?.row ?? locality
      : locality
    const requestedDay = requestedDeliveryDay(lastCustomerText, upcomingDeliveryDates(new Date(), cutoff, scheme, holidays, 7, pinned))
    const exchangeDate = requestedDay ?? delivery.date
    const returnQty = Math.max(1, exchangeSource?.qty ?? 1)
    const tradeIn = isTradeIn && exchangeSource && exchangeProduct
      ? settle({ kind: 'trade_in', orderAmount: exchangeSource.amount, orderQty: exchangeSource.qty, returnQty, outValue: priceFor(exchangeProduct, qty), allowance: 0 })
      : null
    // Evidence they HOLD the item: its order row, any past order on this number,
    // or a fault they describe. A fresh lead asking "can I return it if it
    // breaks?" has none of these and gets no confirmation.
    const holdsItem = Boolean(exchangeSource || pastNewestFirst.length > 0 || reportsFault(lastCustomerText))
    const exchangeReady = Boolean(afterSales && holdsItem && exchangeProduct && phone && exchangeLocality && exchangeDate)
    if (afterSales) {
      readyToOrder = exchangeReady
      if (exchangeReady && exchangeProduct) {
        reply = tradeIn && exchangeSource
          ? enforceTradeInReply({ reply, outLine: `${qty} x ${exchangeProduct.name}`, returnProductName: exchangeSource.products?.trim() || 'item you received', deliveryDate: exchangeDate, money: { credit: tradeIn.credit, amount: tradeIn.amount } })
          : enforceExchangeReply({ reply, productName: exchangeProduct.name, deliveryDate: exchangeDate })
        missing = []
      } else {
        missing = (['product', 'phone', 'locality'] as const).filter((k) => (k === 'product' ? !exchangeProduct : k === 'phone' ? !phone : !exchangeLocality))
      }
      console.info('[ai-assist] after-sales thread', { kind: isTradeIn ? 'trade_in' : 'exchange', ready: exchangeReady, requestedDay, source: exchangeSource?.deliveryDate ?? null, door: tradeIn?.amount ?? 0, text: lastCustomerText.slice(0, 80) })
    }
    if (allKnown && product) {
      const isAddition = wantsAnotherItem(lastCustomerText)
      const enforced = enforceConfirmationReply({ reply, productName: product.name, qty, amount: priceFor(product, qty), deliveryDate: delivery.date, openOrders, isAddition })
      if (enforced) {
        console.info('[ai-assist] replaced model reply with confirmation', { askedForPhone: asksForPhoneNumber(reply), addition: openOrders.length > 0 && isAddition })
        reply = enforced
      }
      readyToOrder = true
      missing = []
    }

    return NextResponse.json({
      success: true,
      reply,
      servedBy,
      notice: standbyNotice(servedBy),
      intent: afterSales ? 'complaint' : allKnown ? 'ready_to_order' : out.intent,
      readyToOrder,
      missing,
      afterSales,
      order: afterSales
        ? {
            // Exchange prefill: the delivered order's product and locality, no charge,
            // the faulty unit comes back with the rider. The panel creates it as
            // sales_type 'exchange' linked to the source row - never as a second sale.
            customerName: out.customerName?.trim() || body.customerName || '',
            contact1: phone ?? '',
            contact2: phone2 && phone2 !== phone ? phone2 : '',
            region: exchangeLocality?.name ?? '',
            productId: exchangeProduct?.id ?? null,
            productName: exchangeProduct?.name ?? '',
            // Trade-in: what goes out is the named item, and the door money is the
            // signed settlement (the server recomputes it from the source order).
            qty: tradeIn ? qty : 1,
            amount: tradeIn?.amount ?? 0,
            notes: out.notes?.trim() || '',
            deliveryDate: exchangeDate,
            salesType: tradeIn ? ('trade_in' as const) : ('exchange' as const),
            sourceDeliveryId: exchangeSource?.id ?? null,
          }
        : {
            customerName: out.customerName?.trim() || body.customerName || '',
            contact1: phone ?? '',
            contact2: phone2 && phone2 !== phone ? phone2 : '',
            region: locality?.name ?? '',
            // Null when nothing matched, so the form shows an empty picker rather
            // than a confidently wrong product.
            productId: product?.id ?? null,
            productName: product?.name ?? '',
            qty,
            amount: product ? priceFor(product, qty) : 0,
            notes: out.notes?.trim() || '',
            deliveryDate: delivery.date,
            salesType: 'sale' as const,
            sourceDeliveryId: null,
          },
      deliveryOptions,
      // Surfaced in the UI so the agent can see WHY a field is blank.
      unmatched: {
        product: !!out.productName && !product ? out.productName : null,
        locality: !!out.locality && !locality ? out.locality : null,
      },
    })
  } catch (error) {
    if (error instanceof WhatsAppDraftBlocked || error instanceof WhatsAppScopeError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.status })
    }
    const err = error as { name?: string; message?: string; cause?: unknown; statusCode?: number; responseBody?: string }
    // Keep the message (never the transcript) so the Vercel log shows the real cause
    // instead of a blanket failure; the agent gets the same class of reason.
    console.error('[ai-assist] failed', { name: err?.name, message: err?.message, status: err?.statusCode, body: typeof err?.responseBody === 'string' ? err.responseBody.slice(0, 300) : undefined })
    const reason = describeAssistFailure(err)
    return NextResponse.json({ success: false, error: reason }, { status: 500 })
  }
}
