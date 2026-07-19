'use client'

import { useState, useEffect, Fragment } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { TvDashboard } from '@/components/ads/tv-dashboard'
import { Tv } from 'lucide-react'
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
  DollarSign,
  CalendarIcon,
  ChevronDown,
  TrendingUp,
  Megaphone,
  Package,
  Link2,
  X,
  ChevronRight,
  Boxes,
  Copy,
  Check,
  ExternalLink,
  Users,
  ArrowUpDown,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { format, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { DateRange } from 'react-day-picker'

interface AdAccount {
  id: string
  name: string
  account_status: number
  currency: string
  amount_spent: string
  balance: string // Amount owed to Facebook (in cents, negative = owed)
}

interface Campaign {
  id: string
  name: string
  status: string
  objective: string
  created_time: string
  spend: string
  impressions: string
  clicks: string
  reach: string
  adIds?: string[]
  ads?: { id: string; postId: string | null }[]
  accountId?: string
  accountName?: string
  // Facebook budget + schedule (budget fields are in USD minor units / cents)
  lifetime_budget?: string | null
  daily_budget?: string | null
  budget_remaining?: string | null
  start_time?: string | null
  stop_time?: string | null
}

interface Product {
  id: string
  name: string
  price: number
  quantity: number
}

interface CampaignProductLink {
  campaign_id: string
  campaign_name: string
  product_id: string | null
  account_id: string
  products?: Product
}

type DatePreset = 'today' | 'yesterday' | 'last_7d' | 'last_14d' | 'last_30d' | 'this_month' | 'last_month' | 'lifetime' | 'custom'

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last_7d', label: 'Last 7 Days' },
  { value: 'last_14d', label: 'Last 14 Days' },
  { value: 'last_30d', label: 'Last 30 Days' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'lifetime', label: 'Lifetime' },
  { value: 'custom', label: 'Custom Range' },
]

