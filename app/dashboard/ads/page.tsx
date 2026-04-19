'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Loader2,
  RefreshCw,
  TrendingUp,
  Eye,
  MousePointer,
  DollarSign,
  Users,
  Target,
  Megaphone,
  LayoutGrid,
  AlertCircle,
} from 'lucide-react'
import Image from 'next/image'

interface AdAccount {
  id: string
  name: string
  account_status: number
  currency: string
  amount_spent: string
  balance: string
}

interface Campaign {
  id: string
  name: string
  status: string
  objective: string
  daily_budget?: string
  lifetime_budget?: string
  created_time: string
  start_time?: string
  stop_time?: string
}

interface Ad {
  id: string
  name: string
  status: string
  adset_id: string
  campaign_id: string
  creative?: {
    id: string
    name: string
    thumbnail_url?: string
  }
  created_time: string
}

interface Insights {
  impressions?: string
  clicks?: string
  spend?: string
  reach?: string
  cpc?: string
  cpm?: string
  ctr?: string
}

export default function AdsManagerPage() {
  const [accounts, setAccounts] = useState<AdAccount[]>([])
  const [selectedAccount, setSelectedAccount] = useState<string>('all')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [ads, setAds] = useState<Ad[]>([])
  const [insights, setInsights] = useState<Record<string, Insights>>({})
  const [loading, setLoading] = useState(true)
  const [loadingCampaigns, setLoadingCampaigns] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('campaigns')

  // Fetch ad accounts on mount
  useEffect(() => {
    fetchAccounts()
  }, [])

  // Fetch campaigns when account changes
  useEffect(() => {
    if (selectedAccount && selectedAccount !== 'all') {
      fetchCampaigns(selectedAccount)
      fetchAds(selectedAccount)
      fetchInsights(selectedAccount)
    } else if (selectedAccount === 'all' && accounts.length > 0) {
      fetchAllAccountsData()
    }
  }, [selectedAccount, accounts])

  async function fetchAccounts() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/facebook-ads?action=accounts')
      const data = await res.json()
      
      if (data.error) {
        setError(data.error)
        return
      }
      
      setAccounts(data.data || [])
      if (data.data?.length > 0) {
        setSelectedAccount('all')
      }
    } catch (err) {
      setError('Failed to fetch ad accounts')
    } finally {
      setLoading(false)
    }
  }

  async function fetchAllAccountsData() {
    setLoadingCampaigns(true)
    const allCampaigns: Campaign[] = []
    const allAds: Ad[] = []
    const allInsights: Record<string, Insights> = {}

    for (const account of accounts) {
      try {
        const [campaignsRes, adsRes, insightsRes] = await Promise.all([
          fetch(`/api/facebook-ads?action=campaigns&accountId=${account.id}`),
          fetch(`/api/facebook-ads?action=ads&accountId=${account.id}`),
          fetch(`/api/facebook-ads?action=insights&accountId=${account.id}`)
        ])
        
        const campaignsData = await campaignsRes.json()
        const adsData = await adsRes.json()
        const insightsData = await insightsRes.json()
        
        if (campaignsData.data) {
          allCampaigns.push(...campaignsData.data.map((c: Campaign) => ({ ...c, accountId: account.id, accountName: account.name })))
        }
        if (adsData.data) {
          allAds.push(...adsData.data.map((a: Ad) => ({ ...a, accountId: account.id, accountName: account.name })))
        }
        if (insightsData.data?.[0]) {
          allInsights[account.id] = insightsData.data[0]
        }
      } catch (err) {
        console.error(`Failed to fetch data for account ${account.id}`)
      }
    }

    setCampaigns(allCampaigns)
    setAds(allAds)
    setInsights(allInsights)
    setLoadingCampaigns(false)
  }

  async function fetchCampaigns(accountId: string) {
    setLoadingCampaigns(true)
    try {
      const res = await fetch(`/api/facebook-ads?action=campaigns&accountId=${accountId}`)
      const data = await res.json()
      setCampaigns(data.data || [])
    } catch (err) {
      console.error('Failed to fetch campaigns')
    } finally {
      setLoadingCampaigns(false)
    }
  }

  async function fetchAds(accountId: string) {
    try {
      const res = await fetch(`/api/facebook-ads?action=ads&accountId=${accountId}`)
      const data = await res.json()
      setAds(data.data || [])
    } catch (err) {
      console.error('Failed to fetch ads')
    }
  }

  async function fetchInsights(accountId: string) {
    try {
      const res = await fetch(`/api/facebook-ads?action=insights&accountId=${accountId}`)
      const data = await res.json()
      if (data.data?.[0]) {
        setInsights({ [accountId]: data.data[0] })
      }
    } catch (err) {
      console.error('Failed to fetch insights')
    }
  }

  const getStatusBadge = (status: string) => {
    const statusColors: Record<string, string> = {
      ACTIVE: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
      PAUSED: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
      DELETED: 'bg-red-500/10 text-red-600 border-red-500/20',
      ARCHIVED: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
    }
    return statusColors[status] || 'bg-gray-500/10 text-gray-600'
  }

  const formatCurrency = (amount: string | undefined, currency = 'MUR') => {
    if (!amount) return '-'
    const value = parseFloat(amount) / 100
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value)
  }

  const totalInsights = Object.values(insights).reduce(
    (acc, curr) => ({
      impressions: (parseInt(acc.impressions || '0') + parseInt(curr.impressions || '0')).toString(),
      clicks: (parseInt(acc.clicks || '0') + parseInt(curr.clicks || '0')).toString(),
      spend: (parseFloat(acc.spend || '0') + parseFloat(curr.spend || '0')).toString(),
      reach: (parseInt(acc.reach || '0') + parseInt(curr.reach || '0')).toString(),
    }),
    { impressions: '0', clicks: '0', spend: '0', reach: '0' }
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <AlertCircle className="w-12 h-12 text-red-500" />
        <p className="text-lg text-red-500">{error}</p>
        <Button onClick={fetchAccounts} variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Ads Manager</h1>
          <p className="text-muted-foreground">Monitor your Facebook & Instagram ad campaigns</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedAccount} onValueChange={setSelectedAccount}>
            <SelectTrigger className="w-[250px]">
              <Megaphone className="w-4 h-4 mr-2 text-muted-foreground" />
              <SelectValue placeholder="Select Ad Account" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                <span className="flex items-center gap-2">
                  <LayoutGrid className="w-4 h-4" />
                  All Accounts ({accounts.length})
                </span>
              </SelectItem>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name || account.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={fetchAccounts}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Eye className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {parseInt(totalInsights.impressions).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">Impressions</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border-emerald-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <MousePointer className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {parseInt(totalInsights.clicks).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">Clicks</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 border-amber-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {formatCurrency(totalInsights.spend)}
                </p>
                <p className="text-xs text-muted-foreground">Spend (7d)</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border-purple-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <Users className="w-5 h-5 text-purple-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {parseInt(totalInsights.reach).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">Reach</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="campaigns" className="gap-2">
            <Target className="w-4 h-4" />
            Campaigns ({campaigns.length})
          </TabsTrigger>
          <TabsTrigger value="ads" className="gap-2">
            <Megaphone className="w-4 h-4" />
            Ads ({ads.length})
          </TabsTrigger>
          <TabsTrigger value="accounts" className="gap-2">
            <LayoutGrid className="w-4 h-4" />
            Accounts ({accounts.length})
          </TabsTrigger>
        </TabsList>

        {/* Campaigns Tab */}
        <TabsContent value="campaigns" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Campaigns</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingCampaigns ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : campaigns.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No campaigns found</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Objective</TableHead>
                      <TableHead className="text-right">Budget</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaigns.map((campaign) => (
                      <TableRow key={campaign.id}>
                        <TableCell className="font-medium">{campaign.name}</TableCell>
                        <TableCell>
                          <Badge className={`${getStatusBadge(campaign.status)} border`}>
                            {campaign.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {campaign.objective?.replace(/_/g, ' ')}
                        </TableCell>
                        <TableCell className="text-right">
                          {campaign.daily_budget
                            ? `${formatCurrency(campaign.daily_budget)}/day`
                            : campaign.lifetime_budget
                            ? formatCurrency(campaign.lifetime_budget)
                            : '-'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(campaign.created_time).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Ads Tab */}
        <TabsContent value="ads" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Active Ads</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingCampaigns ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : ads.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No ads found</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {ads.map((ad) => (
                    <Card key={ad.id} className="overflow-hidden">
                      <div className="aspect-video bg-muted relative">
                        {ad.creative?.thumbnail_url ? (
                          <Image
                            src={ad.creative.thumbnail_url}
                            alt={ad.name}
                            fill
                            className="object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Megaphone className="w-8 h-8 text-muted-foreground/50" />
                          </div>
                        )}
                      </div>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium truncate">{ad.name}</p>
                            <p className="text-xs text-muted-foreground">
                              Created {new Date(ad.created_time).toLocaleDateString()}
                            </p>
                          </div>
                          <Badge className={`${getStatusBadge(ad.status)} border shrink-0`}>
                            {ad.status}
                          </Badge>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Accounts Tab */}
        <TabsContent value="accounts" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Ad Accounts</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account Name</TableHead>
                    <TableHead>Account ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead className="text-right">Total Spent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((account) => (
                    <TableRow key={account.id}>
                      <TableCell className="font-medium">{account.name || 'Unnamed Account'}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-sm">
                        {account.id}
                      </TableCell>
                      <TableCell>
                        <Badge className={account.account_status === 1 
                          ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' 
                          : 'bg-red-500/10 text-red-600 border border-red-500/20'
                        }>
                          {account.account_status === 1 ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>{account.currency}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(account.amount_spent, account.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
