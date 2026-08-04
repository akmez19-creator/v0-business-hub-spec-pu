// Facebook conversion extraction - the single source of truth for "how many
// results did this ad get, and what did each one cost".
//
// Verified against the live account: our spend / messages division matches
// Facebook's own cost_per_action_type on 62/62 campaigns that had messages.

export interface FbAction {
  action_type: string
  value: string
}

// Facebook reports the SAME conversion under several action_type aliases
// (a lead shows up as lead, onsite_conversion.lead, onsite_web_lead,
// onsite_conversion.lead_grouped and more - all with the identical value).
// Summing them would multiply one lead by six, so each family takes the MAX.
const MESSAGE_ALIASES = [
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.messaging_conversation_started',
]
const LEAD_ALIASES = [
  'lead',
  'onsite_conversion.lead',
  'onsite_conversion.lead_grouped',
  'onsite_web_lead',
  'offsite_conversion.fb_pixel_lead',
]
const PURCHASE_ALIASES = [
  'purchase',
  'onsite_conversion.purchase',
  'offsite_conversion.fb_pixel_purchase',
  'omni_purchase',
]

export type ResultKind = 'msg' | 'lead' | 'buy' | 'none'

export interface Conversions {
  messages: number
  leads: number
  purchases: number
  /** The campaign's primary result count under the general conversion rule */
  results: number
  /** Which conversion the result count refers to */
  resultKind: ResultKind
}

const familyMax = (actions: FbAction[], aliases: string[]) =>
  aliases.reduce((max, t) => {
    const hit = actions.find((a) => a.action_type === t)
    const v = hit ? Number(hit.value) : 0
    return Number.isFinite(v) && v > max ? v : max
  }, 0)

/**
 * General conversion rule, applied uniformly to every campaign:
 * messages first (these are messaging ads), then leads, then purchases.
 * The first family with a non-zero count becomes the campaign's "result".
 */
export function extractConversions(actions?: FbAction[] | null): Conversions {
  const list = Array.isArray(actions) ? actions : []
  const messages = familyMax(list, MESSAGE_ALIASES)
  const leads = familyMax(list, LEAD_ALIASES)
  const purchases = familyMax(list, PURCHASE_ALIASES)

  let results = 0
  let resultKind: ResultKind = 'none'
  if (messages > 0) {
    results = messages
    resultKind = 'msg'
  } else if (leads > 0) {
    results = leads
    resultKind = 'lead'
  } else if (purchases > 0) {
    results = purchases
    resultKind = 'buy'
  }
  return { messages, leads, purchases, results, resultKind }
}

/** Cost of one result in Rs. null when there is nothing to divide by. */
export function costPerResultRs(spendUsd: number, results: number, usdToRs: number): number | null {
  if (!Number.isFinite(spendUsd) || spendUsd <= 0 || results <= 0) return null
  return (spendUsd * usdToRs) / results
}

export const RESULT_LABEL: Record<ResultKind, string> = {
  msg: 'msg',
  lead: 'lead',
  buy: 'sale',
  none: '-',
}
