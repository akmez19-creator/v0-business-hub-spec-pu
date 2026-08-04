'use client'

import { useCallback, useState } from 'react'
import { AlertCircle, Check, Copy, Download, Loader2, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Feature 6: one button -> poster + description, ready to publish.
 *
 * The route runs the whole thing twice, once through Gemini and once through
 * ChatGPT, so both complete options are shown side by side and the better one
 * wins on merit. Either side can fail on its own without hiding the other.
 */

type PostCopy = { hook: string; body: string; cta: string; hashtags: string; raw: string }
type Option = {
  label: string
  provider: 'google' | 'openai'
  image: string | null
  imageError: string | null
  post: PostCopy | null
  copyError: string | null
}

const captionText = (p: PostCopy) =>
  [p.hook, p.body, p.cta, p.hashtags].map((s) => s?.trim()).filter(Boolean).join('\n\n')

export function OneClickPostPanel({
  fields,
  disabled,
  onUsePoster,
}: {
  /** Everything the poster brief needs - same shape Poster Studio already holds */
  fields: Record<string, unknown>
  disabled?: boolean
  /** Push a chosen poster back into Poster Studio's preview */
  onUsePoster?: (dataUrl: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [options, setOptions] = useState<Option[]>([])
  const [copied, setCopied] = useState<string | null>(null)

  const run = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setError('')
    setOptions([])
    try {
      const res = await fetch('/api/product-master/generate-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      const json = await res.json()
      // A partial result still ships: options may be present on a failure too
      if (Array.isArray(json.options) && json.options.length) setOptions(json.options)
      if (!json.success) throw new Error(json.error || 'Generation failed')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setBusy(false)
    }
  }, [busy, fields])

  const copy = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000)
    } catch {
      // Clipboard can be blocked by permissions; the text is on screen anyway
    }
  }, [])

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-violet-500/25 bg-violet-500/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Wand2 className="h-4 w-4 text-violet-500" />
            One-click post
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Generates the poster and its caption together, through both Gemini and ChatGPT, so you can pick
            the better one.
          </p>
        </div>
        <Button onClick={run} disabled={busy || disabled}>
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Wand2 className="mr-1.5 h-4 w-4" />}
          {busy ? 'Generating both\u2026' : 'Generate post'}
        </Button>
      </div>

      {busy && (
        <p className="text-xs text-muted-foreground">
          Four generations are running in parallel - this takes about as long as one.
        </p>
      )}

      {error && options.length === 0 && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {options.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {options.map((opt) => {
            const text = opt.post ? captionText(opt.post) : ''
            const key = opt.provider
            return (
              <article
                key={key}
                className="flex flex-col gap-2 rounded-lg border border-border bg-background p-2.5"
              >
                <header className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide">{opt.label}</h4>
                  {opt.image && (
                    <div className="flex gap-1">
                      {onUsePoster && (
                        <Button size="sm" variant="ghost" onClick={() => onUsePoster(opt.image as string)}>
                          Use
                        </Button>
                      )}
                      <a
                        href={opt.image}
                        download={`${opt.label.toLowerCase()}-poster.png`}
                        className="inline-flex items-center rounded-md px-2 py-1 text-xs hover:bg-muted"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span className="sr-only">Download {opt.label} poster</span>
                      </a>
                    </div>
                  )}
                </header>

                {opt.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={opt.image}
                    alt={`${opt.label} generated poster`}
                    className="w-full rounded-md border border-border"
                  />
                ) : (
                  <p className="flex items-start gap-1.5 rounded-md bg-muted p-2 text-xs text-muted-foreground">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {opt.imageError || 'No poster returned'}
                  </p>
                )}

                {opt.post ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Caption</span>
                      <Button size="sm" variant="ghost" onClick={() => void copy(key, text)}>
                        {copied === key ? (
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        <span className="ml-1 text-xs">{copied === key ? 'Copied' : 'Copy'}</span>
                      </Button>
                    </div>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs leading-relaxed">
                      {text}
                    </pre>
                  </div>
                ) : (
                  <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {opt.copyError || 'No caption returned'}
                  </p>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
