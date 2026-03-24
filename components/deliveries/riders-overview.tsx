'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Star, Search, Users, TrendingUp, TrendingDown, Minus, Phone, Building2, Link2, Pencil, Plus } from 'lucide-react'
import { EditRiderDialog } from '@/components/admin/edit-rider-dialog'
import { AddRiderDialog } from '@/components/admin/add-rider-dialog'
import type { Rider, Contractor } from '@/lib/types'

interface RiderWithStats extends Rider {
  profile_id?: string | null
  stats: {
    total: number
    delivered: number
    undelivered: number
    postponed: number
    deliveryRate: string
    rating: number
  }
}

interface Props {
  riders: RiderWithStats[]
  contractors: Contractor[]
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
  } else {
    return (
      <Badge className="bg-red-100 text-red-700 border-red-200">
        <TrendingDown className="w-3 h-3 mr-1" />
        Needs Improvement
      </Badge>
    )
  }
}

export function RidersOverview({ riders, contractors, monthName }: Props) {
  const [search, setSearch] = useState('')
  const [contractorFilter, setContractorFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'name' | 'rating' | 'deliveries'>('rating')

  // Filter riders
  const filteredRiders = riders
    .filter(rider => {
      const matchesSearch = rider.name.toLowerCase().includes(search.toLowerCase())
      const matchesContractor = contractorFilter === 'all' || rider.contractor_id === contractorFilter
      return matchesSearch && matchesContractor
    })
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'rating') return b.stats.rating - a.stats.rating
      if (sortBy === 'deliveries') return b.stats.total - a.stats.total
      return 0
    })

  // Calculate overall stats
  const totalRiders = filteredRiders.length
  const avgRating = totalRiders > 0 
    ? filteredRiders.reduce((sum, r) => sum + r.stats.rating, 0) / totalRiders 
    : 0
  const totalDeliveries = filteredRiders.reduce((sum, r) => sum + r.stats.total, 0)
  const totalDelivered = filteredRiders.reduce((sum, r) => sum + r.stats.delivered, 0)

  // Get contractor name
  const getContractorName = (contractorId: string | null) => {
    if (!contractorId) return null
    return contractors.find(c => c.id === contractorId)?.name || 'Unknown'
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100">
                <Users className="w-5 h-5 text-blue-600" />
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
                <p className="text-sm text-muted-foreground">Delivered ({monthName})</p>
                <p className="text-2xl font-bold">{totalDelivered.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100">
                <TrendingUp className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Assignments</p>
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
                placeholder="Search riders..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            
            <Select value={contractorFilter} onValueChange={setContractorFilter}>
              <SelectTrigger className="w-full md:w-[200px]">
                <SelectValue placeholder="Filter by contractor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Contractors</SelectItem>
                <SelectItem value="none">No Contractor</SelectItem>
                {contractors.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rating">Sort by Rating</SelectItem>
                <SelectItem value="deliveries">Sort by Deliveries</SelectItem>
                <SelectItem value="name">Sort by Name</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Riders Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredRiders.map(rider => (
          <Card key={rider.id} className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary font-bold text-lg relative">
                    {rider.name.charAt(0).toUpperCase()}
                    {rider.profile_id && (
                      <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                        <Link2 className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </div>
                  <div>
                    <CardTitle className="text-lg">{rider.name}</CardTitle>
                    {rider.phone && (
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {rider.phone}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <PerformanceBadge rate={parseFloat(rider.stats.deliveryRate)} />
                  {rider.profile_id ? (
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
              {/* Contractor */}
              {rider.contractor_id && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Building2 className="w-4 h-4" />
                  <span>{getContractorName(rider.contractor_id)}</span>
                </div>
              )}
              
              {/* Rating */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-muted-foreground">Performance Rating</span>
                </div>
                <StarRating rating={rider.stats.rating} />
              </div>
              
              {/* Delivery Rate */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-muted-foreground">Delivery Rate</span>
                  <span className="text-sm font-medium">{rider.stats.deliveryRate}%</span>
                </div>
                <Progress value={parseFloat(rider.stats.deliveryRate)} className="h-2" />
              </div>
              
              {/* Stats */}
              <div className="grid grid-cols-4 gap-2 pt-2 border-t">
                <div className="text-center">
                  <p className="text-lg font-bold">{rider.stats.total}</p>
                  <p className="text-xs text-muted-foreground">Total</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-green-600">{rider.stats.delivered}</p>
                  <p className="text-xs text-muted-foreground">Delivered</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-red-600">{rider.stats.undelivered}</p>
                  <p className="text-xs text-muted-foreground">Failed</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-amber-600">{rider.stats.postponed}</p>
                  <p className="text-xs text-muted-foreground">Postponed</p>
                </div>
              </div>

              {/* Edit Button */}
              <div className="pt-3 border-t">
                <EditRiderDialog 
                  rider={rider} 
                  contractors={contractors}
                  trigger={
                    <Button variant="outline" size="sm" className="w-full bg-transparent">
                      <Pencil className="w-4 h-4 mr-2" />
                      Edit Rider
                    </Button>
                  }
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredRiders.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <Users className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">No riders found matching your filters</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
