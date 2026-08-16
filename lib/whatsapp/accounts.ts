import { fbGet } from '@/lib/facebook/graph'

/**
 * Discovers the business's WhatsApp numbers from Meta rather than requiring a
 * WHATSAPP_PHONE_NUMBER_ID env var.
 *
 * There are five live Cloud API numbers across four Business Manager accounts
 * (Destockage, Hot Sales, Buildeco, and TWO under Made By Moris), so a single
 * env var could only ever have served one of them.
 *
 * Discovery is deliberately dynamic rather than a hardcoded list: numbers get
 * added in Business Suite without anyone touching this code.
 */

const GRAPH = 'https://graph.facebook.com/v21.0'

export type WaNumber = {
  /** phone_number_id - the id used to send and the key webhooks arrive on. */
  id: string
  displayPhone: string
  verifiedName: string
  wabaId: string
  wabaName: string
  businessName: string
  /**
   * Only CLOUD_API numbers are usable. ON_PREMISE runs on a self-hosted
   * gateway this app has no access to, and NOT_APPLICABLE means the number was
   * never migrated off the WhatsApp Business phone app.
   */
  platform: string
  usable: boolean
  /**
   * Apps receiving this WABA's webhooks. A number can be live in a third-party
   * inbox (respond.io, n8n) while invisible here, so the distinction between
   * "nobody is listening" and "someone else is listening" has to be shown.
   */
  subscribedApps: string[]
  /** True when THIS app is subscribed, i.e. messages can reach this inbox. */
  oursSubscribed: boolean
}

/** Our Meta app. Webhooks only reach this inbox if this id is subscribed. */
export const OUR_APP_ID = '1284520097159203'

type BizList = { data?: { id: string; name: string }[] }
type WabaList = { data?: { id: string; name: string }[] }
type SubList = {
  data?: { whatsapp_business_api_data?: { id?: string; name?: string } }[]
}
type PhoneList = {
  data?: {
    id: string
    display_phone_number?: string
    verified_name?: string
    platform_type?: string
  }[]
}

/** Meta's sandbox numbers are noise in a real inbox. */
function isTestNumber(displayPhone: string, verifiedName: string): boolean {
  return /^\+1 555/.test(displayPhone) || /^test number$/i.test(verifiedName.trim())
}

/**
 * Every WhatsApp number reachable by the current token.
 *
 * Cached for 10 minutes - numbers change when a business is reconfigured, not
 * between page loads, and this walks three levels of the Graph.
 */
export async function listWhatsAppNumbers(token: string): Promise<WaNumber[]> {
  const enc = encodeURIComponent(token)
  const out: WaNumber[] = []
  const seen = new Set<string>()

  const biz = await fbGet<BizList>(`${GRAPH}/me/businesses?fields=id,name&limit=25&access_token=${enc}`, {
    cacheTtl: 10 * 60 * 1000,
  })

  for (const b of biz.data ?? []) {
    // A business can own its WABA outright or have one shared with it; both
    // appear in Business Suite, so both must be walked.
    for (const edge of ['owned_whatsapp_business_accounts', 'client_whatsapp_business_accounts']) {
      let wabas: WabaList
      try {
        wabas = await fbGet<WabaList>(`${GRAPH}/${b.id}/${edge}?fields=id,name&limit=25&access_token=${enc}`, {
          cacheTtl: 10 * 60 * 1000,
        })
      } catch {
        continue // one inaccessible edge must not hide the other businesses
      }

      for (const wa of wabas.data ?? []) {
        let phones: PhoneList
        try {
          phones = await fbGet<PhoneList>(
            `${GRAPH}/${wa.id}/phone_numbers?fields=id,display_phone_number,verified_name,platform_type&access_token=${enc}`,
            { cacheTtl: 10 * 60 * 1000 },
          )
        } catch {
          continue
        }

        // Who receives this WABA's webhooks. Asked once per WABA, not per
        // phone. A number can be live in respond.io and still deliver nothing
        // here, so "nobody is listening" must not look like "not connected".
        let subscribedApps: string[] = []
        let oursSubscribed = false
        try {
          const subs = await fbGet<SubList>(
            `${GRAPH}/${wa.id}/subscribed_apps?access_token=${enc}`,
            { cacheTtl: 10 * 60 * 1000 },
          )
          const entries = (subs.data ?? []).map((s) => s.whatsapp_business_api_data ?? {})
          subscribedApps = entries.map((a) => a.name?.trim()).filter((n): n is string => Boolean(n))
          oursSubscribed = entries.some((a) => a.id === OUR_APP_ID)
        } catch {
          // Not fatal: the number is still listed, just without routing info.
        }

        for (const p of phones.data ?? []) {
          const displayPhone = p.display_phone_number ?? ''
          const verifiedName = (p.verified_name ?? '').trim()
          if (seen.has(p.id) || isTestNumber(displayPhone, verifiedName)) continue
          seen.add(p.id)

          const platform = p.platform_type ?? 'UNKNOWN'
          out.push({
            id: p.id,
            displayPhone,
            verifiedName,
            wabaId: wa.id,
            wabaName: wa.name,
            businessName: b.name.trim(),
            platform,
            usable: platform === 'CLOUD_API',
            subscribedApps,
            oursSubscribed,
          })
        }
      }
    }
  }

  // Usable numbers first, then alphabetically, so the picker opens on a number
  // that can actually send.
  out.sort((a, b) =>
    a.usable === b.usable ? a.verifiedName.localeCompare(b.verifiedName) : a.usable ? -1 : 1,
  )
  return out
}
