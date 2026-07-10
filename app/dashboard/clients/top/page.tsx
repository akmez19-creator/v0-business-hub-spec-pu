import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Trophy, Banknote, Package, ThumbsUp } from 'lucide-react'
import { CLIENT_STATUS_LABELS, CLIENT_STATUS_COLORS } from '@/lib/types'
import type { Client } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function TopClientsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const adminDb = createAdminClient()
  const { data: profile } = await adminDb
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    redirect('/dashboard')
  }

  // Top 100 by lifetime sales — a single indexed ORDER BY ... LIMIT query
  const { data } = await adminDb
    .from('clients')
    .select('*')
    .gt('total_sales', 0)
    .order('total_sales', { ascending: false })
    .limit(100)

  const top = (data || []) as Client[]

  const totalSales = top.reduce((s, c) => s + Number(c.total_sales || 0), 0)
  const totalOrders = top.reduce((s, c) => s + (c.total_orders || 0), 0)
  const goodCount = top.filter(c => c.client_status === 'good').length

  const rankStyle = (i: number) => {
    if (i === 0) return 'bg-warning/15 text-warning-foreground font-bold'
    if (i === 1) return 'bg-muted font-bold'
    if (i === 2) return 'bg-accent/60 font-bold'
    return 'text-muted-foreground'
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Top 100 Clients</h1>
        <p className="text-muted-foreground">Ranked by lifetime sales from delivered orders</p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Clients Ranked</CardTitle>
            <Trophy className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{top.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Combined Sales</CardTitle>
            <Banknote className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Rs {totalSales.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Combined Orders</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalOrders.toLocaleString()}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Rated Good</CardTitle>
            <ThumbsUp className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">{goodCount}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ranking</CardTitle>
          <CardDescription>Best customers by total delivered sales</CardDescription>
        </CardHeader>
        <CardContent>
          {top.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center text-center">
              <p className="text-muted-foreground">No client sales data yet</p>
              <p className="text-sm text-muted-foreground">Import past order history from the Clients page to populate this ranking</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14">#</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Region</TableHead>
                    <TableHead>Rating</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Delivered</TableHead>
                    <TableHead className="text-right">CMS</TableHead>
                    <TableHead className="text-right">Total Sales</TableHead>
                    <TableHead>Last Order</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {top.map((c, i) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-xs ${rankStyle(i)}`}>
                          {i + 1}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-sm">{c.phone || '-'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.region || c.city || '-'}</TableCell>
                      <TableCell>
                        <Badge className={CLIENT_STATUS_COLORS[c.client_status] || CLIENT_STATUS_COLORS.new}>
                          {CLIENT_STATUS_LABELS[c.client_status] || 'New'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm">{(c.total_orders || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right text-sm text-success">{(c.delivered_orders || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right text-sm text-destructive">{(c.cms_orders || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-right text-sm font-semibold">Rs {Number(c.total_sales || 0).toLocaleString()}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.last_order_date
                          ? new Date(c.last_order_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                          : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
