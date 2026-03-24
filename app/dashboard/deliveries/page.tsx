import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { DeliveryDashboard } from '@/components/deliveries/delivery-dashboard'

export default async function DeliveriesDashboardPage() {
  const supabase = await createClient()
  const adminDb = createAdminClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  
  const { data: profile } = await adminDb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()
  
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    redirect('/dashboard')
  }

  // Helper function to calculate period stats
  function calculatePeriodStats(data: { status: string; amount: number; entry_date: string; delivery_date: string }[]) {
    const total = data.length
    const delivered = data.filter(d => d.status === 'delivered').length
    const nwd = data.filter(d => d.status === 'nwd').length
    const cms = data.filter(d => d.status === 'cms').length
    const undelivered = nwd + cms
    const undeliveredPercent = total > 0 ? ((undelivered / total) * 100).toFixed(1) : '0'
    const postponed = data.filter(d => d.entry_date && d.delivery_date && d.entry_date !== d.delivery_date).length
    const postponedPercent = total > 0 ? ((postponed / total) * 100).toFixed(1) : '0'
    const amount = data.reduce((sum, d) => sum + (d.amount || 0), 0)
    return { total, delivered, undelivered, undeliveredPercent, postponed, postponedPercent, amount }
  }

  // Date calculations
  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  
  // Week start (Monday) and end (Sunday)
  const dayOfWeek = today.getDay()
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const weekStart = new Date(today)
  weekStart.setDate(today.getDate() + diffToMonday)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  const weekStartStr = weekStart.toISOString().split('T')[0]
  const weekEndStr = weekEnd.toISOString().split('T')[0]

  // Month start and end
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0]
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0]
  const monthName = today.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  // 3 months ago
  const threeMonthsAgo = new Date(today)
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
  const threeMonthStartStr = threeMonthsAgo.toISOString().split('T')[0]

  // Fetch all data for 3 months
  const { data: allPeriodData } = await adminDb
    .from('deliveries')
    .select('status, amount, entry_date, delivery_date')
    .gte('delivery_date', threeMonthStartStr)
    .lte('delivery_date', todayStr)

  // Filter data for each period
  const todayData = (allPeriodData || []).filter(d => d.delivery_date === todayStr)
  const weekData = (allPeriodData || []).filter(d => d.delivery_date >= weekStartStr && d.delivery_date <= weekEndStr)
  const monthData = (allPeriodData || []).filter(d => d.delivery_date >= monthStart && d.delivery_date <= monthEnd)
  const threeMonthData = allPeriodData || []

  // Calculate stats for each period
  const dailyStatsCalc = calculatePeriodStats(todayData)
  const weeklyStatsCalc = calculatePeriodStats(weekData)
  const monthlyStatsCalc = calculatePeriodStats(monthData)
  const threeMonthStatsCalc = calculatePeriodStats(threeMonthData)

  // Generate chart data for daily
  const dailyChartData = [
    { date: todayStr, label: 'Today', delivered: dailyStatsCalc.delivered, undelivered: dailyStatsCalc.undelivered, postponed: dailyStatsCalc.postponed, total: dailyStatsCalc.total, amount: dailyStatsCalc.amount }
  ]

  // Generate chart data for weekly (7 days)
  const weeklyChartData = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart)
    date.setDate(weekStart.getDate() + i)
    const dateStr = date.toISOString().split('T')[0]
    const dayData = (allPeriodData || []).filter(d => d.delivery_date === dateStr)
    const stats = calculatePeriodStats(dayData)
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    return {
      date: date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' }),
      label: dayNames[date.getDay()],
      delivered: stats.delivered,
      undelivered: stats.undelivered,
      postponed: stats.postponed,
      total: stats.total,
      amount: stats.amount
    }
  })

  // Generate chart data for monthly
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  const monthlyChartData = Array.from({ length: daysInMonth }, (_, i) => {
    const date = new Date(today.getFullYear(), today.getMonth(), i + 1)
    const dateStr = date.toISOString().split('T')[0]
    const dayData = (allPeriodData || []).filter(d => d.delivery_date === dateStr)
    const stats = calculatePeriodStats(dayData)
    return {
      date: date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }),
      label: String(i + 1),
      delivered: stats.delivered,
      undelivered: stats.undelivered,
      postponed: stats.postponed,
      total: stats.total,
      amount: stats.amount
    }
  })

  // Generate chart data for 3 months (weekly aggregates)
  const threeMonthChartData: { date: string; label: string; delivered: number; undelivered: number; postponed: number; total: number; amount: number }[] = []
  const weekCursor = new Date(threeMonthsAgo)
  while (weekCursor <= today) {
    const weekEndCursor = new Date(weekCursor)
    weekEndCursor.setDate(weekCursor.getDate() + 6)
    const startStr = weekCursor.toISOString().split('T')[0]
    const endStr = weekEndCursor.toISOString().split('T')[0]
    const weekDataChunk = (allPeriodData || []).filter(d => d.delivery_date >= startStr && d.delivery_date <= endStr)
    const stats = calculatePeriodStats(weekDataChunk)
    threeMonthChartData.push({
      date: `${weekCursor.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}`,
      label: `W${threeMonthChartData.length + 1}`,
      delivered: stats.delivered,
      undelivered: stats.undelivered,
      postponed: stats.postponed,
      total: stats.total,
      amount: stats.amount
    })
    weekCursor.setDate(weekCursor.getDate() + 7)
  }

  // Prepare dashboard props
  const dashboardData = {
    dailyStats: {
      ...dailyStatsCalc,
      periodLabel: today.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      chartData: dailyChartData
    },
    weeklyStats: {
      ...weeklyStatsCalc,
      periodLabel: `${weekStart.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} - ${weekEnd.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}`,
      chartData: weeklyChartData
    },
    monthlyStats: {
      ...monthlyStatsCalc,
      periodLabel: monthName,
      chartData: monthlyChartData
    },
    threeMonthStats: {
      ...threeMonthStatsCalc,
      periodLabel: `${threeMonthsAgo.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} - ${today.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`,
      chartData: threeMonthChartData
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Delivery Dashboard</h2>
        <p className="text-muted-foreground">
          Overview of delivery performance and analytics
        </p>
      </div>
      
      <DeliveryDashboard
        dailyStats={dashboardData.dailyStats}
        weeklyStats={dashboardData.weeklyStats}
        monthlyStats={dashboardData.monthlyStats}
        threeMonthStats={dashboardData.threeMonthStats}
      />
    </div>
  )
}
