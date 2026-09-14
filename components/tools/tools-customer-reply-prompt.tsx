'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'

/**
 * Editor for the instruction the customer-reply assistant follows when it
 * drafts a message. Stored in extension_settings.ai_reply_prompt and read by
 * both the dashboard "Draft with AI" and the extension's AI reply button, so a
 * change here takes effect on the next draft with no re-download or redeploy.
 */
const PLACEHOLDER = `Describe how to reply to customers. The assistant already sees the live product list, prices and the next delivery days — it will never invent a price or a date. Use "Start from suggested draft" below, or write your own.`

/**
 * Written from the owner's own description of the business. Facts the model
 * already receives as data (prices, delivery days) are referenced, not
 * restated, so this text can never drift from the live settings.
 */
const SUGGESTED_DRAFT = `WHO WE ARE
We sell practical home, kitchen and lifestyle products across Mauritius, with home delivery. Our whole business is the shop-through-chat experience: the customer sees a product in an ad, messages us, and we close the sale in a few friendly messages. Be warm, human and efficient. One short message at a time.

LANGUAGE
Reply in the language the customer used: English, French or Mauritian Kreol. Match their register. Never mix languages in one message unless they did.

PRODUCT AND PRICE
Always talk about the specific product the customer asked about. Use the exact name from the product list and the exact price you were given for that product and quantity. Mention any offer that applies (sets, buy-1-get-1, promo) exactly as given. If you were not given a price, do not guess: say you will confirm it. Never invent stock levels.

DELIVERY - ISLAND-WIDE
Delivery anywhere in Mauritius is FREE. Payment is cash on delivery. Only offer the delivery days you were given; the first one is the normal next delivery. If the customer needs another day, say the team will confirm it.

DELIVERY - BY POST
Delivery by post is also FREE. For a postal order: ask for the customer's exact full postal address (name, street, locality and postcode). Explain that postal orders are paid in advance and that our team will send the payment details to complete the order. Do not give any account number yourself.

TAKING THE ORDER
To place a delivery order we need: the product and quantity, the customer's full name, a phone number (8 digits starting with 5) and the locality. Ask only for what is still missing, politely, in one message. Once everything is there, confirm the order back in one line: product, quantity, total price, delivery day, and that delivery is free.

IF ASKED SOMETHING YOU CANNOT ANSWER
Say the team will get back to them. Never promise a refund, an exchange, a discount or a delivery time slot that you were not given.`

export function ToolsCustomerReplyPrompt() {
  const [prompt, setPrompt] = useState('')
  const [saved, setSaved] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/extension/customer-reply-prompt')
        // Branch on the status before reading the body: an HTML error page
        // would make res.json() throw and report the wrong cause.
        if (!res.ok) {
          if (!cancelled) {
            setError(
              res.status === 403
                ? 'Only an admin or manager can edit this instruction.'
                : 'Could not load the instruction.',
            )
          }
          return
        }
        const json = await res.json()
        if (cancelled) return
        setPrompt(json.prompt || '')
        setSaved(json.prompt || '')
      } catch {
        if (!cancelled) setError('Could not load the instruction.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const dirty = prompt !== saved

  async function save() {
    setSaving(true)
    setError('')
    setDone(false)
    try {
      const res = await fetch('/api/extension/customer-reply-prompt', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      const json = res.headers.get('content-type')?.includes('json')
        ? await res.json()
        : { error: 'Server error' }
      if (!res.ok || !json.success) {
        setError(json.error || 'Could not save.')
        return
      }
      setSaved(prompt)
      setDone(true)
      setTimeout(() => setDone(false), 2500)
    } catch {
      setError('Could not save. Check your connection.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="px-4 pb-8 md:px-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-balance">Customer reply instruction</CardTitle>
          <CardDescription className="text-pretty leading-relaxed">
            What the assistant is told before it drafts a reply to a customer in the inbox and in the
            Chrome extension. It always sees your live product list, prices and the next delivery days
            alongside this, so it answers product, price and delivery-day questions from real data and
            never invents them. Put your delivery and postal policy and your tone here — it takes effect
            on the next draft, with no re-download.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Textarea
            value={loading ? '' : prompt}
            onChange={e => setPrompt(e.target.value)}
            disabled={loading || saving}
            rows={16}
            aria-label="Customer reply instruction"
            placeholder={loading ? 'Loading…' : PLACEHOLDER}
            className="font-mono text-xs leading-relaxed"
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={save} disabled={!dirty || saving || loading}>
              {saving ? 'Saving…' : 'Save instruction'}
            </Button>
            {dirty && !saving ? (
              <Button variant="ghost" onClick={() => setPrompt(saved)} disabled={loading}>
                Undo changes
              </Button>
            ) : null}
            {!loading && prompt !== SUGGESTED_DRAFT ? (
              <Button
                variant="outline"
                onClick={() => setPrompt(SUGGESTED_DRAFT)}
                disabled={saving}
                title={prompt.trim() ? 'Replaces the text above (you can still Undo)' : undefined}
              >
                {prompt.trim() ? 'Replace with suggested draft' : 'Start from suggested draft'}
              </Button>
            ) : null}
            <span className="text-sm text-muted-foreground" role="status" aria-live="polite">
              {error ? (
                <span className="text-destructive">{error}</span>
              ) : done ? (
                'Saved.'
              ) : dirty ? (
                'Unsaved changes'
              ) : (
                ''
              )}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground text-pretty">
            The fully automated WhatsApp Autopilot does not use this instruction — it sends fixed,
            approved wording — so editing this only changes drafts a person reviews before sending.
          </p>
        </CardContent>
      </Card>
    </section>
  )
}
