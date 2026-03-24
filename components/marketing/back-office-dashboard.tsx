'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { 
  Truck, 
  TrendingUp, 
  Package, 
  CheckCircle2,
  Clock,
  BarChart3,
  Download,
} from 'lucide-react'
import type { Profile } from '@/lib/types'

interface Props {
  profile: Profile
  stats: {
    todayDeliveries: number
    deliveredCount: number
    totalSales: number
    totalStock: number
  }
  recentDeliveries: {
    id: string
    customer_name: string | null
    amount: number | null
    status: string
    delivery_date: string | null
    products: string | null
  }[]
}

const fmtRs = (n: number) => `Rs ${n.toLocaleString()}`

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20',
  assigned: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
  picked_up: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
  delivered: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  nwd: 'bg-red-500/10 text-red-500 border-red-500/20',
  cms: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
}

export function MarketingBackOfficeDashboard({ profile, stats, recentDeliveries }: Props) {
  const deliveryRate = stats.todayDeliveries > 0 
    ? Math.round((stats.deliveredCount / stats.todayDeliveries) * 100) 
    : 0

  return (
    <div className="min-h-screen bg-background p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Marketing Back Office</h1>
        <p className="text-muted-foreground mt-1">
          Welcome back, {profile.name || profile.email}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card className="bg-gradient-to-br from-violet-500/10 to-violet-500/5 border-violet-500/20">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Today's Deliveries</p>
                <p className="text-3xl font-bold mt-1">{stats.todayDeliveries}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-violet-500/20 flex items-center justify-center">
                <Truck className="w-6 h-6 text-violet-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border-emerald-500/20">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Delivered</p>
                <p className="text-3xl font-bold mt-1">{stats.deliveredCount}</p>
                <p className="text-xs text-emerald-500 mt-1">{deliveryRate}% completion</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-cyan-500/10 to-cyan-500/5 border-cyan-500/20">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Today's Sales</p>
                <p className="text-3xl font-bold mt-1">{fmtRs(stats.totalSales)}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-cyan-500/20 flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-cyan-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500/10 to-orange-500/5 border-orange-500/20">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Stock</p>
                <p className="text-3xl font-bold mt-1">{stats.totalStock.toLocaleString()}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-orange-500/20 flex items-center justify-center">
                <Package className="w-6 h-6 text-orange-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <Card className="col-span-1 lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              Recent Deliveries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentDeliveries.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No recent deliveries</p>
              ) : (
                recentDeliveries.map((delivery) => (
                  <div 
                    key={delivery.id} 
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{delivery.customer_name || 'Unknown'}</p>
                      <p className="text-xs text-muted-foreground truncate">{delivery.products || 'No products'}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className={statusColors[delivery.status] || ''}>
                        {delivery.status}
                      </Badge>
                      <span className="font-semibold text-sm">
                        {fmtRs(Number(delivery.amount || 0))}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <a 
              href="/dashboard/marketing-back-office/orders"
              className="flex items-center gap-3 p-3 rounded-lg bg-violet-500/10 hover:bg-violet-500/20 transition-colors group"
            >
              <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center">
                <Package className="w-5 h-5 text-violet-500" />
              </div>
              <div>
                <p className="font-medium group-hover:text-violet-500 transition-colors">Create Order</p>
                <p className="text-xs text-muted-foreground">Add new delivery order</p>
              </div>
            </a>
            
            <a 
              href="/dashboard/marketing-back-office/stock"
              className="flex items-center gap-3 p-3 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 transition-colors group"
            >
              <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                <Package className="w-5 h-5 text-cyan-500" />
              </div>
              <div>
                <p className="font-medium group-hover:text-cyan-500 transition-colors">View Stock</p>
                <p className="text-xs text-muted-foreground">Check inventory levels</p>
              </div>
            </a>
            
            <a 
              href="/dashboard/marketing-back-office/sales"
              className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors group"
            >
              <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <p className="font-medium group-hover:text-emerald-500 transition-colors">Sales Report</p>
                <p className="text-xs text-muted-foreground">View sales analytics</p>
              </div>
            </a>
            
            <a 
              href="/dashboard/tools"
              className="flex items-center gap-3 p-3 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 transition-colors group"
            >
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <Download className="w-5 h-5 text-purple-500" />
              </div>
              <div>
                <p className="font-medium group-hover:text-purple-500 transition-colors">Download Tools</p>
                <p className="text-xs text-muted-foreground">Get browser extension</p>
              </div>
            </a>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
