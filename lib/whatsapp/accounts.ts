import { fbGet } from '@/lib/facebook/graph'

/**
 * Discovers the business's WhatsApp numbers from Meta rather than requiring a
 * WHATSAPP_PHONE_NUMBER_ID env var.
 *
 * There are four live Cloud API numbers across four Business Manager accounts
 * (Destockage, Hot Sales, Made By Moris, Buildeco), so a single env var could
 * only ever have served one of them.
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
}

type BizList = { data?: { id: string; name: string }[] }
type WabaList = { data?: { id: string; name: string }[] }
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
