'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { 
  Star, Search, Building2, Users, TrendingUp, TrendingDown, Minus, 
  Phone, Mail, ChevronDown, ChevronUp, Bike, Link2, Pencil, Plus
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { EditContractorDialog } from '@/components/admin/edit-contractor-dialog'
import { AddContractorDialog } from '@/components/admin/add-contractor-dialog'
import { ContractorFinanceControls } from '@/components/admin/contractor-finance-controls'

import { cn } from '@/lib/utils'
import type { Contractor, Rider } from '@/lib/types'

interface ContractorWalletData {
  balance: number
  totalEarned: number
  totalPaidOut: number
  thisMonthEarnings: number
  thisMonthDeliveries: number
  lastMonthEarnings: number
  lastMonthDeliveries: number
  recentPayouts: { amount: number; created_at: string; description: string }[]
  pendingWithdrawals: { id: string; amount: number; payment_method: string; payment_details: any; notes: string; requested_at: string }[]
}

interface ContractorWithStats extends Contractor {
  profile_id?: string | null
  riderCount: number
  riders: Rider[]
  stats: {
    total: number
    delivered: number
    undelivered: number
    postponed: number
    deliveryRate: string
    rating: number
  }
  wallet?: ContractorWalletData
}

interface Props {
  contractors: ContractorWithStats[]
  monthName: string
}

function StarRating({ rating }: { rating: number }) {
  const fullStars = Math.floor(rating)
  const hasHalfStar = rating % 1 >= 0.5
  const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0)
  
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: fullStars }).map((_, i) => (
        <Star key={`full-${i}`} className="w-4 h-4 fill-amber-400 text-amber-400" />
      ))}
      {hasHalfStar && (
        <div className="relative">
          <Star className="w-4 h-4 text-muted-foreground/30" />
          <div className="absolute inset-0 overflow-hidden w-1/2">
            <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
          </div>
        </div>
      )}
      {Array.from({ length: emptyStars }).map((_, i) => (
        <Star key={`empty-${i}`} className="w-4 h-4 text-muted-foreground/30" />
      ))}
      <span className="ml-1 text-sm font-medium text-muted-foreground">({rating.toFixed(1)})</span>
    </div>
  )
}

function PerformanceBadge({ rate }: { rate: number }) {
  if (rate >= 90) {
    return (
      <Badge className="bg-green-100 text-green-700 border-green-200">
        <TrendingUp className="w-3 h-3 mr-1" />
        Excellent
      </Badge>
    )
  } else if (rate >= 70) {
    return (
      <Badge className="bg-amber-100 text-amber-700 border-amber-200">
        <Minus className="w-3 h-3 mr-1" />
        Good
      </Badge>
    )
  } else if (rate > 0) {
    return (
      <Badge className="bg-red-100 text-red-700 border-red-200">
        <TrendingDown className="w-3 h-3 mr-1" />
        Needs Improvement
      </Badge>
    )
  } else {
    return (
      <Badge variant="secondary">
        No Data
      </Badge>
    )
  }
}

