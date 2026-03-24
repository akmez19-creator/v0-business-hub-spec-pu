'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Search, X, CalendarDays } from 'lucide-react'
import { STATUS_LABELS } from '@/lib/types'
import { Label } from '@/components/ui/label'

interface Props {
  regions: string[]
  riders: { id: string; name: string | null }[]
}

export function DeliveryFilters({ regions, riders }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  
  const currentStatus = searchParams.get('status') || 'all'
  const currentRegion = searchParams.get('region') || 'all'
  const currentRider = searchParams.get('rider') || 'all'
  const currentEntryDate = searchParams.get('entry_date') || ''
  const currentDeliveryDate = searchParams.get('delivery_date') || ''
  const currentSearch = searchParams.get('search') || ''

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value && value !== 'all') {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  function clearFilters() {
    router.push(pathname)
  }

  const hasFilters = currentStatus !== 'all' || currentRegion !== 'all' || currentRider !== 'all' || currentEntryDate || currentDeliveryDate || currentSearch

  return (
    <div className="space-y-4 p-4 bg-card rounded-lg border">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
        {/* Search */}
        <div className="flex-1 space-y-1.5">
          <Label className="text-xs text-muted-foreground">Search</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Customer, contact, region, product..."
              value={currentSearch}
              onChange={(e) => updateFilter('search', e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        
        {/* Status Filter */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select value={currentStatus} onValueChange={(v) => updateFilter('status', v)}>
            <SelectTrigger className="w-full lg:w-[150px]">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        {/* Rider Filter */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Rider</Label>
          <Select value={currentRider} onValueChange={(v) => updateFilter('rider', v)}>
            <SelectTrigger className="w-full lg:w-[150px]">
              <SelectValue placeholder="All Riders" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Riders</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {riders.map((rider) => (
                <SelectItem key={rider.id} value={rider.id}>
                  {rider.name || 'Unnamed'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        {/* Region Filter */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Region</Label>
          <Select value={currentRegion} onValueChange={(v) => updateFilter('region', v)}>
            <SelectTrigger className="w-full lg:w-[150px]">
              <SelectValue placeholder="All Regions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Regions</SelectItem>
              {regions.map((region) => (
                <SelectItem key={region} value={region}>{region}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      
      {/* Date Filters Row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground flex items-center gap-1">
            <CalendarDays className="w-3 h-3" />
            Entry Date
          </Label>
          <Input
            type="date"
            value={currentEntryDate}
            onChange={(e) => updateFilter('entry_date', e.target.value)}
            className="w-full sm:w-[160px]"
          />
        </div>
        
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground flex items-center gap-1">
            <CalendarDays className="w-3 h-3" />
            Delivery Date
          </Label>
          <Input
            type="date"
            value={currentDeliveryDate}
            onChange={(e) => updateFilter('delivery_date', e.target.value)}
            className="w-full sm:w-[160px]"
          />
        </div>
        
        {hasFilters && (
          <Button variant="outline" size="sm" onClick={clearFilters} className="h-10 bg-transparent">
            <X className="w-4 h-4 mr-1" />
            Clear Filters
          </Button>
        )}
      </div>
    </div>
  )
}