export default function AdsManagerPage() {
  const [accounts, setAccounts] = useState<AdAccount[]>([])
  const [selectedAccount, setSelectedAccount] = useState<string>('all')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [accountSpends, setAccountSpends] = useState<Record<string, number>>({}) // Account-level spend from FB
  
  // Product linking state
  const [products, setProducts] = useState<Product[]>([])
  const [campaignLinks, setCampaignLinks] = useState<Record<string, CampaignProductLink>>({})
  // Per-product client counts (for cost-per-client / CAC), keyed by product name
  const [productClientStats, setProductClientStats] = useState<Record<string, { clientCount: number; deliveredClientCount: number; orderCount: number }>>({})
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [linkingProduct, setLinkingProduct] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingCampaigns, setLoadingCampaigns] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Date range state
  const [datePreset, setDatePreset] = useState<DatePreset>('today')
  const [dateRange, setDateRange] = useState<DateRange | undefined>()
  const [showCalendar, setShowCalendar] = useState(false)
  const [showTodayOnly, setShowTodayOnly] = useState(true) // Default to Today's Spend ON
  
  // Auto-refresh state
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [countdown, setCountdown] = useState(15 * 60) // 15 minutes in seconds
  const AUTO_REFRESH_INTERVAL = 15 * 60 // 15 minutes in seconds
  
  // Full-screen TV dashboard mode (separate glanceable wall-display view)
  const [tvMode, setTvMode] = useState(false)

  // Product grouping view (a product can have multiple campaigns)
  const [groupByProduct, setGroupByProduct] = useState(true)
  const [collapsedProducts, setCollapsedProducts] = useState<Set<string>>(new Set())
  // How to sort product groups: by spend, cost-per-client (CAC), or client count
  const [groupSort, setGroupSort] = useState<'spend' | 'cac_desc' | 'cac_asc' | 'clients_desc'>('spend')
  
  const toggleProductGroup = (key: string) => {
    setCollapsedProducts(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  
  // Reveal/copy ad IDs per campaign
  const [revealedAdIds, setRevealedAdIds] = useState<Set<string>>(new Set())
  const [copiedAdId, setCopiedAdId] = useState<string | null>(null)
  
  const toggleAdIds = (campaignId: string) => {
    setRevealedAdIds(prev => {
      const next = new Set(prev)
      if (next.has(campaignId)) next.delete(campaignId)
      else next.add(campaignId)
      return next
    })
  }
  
  const copyAdId = (adId: string) => {
    navigator.clipboard?.writeText(adId)
    setCopiedAdId(adId)
    setTimeout(() => setCopiedAdId(prev => (prev === adId ? null : prev)), 1500)
  }
  
  const renderAdIds = (campaign: Campaign) => {
    // New shape: ads[{id, postId}]. Fall back to legacy adIds (stale cache).
    const ads = campaign.ads && campaign.ads.length > 0
      ? campaign.ads
      : (campaign.adIds || []).map(id => ({ id, postId: null as string | null }))
    if (ads.length === 0) {
      return <span className="text-xs text-muted-foreground/50">No ads</span>
    }
    const isOpen = revealedAdIds.has(campaign.id)
    return (
      <div className="mt-1">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toggleAdIds(campaign.id) }}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <Megaphone className="w-3 h-3" />
          {isOpen ? 'Hide' : 'Show'} Ad ID{ads.length > 1 ? `s (${ads.length})` : ''}
        </button>
        {isOpen && (
          <div className="mt-1 flex flex-col gap-1">
            {ads.map((ad) => (
              <div key={ad.id} className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); copyAdId(ad.id) }}
                  title="Click to copy"
                  className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground hover:bg-primary/10 hover:text-primary transition-colors"
                >
                  {copiedAdId === ad.id ? (
                    <Check className="w-3 h-3 text-green-500" />
                  ) : (
                    <Copy className="w-3 h-3 opacity-60" />
                  )}
                  {ad.id}
                </button>
                {ad.postId && (
                  <a
                    href={`https://www.facebook.com/${ad.postId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title={`Open post ${ad.postId}`}
                    className="inline-flex items-center gap-1 rounded bg-blue-500/10 px-1.5 py-0.5 text-[11px] text-blue-500 hover:bg-blue-500/20 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    View Post
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Initial load - use cached API for instant data
  useEffect(() => {
    fetchCachedData()
    fetchProducts()
    fetchCampaignLinks()
  }, [])
  
  // Countdown timer that syncs with server cache
  useEffect(() => {
    const countdownTimer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          // Auto-refresh when countdown hits 0
          fetchCachedData(true)
          return AUTO_REFRESH_INTERVAL
        }
        return prev - 1
      })
    }, 1000)
    
    return () => clearInterval(countdownTimer)
  }, [])

  // When filters change (not today's spend mode), fetch fresh data.
  // For a custom range, wait until BOTH ends are picked — otherwise the fetch
  // fires on every calendar click (open, "from", "to") and the dashboard keeps
  // reloading while the user is still selecting the range.
  useEffect(() => {
    if (showTodayOnly || accounts.length === 0) return
    if (datePreset === 'custom' && !(dateRange?.from && dateRange?.to)) return
    fetchCampaignsData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccount, datePreset, dateRange])
  
  // When switching to today's spend mode, use cached data
  useEffect(() => {
    if (showTodayOnly) {
      fetchCachedData()
    }
  }, [showTodayOnly])

  // Refresh per-product client counts whenever the set of linked products changes
  useEffect(() => {
    const names = Array.from(
      new Set(
        Object.values(campaignLinks)
          .map((l) => l.products?.name)
          .filter((n): n is string => !!n)
      )
    )
    fetchProductClientStats(names)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignLinks])

  async function fetchCachedData(forceRefresh = false) {
    setLoading(true)
    setLoadingCampaigns(true)
    setError(null)
    
    try {
      const res = await fetch(`/api/facebook-ads/cached${forceRefresh ? '?forceRefresh=true' : ''}`)
      const data = await res.json()
      
      // If we got data (even stale), render it. Show the error as a warning if present.
      if (data.accounts || data.campaigns) {
        setAccounts(data.accounts || [])
        setCampaigns(data.campaigns || [])
        setAccountSpends(data.accountSpends || {})
        if (data.lastRefresh) setLastRefresh(new Date(data.lastRefresh))
        setCountdown(data.nextRefreshIn || AUTO_REFRESH_INTERVAL)
      }
      
      if (data.error) {
        setError(data.error)
      }
    } catch {
      setError('Failed to fetch ads data')
    } finally {
      setLoading(false)
      setLoadingCampaigns(false)
    }
  }

  async function fetchCampaignsData() {
    setLoadingCampaigns(true)
    
    const buildParams = () => {
      let params = `datePreset=${datePreset}`
      if (datePreset === 'custom' && dateRange?.from && dateRange?.to) {
        params += `&since=${format(dateRange.from, 'yyyy-MM-dd')}&until=${format(dateRange.to, 'yyyy-MM-dd')}`
      }
      return params
    }
    
    const params = buildParams()
    
    if (selectedAccount === 'all') {
      // Fetch from all accounts
      const allCampaigns: Campaign[] = []
      const newAccountSpends: Record<string, number> = {}
      
      for (const account of accounts) {
        try {
          const res = await fetch(`/api/facebook-ads?action=campaigns&accountId=${account.id}&${params}`)
          const data = await res.json()
          
          if (data.data) {
            allCampaigns.push(...data.data.map((c: Campaign) => ({
              ...c,
              accountId: account.id,
              accountName: account.name || account.id
            })))
          }
          
          // Store account-level spend (more accurate than summing campaigns)
          if (data.accountTotalSpend) {
            newAccountSpends[account.id] = parseFloat(data.accountTotalSpend)
          }
        } catch {
          console.error(`Failed to fetch campaigns for ${account.id}`)
        }
      }
      
      // Sort by spend
      allCampaigns.sort((a, b) => parseFloat(b.spend) - parseFloat(a.spend))
      setCampaigns(allCampaigns)
      setAccountSpends(newAccountSpends)
      setLastRefresh(new Date())
    } else {
      // Fetch from single account
      try {
        const res = await fetch(`/api/facebook-ads?action=campaigns&accountId=${selectedAccount}&${params}`)
        const data = await res.json()
        
        const account = accounts.find(a => a.id === selectedAccount)
        setCampaigns((data.data || []).map((c: Campaign) => ({
          ...c,
          accountId: selectedAccount,
          accountName: account?.name || selectedAccount
        })))
        
        // Store account-level spend
        if (data.accountTotalSpend) {
          setAccountSpends({ [selectedAccount]: parseFloat(data.accountTotalSpend) })
        }
      } catch {
        console.error('Failed to fetch campaigns')
        setCampaigns([])
        setAccountSpends({})
      }
    }
    
    setLoadingCampaigns(false)
  }
  
  async function fetchProducts() {
    try {
      const res = await fetch('/api/products')
      const data = await res.json()
      setProducts(data || [])
    } catch {
      console.error('Failed to fetch products')
    }
  }
  
  async function fetchCampaignLinks() {
    try {
      const res = await fetch('/api/campaign-links')
      const data = await res.json()
      const linksMap: Record<string, CampaignProductLink> = {}
      for (const link of (data.data || [])) {
        linksMap[link.campaign_id] = link
      }
      setCampaignLinks(linksMap)
    } catch {
      console.error('Failed to fetch campaign links')
    }
  }
  
  async function fetchProductClientStats(names: string[]) {
    if (names.length === 0) {
      setProductClientStats({})
      return
    }
    try {
      const res = await fetch('/api/product-client-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
      })
      const data = await res.json()
      setProductClientStats(data.stats || {})
    } catch {
      console.error('[v0] Failed to fetch product client stats')
    }
  }

  async function linkProductToCampaign(productId: string | null) {
    if (!selectedCampaign) return
    
    setLinkingProduct(true)
    try {
      await fetch('/api/campaign-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: selectedCampaign.id,
          campaign_name: selectedCampaign.name,
          product_id: productId,
          account_id: selectedCampaign.accountId
        })
      })
      
      // Update local state
      if (productId) {
        const product = products.find(p => p.id === productId)
        setCampaignLinks(prev => ({
          ...prev,
          [selectedCampaign.id]: {
            campaign_id: selectedCampaign.id,
            campaign_name: selectedCampaign.name,
            product_id: productId,
            account_id: selectedCampaign.accountId || '',
            products: product
          }
        }))
      } else {
        // Remove link
        setCampaignLinks(prev => {
          const newLinks = { ...prev }
          delete newLinks[selectedCampaign.id]
          return newLinks
        })
      }
      
      setLinkDialogOpen(false)
      setSelectedCampaign(null)
    } catch {
      console.error('Failed to link product')
    } finally {
      setLinkingProduct(false)
    }
  }

  const handleDatePresetChange = (preset: DatePreset) => {
    setDatePreset(preset)

    // "Today's Spend" mode reads from the cached (today-only) endpoint. Any other
    // date requires the live historical fetch, so exit today-only mode; selecting
    // "Today" re-enters it. Without this, picking Yesterday/other dates left the
    // view stuck on today's cached data.
    setShowTodayOnly(preset === 'today')

    if (preset === 'custom') {
      setShowCalendar(true)
    } else {
      setShowCalendar(false)
      setDateRange(undefined)
    }
  }

  const getDateRangeLabel = () => {
    if (datePreset === 'custom' && dateRange?.from && dateRange?.to) {
      return `${format(dateRange.from, 'MMM d, yyyy')} - ${format(dateRange.to, 'MMM d, yyyy')}`
    }
    return DATE_PRESETS.find(p => p.value === datePreset)?.label || 'Select Date'
  }

  const getStatusBadge = (status: string) => {
    const config: Record<string, { bg: string; text: string }> = {
      ACTIVE: { bg: 'bg-emerald-500/10', text: 'text-emerald-600' },
      PAUSED: { bg: 'bg-amber-500/10', text: 'text-amber-600' },
      DELETED: { bg: 'bg-red-500/10', text: 'text-red-600' },
      ARCHIVED: { bg: 'bg-gray-500/10', text: 'text-gray-500' },
    }
    const style = config[status] || config.ARCHIVED
    return `${style.bg} ${style.text} border-0`
  }

  // USD to Rs conversion rate (including VAT)
  const USD_TO_RS = 57.5
  
  const formatSpend = (amount: string) => {
    // Facebook returns spend in USD cents (divide by 100) or USD
    const usdValue = parseFloat(amount)
    const rsValue = usdValue * USD_TO_RS
    return `Rs ${rsValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  
  const formatUsd = (amount: string) => {
    const value = parseFloat(amount)
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  // Per-campaign budget summary from Facebook: total amount spent toward the
  // budget, remaining budget, and the campaign end date. Budget fields come
  // back in USD minor units (cents), so divide by 100 before formatting.
  const renderCampaignBudget = (campaign: Campaign) => {
    const lifetimeBudget = parseFloat(campaign.lifetime_budget || '0') / 100
    const dailyBudget = parseFloat(campaign.daily_budget || '0') / 100
    const remaining = parseFloat(campaign.budget_remaining || '0') / 100
    const hasLifetime = lifetimeBudget > 0
    const endDate = campaign.stop_time ? new Date(campaign.stop_time) : null
    const validEnd = endDate && !isNaN(endDate.getTime())

    // Nothing useful to show (e.g. ad-set level budgets, no schedule)
    if (!hasLifetime && dailyBudget <= 0 && !validEnd) return null

    // Spent toward the budget = budget - remaining (Facebook's own accounting)
    const spent = hasLifetime ? Math.max(0, lifetimeBudget - remaining) : 0

    return (
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {hasLifetime && (
          <>
            <span title="Total amount spent toward this campaign's budget">
              Spent{' '}
              <span className="font-medium text-amber-600">{formatSpend(spent.toString())}</span>
              <span className="text-muted-foreground/60"> / {formatSpend(lifetimeBudget.toString())}</span>
            </span>
            <span title="Remaining budget">
              Left <span className="font-medium text-foreground">{formatSpend(remaining.toString())}</span>
            </span>
          </>
        )}
        {!hasLifetime && dailyBudget > 0 && (
          <span title="Daily budget">
            Daily <span className="font-medium text-foreground">{formatSpend(dailyBudget.toString())}</span>
          </span>
        )}
        {validEnd && (
          <span className="inline-flex items-center gap-1" title="Campaign end date">
            <CalendarIcon className="w-3 h-3" />
            Ends {format(endDate as Date, 'd MMM yyyy')}
          </span>
        )}
      </div>
    )
  }

  // When showTodayOnly is on, the API already returns today's data - filter for spend > 0
  const filteredCampaigns = showTodayOnly 
    ? campaigns.filter(c => parseFloat(c.spend || '0') > 0)
    : campaigns

  // Group campaigns by their linked product (a product may have multiple campaigns)
  const UNLINKED_KEY = '__unlinked__'
  const productGroupsMap = filteredCampaigns.reduce((acc, campaign) => {
    const product = campaignLinks[campaign.id]?.products
    const key = product?.id || UNLINKED_KEY
    if (!acc[key]) {
      acc[key] = {
        key,
        productId: product?.id || null,
        productName: product?.name || 'Unlinked Campaigns',
        productPrice: product?.price,
        campaigns: [],
        totalSpend: 0,
      }
    }
    acc[key].campaigns.push(campaign)
    acc[key].totalSpend += parseFloat(campaign.spend || '0')
    return acc
  }, {} as Record<string, { key: string; productId: string | null; productName: string; productPrice?: number; campaigns: Campaign[]; totalSpend: number }>)

  // Cost per client (CAC) in Rs for a group, or null when it can't be computed
  const groupCac = (g: { productName: string; totalSpend: number }) => {
    const clients = productClientStats[g.productName]?.clientCount ?? 0
    if (g.totalSpend <= 0 || clients <= 0) return null
    return (g.totalSpend * USD_TO_RS) / clients
  }

  const productGroups = Object.values(productGroupsMap).sort((a, b) => {
    // Always keep the unlinked group pinned to the bottom
    if (a.key === UNLINKED_KEY) return 1
    if (b.key === UNLINKED_KEY) return -1

    if (groupSort === 'clients_desc') {
      const ca = productClientStats[a.productName]?.clientCount ?? 0
      const cb = productClientStats[b.productName]?.clientCount ?? 0
      if (cb !== ca) return cb - ca
      return b.totalSpend - a.totalSpend
    }

    if (groupSort === 'cac_desc' || groupSort === 'cac_asc') {
      const ca = groupCac(a)
      const cb = groupCac(b)
      // Groups without a computable CAC (no spend or no clients) sink to the bottom
      if (ca === null && cb === null) return b.totalSpend - a.totalSpend
      if (ca === null) return 1
      if (cb === null) return -1
      return groupSort === 'cac_desc' ? cb - ca : ca - cb
    }

    // Default: highest spend first
    return b.totalSpend - a.totalSpend
  })

  // TV dashboard: product groups enriched with client count + cost-per-client (Rs)
  // so the TV view can color-code each product into a CAC efficiency zone.
  const tvGroups = productGroups.map((g) => ({
    key: g.key,
    productName: g.productName,
    productPrice: g.productPrice,
    totalSpend: g.totalSpend,
    isUnlinked: g.key === UNLINKED_KEY,
    clients: productClientStats[g.productName]?.clientCount ?? 0,
    cac: groupCac(g),
    campaigns: g.campaigns,
  }))

  // Number of columns shown in the campaigns table (drives colSpan for group headers)
  const tableCols = selectedAccount === 'all' ? 4 : 3

  // Use account-level spend from Facebook (more accurate than summing campaigns)
  const totalSpendFromAccounts = Object.values(accountSpends).reduce((sum, spend) => sum + spend, 0)
  // Fallback to campaign sum if account spend not available
  const campaignSum = filteredCampaigns.reduce((sum, c) => sum + parseFloat(c.spend || '0'), 0)
  const totalSpend = totalSpendFromAccounts > 0 ? totalSpendFromAccounts : campaignSum
  
  const activeCampaigns = filteredCampaigns.filter(c => c.status === 'ACTIVE').length
  // Count campaigns that have spend > 0
  const campaignsWithSpendCount = campaigns.filter(c => parseFloat(c.spend || '0') > 0).length

  // Calculate spend per account - use account-level spend from FB when available
  const accountSpendMap = filteredCampaigns.reduce((acc, campaign) => {
    const accountId = campaign.accountId || 'unknown'
    const accountName = campaign.accountName || accountId
    const account = accounts.find(a => a.id === accountId)
    if (!acc[accountId]) {
      // Use account-level spend from FB, fallback to 0
      // Balance from FB is in cents - positive means amount owed to Facebook
      const balanceCents = parseFloat(account?.balance || '0')
      // Convert cents to currency units (divide by 100)
      const balanceOwed = Math.abs(balanceCents) / 100
      acc[accountId] = { 
        name: accountName, 
        spend: accountSpends[accountId] || 0, // Use FB account spend
        campaignSpend: 0, // Track campaign-level for comparison
        campaignCount: 0,
        balance: balanceOwed // Amount owed to Facebook in currency units
      }
    }
    acc[accountId].campaignSpend += parseFloat(campaign.spend || '0')
    acc[accountId].campaignCount += 1
    // If we don't have account-level spend, use campaign sum
    if (!accountSpends[accountId]) {
      acc[accountId].spend = acc[accountId].campaignSpend
    }
    return acc
  }, {} as Record<string, { name: string; spend: number; campaignSpend: number; campaignCount: number; balance: number }>)

  const accountSpendList = Object.entries(accountSpendMap)
    .map(([id, data]) => ({ id, ...data }))
    .sort((a, b) => b.spend - a.spend)
  
  // Calculate total balance owed across all accounts
  const totalBalanceOwed = accountSpendList.reduce((sum, acc) => sum + acc.balance, 0)
    
  // Format countdown timer
  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }
  
  // Format last refresh time
  const formatLastRefresh = (date: Date) => {
    return format(date, 'HH:mm:ss')
  }
  
  // Manual refresh handler
  const handleManualRefresh = () => {
    if (showTodayOnly) {
      fetchCachedData(true) // Force refresh from Facebook
    } else {
      fetchCampaignsData()
      setLastRefresh(new Date())
      setCountdown(AUTO_REFRESH_INTERVAL)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 p-6">
        <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center">
          <Megaphone className="w-8 h-8 text-red-500" />
        </div>
        <p className="text-lg text-red-500 text-center">{error}</p>
        <Button onClick={() => fetchCachedData(true)} variant="outline">
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    )
  }

  if (tvMode) {
    return (
      <TvDashboard
        groups={tvGroups}
        campaignCount={filteredCampaigns.length}
        totalSpend={totalSpend}
        activeCampaigns={activeCampaigns}
        campaignsWithSpendCount={campaignsWithSpendCount}
        totalBalanceOwed={totalBalanceOwed}
        showTodayOnly={showTodayOnly}
        countdown={countdown}
        lastRefresh={lastRefresh}
        formatSpend={formatSpend}
        formatUsd={formatUsd}
        formatCountdown={formatCountdown}
        formatLastRefresh={formatLastRefresh}
        onRefresh={handleManualRefresh}
        refreshing={loadingCampaigns}
        onExit={() => setTvMode(false)}
      />
    )
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Ads Manager</h1>
            <p className="text-muted-foreground">Campaign spend overview</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button variant="outline" size="sm" onClick={handleManualRefresh} disabled={loadingCampaigns}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loadingCampaigns ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <span>Last: {formatLastRefresh(lastRefresh)}</span>
              <span className="text-primary font-mono">({formatCountdown(countdown)})</span>
            </div>
          </div>
        </div>
        
        {/* Filters Row */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Account Selector */}
          <Select value={selectedAccount} onValueChange={setSelectedAccount}>
            <SelectTrigger className="w-[220px] bg-card">
              <SelectValue placeholder="Select Account" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                All Accounts ({accounts.length})
              </SelectItem>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name || account.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          {/* Today's Spend Toggle */}
          <Button
            variant={showTodayOnly ? "default" : "outline"}
            size="sm"
            onClick={() => {
              const next = !showTodayOnly
              setShowTodayOnly(next)
              // Keep the date label in sync: today-only mode always means "Today"
              if (next) setDatePreset('today')
            }}
            className={showTodayOnly ? "bg-primary" : "bg-card"}
          >
            <DollarSign className="w-4 h-4 mr-2" />
            Today&apos;s Spend
            {campaignsWithSpendCount > 0 && (
              <Badge variant="secondary" className="ml-2 px-1.5 py-0 text-xs">
                {campaignsWithSpendCount}
              </Badge>
            )}
          </Button>

          {/* TV Mode - full-screen glanceable wall display */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTvMode(true)}
            className="bg-card"
          >
            <Tv className="w-4 h-4 mr-2" />
            TV Mode
          </Button>
          
          {/* Group by Product Toggle */}
          <Button
            variant={groupByProduct ? "default" : "outline"}
            size="sm"
            onClick={() => setGroupByProduct(!groupByProduct)}
            className={groupByProduct ? "bg-primary" : "bg-card"}
          >
            <Boxes className="w-4 h-4 mr-2" />
            Group by Product
          </Button>

          {/* Product group sort */}
          {groupByProduct && (
            <Select value={groupSort} onValueChange={(v) => setGroupSort(v as typeof groupSort)}>
              <SelectTrigger className="w-[190px] bg-card" size="sm">
                <ArrowUpDown className="w-4 h-4 mr-2 shrink-0" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="spend">Highest spend</SelectItem>
                <SelectItem value="cac_desc">Cost/client: high to low</SelectItem>
                <SelectItem value="cac_asc">Cost/client: low to high</SelectItem>
                <SelectItem value="clients_desc">Most clients</SelectItem>
              </SelectContent>
            </Select>
          )}
          
          {/* Date Range Selector */}
          <Popover open={showCalendar} onOpenChange={setShowCalendar}>
            <PopoverTrigger asChild>
              <Button 
                variant="outline" 
                className="w-[220px] justify-between bg-card"
              >
                <span className="flex items-center gap-2">
                  <CalendarIcon className="w-4 h-4 text-muted-foreground" />
                  {getDateRangeLabel()}
                </span>
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <div className="flex">
                {/* Presets */}
                <div className="border-r p-2 space-y-1 min-w-[140px]">
                  {DATE_PRESETS.map(preset => (
                    <button
                      key={preset.value}
                      onClick={() => handleDatePresetChange(preset.value)}
                      className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
                        datePreset === preset.value
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                
                {/* Calendar */}
                {datePreset === 'custom' && (
                  <div className="p-3">
                    <Calendar
                      mode="range"
                      selected={dateRange}
                      onSelect={(range) => {
                        setDateRange(range)
                        if (range?.from && range?.to) {
                          setShowCalendar(false)
                        }
                      }}
                      numberOfMonths={2}
                      disabled={{ after: new Date() }}
                    />
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 border-amber-500/20">
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center">
                <DollarSign className="w-6 h-6 text-amber-500" />
              </div>
              <div>
                <p className="text-3xl font-bold text-foreground">
                  {formatSpend(totalSpend.toString())}
                </p>
                <p className="text-xs text-muted-foreground/70 mt-0.5">
                  {formatUsd(totalSpend.toString())} USD
                </p>
                <p className="text-sm text-muted-foreground">Total Spend</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border-emerald-500/20">
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-emerald-500" />
              </div>
              <div>
                <p className="text-3xl font-bold text-foreground">{activeCampaigns}</p>
                <p className="text-sm text-muted-foreground">Active Campaigns</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border-blue-500/20">
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
                <Megaphone className="w-6 h-6 text-blue-500" />
              </div>
              <div>
                <p className="text-3xl font-bold text-foreground">{filteredCampaigns.length}</p>
                <p className="text-sm text-muted-foreground">
                  {showTodayOnly ? "With Spend" : "Total Campaigns"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Account Spend Breakdown */}
      {selectedAccount === 'all' && accountSpendList.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-foreground">Spend by Account</h2>
            {totalBalanceOwed > 0 && (
              <div className="text-sm">
                <span className="text-muted-foreground">Total Due: </span>
                <span className="font-semibold text-red-500">{formatSpend(totalBalanceOwed.toString())} (${totalBalanceOwed.toFixed(2)})</span>
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {accountSpendList.map((account) => (
              <Card 
                key={account.id} 
                className="bg-card hover:border-primary/30 transition-colors cursor-pointer"
                onClick={() => setSelectedAccount(account.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground truncate" title={account.name}>
                        {account.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {account.campaignCount} campaign{account.campaignCount !== 1 ? 's' : ''}
                      </p>
                      {account.balance > 0 && (
                        <p className="text-xs text-red-500 mt-1">
                          Due: {formatSpend(account.balance.toString())} (${account.balance.toFixed(2)})
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`font-semibold ${account.spend > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                        {formatSpend(account.spend.toString())}
                      </p>
                      {account.spend > 0 && (
                        <p className="text-xs text-muted-foreground/70">
                          {formatUsd(account.spend.toString())}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Campaigns Table */}
      <Card>
        <CardContent className="p-0">
          {loadingCampaigns ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : filteredCampaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <Megaphone className="w-10 h-10 text-muted-foreground/50" />
              <p className="text-muted-foreground">
                {showTodayOnly ? "No campaigns spent money today" : "No campaigns found"}
              </p>
              {showTodayOnly && (
                <Button variant="ghost" size="sm" onClick={() => setShowTodayOnly(false)}>
                  Show all campaigns
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[35%]">{groupByProduct ? 'Product / Campaign' : 'Campaign'}</TableHead>
                  {selectedAccount === 'all' && <TableHead>Account</TableHead>}
                  {!groupByProduct && <TableHead>Product</TableHead>}
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupByProduct ? (
                  productGroups.map((group) => {
                    const isCollapsed = collapsedProducts.has(group.key)
                    const isUnlinked = group.key === UNLINKED_KEY
                    return (
                      <Fragment key={group.key}>
                        {/* Product group header */}
                        <TableRow
                          className="cursor-pointer bg-muted/30 hover:bg-muted/50 border-t-2 border-border"
                          onClick={() => toggleProductGroup(group.key)}
                        >
                          <TableCell colSpan={tableCols - 1}>
                            <div className="flex items-center gap-2">
                              {isCollapsed ? (
                                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                              ) : (
                                <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                              )}
                              {isUnlinked ? (
                                <Link2 className="w-4 h-4 text-muted-foreground shrink-0" />
                              ) : (
                                <Package className="w-4 h-4 text-primary shrink-0" />
                              )}
                              <span className={`font-semibold ${isUnlinked ? 'text-muted-foreground' : 'text-foreground'}`}>
                                {group.productName}
                              </span>
                              {group.productPrice != null && (
                                <span className="text-xs text-muted-foreground">Rs {group.productPrice}</span>
                              )}
                              <Badge variant="secondary" className="ml-1 px-2 py-0 text-xs">
                                {group.campaigns.length} campaign{group.campaigns.length !== 1 ? 's' : ''}
                              </Badge>
                              {!isUnlinked && (() => {
                                const stat = productClientStats[group.productName]
                                const clients = stat?.clientCount ?? 0
                                return (
                                  <Badge
                                    variant="outline"
                                    className="px-2 py-0 text-xs bg-primary/5 text-primary border-primary/20"
                                    title={`${clients} distinct client${clients !== 1 ? 's' : ''} logged for this product${stat ? ` \u00b7 ${stat.deliveredClientCount} delivered` : ''}`}
                                  >
                                    <Users className="w-3 h-3 mr-1" />
                                    {clients.toLocaleString()} client{clients !== 1 ? 's' : ''}
                                  </Badge>
                                )
                              })()}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={`font-bold ${group.totalSpend > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                              {formatSpend(group.totalSpend.toString())}
                            </span>
                            {group.totalSpend > 0 && (
                              <p className="text-xs text-muted-foreground/70">{formatUsd(group.totalSpend.toString())}</p>
                            )}
                            {!isUnlinked && (() => {
                              const clients = productClientStats[group.productName]?.clientCount ?? 0
                              if (group.totalSpend <= 0 || clients <= 0) return null
                              const cacRs = (group.totalSpend * USD_TO_RS) / clients
                              return (
                                <p className="mt-0.5 text-xs font-medium text-primary" title="Ad spend per client acquired (cost of a client)">
                                  Rs {cacRs.toLocaleString('en-US', { maximumFractionDigits: 0 })}/client
                                </p>
                              )
                            })()}
                          </TableCell>
                        </TableRow>
                        
                        {/* Campaigns within the product */}
                        {!isCollapsed && group.campaigns.map((campaign) => (
                          <TableRow key={`${campaign.accountId}-${campaign.id}`} className="group">
                            <TableCell>
                              <div className="flex items-center gap-2 pl-6">
                                <div className="min-w-0">
                                  <p className="font-medium text-foreground truncate">{campaign.name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {campaign.objective?.replace(/_/g, ' ')}
                                  </p>
                                  {renderCampaignBudget(campaign)}
                                  {renderAdIds(campaign)}
                                </div>
                                {isUnlinked ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-xs text-muted-foreground hover:text-primary shrink-0"
                                    onClick={() => {
                                      setSelectedCampaign(campaign)
                                      setLinkDialogOpen(true)
                                    }}
                                  >
                                    <Link2 className="w-3 h-3 mr-1" />
                                    Link
                                  </Button>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Unlink product"
                                    onClick={() => {
                                      setSelectedCampaign(campaign)
                                      linkProductToCampaign(null)
                                    }}
                                  >
                                    <X className="w-3 h-3" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                            {selectedAccount === 'all' && (
                              <TableCell>
                                <span className="text-sm text-muted-foreground">{campaign.accountName}</span>
                              </TableCell>
                            )}
                            <TableCell>
                              <Badge className={getStatusBadge(campaign.status)}>
                                {campaign.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              <div>
                                <span className={`font-semibold ${parseFloat(campaign.spend) > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                                  {formatSpend(campaign.spend)}
                                </span>
                                {parseFloat(campaign.spend) > 0 && (
                                  <p className="text-xs text-muted-foreground/70">{formatUsd(campaign.spend)}</p>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </Fragment>
                    )
                  })
                ) : (
                  filteredCampaigns.map((campaign) => (
                  <TableRow key={`${campaign.accountId}-${campaign.id}`}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-foreground">{campaign.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {campaign.objective?.replace(/_/g, ' ')}
                        </p>
                        {renderCampaignBudget(campaign)}
                        {renderAdIds(campaign)}
                      </div>
                    </TableCell>
                    {selectedAccount === 'all' && (
                      <TableCell>
                        <span className="text-sm text-muted-foreground">{campaign.accountName}</span>
                      </TableCell>
                    )}
                    <TableCell>
                      {campaignLinks[campaign.id]?.products ? (
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 font-normal">
                            <Package className="w-3 h-3 mr-1" />
                            {campaignLinks[campaign.id].products?.name}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              setSelectedCampaign(campaign)
                              linkProductToCampaign(null)
                            }}
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-primary"
                          onClick={() => {
                            setSelectedCampaign(campaign)
                            setLinkDialogOpen(true)
                          }}
                        >
                          <Link2 className="w-3 h-3 mr-1" />
                          Link Product
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusBadge(campaign.status)}>
                        {campaign.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div>
                        <span className={`font-semibold ${parseFloat(campaign.spend) > 0 ? 'text-amber-600' : 'text-muted-foreground'}`}>
                          {formatSpend(campaign.spend)}
                        </span>
                        {parseFloat(campaign.spend) > 0 && (
                          <p className="text-xs text-muted-foreground/70">{formatUsd(campaign.spend)}</p>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      
      {/* Link Product Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link Product to Campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              Campaign: <span className="font-medium text-foreground">{selectedCampaign?.name}</span>
            </div>
            <Command className="border rounded-lg">
              <CommandInput placeholder="Search products..." />
              <CommandList className="max-h-[300px]">
                <CommandEmpty>No products found.</CommandEmpty>
                <CommandGroup>
                  {products.map((product) => (
                    <CommandItem
                      key={product.id}
                      value={product.name}
                      onSelect={() => linkProductToCampaign(product.id)}
                      className="cursor-pointer"
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-2">
                          <Package className="w-4 h-4 text-muted-foreground" />
                          <span>{product.name}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          Rs {product.price}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
            {linkingProduct && (
              <div className="flex items-center justify-center py-2">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
