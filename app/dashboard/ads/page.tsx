'use client'

import { useState, useEffect } from 'react'
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
} from 'lucide-react'
import { format, subDays, startOfMonth, endOfMonth, subMonths } from 'date-fns'
import { DateRange } from 'react-day-picker'

interface AdAccount {
  id: string
  name: string
  account_status: number
  currency: string
  amount_spent: string
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
  accountId?: string
  accountName?: string
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
  const [loading, setLoading] = useState(true)
  const [loadingCampaigns, setLoadingCampaigns] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  // Date range state
  const [datePreset, setDatePreset] = useState<DatePreset>('lifetime')
  const [dateRange, setDateRange] = useState<DateRange | undefined>()
  const [showCalendar, setShowCalendar] = useState(false)
  const [showTodayOnly, setShowTodayOnly] = useState(false)

  useEffect(() => {
    fetchAccounts()
  }, [])

  useEffect(() => {
    if (accounts.length > 0) {
      fetchCampaignsData()
    }
  }, [selectedAccount, accounts, datePreset, dateRange, showTodayOnly])

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
    } catch {
      setError('Failed to fetch ad accounts')
    } finally {
      setLoading(false)
    }
  }

  async function fetchCampaignsData() {
    setLoadingCampaigns(true)
    
    const buildParams = () => {
      // If "Today's Spend" is enabled, always use today's date preset
      if (showTodayOnly) {
        return 'datePreset=today'
      }
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
        } catch {
          console.error(`Failed to fetch campaigns for ${account.id}`)
        }
      }
      
      // Sort by spend
      allCampaigns.sort((a, b) => parseFloat(b.spend) - parseFloat(a.spend))
      setCampaigns(allCampaigns)
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
      } catch {
        console.error('Failed to fetch campaigns')
        setCampaigns([])
      }
    }
    
    setLoadingCampaigns(false)
  }

  const handleDatePresetChange = (preset: DatePreset) => {
    setDatePreset(preset)
    
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

  // When showTodayOnly is on, the API already returns today's data - filter for spend > 0
  const filteredCampaigns = showTodayOnly 
    ? campaigns.filter(c => parseFloat(c.spend || '0') > 0)
    : campaigns

  const totalSpend = filteredCampaigns.reduce((sum, c) => sum + parseFloat(c.spend || '0'), 0)
  const activeCampaigns = filteredCampaigns.filter(c => c.status === 'ACTIVE').length
  // Count campaigns that have spend > 0
  const campaignsWithSpendCount = campaigns.filter(c => parseFloat(c.spend || '0') > 0).length

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
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Ads Manager</h1>
            <p className="text-muted-foreground">Campaign spend overview</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => { fetchAccounts(); fetchCampaignsData(); }}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
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
            onClick={() => setShowTodayOnly(!showTodayOnly)}
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
                  <TableHead className="w-[40%]">Campaign</TableHead>
                  {selectedAccount === 'all' && <TableHead>Account</TableHead>}
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Spend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCampaigns.map((campaign) => (
                  <TableRow key={`${campaign.accountId}-${campaign.id}`}>
                    <TableCell>
                      <div>
                        <p className="font-medium text-foreground">{campaign.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {campaign.objective?.replace(/_/g, ' ')}
                        </p>
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
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
