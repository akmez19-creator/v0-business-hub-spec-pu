'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Check, Copy, Loader2, Sparkles } from 'lucide-react'

interface GeneratedPost {
  hook: string
  body: string
  cta: string
  hashtags: string
  raw: string
}

interface HistoryItem {
  product: string
  postType: string
  post: GeneratedPost
  at: string
}

const HISTORY_KEY = 'product-master-ai-posts'

async function fetchProducts() {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('products')
    .select('id, name, price')
    .eq('is_active', true)
    .order('name')
  if (error) throw error
  return data as { id: string; name: string; price: number | null }[]
}

export function AiPostsTab({ initialProductId }: { initialProductId?: string }) {
  const { data: products } = useSWR('pm-products-list', fetchProducts)
  const [productId, setProductId] = useState(initialProductId ?? '')
  const [postType, setPostType] = useState('fb_ad')
  const [tone, setTone] = useState('energetic')
  const [language, setLanguage] = useState('en')
  const [extra, setExtra] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<GeneratedPost | null>(null)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [copied, setCopied] = useState(false)

  // Recent generations kept locally for quick reuse (content drafts, not
  // business data - localStorage is the right place for this scratchpad)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY)
      if (saved) setHistory(JSON.parse(saved))
    } catch { /* ignore */ }
  }, [])

  const product = products?.find((p) => p.id === productId)

  const generate = async () => {
    if (!product) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/product-master/ai-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName: product.name,
          productPrice: product.price != null ? `Rs ${product.price}` : '',
          postType,
          tone,
          language,
          extra,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Generation failed')
      setResult(json.post)
      const item: HistoryItem = { product: product.name, postType, post: json.post, at: new Date().toISOString() }
      const next = [item, ...history].slice(0, 12)
      setHistory(next)
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      } catch { /* ignore */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setLoading(false)
    }
  }

  const fullText = (p: GeneratedPost) =>
    [p.hook, p.body, p.cta, p.hashtags].filter(Boolean).join('\n\n')

  const copyPost = async (p: GeneratedPost) => {
    await navigator.clipboard.writeText(fullText(p))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ---- Setup: labeled fields in a compact grid ---- */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="ai-product" className="text-xs font-medium text-muted-foreground">Product</label>
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger id="ai-product">
              <SelectValue placeholder="Pick a product" />
            </SelectTrigger>
            <SelectContent>
              {(products || []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                  {p.price != null ? ` \u00b7 Rs ${p.price}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label className="text-xs font-medium text-muted-foreground">Post type</label>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['fb_ad', 'Facebook ad copy'],
                ['reel_caption', 'Reel caption'],
                ['description', 'Product description'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setPostType(value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  postType === value
                    ? 'border-amber-500/50 bg-amber-500/15 text-amber-500'
                    : 'text-muted-foreground hover:bg-muted/50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ai-tone" className="text-xs font-medium text-muted-foreground">Tone</label>
          <Select value={tone} onValueChange={setTone}>
            <SelectTrigger id="ai-tone">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="energetic">Energetic</SelectItem>
              <SelectItem value="friendly">Friendly</SelectItem>
              <SelectItem value="professional">Professional</SelectItem>
              <SelectItem value="funny">Funny</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ai-lang" className="text-xs font-medium text-muted-foreground">Language</label>
          <Select value={language} onValueChange={setLanguage}>
            <SelectTrigger id="ai-lang">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="fr">French</SelectItem>
              <SelectItem value="kreol_mix">Mauritian mix</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="ai-extra" className="text-xs font-medium text-muted-foreground">
            Offer details <span className="font-normal">(optional)</span>
          </label>
          <Textarea
            id="ai-extra"
            placeholder="Promo details, angle, offer (e.g. B1G1, free delivery)..."
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            rows={2}
            className="resize-none"
          />
        </div>
      </div>

      <Button onClick={generate} disabled={!product || loading} size="lg" className="w-full">
        {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
        {loading ? 'Generating\u2026' : 'Generate post'}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* ---- Result ---- */}
      {result && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5">
          <div className="flex items-center justify-between border-b border-amber-500/20 px-4 py-2.5">
            <span className="text-sm font-semibold">Generated post</span>
            <Button variant="outline" size="sm" onClick={() => copyPost(result)}>
              {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy all'}
            </Button>
          </div>
          <div className="flex flex-col gap-3 px-4 py-3 text-sm">
            {(
              [
                ['Hook', result.hook, 'font-medium'],
                ['Body', result.body, 'leading-relaxed'],
                ['CTA', result.cta, ''],
                ['Hashtags', result.hashtags, 'text-muted-foreground'],
              ] as const
            ).map(([label, text, cls]) =>
              text ? (
                <div key={label} className="grid grid-cols-[76px_1fr] gap-2">
                  <Badge variant="outline" className="h-fit justify-center">{label}</Badge>
                  <p className={`whitespace-pre-wrap ${cls}`}>{text}</p>
                </div>
              ) : null,
            )}
          </div>
        </div>
      )}

      {/* ---- History: collapsed rows, only when there is any ---- */}
      {history.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent generations</p>
          <div className="flex max-h-44 flex-col gap-1.5 overflow-y-auto pr-1">
            {history.map((h, i) => (
              <button
                key={`${h.at}-${i}`}
                type="button"
                onClick={() => setResult(h.post)}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
              >
                <span className="truncate">
                  <span className="font-medium">{h.product}</span>{' '}
                  <span className="text-xs text-muted-foreground">
                    {h.postType === 'fb_ad' ? 'FB ad' : h.postType === 'reel_caption' ? 'Reel caption' : 'Description'}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(h.at).toLocaleDateString()}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
