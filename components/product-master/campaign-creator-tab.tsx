'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react'

interface Account {
  id: string
  name: string
}

interface Campaign {
  id: string
  name: string
  status: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

// Campaign creation by duplication: pick a proven campaign, give ONE common
// name, and the copy's campaign + all ad sets + all ads get exactly that
// name. New campaign starts PAUSED for review.
export function CampaignCreatorTab({ initialName }: { initialName?: string }) {
  const { data: accountsData } = useSWR('/api/facebook-ads?action=accounts', fetcher)
  const [accountId, setAccountId] = useState('')
  const { data: campaignsData, isLoading: loadingCampaigns } = useSWR(
    accountId ? `/api/facebook-ads?action=campaigns&accountId=${accountId}` : null,
    fetcher,
  )
  const [campaignId, setCampaignId] = useState('')
  const [commonName, setCommonName] = useState(initialName ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{
    newCampaignId: string
    commonName: string
    renamed: { campaign: number; adSets: number; ads: number }
    failures: number
  } | null>(null)

  const accounts: Account[] = accountsData?.accounts || accountsData?.data || []
  const campaigns: Campaign[] = campaignsData?.campaigns || campaignsData?.data || []
  const source = campaigns.find((c) => c.id === campaignId)

  const duplicate = async () => {
    if (!campaignId || !commonName.trim()) return
    if (
      !window.confirm(
        `Duplicate "${source?.name}"?\n\nThe new campaign, all its ad sets and all its ads will be named:\n"${commonName.trim()}"\n\nIt will start PAUSED.`,
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
        body: JSON.stringify({ campaignId, commonName: commonName.trim() }),
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

        <div className="flex flex-col gap-1.5">
          <label htmlFor="cc-campaign" className="text-xs font-medium text-muted-foreground">Campaign to duplicate</label>
          <Select value={campaignId} onValueChange={setCampaignId} disabled={!accountId}>
            <SelectTrigger id="cc-campaign">
              <SelectValue placeholder={loadingCampaigns ? 'Loading campaigns\u2026' : accountId ? 'Pick a campaign' : 'Pick an account first'} />
            </SelectTrigger>
            <SelectContent>
              {campaigns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
              Structure, targeting, budgets and creatives are copied from{' '}
              <span className="font-medium text-foreground">{source.name}</span>. The copy starts PAUSED.
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
