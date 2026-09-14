'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { createClient } from '@/lib/supabase/client'
import { REGULAR_PAGE_POSTS } from '@/lib/facebook/page-usage-shared'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { CheckCircle2, ExternalLink, Loader2, MessageCircle, RefreshCw, Rocket, Send, X } from 'lucide-react'

// Post the finished Reels Studio video to the Facebook Page without leaving
// the studio. The description is auto-generated (reel caption grounded in
// the real inventory record) the moment the panel opens - editable before
// publishing.

interface GeneratedPost {
  hook: string
  body: string
  cta: string
  hashtags: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function ReelPublishPanel({
  videoBlob,
  productName,
  priceText,
  onClose,
  onBoost,
}: {
  videoBlob: Blob
  productName: string
  priceText?: string
  onClose: () => void
  /** Hand the just-published post off to the Campaign Creator pre-filled */
  onBoost?: (boost: { pageId: string; postId: string }) => void
}) {
  const [caption, setCaption] = useState('')
  const [generating, setGenerating] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')
  const [published, setPublished] = useState<{
    postUrl: string
    pageName: string
    pageId: string
    boostPostId: string
    videoId: string
    // Did we ASK Facebook for the Send message button on this post
    messengerCtaRequested: boolean
  } | null>(null)
  // Confirmation arrives later: null = still checking, true/false = answer
  const [ctaAttached, setCtaAttached] = useState<boolean | null>(null)
  // The Page applies its own empty-value MESSAGE_PAGE at publish time, so
  // "ours didn't land" still isn't the same as "no button on the post"
  const [ctaPageDefault, setCtaPageDefault] = useState(false)
  const [pageId, setPageId] = useState('')
  // On by default - the captions already end in "Order now via inbox", so the
  // button is what that line is asking people to do
  const [messengerCta, setMessengerCta] = useState(true)

  // All pages the token can manage - the user picks the destination
  const { data: pageData } = useSWR<{
    success: boolean
    pages?: { id: string; name: string; posts?: number }[]
    error?: string
  }>('/api/product-master/posts/publish', fetcher)
  const pages = pageData?.pages ?? []

  // Default to the first page, which the API now orders most-posted-to first.
  // It used to be alphabetical, so this quietly pre-selected a Page with 6
  // posts in its history as the destination for a finished video.
  useEffect(() => {
    if (!pageId && pages.length > 0) setPageId(pages[0].id)
  }, [pages, pageId])

  // Confirm the Send message button in the BACKGROUND once the post is live.
  // Facebook needs ~30s of video processing before the post is readable, so
  // this cannot happen during publish without stalling it. Polls for up to ~60s
  // and stops the moment it has a definite answer.
  useEffect(() => {
    if (!published?.messengerCtaRequested || !published.videoId || ctaAttached !== null) return
    let cancelled = false
    let tries = 0
    const tick = async () => {
      if (cancelled || tries >= 12) return
      tries++
      try {
        const res = await fetch(
          `/api/product-master/posts/cta-status?videoId=${encodeURIComponent(published.videoId)}&pageId=${encodeURIComponent(published.pageId)}`,
        )
        const json = await res.json()
        // `attached === null` means "not readable yet" - keep waiting rather
        // than reporting the button as missing
        if (!cancelled && json?.success && typeof json.attached === 'boolean') {
          setCtaAttached(json.attached)
          setCtaPageDefault(Boolean(json.pageDefaultOnly))
          return
        }
      } catch {
        // Network hiccup - just try again on the next tick
      }
      if (!cancelled) setTimeout(tick, 5000)
    }
    const t = setTimeout(tick, 5000)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [published, ctaAttached])

  // Auto-generate the caption on open: resolve the product by name so the
  // copy is grounded in real inventory facts (price, offers, description)
  const generate = async () => {
    setGenerating(true)
    setError('')
    try {
      let productId = ''
      let productPrice = ''
      if (productName) {
        const supabase = createClient()
        const { data: match } = await supabase
          .from('products')
          .select('id, price')
          .ilike('name', productName)
          .limit(1)
          .maybeSingle()
        if (match) {
          productId = match.id
          if (match.price != null) productPrice = `Rs ${match.price}`
        }
      }
      const res = await fetch('/api/product-master/ai-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          productName: productName || 'this product',
          productPrice,
          postType: 'reel_caption',
          tone: 'energetic',
          language: 'en',
          extra: priceText ? `The video shows this offer on screen: ${priceText}. Lead with it.` : '',
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Caption generation failed')
      const p = json.post as GeneratedPost
      setCaption([p.hook, p.body, p.cta, p.hashtags].filter(Boolean).join('\n\n'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Caption generation failed')
    } finally {
      setGenerating(false)
    }
  }

  useEffect(() => {
    generate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const publish = async () => {
    setPublishing(true)
    setError('')
    try {
      // Upload the video straight to Supabase Storage from the browser -
      // sending it through our API hits the request body size limit (413)
      const supabase = createClient()
      const path = `${Date.now()}-${(productName || 'reel').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.mp4`
      const { error: uploadError } = await supabase.storage
        .from('reels')
        .upload(path, videoBlob, { contentType: 'video/mp4' })
      if (uploadError) throw new Error(`Video upload failed: ${uploadError.message}`)
      const { data: pub } = supabase.storage.from('reels').getPublicUrl(path)

      // Hand Facebook the URL - it fetches the file itself
      const res = await fetch('/api/product-master/posts/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoUrl: pub.publicUrl, description: caption, productName, pageId, messengerCta }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Publish failed')
      setPublished({
        postUrl: json.postUrl,
        pageName: json.pageName,
        pageId: json.pageId || pageId,
        boostPostId: json.boostPostId || '',
        videoId: json.videoId || '',
        messengerCtaRequested: Boolean(json.messengerCtaRequested),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Publish failed')
    } finally {
      setPublishing(false)
    }
  }

  if (published) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4 text-center">
        <CheckCircle2 className="h-8 w-8 text-emerald-500" />
        <p className="text-sm font-semibold">Posted to {published.pageName}</p>
        <p className="text-xs text-muted-foreground">
          The video and caption are live on your Facebook Page.
          {onBoost && published.boostPostId ? ' Next step: put budget behind it.' : ''}
        </p>
        {/* Three honest states, never rounded up to "done". Confirmed only
            claims the button after Facebook reads it back off the post. */}
        {published.messengerCtaRequested && (
          <p
            className={`flex items-center gap-1.5 text-xs ${
              ctaAttached === true ? 'font-medium text-emerald-500' : 'text-muted-foreground'
            }`}
          >
            {ctaAttached === null ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <MessageCircle className="h-3.5 w-3.5" />
            )}
            {ctaAttached === true
              ? 'Send message button is on the post - taps go to your Page inbox'
              : ctaAttached === false
                ? ctaPageDefault
                  ? 'Your Page\u2019s own Send message button is on the post (ours was not applied)'
                  : 'Facebook did not attach the Send message button to this post'
                : 'Checking the Send message button\u2026 (Facebook is still processing the video)'}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          <Button asChild size="sm" variant="outline" className="bg-transparent">
            <a href={published.postUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> View post
            </a>
          </Button>
          {onBoost && published.boostPostId && (
            <Button size="sm" onClick={() => onBoost({ pageId: published.pageId, postId: published.boostPostId })}>
              <Rocket className="mr-1.5 h-3.5 w-3.5" /> Boost this post
            </Button>
          )}
          <Button size="sm" variant={onBoost && published.boostPostId ? 'outline' : 'default'} onClick={onClose} className={onBoost && published.boostPostId ? 'bg-transparent' : undefined}>
            Done
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-md border bg-background/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Post to Facebook</p>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onClose} aria-label="Close post panel">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {pages.length > 0 && (
        <div className="flex items-center gap-2">
          <label htmlFor="fb-page-select" className="shrink-0 text-xs text-muted-foreground">
            Page
          </label>
          <select
            id="fb-page-select"
            value={pageId}
            onChange={(e) => setPageId(e.target.value)}
            disabled={publishing}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {/* Grouped so a most-used-first order does not read as unsorted.
                Native optgroup rather than styled headings - this is a plain
                select, and the browser renders the labels unselectable. */}
            {(() => {
              const regular = pages.filter((p) => (p.posts ?? 0) >= REGULAR_PAGE_POSTS)
              const rare = pages.filter((p) => (p.posts ?? 0) < REGULAR_PAGE_POSTS)
              // No history yet (or the tally failed): one flat list, because
              // an empty "Pages you post to" group would be a lie
              if (regular.length === 0) {
                return pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))
              }
              return (
                <>
                  <optgroup label="Pages you post to">
                    {regular.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                  {rare.length > 0 && (
                    <optgroup label="Rarely used">
                      {rare.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </>
              )
            })()}
          </select>
        </div>
      )}

      {/* The organic Send message button. Sits next to the Page picker because
          it is a property of the post being made, not of the caption. */}
      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={messengerCta}
          onChange={(e) => setMessengerCta(e.target.checked)}
          disabled={publishing}
          className="h-3.5 w-3.5 accent-emerald-500"
        />
        <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
        <span>
          Add a <span className="font-medium">Send message</span> button
          <span className="text-muted-foreground"> - taps open Messenger to your Page inbox</span>
        </span>
      </label>

      {generating ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Writing the post description from your inventory data&hellip;
        </div>
      ) : (
        <>
          <Textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={8}
            className="resize-none text-sm leading-relaxed"
            placeholder="Post description"
            aria-label="Post description"
          />
          <div className="flex items-center justify-between gap-2">
            <Button size="sm" variant="outline" onClick={generate} disabled={publishing} className="bg-transparent">
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Regenerate
            </Button>
            <Button size="sm" onClick={publish} disabled={publishing || !caption.trim()}>
              {publishing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
              {publishing ? 'Publishing\u2026' : 'Publish now'}
            </Button>
          </div>
        </>
      )}
      {pageData && !pageData.success && <p className="text-xs text-destructive">{pageData.error}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
