'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
    <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-amber-500" /> Generate a post
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger>
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

          <Select value={postType} onValueChange={setPostType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fb_ad">Facebook ad copy</SelectItem>
              <SelectItem value="reel_caption">Reel caption</SelectItem>
              <SelectItem value="description">Product description</SelectItem>
            </SelectContent>
          </Select>

          <div className="grid grid-cols-2 gap-2">
            <Select value={tone} onValueChange={setTone}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="energetic">Energetic</SelectItem>
                <SelectItem value="friendly">Friendly</SelectItem>
                <SelectItem value="professional">Professional</SelectItem>
                <SelectItem value="funny">Funny</SelectItem>
              </SelectContent>
            </Select>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="fr">French</SelectItem>
                <SelectItem value="kreol_mix">Mauritian mix</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Textarea
            placeholder="Optional: promo details, angle, offer (e.g. B1G1, free delivery)..."
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            rows={3}
          />

          <Button onClick={generate} disabled={!product || loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {loading ? 'Generating\u2026' : 'Generate'}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        {result && (
          <Card className="border-amber-500/30">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Generated post</CardTitle>
              <Button variant="outline" size="sm" onClick={() => copyPost(result)}>
                {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy all'}
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {result.hook && (
                <div>
                  <Badge variant="outline" className="mb-1">Hook</Badge>
                  <p className="whitespace-pre-wrap font-medium">{result.hook}</p>
                </div>
              )}
              {result.body && (
                <div>
                  <Badge variant="outline" className="mb-1">Body</Badge>
                  <p className="whitespace-pre-wrap leading-relaxed">{result.body}</p>
                </div>
              )}
              {result.cta && (
                <div>
                  <Badge variant="outline" className="mb-1">CTA</Badge>
                  <p className="whitespace-pre-wrap">{result.cta}</p>
                </div>
              )}
              {result.hashtags && (
                <div>
                  <Badge variant="outline" className="mb-1">Hashtags</Badge>
                  <p className="whitespace-pre-wrap text-muted-foreground">{result.hashtags}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent generations</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {history.length === 0 && (
              <p className="text-sm text-muted-foreground">Nothing yet. Generated posts are kept here for reuse.</p>
            )}
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
                <span className="shrink-0 text-xs text-muted-foreground">{new Date(h.at).toLocaleString()}</span>
              </button>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
