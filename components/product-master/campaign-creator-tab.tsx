'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Check, Copy, ExternalLink, Loader2, Megaphone } from 'lucide-react'

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
    <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Megaphone className="h-4 w-4 text-blue-500" /> Duplicate a campaign
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Select value={accountId} onValueChange={(v) => { setAccountId(v); setCampaignId('') }}>
            <SelectTrigger>
              <SelectValue placeholder="Ad account" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={campaignId} onValueChange={setCampaignId} disabled={!accountId}>
            <SelectTrigger>
              <SelectValue placeholder={loadingCampaigns ? 'Loading campaigns\u2026' : 'Campaign to duplicate'} />
            </SelectTrigger>
            <SelectContent>
              {campaigns.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            placeholder='Common name, e.g. "MBM - Glass Oil Film Remover - 6"'
            value={commonName}
            onChange={(e) => setCommonName(e.target.value)}
            maxLength={200}
          />

          <Button onClick={duplicate} disabled={busy || !campaignId || !commonName.trim()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Copy className="mr-2 h-4 w-4" />}
            {busy ? 'Duplicating\u2026' : 'Duplicate + rename'}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        {commonName.trim() && !result && (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-base">Naming preview</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <p className="text-muted-foreground">
                One common name is applied identically at every level:
              </p>
              <div className="flex flex-col gap-1.5">
                {(['Campaign', 'Every ad set', 'Every ad'] as const).map((level) => (
                  <div key={level} className="flex items-center gap-2">
                    <Badge variant="outline" className="w-24 justify-center">{level}</Badge>
                    <span className="truncate font-mono text-xs">{commonName.trim()}</span>
                  </div>
                ))}
              </div>
              {source && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Structure, targeting, budgets and creatives are copied from{' '}
                  <span className="font-medium text-foreground">{source.name}</span>. The copy starts PAUSED.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {result && (
          <Card className="border-emerald-500/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Check className="h-4 w-4 text-emerald-500" /> Campaign created
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
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
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
