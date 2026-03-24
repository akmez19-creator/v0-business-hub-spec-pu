import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { SalesReportView } from '@/components/marketing/sales-report-view'

export default async function SalesReportPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile || (profile.role !== 'marketing_back_office' && profile.role !== 'admin')) {
    redirect('/dashboard')
  }

  // Get last 30 days of deliveries
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  
  const { data: deliveries } = await supabase
    .from('deliveries')
    .select('id, delivery_date, amount, status, products, payment_method')
    .eq('status', 'delivered')
    .gte('delivery_date', thirtyDaysAgo.toISOString().split('T')[0])
    .order('delivery_date', { ascending: false })

  // Calculate daily totals
  const dailyTotals = new Map<string, number>()
  deliveries?.forEach(d => {
    if (d.delivery_date) {
      const current = dailyTotals.get(d.delivery_date) || 0
      dailyTotals.set(d.delivery_date, current + Number(d.amount || 0))
    }
  })

  // Get top products
  const productCounts = new Map<string, { count: number, revenue: number }>()
  deliveries?.forEach(d => {
    const products = d.products?.split(',').map(p => p.trim()) || []
    products.forEach(product => {
      if (product) {
        const current = productCounts.get(product) || { count: 0, revenue: 0 }
        productCounts.set(product, {
          count: current.count + 1,
          revenue: current.revenue + Number(d.amount || 0) / products.length
        })
      }
    })
  })

  const topProducts = Array.from(productCounts.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([name, data]) => ({ name, ...data }))

  return (
    <SalesReportView
      deliveries={deliveries || []}
      dailyTotals={Array.from(dailyTotals.entries()).map(([date, total]) => ({ date, total }))}
      topProducts={topProducts}
    />
  )
}
