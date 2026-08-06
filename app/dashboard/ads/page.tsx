'use client'

import { useState, useEffect, useRef, Fragment } from 'react'
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
import { AdAttributionPanel } from '@/components/ads/ad-attribution-panel'
import { costPerResultRs, RESULT_LABEL, type ResultKind } from '@/lib/ads-conversions'
import { USD_TO_RS } from '@/lib/ads/currency'
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
  Pencil,
  History,
  Facebook,
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
import { format, formatDistanceToNow, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { DateRange } from 'react-day-picker'
import { getRecommendation, RECOMMENDATION_STYLES, VERDICT_STYLES, type Recommendation } from '@/lib/ads-recommendations'

// Shape of one normalized Facebook activity (campaign edit) from our API
interface AdActivity {
  eventTime: string
  actorName: string
  objectName: string
  objectId: string
  eventType: string
  changeSummary: string
  direction: 'increase' | 'decrease' | 'status' | 'other'
}

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
  // Conversions from Facebook insights actions (general conversion rule:
  // messages, else leads, else purchases). Drives cost-per-result in Rs.
  messages?: number
  results?: number
  resultKind?: ResultKind
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
  image_url?: string | null
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
  // Multi-select account filter (empty = all accounts). Persisted so the
  // team's usual pair (MBM + Destockage By Moris) is the default view.
  const [accountFilter, setAccountFilter] = useState<string[]>([])
  const accountFilterInitRef = useRef(false)
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [accountSpends, setAccountSpends] = useState<Record<string, number>>({}) // Account-level spend from FB
  
  // Product linking state
  const [products, setProducts] = useState<Product[]>([])
  const [campaignLinks, setCampaignLinks] = useState<Record<string, CampaignProductLink>>({})
  // Per-product client counts (for cost-per-client / CAC), keyed by product name
  const [productClientStats, setProductClientStats] = useState<Record<string, { clientCount: number; deliveredClientCount: number; orderCount: number }>>({})
  // Per-page attribution: which page (deliveries.medium) each client came from.
  // productPages: { [productName]: { [page]: clients } }
  const [productPages, setProductPages] = useState<Record<string, Record<string, number>>>({})
  // Campaign edit history from Facebook's Activities API
  const [activities, setActivities] = useState<AdActivity[]>([])
  const [lastEditByObject, setLastEditByObject] = useState<Record<string, AdActivity>>({})
  const [showEditsPanel, setShowEditsPanel] = useState(false)
  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [linkingProduct, setLinkingProduct] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingCampaigns, setLoadingCampaigns] = useState(false)
  // Cache for historical date results (past dates never change), keyed by
  // account + preset + range. Lets us instantly re-show a previously viewed
  // date without refetching or blanking the whole dashboard. "Today" is never
  // cached here since it keeps changing.
  const historyCacheRef = useRef<Record<string, { campaigns: Campaign[]; accountSpends: Record<string, number> }>>({})
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
  // Latest client-stats refresher, callable from the []-deps interval
  const refreshClientStatsRef = useRef<(() => void) | null>(null)
  
  // Full-screen TV dashboard mode (separate glanceable wall-display view)
  const [tvMode, setTvMode] = useState(false)
  // Riders + their allocated regions + today's client counts (TV mode display)
  const [tvRiders, setTvRiders] = useState<{ id: string; name: string; regions: string[]; todayClients?: number }[]>([])
  const [tvRidersTodayTotal, setTvRidersTodayTotal] = useState(0)
  // The delivery batch date the rider client counts belong to
  const [tvRidersBatchDate, setTvRidersBatchDate] = useState<string | null>(null)
  // Localities of clients that resolve to no rider (with client counts)
  const [tvUnassignedLocalities, setTvUnassignedLocalities] = useState<{ name: string; clients: number }[]>([])
  // User-selected batch date (null = auto: the active delivery batch)
  const [tvRidersDate, setTvRidersDate] = useState<string | null>(null)
  // Revenue booked per Facebook AD, keyed by deliveries.ad_id. This is order
  // value (every delivery row is still unpaid), not cash collected.
  const [adRevenue, setAdRevenue] = useState<Record<string, { revenue: number; orders: number; clients: number }>>({})
  // Money that could not be tied to any ad id, so the per-ad totals can never
  // masquerade as the whole business
  const [adRevenueLeftover, setAdRevenueLeftover] = useState<{
    labelledOrders: number
    labelledRevenue: number
    missingOrders: number
    missingRevenue: number
  } | null>(null)
  // Clients arriving with no usable ad id, per product. Orders are never
  // blocked for a missing ad, so this is how the gap stays visible.
  const [attributionGaps, setAttributionGaps] = useState<
    { product: string; total: number; attributed: number; missing: number }[]
  >([])
  const [attributionTotals, setAttributionTotals] = useState<{
    total: number
    attributed: number
    missing: number
    coverage: number
  } | null>(null)

  // Load riders/regions when TV mode opens (refreshed on each entry) or
  // when the user picks a different batch date on the Riders panel
  useEffect(() => {
    if (!tvMode) return
    const url = tvRidersDate
      ? `/api/ads/riders-regions?date=${tvRidersDate}`
      : '/api/ads/riders-regions'
    fetch(url)
      .then(res => res.json())
      .then(data => {
        if (data?.success) {
          setTvRiders(data.riders || [])
          setTvRidersTodayTotal(data.todayTotal || 0)
          setTvRidersBatchDate(data.batchDate || null)
          setTvUnassignedLocalities(data.unassignedLocalities || [])
        }
      })
      .catch(() => {})
  }, [tvMode, tvRidersDate])

  // Per-ad revenue for the wall. Scoped to orders entered TODAY when the
  // "Today's Spend" toggle is on, so revenue and spend cover the same window;
  // all-time otherwise (an ad that ran last week still earned that money).
  useEffect(() => {
    if (!tvMode) return
    const entryDate = showTodayOnly
      ? new Date().toLocaleDateString('en-CA', { timeZone: 'Indian/Mauritius' })
      : null
    fetch(`/api/ads/ad-revenue${entryDate ? `?entryDate=${entryDate}` : ''}`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.success) {
          setAdRevenue(data.byAd || {})
          setAdRevenueLeftover(data.unattributed || null)
        }
      })
      .catch(() => {})

    // Same window as the revenue call above, so "tagged %" describes exactly
    // the same set of clients the wall is costing.
    fetch(`/api/ads/attribution-gaps${entryDate ? `?entryDate=${entryDate}` : ''}`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.success) {
          setAttributionGaps(data.byProduct || [])
          setAttributionTotals(data.totals || null)
        }
      })
      .catch(() => {})
  }, [tvMode, showTodayOnly])

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
          // Auto-refresh when countdown hits 0: fresh ad spend AND fresh
          // client counts (via ref so we never use a stale product list)
          fetchCachedData(true)
          refreshClientStatsRef.current?.()
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
  }, [selectedAccount, accountFilter, datePreset, dateRange])
  
  // When switching to today's spend mode, use cached data
  useEffect(() => {
    if (showTodayOnly) {
      fetchCachedData()
    }
  }, [showTodayOnly])

  // Initialize the account filter once accounts arrive: restore the saved
  // selection, or default to the two working accounts (MBM + Destockage By
  // Moris, excluding read-only duplicates) on first ever load.
  useEffect(() => {
    if (accounts.length === 0 || accountFilterInitRef.current) return
    accountFilterInitRef.current = true
    try {
      const saved = localStorage.getItem('ads-account-filter')
      if (saved) {
        const ids = (JSON.parse(saved) as string[]).filter((id) => accounts.some((a) => a.id === id))
        setAccountFilter(ids)
        return
      }
    } catch {
      // fall through to defaults
    }
    const defaults = accounts
      .filter((a) => {
        const n = (a.name || '').toLowerCase()
        if (n.includes('read-only')) return false
        return n === 'mbm' || n.includes('destockage')
      })
      .map((a) => a.id)
    if (defaults.length > 0) setAccountFilter(defaults)
  }, [accounts])

  // Toggle one account in the filter (persisted). Empty selection = all.
  const updateAccountFilter = (ids: string[]) => {
    setAccountFilter(ids)
    try {
      localStorage.setItem('ads-account-filter', JSON.stringify(ids))
    } catch {
      // storage unavailable - selection just won't persist
    }
  }

  // Re-pull today's client counts for all linked products. Used by the
  // campaignLinks effect below AND by every refresh (manual + auto) so the
  // Cl column moves in lockstep with fresh ad spend as agents log entries.
  const refreshClientStats = () => {
    const names = Array.from(
      new Set(
        Object.values(campaignLinks)
          .map((l) => l.products?.name)
          .filter((n): n is string => !!n)
      )
    )
    fetchProductClientStats(names)
  }
  // Keep a ref to the latest version for the []-deps auto-refresh interval
  refreshClientStatsRef.current = refreshClientStats

  // Refresh per-product client counts whenever the set of linked products changes
  useEffect(() => {
    refreshClientStats()
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

  async function fetchCampaignsData(forceRefresh = false) {
    const buildParams = () => {
      let params = `datePreset=${datePreset}`
      if (datePreset === 'custom' && dateRange?.from && dateRange?.to) {
        params += `&since=${format(dateRange.from, 'yyyy-MM-dd')}&until=${format(dateRange.to, 'yyyy-MM-dd')}`
      }
      return params
    }
    
    const params = buildParams()

    // Historical dates are immutable, so serve a cached result instantly (unless
    // the user explicitly hits Refresh). This avoids the full reload/spinner when
    // flipping between past dates. "Today" is excluded — it always fetches fresh.
    const cacheKey = `${selectedAccount}|${accountFilter.join(',')}|${params}`
    const canCache = datePreset !== 'today'
    if (!forceRefresh && canCache && historyCacheRef.current[cacheKey]) {
      const cached = historyCacheRef.current[cacheKey]
      setCampaigns(cached.campaigns)
      setAccountSpends(cached.accountSpends)
      return
    }

    setLoadingCampaigns(true)
    
    if (selectedAccount === 'all') {
      // Fetch from all accounts
      const allCampaigns: Campaign[] = []
      const newAccountSpends: Record<string, number> = {}
      
      // Only fetch accounts in the filter - no point pulling history for
      // the 8 accounts the team never uses.
      const accountsToFetch =
        accountFilter.length > 0 ? accounts.filter((a) => accountFilter.includes(a.id)) : accounts
      for (const account of accountsToFetch) {
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
      if (canCache) historyCacheRef.current[cacheKey] = { campaigns: allCampaigns, accountSpends: newAccountSpends }
    } else {
      // Fetch from single account
      try {
        const res = await fetch(`/api/facebook-ads?action=campaigns&accountId=${selectedAccount}&${params}`)
        const data = await res.json()
        
        const account = accounts.find(a => a.id === selectedAccount)
        const mapped = (data.data || []).map((c: Campaign) => ({
          ...c,
          accountId: selectedAccount,
          accountName: account?.name || selectedAccount
        }))
        setCampaigns(mapped)

        // Store account-level spend
        const spends = data.accountTotalSpend
          ? { [selectedAccount]: parseFloat(data.accountTotalSpend) }
          : {}
        if (data.accountTotalSpend) setAccountSpends(spends)
        if (canCache) historyCacheRef.current[cacheKey] = { campaigns: mapped, accountSpends: spends }
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
      setProductPages({})
      return
    }
    try {
      // Cl counts = clients ENTERED today (Mauritius time), pairing with
      // today's ad spend. The Riders panel intentionally differs: it groups
      // by delivery date (the batch riders deliver today).
      const entryDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Indian/Mauritius' })
      const res = await fetch('/api/product-client-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names, entryDate }),
      })
      const data = await res.json()
      setProductClientStats(data.stats || {})
      setProductPages(data.productPages || {})
    } catch {
      console.error('[v0] Failed to fetch product client stats')
    }
  }

  // Campaign edit history: what changed on Facebook (budget up/down, status),
  // who did it and when. Refreshed with every data refresh cycle.
  async function fetchActivities(accountList: AdAccount[]) {
    if (accountList.length === 0) return
    try {
      const ids = accountList.map((a) => a.id).join(',')
      const res = await fetch(`/api/facebook-ads/activities?accountIds=${ids}`)
      const data = await res.json()
      setActivities(data.activities || [])
      setLastEditByObject(data.lastEditByObject || {})
    } catch {
      console.error('[v0] Failed to fetch campaign activities')
    }
  }

  // Load/refresh the edit feed whenever accounts arrive or data refreshes
  useEffect(() => {
    fetchActivities(accounts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, lastRefresh])

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

  // USD to Rs conversion rate (including VAT) now lives in lib/ads/currency so
  // the Rs 150 kill rule cannot drift from the figure displayed beside it.

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

  // Account filter first (empty = all), then when showTodayOnly is on,
  // keep only campaigns that actually have spend today.
  const inAccountFilter = (c: Campaign) =>
    accountFilter.length === 0 || accountFilter.includes(c.accountId || '')
  const accountFiltered = campaigns.filter(inAccountFilter)
  const filteredCampaigns = showTodayOnly
    ? accountFiltered.filter(c => parseFloat(c.spend || '0') > 0)
    : accountFiltered

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
        productImage: product?.image_url || null,
        campaigns: [],
        totalSpend: 0,
      }
    }
    acc[key].campaigns.push(campaign)
    acc[key].totalSpend += parseFloat(campaign.spend || '0')
    return acc
  }, {} as Record<string, { key: string; productId: string | null; productName: string; productPrice?: number; productImage?: string | null; campaigns: Campaign[]; totalSpend: number }>)

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

  // Find a campaign's most recent budget edit. Matches by object id first;
  // falls back to the edited object's NAME because ad-set-level budget edits
  // carry the ad set's id (not the campaign id), while FB names ad sets after
  // their campaign - so "DBM - Pet Comb - 4" still maps back to the campaign.
  const editForCampaign = (c: Campaign): AdActivity | null => {
    const byId = lastEditByObject[c.id]
    if (byId && (byId.direction === 'increase' || byId.direction === 'decrease')) return byId
    const name = c.name?.trim().toLowerCase()
    if (!name) return null
    return (
      activities.find(
        (a) =>
          (a.direction === 'increase' || a.direction === 'decrease') &&
          a.objectName.trim().toLowerCase() === name,
      ) ?? null
    )
  }

  // Budget recommendation for a product group: uses group CAC + the EARLIEST
  // campaign created_time (an established product shouldn't show HOLD just
  // because one new campaign was added).
  const groupRecommendation = (g: { productName: string; totalSpend: number; campaigns: Campaign[]; key: string }): Recommendation | null => {
    if (g.key === UNLINKED_KEY) return null
    const earliest = g.campaigns.reduce<string | null>((min, c) => {
      if (!c.created_time) return min
      return min === null || c.created_time < min ? c.created_time : min
    }, null)
    // Most recent budget edit across the group's campaigns (from the FB
    // activity feed): if one exists within the watch window, the group shows
    // EDITED (already taken care of) instead of re-recommending.
    const lastEdit = g.campaigns.reduce<AdActivity | null>((latest, c) => {
      const e = editForCampaign(c)
      if (!e) return latest
      return latest === null || e.eventTime > latest.eventTime ? e : latest
    }, null)
    return getRecommendation({
      createdTime: earliest,
      cac: groupCac(g),
      hasSpend: g.totalSpend > 0,
      lastEditTime: lastEdit?.eventTime ?? null,
      lastEditDirection: lastEdit?.direction ?? null,
    })
  }

  // THE key question per product: did any of its campaigns get a budget
  // increase or decrease TODAY? Returns the latest such edit, or null.
  const todaysEdit = (g: { campaigns: Campaign[]; key: string }): AdActivity | null => {
    if (g.key === UNLINKED_KEY) return null
    const todayStr = new Date().toDateString()
    return g.campaigns.reduce<AdActivity | null>((latest, c) => {
      const e = editForCampaign(c)
      if (!e) return latest
      if (new Date(e.eventTime).toDateString() !== todayStr) return latest
      return latest === null || e.eventTime > latest.eventTime ? e : latest
    }, null)
  }

  // Prominent chip: "↑ EDITED TODAY" green / "↓ EDITED TODAY" red, with the
  // Rs change + who did it in the tooltip. This is the action-taken signal.
  const renderTodayEditChip = (g: { campaigns: Campaign[]; key: string }) => {
    const e = todaysEdit(g)
    if (!e) return null
    const up = e.direction === 'increase'
    return (
      <span
        title={`${e.changeSummary} \u00b7 by ${e.actorName}`}
        className={`inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0 text-[10px] font-bold uppercase tracking-wide ${
          up
            ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-500'
            : 'border-red-500/40 bg-red-500/15 text-red-500'
        }`}
      >
        {up ? '\u2191' : '\u2193'} Edited today
      </span>
    )
  }

  // Page-level stats across ALL products: total clients per page and the
  // estimated avg cost/client per page. Page spend is estimated by splitting
  // each product's spend across its pages proportionally to clients, so the
  // page average is weighted by the real CAC of the products it sells.
  const pageAgg: Record<string, { clients: number; spendRs: number }> = {}
  for (const g of productGroups) {
    if (g.key === UNLINKED_KEY) continue
    const totalClients = productClientStats[g.productName]?.clientCount ?? 0
    const pages = productPages[g.productName]
    if (!pages) continue
    const spendRs = g.totalSpend * USD_TO_RS
    for (const [page, count] of Object.entries(pages)) {
      if (!pageAgg[page]) pageAgg[page] = { clients: 0, spendRs: 0 }
      pageAgg[page].clients += count
      if (totalClients > 0 && spendRs > 0) {
        pageAgg[page].spendRs += spendRs * (count / totalClients)
      }
    }
  }
  const pageStats = Object.entries(pageAgg)
    .map(([page, v]) => ({
      page,
      clients: v.clients,
      cac: v.spendRs > 0 && v.clients > 0 ? v.spendRs / v.clients : null,
    }))
    .sort((a, b) => b.clients - a.clients)

  // Small colored badge for a budget recommendation (shared style map).
  // EDITED additionally shows the live verdict: is the change paying off?
  const renderRecBadge = (rec: Recommendation | null, compact = false) => {
    if (!rec) return null
    const s = RECOMMENDATION_STYLES[rec.action]
    const verdict = rec.action === 'EDITED' && rec.verdict ? VERDICT_STYLES[rec.verdict] : null
    return (
      <span className="inline-flex shrink-0 items-center gap-1">
        <span
          title={rec.reason}
          className={`inline-flex items-center gap-0.5 rounded border px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide ${s.bg} ${s.text} ${s.border}`}
        >
          {s.arrow}
          {!compact && <span>{rec.action === 'EDITED' ? 'Edited - watching' : s.label}</span>}
        </span>
        {verdict && !compact && (
          <span title={rec.reason} className={`text-[10px] font-semibold ${verdict.text}`}>
            {verdict.label}
          </span>
        )}
      </span>
    )
  }

  // "Edited 2h ago" indicator for a campaign that appears in the activity feed
  const renderLastEdit = (campaign: Campaign) => {
    const edit = editForCampaign(campaign)
    if (!edit) return null
    const color =
      edit.direction === 'increase' ? 'text-emerald-500' : edit.direction === 'decrease' ? 'text-red-500' : 'text-blue-400'
    let when = ''
    try {
      when = formatDistanceToNow(new Date(edit.eventTime), { addSuffix: true })
    } catch {
      when = ''
    }
    return (
      <span
        className={`inline-flex items-center gap-1 text-[11px] ${color}`}
        title={`${edit.changeSummary} \u00b7 by ${edit.actorName}`}
      >
        <Pencil className="w-3 h-3" />
        {edit.changeSummary}
        {when && <span className="text-muted-foreground/70">{'\u00b7'} {when}</span>}
      </span>
    )
  }

  // Cost of one conversion for a single ad, in Rs. This is the number that
  // makes ads comparable - a big spender can still be the cheapest per message.
  const renderCostPerResult = (campaign: Campaign) => {
    const spendUsd = parseFloat(campaign.spend || '0')
    const results = campaign.results ?? 0
    const cpr = costPerResultRs(spendUsd, results, USD_TO_RS)
    const label = RESULT_LABEL[campaign.resultKind ?? 'none']
    if (cpr === null) {
      if (spendUsd <= 0) return null
      return (
        <p className="mt-0.5 text-xs font-medium text-red-500" title="Spending with no messages yet">
          no {RESULT_LABEL.msg} yet
        </p>
      )
    }
    const tone = cpr <= 50 ? 'text-emerald-600' : cpr <= 75 ? 'text-amber-600' : 'text-red-500'
    return (
      <p
        className={`mt-0.5 text-xs font-semibold ${tone}`}
        title={`${results} ${label}${results !== 1 ? 's' : ''} \u00b7 ${formatSpend(campaign.spend)} spent`}
      >
        Rs {cpr.toLocaleString('en-US', { maximumFractionDigits: 0 })}/{label}
        <span className="ml-1 font-normal text-muted-foreground">({results})</span>
      </p>
    )
  }

  // TV dashboard: product groups enriched with client count + cost-per-client (Rs)
  // so the TV view can color-code each product into a CAC efficiency zone.
  const tvGroups = productGroups.map((g) => ({
    key: g.key,
    productName: g.productName,
    productPrice: g.productPrice,
    productImage: g.productImage ?? null,
    totalSpend: g.totalSpend,
    isUnlinked: g.key === UNLINKED_KEY,
    clients: productClientStats[g.productName]?.clientCount ?? 0,
    cac: groupCac(g),
    campaigns: g.campaigns,
    // Conversions rolled up from this product's campaigns, so the group can
    // show what one message costs across all of its ads.
    totalResults: g.campaigns.reduce((sum, c) => sum + (c.results ?? 0), 0),
    costPerResult: costPerResultRs(
      g.totalSpend,
      g.campaigns.reduce((sum, c) => sum + (c.results ?? 0), 0),
      USD_TO_RS,
    ),
    recommendation: groupRecommendation(g),
    todayEdit: (() => {
      const e = todaysEdit(g)
      return e ? { direction: e.direction as 'increase' | 'decrease', summary: `${e.changeSummary} \u00b7 by ${e.actorName}` } : null
    })(),
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
  const campaignsWithSpendCount = accountFiltered.filter(c => parseFloat(c.spend || '0') > 0).length

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
  
  // Manual refresh handler: fresh ad spend + fresh client entry counts
  // together, so the Cl column reflects what agents just logged
  const handleManualRefresh = () => {
    refreshClientStats()
    if (showTodayOnly) {
      fetchCachedData(true) // Force refresh from Facebook
    } else {
      fetchCampaignsData(true) // Bypass the historical cache for a fresh pull
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
          riders={tvRiders}
          ridersTodayTotal={tvRidersTodayTotal}
          ridersBatchDate={tvRidersBatchDate}
          onRidersDateChange={setTvRidersDate}
          unassignedLocalities={tvUnassignedLocalities}
        pageStats={pageStats}
        activities={activities}
        adRevenue={adRevenue}
        adRevenueLeftover={adRevenueLeftover}
        attributionGaps={attributionGaps}
        attributionTotals={attributionTotals}
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
          {/* Account Selector: multi-select so the team's usual pair
              (MBM + DBM) can be the default without hiding the others */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="w-[220px] justify-between bg-card font-normal">
                <span className="truncate">
                  {accountFilter.length === 0
                    ? `All Accounts (${accounts.length})`
                    : accountFilter.length === 1
                      ? accounts.find((a) => a.id === accountFilter[0])?.name || accountFilter[0]
                      : accounts
                          .filter((a) => accountFilter.includes(a.id))
                          .map((a) => a.name || a.id)
                          .join(' + ')}
                </span>
                <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[260px] p-1">
              <button
                type="button"
                onClick={() => updateAccountFilter([])}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <span className={`flex h-4 w-4 items-center justify-center rounded border ${accountFilter.length === 0 ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>
                  {accountFilter.length === 0 && <Check className="h-3 w-3" />}
                </span>
                All Accounts ({accounts.length})
              </button>
              <div className="my-1 h-px bg-border" />
              {accounts.map((account) => {
                const checked = accountFilter.includes(account.id)
                return (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() =>
                      updateAccountFilter(
                        checked ? accountFilter.filter((id) => id !== account.id) : [...accountFilter, account.id],
                      )
                    }
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}>
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate">{account.name || account.id}</span>
                  </button>
                )
              })}
            </PopoverContent>
          </Popover>
          
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

      {/* Clients by Page: which page each client came from, with estimated
          avg cost/client per page (product spend split by client share) */}
      {pageStats.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Facebook className="w-4 h-4 text-blue-500" />
            <h2 className="text-sm font-semibold text-foreground">Clients by Page</h2>
            <span className="text-xs text-muted-foreground">est. cost/client per page</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {pageStats.map((p) => {
              const cacColor =
                p.cac === null
                  ? 'text-muted-foreground'
                  : p.cac <= 75
                    ? 'text-emerald-500'
                    : p.cac < 100
                      ? 'text-amber-500'
                      : 'text-red-500'
              return (
                <div
                  key={p.page}
                  className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5"
                  title={`${p.clients} client${p.clients !== 1 ? 's' : ''} from ${p.page}${p.cac !== null ? ` \u00b7 est. Rs ${Math.round(p.cac)}/client` : ''}`}
                >
                  <span className="text-sm font-medium text-foreground">{p.page}</span>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="w-3 h-3" />
                    {p.clients.toLocaleString()}
                  </span>
                  {p.cac !== null && (
                    <span className={`text-xs font-semibold tabular-nums ${cacColor}`}>
                      Rs {Math.round(p.cac)}/cl
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Recent Edits: live campaign change feed from Facebook (budget up/down,
          status changes) so the team knows what got edited, by whom, and when */}
      <Card>
        <CardContent className="p-0">
          <button
            type="button"
            onClick={() => setShowEditsPanel((v) => !v)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
          >
            {showEditsPanel ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
            <History className="w-4 h-4 text-blue-500 shrink-0" />
            <span className="text-sm font-semibold text-foreground">Recent Edits</span>
            <span className="text-xs text-muted-foreground">last 7 days from Facebook</span>
            <Badge variant="secondary" className="ml-auto px-2 py-0 text-xs">
              {activities.length}
            </Badge>
          </button>
          {showEditsPanel && (
            <div className="max-h-72 overflow-y-auto border-t border-border">
              {activities.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">No edits in the last 7 days</p>
              ) : (
                activities.slice(0, 30).map((act, i) => {
                  const color =
                    act.direction === 'increase'
                      ? 'text-emerald-500'
                      : act.direction === 'decrease'
                        ? 'text-red-500'
                        : act.direction === 'status'
                          ? 'text-blue-400'
                          : 'text-muted-foreground'
                  let when = ''
                  try {
                    when = formatDistanceToNow(new Date(act.eventTime), { addSuffix: true })
                  } catch {
                    when = ''
                  }
                  return (
                    <div
                      key={`${act.objectId}-${act.eventTime}-${i}`}
                      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-border/50 px-4 py-2 last:border-b-0"
                    >
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{when}</span>
                      <span className="text-sm font-medium text-foreground truncate max-w-[280px]" title={act.objectName}>
                        {act.objectName || act.objectId}
                      </span>
                      <span className={`text-sm ${color}`}>{act.changeSummary}</span>
                      <span className="text-xs text-muted-foreground/70">by {act.actorName}</span>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per-ad client attribution + the Rs 150 kill queue. Needs a single
          account: ad-level insights are fetched per ad account. */}
      {selectedAccount !== 'all' && (
        <AdAttributionPanel
          accountId={selectedAccount}
          since={dateRange?.from ? dateRange.from.toISOString().slice(0, 10) : null}
          until={dateRange?.to ? dateRange.to.toISOString().slice(0, 10) : null}
        />
      )}

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
          {loadingCampaigns && filteredCampaigns.length === 0 ? (
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
                              {renderTodayEditChip(group)}
                              {renderRecBadge(groupRecommendation(group))}
                              {/* Which pages this product's clients came from */}
                              {!isUnlinked && (() => {
                                const pages = productPages[group.productName]
                                if (!pages) return null
                                const entries = Object.entries(pages).sort((a, b) => b[1] - a[1])
                                if (entries.length === 0) return null
                                const shown = entries.slice(0, 4)
                                const moreCount = entries.length - shown.length
                                return (
                                  <span className="flex flex-wrap items-center gap-1">
                                    {shown.map(([page, count]) => (
                                      <span
                                        key={page}
                                        className="inline-flex items-center gap-1 rounded bg-blue-500/10 px-1.5 py-0 text-[11px] text-blue-500"
                                        title={`${count} client${count !== 1 ? 's' : ''} from page ${page}`}
                                      >
                                        {page} {'\u00b7'} {count}
                                      </span>
                                    ))}
                                    {moreCount > 0 && (
                                      <span
                                        className="text-[11px] text-muted-foreground"
                                        title={entries.slice(4).map(([p, c]) => `${p}: ${c}`).join(', ')}
                                      >
                                        +{moreCount} more
                                      </span>
                                    )}
                                  </span>
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
                                  <div className="flex items-center gap-2">
                                    <p className="font-medium text-foreground truncate">{campaign.name}</p>
                                    {!isUnlinked &&
                                      renderRecBadge(
                                        getRecommendation({
                                          createdTime: campaign.created_time,
                                          cac: groupCac(group),
                                          hasSpend: parseFloat(campaign.spend || '0') > 0,
                                          lastEditTime: editForCampaign(campaign)?.eventTime ?? null,
                                          lastEditDirection: editForCampaign(campaign)?.direction ?? null,
                                        }),
                                        true,
                                      )}
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    {campaign.objective?.replace(/_/g, ' ')}
                                  </p>
                                  {renderCampaignBudget(campaign)}
                                  {renderLastEdit(campaign)}
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
                                {renderCostPerResult(campaign)}
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
                        {renderLastEdit(campaign)}
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
                        {renderCostPerResult(campaign)}
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
