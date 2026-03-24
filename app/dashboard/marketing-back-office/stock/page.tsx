import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { MarketingStockView } from '@/components/marketing/stock-view'

export default async function MarketingStockPage() {
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

  // Get all stock items
  const { data: stockItems } = await supabase
    .from('stock_items')
    .select('*')
    .order('name', { ascending: true })

  // Get stock categories
  const { data: categories } = await supabase
    .from('stock_categories')
    .select('*')
    .order('name', { ascending: true })

  return (
    <MarketingStockView
      stockItems={stockItems || []}
      categories={categories || []}
    />
  )
}
