import { fbGet } from './graph'

/**
 * What the CURRENT token can actually do, read from Facebook rather than
 * assumed.
 *
 * This exists because ticking permissions in the Graph API Explorer does not
 * change the live token - only regenerating it and replacing the env var does.
 * Every channel asks this module whether it is usable, so a missing scope
 * produces one precise "here is the scope you are missing" panel instead of a
 * generic red error, or worse, an empty list that looks like a quiet day.
 */

const GRAPH = 'https://graph.facebook.com/v21.0'

export type ChannelId = 'messenger' | 'comments' | 'whatsapp'

export type ChannelState = {
  id: ChannelId
  label: string
  /** True when every required scope is present on the live token. */
  available: boolean
  /** Scopes required but absent. Empty when available. */
  missing: string[]
  /** Scopes that unlock extra actions (e.g. replying) but are not required. */
  degraded: string[]
  /** Short, specific explanation shown when unavailable. */
  reason?: string
}

export type TokenCapabilities = {
  valid: boolean
  scopes: string[]
  /** Unix seconds, or 0 for a token that never expires. */
  expiresAt: number | null
  channels: Record<ChannelId, ChannelState>
  error?: string
}

// Reading a Page's own conversations only needs pages_messaging. Reading
// comments written by OTHER people needs pages_read_user_content - without it
// Graph returns #200 rather than an empty list.
const REQUIRED: Record<ChannelId, string[]> = {
  messenger: ['pages_messaging'],
  comments: ['pages_read_user_content'],
  whatsapp: ['whatsapp_business_messaging'],
}

const OPTIONAL: Record<ChannelId, string[]> = {
  messenger: ['pages_utility_messaging'],
  // Replying to a comment is a write on the Page's own feed; hiding/deleting
  // someone else's comment is moderation and needs manage_engagement.
  comments: ['pages_manage_engagement', 'pages_manage_posts'],
  whatsapp: ['whatsapp_business_management'],
}

const LABEL: Record<ChannelId, string> = {
  messenger: 'Messenger',
  comments: 'Comments',
  whatsapp: 'WhatsApp',
}

const REASON: Record<ChannelId, string> = {
  messenger: 'Reading Page conversations requires the pages_messaging permission.',
  comments:
    'Reading comments left by customers requires pages_read_user_content. Without it Facebook rejects the request outright rather than returning an empty list.',
  whatsapp:
    'WhatsApp requires whatsapp_business_messaging and a number registered to the WhatsApp Cloud API. A number used in the WhatsApp Business phone app has no API access.',
}

function buildChannel(id: ChannelId, scopes: string[]): ChannelState {
  const missing = REQUIRED[id].filter((s) => !scopes.includes(s))
  const degraded = OPTIONAL[id].filter((s) => !scopes.includes(s))
  return {
    id,
    label: LABEL[id],
    available: missing.length === 0,
    missing,
    degraded,
    ...(missing.length > 0 ? { reason: REASON[id] } : {}),
  }
}

function allChannels(scopes: string[]): Record<ChannelId, ChannelState> {
  return {
    messenger: buildChannel('messenger', scopes),
    comments: buildChannel('comments', scopes),
    whatsapp: buildChannel('whatsapp', scopes),
  }
}

/**
 * Inspect the token via debug_token. Cached for 5 minutes: scopes only change
 * when the env var is replaced, and this is called by every channel.
 */
export async function getCapabilities(token: string): Promise<TokenCapabilities> {
  const enc = encodeURIComponent(token)
  try {
    const json = await fbGet<{
      data?: { is_valid?: boolean; scopes?: string[]; expires_at?: number }
    }>(`${GRAPH}/debug_token?input_token=${enc}&access_token=${enc}`, { cacheTtl: 5 * 60 * 1000 })

    const data = json.data ?? {}
    const scopes = data.scopes ?? []
    return {
      valid: data.is_valid !== false,
      scopes,
      expiresAt: data.expires_at ?? null,
      channels: allChannels(scopes),
    }
  } catch (e) {
    // A failed probe must not claim "no permissions" - that would tell the
    // user to fix a token that is fine. Report the probe failure instead.
    const message = e instanceof Error ? e.message : 'Could not inspect the access token'
    return { valid: false, scopes: [], expiresAt: null, channels: allChannels([]), error: message }
  }
}
