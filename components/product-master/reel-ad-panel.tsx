'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { CheckCircle2, ExternalLink, Loader2, Megaphone, RefreshCw, X } from 'lucide-react'

// Turn the finished Reels Studio video into a Facebook ad: pick an existing
// ad to duplicate (its page, CTA and link carry over), pick the ad set the
// new ad goes into, and launch it ACTIVE with auto-generated ad copy and the
// new reel as the creative video.

interface FbAd {
  id: string
  name: string
  effective_status?: string
  adset?: { id: string; name: string }
  campaign?: { name: string }
  creative?: { id: string; thumbnail_url?: string }
}

interface FbAdset {
  id: string
  name: string
  effective_status?: string
  campaign?: { name: string }
  daily_budget?: string
}

interface FbAccount {
  id: string
  name: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function ReelAdPanel({
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
  const [accountId, setAccountId] = useState('')
  const [sourceAdId, setSourceAdId] = useState('')
  const [adsetId, setAdsetId] = useState('')
  const [adName, setAdName] = useState(productName ? `${productName} - Reel ad` : 'Reel ad')
  const [adCopy, setAdCopy] = useState('')
  const [generating, setGenerating] = useState(false)
  const [creating, setCreating] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [created, setCreated] = useState<{ adId: string } | null>(null)

  // Ad accounts -> source ads + destination ad sets for the chosen account
  const { data: accountsData } = useSWR<{ data?: FbAccount[] }>('/api/facebook-ads?action=accounts', fetcher)
  const accounts = accountsData?.data ?? []

  useEffect(() => {
    if (!accountId && accounts.length > 0) setAccountId(accounts[0].id)
  }, [accounts, accountId])

  const { data: adsData, isLoading: adsLoading } = useSWR<{ success?: boolean; ads?: FbAd[]; error?: string }>(
    accountId ? `/api/facebook-ads/create-ad?action=ads&accountId=${accountId}` : null,
    fetcher,
  )
  const { data: adsetsData, isLoading: adsetsLoading } = useSWR<{ success?: boolean; adsets?: FbAdset[]; error?: string }>(
    accountId ? `/api/facebook-ads/create-ad?action=adsets&accountId=${accountId}` : null,
    fetcher,
  )
  const ads = adsData?.ads ?? []
  const adsets = adsetsData?.adsets ?? []
  const sourceAd = ads.find((a) => a.id === sourceAdId)

  // When the source ad is picked, default the destination to its own ad set
  useEffect(() => {
    if (sourceAd?.adset?.id && !adsetId) setAdsetId(sourceAd.adset.id)
  }, [sourceAd, adsetId])

  // Reset dependent picks when the account changes
  const changeAccount = (id: string) => {
    setAccountId(id)
    setSourceAdId('')
    setAdsetId('')
  }

  // Ad copy grounded in the real inventory record, fb_ad format
  const generateCopy = async () => {
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
          postType: 'fb_ad',
          tone: 'energetic',
          language: 'en',
          extra: priceText ? `The video shows this offer on screen: ${priceText}. Lead with it.` : '',
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Ad copy generation failed')
      const p = json.post as { hook: string; body: string; cta: string; hashtags: string }
      setAdCopy([p.hook, p.body, p.cta].filter(Boolean).join('\n\n'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ad copy generation failed')
    } finally {
      setGenerating(false)
    }
  }

  useEffect(() => {
    generateCopy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const createAd = async () => {
    setCreating(true)
    setError('')
    try {
      // Video goes to Supabase Storage from the browser (bytes through our
      // API hit the request body size limit), Facebook fetches the URL
      setProgress('Uploading video\u2026')
      const supabase = createClient()
      const path = `${Date.now()}-ad-${(productName || 'reel').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.mp4`
      const { error: uploadError } = await supabase.storage
        .from('reels')
        .upload(path, videoBlob, { contentType: 'video/mp4' })
      if (uploadError) throw new Error(`Video upload failed: ${uploadError.message}`)
      const { data: pub } = supabase.storage.from('reels').getPublicUrl(path)

      setProgress('Creating the ad - Facebook is processing the video, this can take a minute\u2026')
      const res = await fetch('/api/facebook-ads/create-ad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          sourceAdId,
          adsetId,
          videoUrl: pub.publicUrl,
          adCopy,
          adName: adName.trim() || 'Reels Studio ad',
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Ad creation failed')
      setCreated({ adId: json.adId })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ad creation failed')
    } finally {
      setCreating(false)
      setProgress('')
    }
  }

  if (created) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4 text-center">
        <CheckCircle2 className="h-8 w-8 text-emerald-500" />
        <p className="text-sm font-semibold">Ad created and ACTIVE</p>
        <p className="text-xs text-muted-foreground">
          The new ad is live in the chosen ad set with your reel as its video. It inherits the ad set&apos;s targeting and budget.
        </p>
        <div className="mt-1 flex items-center gap-2">
          <Button asChild size="sm" variant="outline" className="bg-transparent">
            <a
              href={`https://adsmanager.facebook.com/adsmanager/manage/ads?act=${accountId.replace('act_', '')}&selected_ad_ids=${created.adId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> View in Ads Manager
            </a>
          </Button>
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    )
  }

  const selectClass =
    'h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <div className="flex flex-col gap-2.5 rounded-md border bg-background/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Create a Facebook ad from this video</p>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onClose} aria-label="Close ad panel">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* 1. Ad account */}
      <div className="flex items-center gap-2">
        <label htmlFor="ad-account-select" className="w-24 shrink-0 text-xs text-muted-foreground">
          Ad account
        </label>
        <select
          id="ad-account-select"
          value={accountId}
          onChange={(e) => changeAccount(e.target.value)}
          disabled={creating}
          className={selectClass}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      {/* 2. Source ad to duplicate */}
      <div className="flex items-center gap-2">
        <label htmlFor="source-ad-select" className="w-24 shrink-0 text-xs text-muted-foreground">
          Duplicate ad
        </label>
        <select
          id="source-ad-select"
          value={sourceAdId}
          onChange={(e) => {
            setSourceAdId(e.target.value)
            setAdsetId('')
          }}
          disabled={creating || adsLoading}
          className={selectClass}
        >
          <option value="">{adsLoading ? 'Loading ads\u2026' : 'Pick the ad to duplicate'}</option>
          {ads.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
              {a.campaign?.name ? ` - ${a.campaign.name}` : ''}
              {a.effective_status ? ` (${a.effective_status})` : ''}
            </option>
          ))}
        </select>
      </div>
      {sourceAd && (
        <p className="pl-26 text-[11px] text-muted-foreground">
          Page, call-to-action and link are copied from this ad - only the video and text are new.
        </p>
      )}

      {/* 3. Destination ad set */}
      <div className="flex items-center gap-2">
        <label htmlFor="adset-select" className="w-24 shrink-0 text-xs text-muted-foreground">
          Into ad set
        </label>
        <select
          id="adset-select"
          value={adsetId}
          onChange={(e) => setAdsetId(e.target.value)}
          disabled={creating || adsetsLoading}
          className={selectClass}
        >
          <option value="">{adsetsLoading ? 'Loading ad sets\u2026' : 'Pick the destination ad set'}</option>
          {adsets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {s.campaign?.name ? ` - ${s.campaign.name}` : ''}
              {s.effective_status ? ` (${s.effective_status})` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* 4. Ad name */}
      <div className="flex items-center gap-2">
        <label htmlFor="ad-name-input" className="w-24 shrink-0 text-xs text-muted-foreground">
          Ad name
        </label>
        <Input
          id="ad-name-input"
          value={adName}
          onChange={(e) => setAdName(e.target.value)}
          disabled={creating}
          className="h-8 text-sm"
          placeholder="New ad name"
        />
      </div>

      {/* 5. Primary text */}
      {generating ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Writing the ad copy from your inventory data&hellip;
        </div>
      ) : (
        <>
          <Textarea
            value={adCopy}
            onChange={(e) => setAdCopy(e.target.value)}
            rows={6}
            className="resize-none text-sm leading-relaxed"
            placeholder="Ad primary text"
            aria-label="Ad primary text"
          />
          <div className="flex items-center justify-between gap-2">
            <Button size="sm" variant="outline" onClick={generateCopy} disabled={creating} className="bg-transparent">
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Regenerate
            </Button>
            <Button size="sm" onClick={createAd} disabled={creating || !sourceAdId || !adsetId || !adCopy.trim()}>
              {creating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Megaphone className="mr-1.5 h-3.5 w-3.5" />}
              {creating ? 'Creating\u2026' : 'Create ad (ACTIVE)'}
            </Button>
          </div>
          <p className="text-[11px] text-amber-500">
            The ad starts delivering immediately using the ad set&apos;s budget.
          </p>
        </>
      )}
      {creating && progress && <p className="text-xs text-muted-foreground">{progress}</p>}
      {adsData?.error && <p className="text-xs text-destructive">{adsData.error}</p>}
      {adsetsData?.error && <p className="text-xs text-destructive">{adsetsData.error}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
