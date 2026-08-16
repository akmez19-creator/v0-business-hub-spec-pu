import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { whatsappToken } from '@/lib/whatsapp/store'
import { listWhatsAppNumbers } from '@/lib/whatsapp/accounts'

/**
 * Request WhatsApp history sync for every number the token can reach.
 *
 * There is no bulk export in the Cloud API: messages exist only as webhook
 * deliveries. The single exception is Coexistence - a number still running in
 * the WhatsApp Business phone app can sync up to 180 days of past 1:1 chats
 * when it is onboarded, and that sync is requested through this endpoint.
 *
 * Rather than deciding eligibility locally and possibly being wrong, this asks
 * Meta about each number and reports whatever Meta answers. A number already
 * on the Cloud API is rejected with code 131000 ("only available to WhatsApp
 * Business App phone numbers"), which is the authoritative confirmation that
 * its history window has closed for good.
 */

const GRAPH = 'https://graph.facebook.com/v23.0'

type SyncResult = {
  id: string
  displayPhone: string
  verifiedName: string
  platform: string
  requested: boolean
  detail: string
}

export async function POST() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    const token = whatsappToken()
    if (!token) {
      return NextResponse.json({ success: false, error: 'No WhatsApp token configured' }, { status: 400 })
    }

    const numbers = await listWhatsAppNumbers(token)
    const results: SyncResult[] = []

    for (const n of numbers) {
      const base = {
        id: n.id,
        displayPhone: n.displayPhone,
        verifiedName: n.verifiedName,
        platform: n.platform,
      }

      try {
        const body = new URLSearchParams({
          messaging_product: 'whatsapp',
          sync_type: 'history',
          access_token: token,
        })
        const res = await fetch(`${GRAPH}/${n.id}/smb_app_data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        })
        const json = (await res.json().catch(() => ({}))) as {
          success?: boolean
          error?: { message?: string; code?: number }
        }

        if (res.ok && !json.error) {
          results.push({
            ...base,
            requested: true,
            detail: 'History sync requested. Past chats arrive by webhook over the next few minutes.',
          })
          continue
        }

        // 131000 is Meta stating the number is already on the Cloud API, so
        // its phone-app history can never be pulled. Report that plainly
        // instead of as a generic failure - it is a permanent answer.
        // Two distinct permanent answers, worth telling apart:
        //   131000 - number is already on the Cloud API, so the phone-app
        //            history window closed when it was migrated. Nothing to do.
        //   133010 - number was never registered on the platform, so history
        //            can still come in, but only via Coexistence onboarding,
        //            and only within 24h of that onboarding.
        const code = json.error?.code
        results.push({
          ...base,
          requested: false,
          detail:
            code === 131000
              ? 'Already on the Cloud API — its earlier phone-app history can no longer be synced.'
              : code === 133010
                ? 'Not registered yet. Onboard it via Coexistence in Meta Business Suite to pull up to 180 days of chats — the sync must be started within 24 hours of onboarding.'
                : (json.error?.message ?? `Request failed (HTTP ${res.status})`),
        })
      } catch (e) {
        results.push({
          ...base,
          requested: false,
          detail: e instanceof Error ? e.message : 'Request failed',
        })
      }
    }

    const requested = results.filter((r) => r.requested).length
    return NextResponse.json({
      success: true,
      requested,
      total: results.length,
      results,
      summary:
        requested > 0
          ? `History sync started for ${requested} number${requested === 1 ? '' : 's'}.`
          : 'No number is eligible for history sync. Meta only allows it for numbers still running in the WhatsApp Business phone app, at the moment they are onboarded.',
    })
  } catch (e) {
    console.log('[v0] whatsapp history sync failed:', e instanceof Error ? e.message : e)
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Sync failed' },
      { status: 500 },
    )
  }
}
