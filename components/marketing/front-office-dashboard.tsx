'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { 
  ShoppingCart, 
  Users, 
  Clock,
  FileText,
  Plus,
  Phone,
  Download,
} from 'lucide-react'
import type { Profile } from '@/lib/types'

interface Props {
  profile: Profile
  stats: {
    todayOrders: number
    totalClients: number
    pendingFollowUps: number
  }
  recentOrders: {
    id: string
    customer_name: string | null
    amount: number | null
    status: string
    created_at: string
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

export function MarketingFrontOfficeDashboard({ profile, stats, recentOrders }: Props) {
  return (
    <div className="min-h-screen bg-background p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Marketing Front Office</h1>
        <p className="text-muted-foreground mt-1">
          Welcome back, {profile.name || profile.email}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card className="bg-gradient-to-br from-pink-500/10 to-pink-500/5 border-pink-500/20">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Today's Orders</p>
                <p className="text-3xl font-bold mt-1">{stats.todayOrders}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-pink-500/20 flex items-center justify-center">
                <ShoppingCart className="w-6 h-6 text-pink-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-500/10 to-blue-500/5 border-blue-500/20">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Clients</p>
                <p className="text-3xl font-bold mt-1">{stats.totalClients.toLocaleString()}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
                <Users className="w-6 h-6 text-blue-500" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-500/10 to-amber-500/5 border-amber-500/20">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending Follow-ups</p>
                <p className="text-3xl font-bold mt-1">{stats.pendingFollowUps}</p>
              </div>
              <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center">
                <Phone className="w-6 h-6 text-amber-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5" />
              Quick Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <a 
              href="/dashboard/marketing-front-office/orders"
              className="flex items-center gap-3 p-4 rounded-lg bg-pink-500/10 hover:bg-pink-500/20 transition-colors group"
            >
              <div className="w-12 h-12 rounded-xl bg-pink-500/20 flex items-center justify-center">
                <ShoppingCart className="w-6 h-6 text-pink-500" />
              </div>
              <div>
                <p className="font-semibold group-hover:text-pink-500 transition-colors">New Order</p>
                <p className="text-sm text-muted-foreground">Create a new delivery order</p>
              </div>
            </a>
            
            <a 
              href="/dashboard/marketing-front-office/clients"
              className="flex items-center gap-3 p-4 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 transition-colors group"
            >
              <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
                <Users className="w-6 h-6 text-blue-500" />
              </div>
              <div>
                <p className="font-semibold group-hover:text-blue-500 transition-colors">Clients</p>
                <p className="text-sm text-muted-foreground">View and manage clients</p>
              </div>
            </a>
            
            <a 
              href="/dashboard/marketing-front-office/follow-up"
              className="flex items-center gap-3 p-4 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 transition-colors group"
            >
              <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center">
                <Phone className="w-6 h-6 text-amber-500" />
              </div>
              <div>
                <p className="font-semibold group-hover:text-amber-500 transition-colors">Follow Up</p>
                <p className="text-sm text-muted-foreground">Pending orders to follow up</p>
              </div>
            </a>
            
            <a 
              href="/dashboard/tools"
              className="flex items-center gap-3 p-4 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 transition-colors group"
            >
              <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center">
                <Download className="w-6 h-6 text-purple-500" />
              </div>
              <div>
                <p className="font-semibold group-hover:text-purple-500 transition-colors">Download Tools</p>
                <p className="text-sm text-muted-foreground">Get browser extension</p>
              </div>
            </a>
          </CardContent>
        </Card>

        {/* Recent Orders */}
        <Card className="col-span-1 lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5" />
              My Recent Orders
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentOrders.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">No orders yet</p>
                  <a 
                    href="/dashboard/marketing-front-office/orders"
                    className="text-pink-500 hover:underline text-sm mt-2 inline-block"
                  >
                    Create your first order
                  </a>
                </div>
              ) : (
                recentOrders.map((order) => (
                  <div 
                    key={order.id} 
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{order.customer_name || 'Unknown'}</p>
                      <p className="text-xs text-muted-foreground truncate">{order.products || 'No products'}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className={statusColors[order.status] || ''}>
                        {order.status}
                      </Badge>
                      <span className="font-semibold text-sm">
                        {fmtRs(Number(order.amount || 0))}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
