'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Package, CheckCircle, XCircle, Calendar, TrendingUp, CalendarDays, CalendarRange } from 'lucide-react'
import { Bar, BarChart, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Line, LineChart, CartesianGrid, Legend } from 'recharts'

interface DailyData {
  date: string
  label: string
  delivered: number
  undelivered: number
  postponed: number
  total: number
  amount: number
}

interface PeriodStats {
  total: number
  delivered: number
  undelivered: number
  undeliveredPercent: string
  postponed: number
  postponedPercent: string
  amount: number
  periodLabel: string
}

interface Props {
  dailyStats: PeriodStats & { chartData: DailyData[] }
  weeklyStats: PeriodStats & { chartData: DailyData[] }
  monthlyStats: PeriodStats & { chartData: DailyData[] }
  threeMonthStats: PeriodStats & { chartData: DailyData[] }
}

function StatCards({ stats }: { stats: PeriodStats }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Card className="border-2">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-100">
              <Package className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-2xl font-bold">{stats.total.toLocaleString()}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-2">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-green-100">
              <CheckCircle className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Delivered</p>
              <p className="text-2xl font-bold">{stats.delivered.toLocaleString()}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-2">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-red-100">
              <XCircle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Undelivered</p>
              <p className="text-2xl font-bold">
                {stats.undeliveredPercent}%
                <span className="text-sm font-normal text-muted-foreground ml-1">
                  ({stats.undelivered})
                </span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-2">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-100">
              <Calendar className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Postponed</p>
              <p className="text-2xl font-bold">
                {stats.postponedPercent}%
                <span className="text-sm font-normal text-muted-foreground ml-1">
                  ({stats.postponed})
                </span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function DeliveryChart({ data, showLine = false }: { data: DailyData[], showLine?: boolean }) {
  if (showLine) {
    return (
      <div className="h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis 
              dataKey="label" 
              tick={{ fontSize: 11 }} 
              tickLine={false}
              axisLine={false}
            />
            <YAxis 
              tick={{ fontSize: 11 }} 
              tickLine={false}
              axisLine={false}
              width={40}
            />
            <Tooltip 
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const d = payload[0].payload as DailyData
                  return (
                    <div className="bg-popover border rounded-lg shadow-lg p-3">
                      <p className="font-medium text-sm">{d.date}</p>
                      <p className="text-green-600 text-sm">Delivered: {d.delivered}</p>
                      <p className="text-red-500 text-sm">Undelivered: {d.undelivered}</p>
                      <p className="text-amber-600 text-sm">Postponed: {d.postponed}</p>
                      <p className="text-muted-foreground text-xs mt-1">Total: {d.total}</p>
                    </div>
                  )
                }
                return null
              }}
            />
            <Legend />
            <Line type="monotone" dataKey="delivered" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} name="Delivered" />
            <Line type="monotone" dataKey="undelivered" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} name="Undelivered" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    )
  }

  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <XAxis 
            dataKey="label" 
            tick={{ fontSize: 11 }} 
            tickLine={false}
            axisLine={false}
          />
          <YAxis 
            tick={{ fontSize: 11 }} 
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip 
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const d = payload[0].payload as DailyData
                return (
                  <div className="bg-popover border rounded-lg shadow-lg p-3">
                    <p className="font-medium text-sm">{d.date}</p>
                    <p className="text-green-600 text-sm">Delivered: {d.delivered}</p>
                    <p className="text-red-500 text-sm">Undelivered: {d.undelivered}</p>
                    <p className="text-amber-600 text-sm">Postponed: {d.postponed}</p>
                    <p className="text-muted-foreground text-xs mt-1">Total: {d.total}</p>
                  </div>
                )
              }
              return null
            }}
          />
          <Bar dataKey="delivered" radius={[4, 4, 0, 0]} stackId="a" fill="#22c55e" name="Delivered" />
          <Bar dataKey="undelivered" radius={[4, 4, 0, 0]} stackId="a" fill="#ef4444" name="Undelivered" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function DeliveryDashboard({ dailyStats, weeklyStats, monthlyStats, threeMonthStats }: Props) {
  const [activeTab, setActiveTab] = useState('daily')

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-4 h-12">
          <TabsTrigger value="daily" className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4" />
            <span className="hidden sm:inline">Daily</span>
          </TabsTrigger>
          <TabsTrigger value="weekly" className="flex items-center gap-2">
            <CalendarRange className="w-4 h-4" />
            <span className="hidden sm:inline">Weekly</span>
          </TabsTrigger>
          <TabsTrigger value="monthly" className="flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            <span className="hidden sm:inline">Monthly</span>
          </TabsTrigger>
          <TabsTrigger value="quarter" className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            <span className="hidden sm:inline">3 Months</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="daily" className="space-y-4 mt-4">
          <div className="text-sm text-muted-foreground">
            Showing data for: <span className="font-medium text-foreground">{dailyStats.periodLabel}</span>
          </div>
          <StatCards stats={dailyStats} />
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Today&apos;s Deliveries by Hour</CardTitle>
            </CardHeader>
            <CardContent>
              <DeliveryChart data={dailyStats.chartData} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="weekly" className="space-y-4 mt-4">
          <div className="text-sm text-muted-foreground">
            Showing data for: <span className="font-medium text-foreground">{weeklyStats.periodLabel}</span>
          </div>
          <StatCards stats={weeklyStats} />
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">This Week - Daily Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <DeliveryChart data={weeklyStats.chartData} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="monthly" className="space-y-4 mt-4">
          <div className="text-sm text-muted-foreground">
            Showing data for: <span className="font-medium text-foreground">{monthlyStats.periodLabel}</span>
          </div>
          <StatCards stats={monthlyStats} />
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">This Month - Daily Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <DeliveryChart data={monthlyStats.chartData} showLine />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quarter" className="space-y-4 mt-4">
          <div className="text-sm text-muted-foreground">
            Showing data for: <span className="font-medium text-foreground">{threeMonthStats.periodLabel}</span>
          </div>
          <StatCards stats={threeMonthStats} />
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Last 3 Months - Weekly Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <DeliveryChart data={threeMonthStats.chartData} showLine />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
