'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, Send, X } from 'lucide-react'

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
}: {
  videoBlob: Blob
  productName: string
  priceText?: string
  onClose: () => void
}) {
  const [caption, setCaption] = useState('')
  const [generating, setGenerating] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')
  const [published, setPublished] = useState<{ postUrl: string; pageName: string } | null>(null)

  // Target page shown up front so the user knows where it goes
  const { data: pageData } = useSWR<{ success: boolean; page?: { id: string; name: string }; error?: string }>(
    '/api/product-master/posts/publish',
    fetcher,
  )

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
      const fd = new FormData()
      fd.append('video', videoBlob, 'reel.mp4')
      fd.append('description', caption)
      fd.append('productName', productName)
      const res = await fetch('/api/product-master/posts/publish', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Publish failed')
      setPublished({ postUrl: json.postUrl, pageName: json.pageName })
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
        <p className="text-xs text-muted-foreground">The video and caption are live on your Facebook Page.</p>
        <div className="mt-1 flex items-center gap-2">
          <Button asChild size="sm" variant="outline" className="bg-transparent">
            <a href={published.postUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> View post
            </a>
          </Button>
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-md border bg-background/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          Post to Facebook
          {pageData?.page && <span className="ml-1.5 text-xs font-normal text-muted-foreground">Page: {pageData.page.name}</span>}
        </p>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onClose} aria-label="Close post panel">
          <X className="h-4 w-4" />
        </Button>
      </div>

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
