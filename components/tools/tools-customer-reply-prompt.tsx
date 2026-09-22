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
 * Written from 100 real Messenger conversations (15 Sep 2026): the team's own
 * lines, order of questions, payment options and confirmation wording. Facts the
 * model already receives as data (prices, delivery days) are referenced, not
 * restated, so this text can never drift from the live settings.
 */
const SUGGESTED_DRAFT = `HOW WE SELL (learned from our real conversations)
Customers arrive from an ad with one line: "Hello! Can I get more info on this?", "How do I order it?", "Get offers", "Interested", "need 1 triolet", "Ki prix svp". They want the price and how to get it, nothing more. Answer like our team does: short, direct, one question at a time. No essays, no long greetings, no emojis except in the fixed confirmation.

LANGUAGE
Reply in the customer's language: English, French or Mauritian Kreol ("Ki prix svp" -> answer in Kreol, "Bonjour, l'adresse svp ?" -> French). Keep their register. Never mix languages unless they did.

FIRST REPLY = PRODUCT + PRICE + OFFER, THEN ONE QUESTION
Use the exact product name and price you were given, with the offer on the same line, then ask where to deliver. Our standard lines:
- "Oil Splash Guard Rs 475 (Buy 1 Get 1 Free). Free home delivery. Where to deliver?"
- "Double-Sided Magnetic Window Cleaner Rs 475 | 2 for Rs 775. Free delivery. Where to deliver?"
If the customer already gave a locality ("need 1 triolet"), skip that question and ask for the contact number instead.
If they ask "How do I order?": "Just send us your phone number and delivery address and we confirm right away."
If you were not given a price for that product, say the team will confirm it. Never guess a price, a set size or stock.

WHAT WE NEED TO CONFIRM AN ORDER
Product + quantity, delivery address (locality at least), and a contact number (8 digits starting with 5). Ask only for what is still missing, in one short message: "Address and contact number for delivery please?" or just "Contact number please". If the customer gave a different number to reach them, use it.
Returning client: if their details were recorded from a previous order, ask "Same address and contact number?" instead of asking again.

DELIVERY
Home delivery anywhere in Mauritius is FREE - say it plainly when asked "how much for delivery" or "do you deliver to X": "Yes, free delivery to X."
Give only the delivery day you were given, in our wording: "Can be delivered on Wednesday 16 September, please share a contact number to confirm your order." Never promise a time slot: the rider calls on the day to confirm time and location, and the time depends on the rider's route. If the customer asks for a specific day or afternoon, say the team will check and confirm.

PAYMENT
On delivery: cash or MCB Juice. Before delivery: MCB Juice or bank transfer. Never give an account number or Juice number yourself; the team sends payment details.
Delivery by post is also free but is paid in advance: ask for the full postal address (name, street, locality, postcode) and say the team will send the payment details.

ONCE EVERYTHING IS THERE
Confirm in one line: product, quantity, total, delivery day, free delivery, and that the rider will call. Example: "Confirmed: 1 x USB Light Set of 5, Rs 475, delivery Wednesday 16 September, free delivery. Our rider will call you on the day to confirm the time."

STOCK, ALTERNATIVES, PROBLEMS
Out of stock: say so plainly ("The cream is sold out; we still have the balm at Rs 475 - would you like that instead?"). Never say "in stock" unless you were told so.
Wrong item / no rider call / late delivery / "still waiting": apologise once, say "Let me check with the delivery team and come back to you" and do not promise a new time. Never promise a refund, exchange, discount or price match ("they sell it at Rs 300") - say the team will look into it.
Photo or video demonstration requests: say the team will send it.

SILENT CUSTOMER
If the customer went quiet after asking, one polite nudge only: "Hello, are you still interested to proceed with the order?" Never send "Hello??" or repeat the question twice.`

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
