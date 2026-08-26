'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'

/**
 * Editor for the instruction the 1688 supplier assistant follows when it drafts
 * a reply. Stored in extension_settings.purchaser_prompt so the negotiating
 * stance can be retuned without a redeploy.
 */
export function ToolsPurchaserPrompt() {
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
        const res = await fetch('/api/extension/purchaser-prompt')
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
      const res = await fetch('/api/extension/purchaser-prompt', {
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
          <CardTitle className="text-balance">Supplier reply instruction</CardTitle>
          <CardDescription className="text-pretty leading-relaxed">
            What the assistant is told before it drafts a message to a 1688 supplier. It always sees
            the supplier&apos;s real order history from Akmez alongside this. Change it whenever the
            way you negotiate changes — it takes effect on the next draft, with no re-download.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Textarea
            value={loading ? '' : prompt}
            onChange={e => setPrompt(e.target.value)}
            disabled={loading || saving}
            rows={14}
            aria-label="Supplier reply instruction"
            placeholder={loading ? 'Loading…' : 'Describe how the assistant should negotiate…'}
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
        </CardContent>
      </Card>
    </section>
  )
}
