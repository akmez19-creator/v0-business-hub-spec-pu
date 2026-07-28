'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, Rocket, Send, X } from 'lucide-react'

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
  } | null>(null)
  const [pageId, setPageId] = useState('')

  // All pages the token can manage - the user picks the destination
  const { data: pageData } = useSWR<{ success: boolean; pages?: { id: string; name: string }[]; error?: string }>(
    '/api/product-master/posts/publish',
    fetcher,
  )
  const pages = pageData?.pages ?? []

  // Default the selection to the first page once the list loads
  useEffect(() => {
    if (!pageId && pages.length > 0) setPageId(pages[0].id)
  }, [pages, pageId])

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
        body: JSON.stringify({ videoUrl: pub.publicUrl, description: caption, productName, pageId }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Publish failed')
      setPublished({
        postUrl: json.postUrl,
        pageName: json.pageName,
        pageId: json.pageId || pageId,
        boostPostId: json.boostPostId || '',
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
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

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