function ContractorCard({ contractor }: { contractor: ContractorWithStats }) {
  const [isOpen, setIsOpen] = useState(false)
  const isLinked = !!contractor.profile_id
  const monthlySalary = Number((contractor as any).monthly_salary || 0)

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-14 h-14 rounded-xl bg-primary/10 text-primary font-bold text-xl relative">
              {contractor.name.charAt(0).toUpperCase()}
              {isLinked && (
                <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                  <Link2 className="w-3 h-3 text-white" />
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-lg">{contractor.name}</CardTitle>
                {monthlySalary > 0 && (
                  <Badge variant="secondary" className="text-[9px] bg-blue-500/10 text-blue-500 border-blue-500/20">
                    Rs {monthlySalary.toLocaleString()}/mo
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                {contractor.phone && (
                  <span className="flex items-center gap-1">
                    <Phone className="w-3 h-3" />
                    {contractor.phone}
                  </span>
                )}
                {contractor.email && (
                  <span className="flex items-center gap-1">
                    <Mail className="w-3 h-3" />
                    {contractor.email}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <PerformanceBadge rate={parseFloat(contractor.stats.deliveryRate)} />
            {isLinked ? (
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
                <Link2 className="w-3 h-3 mr-1" />
                Linked
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
                Not Linked
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Team Size */}
        <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
          <Users className="w-5 h-5 text-primary" />
          <span className="font-medium">{contractor.riderCount} Riders</span>
        </div>
        
        {/* Rating */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-muted-foreground">Performance Rating</span>
          </div>
          <StarRating rating={contractor.stats.rating} />
        </div>
        
        {/* Delivery Rate */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-muted-foreground">Delivery Rate</span>
            <span className="text-sm font-medium">{contractor.stats.deliveryRate}%</span>
          </div>
          <Progress value={parseFloat(contractor.stats.deliveryRate)} className="h-2" />
        </div>
        
        {/* Stats */}
        <div className="grid grid-cols-4 gap-2 pt-2 border-t">
          <div className="text-center">
            <p className="text-lg font-bold">{contractor.stats.total}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-green-600">{contractor.stats.delivered}</p>
            <p className="text-xs text-muted-foreground">Delivered</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-red-600">{contractor.stats.undelivered}</p>
            <p className="text-xs text-muted-foreground">Failed</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-amber-600">{contractor.stats.postponed}</p>
            <p className="text-xs text-muted-foreground">Postponed</p>
          </div>
        </div>

        {/* Contractor Finance Controls */}
        <ContractorFinanceControls
          contractorId={contractor.id}
          contractorName={contractor.name}
          currentRate={Number((contractor as any).rate_per_delivery || 0)}
          payType={(contractor as any).pay_type || 'per_delivery'}
          monthlySalary={Number((contractor as any).monthly_salary || 0)}
          totalEarned={contractor.wallet?.totalEarned || 0}
          totalDeliveries={contractor.stats.total}
          totalPaidOut={contractor.wallet?.totalPaidOut || 0}
          balance={contractor.wallet?.balance || 0}
          thisMonthEarnings={contractor.wallet?.thisMonthEarnings || 0}
          thisMonthDeliveries={contractor.wallet?.thisMonthDeliveries || contractor.stats.delivered}
          lastMonthEarnings={contractor.wallet?.lastMonthEarnings || 0}
          lastMonthDeliveries={contractor.wallet?.lastMonthDeliveries || 0}
          recentPayouts={contractor.wallet?.recentPayouts || []}
          pendingWithdrawals={contractor.wallet?.pendingWithdrawals || []}
        />

        {/* Riders Collapsible */}
        {contractor.riders.length > 0 && (
          <Collapsible open={isOpen} onOpenChange={setIsOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" className="w-full justify-between bg-transparent">
                <span className="flex items-center gap-2">
                  <Bike className="w-4 h-4" />
                  View Riders ({contractor.riderCount})
                </span>
                {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3">
              <div className="space-y-2 p-3 rounded-lg bg-muted/30 border">
                {contractor.riders.map(rider => (
                  <div key={rider.id} className="p-3 rounded-lg bg-background border border-border/50">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-medium text-sm">
                        {rider.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{rider.name}</p>
                        {rider.phone && (
                          <p className="text-xs text-muted-foreground">{rider.phone}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Edit Button */}
        <div className="pt-3 border-t">
          <EditContractorDialog 
            contractor={{ ...contractor, riderCount: contractor.riderCount }}
            trigger={
              <Button variant="outline" size="sm" className="w-full bg-transparent">
                <Pencil className="w-4 h-4 mr-2" />
                Edit Contractor
              </Button>
            }
          />
        </div>
      </CardContent>
    </Card>
  )
}

export function ContractorsOverview({ contractors, monthName }: Props) {
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'rating' | 'riders' | 'deliveries'>('rating')

  // Filter and sort contractors
  const filteredContractors = contractors
    .filter(contractor => contractor.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'rating') return b.stats.rating - a.stats.rating
      if (sortBy === 'riders') return b.riderCount - a.riderCount
      if (sortBy === 'deliveries') return b.stats.total - a.stats.total
      return 0
    })

  // Calculate overall stats
  const totalContractors = filteredContractors.length
  const totalRiders = filteredContractors.reduce((sum, c) => sum + c.riderCount, 0)
  const avgRating = totalContractors > 0 
    ? filteredContractors.reduce((sum, c) => sum + c.stats.rating, 0) / totalContractors 
    : 0
  const totalDeliveries = filteredContractors.reduce((sum, c) => sum + c.stats.total, 0)

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100">
                <Building2 className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Contractors</p>
                <p className="text-2xl font-bold">{totalContractors}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100">
                <Users className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Riders</p>
                <p className="text-2xl font-bold">{totalRiders}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100">
                <Star className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Avg Rating</p>
                <p className="text-2xl font-bold">{avgRating.toFixed(1)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100">
                <TrendingUp className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Deliveries ({monthName})</p>
                <p className="text-2xl font-bold">{totalDeliveries.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search contractors..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <SelectTrigger className="w-full md:w-[200px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rating">Sort by Rating</SelectItem>
                <SelectItem value="riders">Sort by Rider Count</SelectItem>
                <SelectItem value="deliveries">Sort by Deliveries</SelectItem>
                <SelectItem value="name">Sort by Name</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Contractors Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredContractors.map(contractor => (
          <ContractorCard key={contractor.id} contractor={contractor} />
        ))}
      </div>

      {filteredContractors.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <Building2 className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">No contractors found matching your search</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
