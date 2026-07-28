'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Check, ChevronsUpDown, Copy, ExternalLink, Loader2, Rocket } from 'lucide-react'

interface Account {
  id: string
  name: string
}

interface Campaign {
  id: string
  name: string
  status: string
}

interface PagePost {
  id: string
  message: string
  created_time: string
  permalink_url: string
  full_picture: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// Campaign creation by duplication: pick a proven campaign, give ONE common
// name, and the copy's campaign + all ad sets + all ads get exactly that
// name. New campaign starts PAUSED for review.
export function CampaignCreatorTab({
  initialName,
  initialBoost,
}: {
  initialName?: string
  /** Pre-filled page + post when arriving from "Boost this post" after publishing */
  initialBoost?: { pageId: string; postId: string }
}) {
  const { data: accountsData } = useSWR('/api/facebook-ads?action=accounts', fetcher)
  const [accountId, setAccountId] = useState('')
  const { data: campaignsData, isLoading: loadingCampaigns } = useSWR(
    accountId ? `/api/facebook-ads?action=campaigns-list&accountId=${accountId}` : null,
    fetcher,
  )
  const [campaignId, setCampaignId] = useState('')
  const [campaignOpen, setCampaignOpen] = useState(false)
  const [commonName, setCommonName] = useState(initialName ?? '')
  // Post-to-boost picker: pick the page, then one of its recent posts.
  // Every ad in the copy is re-pointed at that post's creative.
  const { data: pagesData } = useSWR('/api/facebook-ads/duplicate?action=pages', fetcher)
  const [pageId, setPageId] = useState(initialBoost?.pageId ?? '')
  const { data: postsData, isLoading: loadingPosts } = useSWR(
    pageId ? `/api/facebook-ads/duplicate?action=posts&pageId=${pageId}` : null,
    fetcher,
  )
  const [boostPostId, setBoostPostId] = useState(initialBoost?.postId ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{
    newCampaignId: string
    commonName: string
    renamed: { campaign: number; adSets: number; ads: number }
    boosted?: { post: string; ads: number; error?: string }
    failures: number
  } | null>(null)

  const accounts: Account[] = accountsData?.accounts || accountsData?.data || []
  const campaigns: Campaign[] = campaignsData?.campaigns || campaignsData?.data || []
  const source = campaigns.find((c) => c.id === campaignId)
  const pages: Account[] = pagesData?.pages || []
  const posts: PagePost[] = postsData?.posts || []
  const boostPost = posts.find((p) => p.id === boostPostId)

  const duplicate = async () => {
    if (!campaignId || !commonName.trim()) return
    const boostLine = boostPost
      ? `\n\nEvery ad in the copy will boost the post:\n"${boostPost.message.slice(0, 80) || boostPost.id}"`
      : '\n\nCreatives are copied unchanged from the source.'
    if (
      !window.confirm(
        `Duplicate "${source?.name}"?\n\nThe new campaign, all its ad sets and all its ads will be named:\n"${commonName.trim()}"${boostLine}\n\nIt will start PAUSED.`,
      )
    )
      return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/facebook-ads/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, commonName: commonName.trim(), boostPostId: boostPostId || undefined }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) throw new Error(json.error || 'Duplication failed')
      setResult(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Duplication failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ---- Arrived from "Boost this post": the post is locked in ---- */}
      {initialBoost && !result && (
        <div className="flex items-center gap-2.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3.5 py-2.5">
          <Rocket className="h-4 w-4 shrink-0 text-sky-400" />
          <p className="text-xs leading-relaxed text-sky-200">
            <span className="font-semibold">Your post is queued for boosting.</span> Pick a proven campaign to copy
            its targeting and budget, name the new campaign, and hit Duplicate {'\u2014'} every ad will run your
            just-published post.
          </p>
        </div>
      )}
      {/* ---- Setup: labeled fields ---- */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="cc-account" className="text-xs font-medium text-muted-foreground">Ad account</label>
          <Select value={accountId} onValueChange={(v) => { setAccountId(v); setCampaignId('') }}>
            <SelectTrigger id="cc-account">
              <SelectValue placeholder="Pick an account" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="cc-campaign" className="text-xs font-medium text-muted-foreground">Campaign to duplicate</label>
          <Popover open={campaignOpen} onOpenChange={setCampaignOpen}>
            <PopoverTrigger asChild>
              <Button
                id="cc-campaign"
                variant="outline"
                role="combobox"
                aria-expanded={campaignOpen}
                disabled={!accountId}
                className="w-full justify-between bg-transparent font-normal"
              >
                <span className="truncate">
                  {source
                    ? source.name
                    : loadingCampaigns
                      ? 'Loading campaigns\u2026'
                      : accountId
                        ? 'Search campaigns\u2026'
                        : 'Pick an account first'}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
              <Command>
                <CommandInput placeholder={'Type to search campaigns\u2026'} />
                <CommandList>
                  <CommandEmpty>
                    No campaign found. Drafts in Ads Manager are invisible to the API {'\u2014'} publish them first.
                  </CommandEmpty>
                  <CommandGroup>
                    {campaigns.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={c.name + ' ' + c.id}
                        onSelect={() => {
                          setCampaignId(c.id === campaignId ? '' : c.id)
                          setCampaignOpen(false)
                        }}
                      >
                        <Check className={campaignId === c.id ? 'mr-2 h-4 w-4 opacity-100' : 'mr-2 h-4 w-4 opacity-0'} />
                        <span className="truncate">{c.name}</span>
                        {c.status !== 'ACTIVE' && (
                          <Badge variant="outline" className="ml-auto shrink-0 text-[10px]">
                            {c.status}
                          </Badge>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="cc-name" className="text-xs font-medium text-muted-foreground">
            Common name {'\u2014'} applied to campaign, all ad sets and all ads
          </label>
          <Input
            id="cc-name"
            placeholder='e.g. "MBM - Glass Oil Film Remover - 6"'
            value={commonName}
            onChange={(e) => setCommonName(e.target.value)}
            maxLength={200}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="cc-page" className="text-xs font-medium text-muted-foreground">Facebook page (for post to boost)</label>
          <Select value={pageId} onValueChange={(v) => { setPageId(v); setBoostPostId('') }}>
            <SelectTrigger id="cc-page">
              <SelectValue placeholder="Keep source creatives" />
            </SelectTrigger>
            <SelectContent>
              {pages.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="cc-post" className="text-xs font-medium text-muted-foreground">Post to boost</label>
          <Select value={boostPostId} onValueChange={setBoostPostId} disabled={!pageId}>
            <SelectTrigger id="cc-post" className="w-full max-w-full [&>span]:truncate">
              <SelectValue
                placeholder={loadingPosts ? 'Loading posts\u2026' : pageId ? 'Pick a post' : 'Pick a page first'}
              />
            </SelectTrigger>
            <SelectContent>
              {/* A just-published post can lag behind the feed listing -
                  keep the handed-off selection visible regardless */}
              {boostPostId && !posts.some((p) => p.id === boostPostId) && (
                <SelectItem value={boostPostId}>Just published {'\u2014'} your new post</SelectItem>
              )}
              {posts.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {(p.created_time || '').slice(0, 10)} {'\u2014'} {p.message ? p.message.slice(0, 70) : '(no text)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {boostPost && (
            <div className="mt-1 flex items-center gap-2 rounded-md border px-2.5 py-1.5">
              {boostPost.full_picture && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={boostPost.full_picture || "/placeholder.svg"} alt="Selected post preview" className="h-9 w-9 shrink-0 rounded object-cover" />
              )}
              <p className="line-clamp-2 text-xs text-muted-foreground">{boostPost.message || boostPost.id}</p>
              {boostPost.permalink_url && (
                <a
                  href={boostPost.permalink_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="Open post on Facebook"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---- Live naming preview, inline under the form ---- */}
      {commonName.trim() && !result && (
        <div className="rounded-lg border border-dashed px-4 py-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Naming preview</p>
          <div className="flex flex-col gap-1.5">
            {(['Campaign', 'Every ad set', 'Every ad'] as const).map((level) => (
              <div key={level} className="flex items-center gap-2">
                <Badge variant="outline" className="w-24 shrink-0 justify-center">{level}</Badge>
                <span className="truncate font-mono text-xs">{commonName.trim()}</span>
              </div>
            ))}
          </div>
          {source && (
            <p className="mt-2 text-xs text-muted-foreground">
              Structure, targeting and budgets are copied from{' '}
              <span className="font-medium text-foreground">{source.name}</span>.{' '}
              {boostPost
                ? 'Every ad will boost the selected post.'
                : 'Creatives are copied unchanged.'}{' '}
              The copy starts PAUSED.
            </p>
          )}
        </div>
      )}

      <Button onClick={duplicate} disabled={busy || !campaignId || !commonName.trim()} size="lg" className="w-full">
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Copy className="mr-2 h-4 w-4" />}
        {busy ? 'Duplicating\u2026' : 'Duplicate + rename'}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* ---- Result ---- */}
      {result && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5">
          <div className="flex items-center gap-2 border-b border-emerald-500/20 px-4 py-2.5">
            <Check className="h-4 w-4 text-emerald-500" />
            <span className="text-sm font-semibold">Campaign created</span>
          </div>
          <div className="flex flex-col gap-3 px-4 py-3 text-sm">
            <p>
              New campaign <span className="font-mono text-xs">{result.newCampaignId}</span> named{' '}
              <span className="font-medium">&quot;{result.commonName}&quot;</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Campaign renamed</Badge>
              <Badge variant="outline">{result.renamed.adSets} ad sets renamed</Badge>
              <Badge variant="outline">{result.renamed.ads} ads renamed</Badge>
              {result.boosted && !result.boosted.error && (
                <Badge variant="outline" className="border-sky-500/40 bg-sky-500/10 text-sky-400">
                  {result.boosted.ads} ad(s) boosting the selected post
                </Badge>
              )}
              {result.boosted?.error && (
                <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-400">
                  Boost failed: {result.boosted.error.slice(0, 80)}
                </Badge>
              )}
              <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-500">
                Status: PAUSED
              </Badge>
              {result.failures > 0 && (
                <Badge variant="outline" className="border-red-500/40 bg-red-500/10 text-red-400">
                  {result.failures} rename(s) failed
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Review it in Facebook Ads Manager, then activate it from the Ads wall when ready.
            </p>
            <Button variant="outline" size="sm" asChild className="self-start">
              <a
                href={`https://adsmanager.facebook.com/adsmanager/manage/campaigns?selected_campaign_ids=${result.newCampaignId}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open in FB Ads Manager <ExternalLink className="ml-1 h-3 w-3" />
              </a>
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
