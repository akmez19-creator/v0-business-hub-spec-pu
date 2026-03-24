import React from 'react'
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { StorekeeperMobileLayout } from '@/components/storekeeper/mobile-layout'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function StorekeeperLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const adminDb = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await adminDb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile || (profile.role !== 'storekeeper' && profile.role !== 'admin')) {
    redirect('/dashboard')
  }

  // Get pending cash total FROM SUMMARY VIEW (avoids 1000 row limit)
  const { data: cashSummary } = await adminDb
    .from('cash_collection_summary')
    .select('pending_cash')
    .gt('pending_count', 0)

  const totalPendingCash = cashSummary?.reduce((s, d) => s + Number(d.pending_cash || 0), 0) || 0

  // Get pending returns count (CMS items not yet verified)
  const { data: pendingReturns } = await adminDb
    .from('deliveries')
    .select('id, qty')
    .eq('status', 'cms')
    .eq('stock_verified', false)

  const totalPendingReturns = pendingReturns?.reduce((s, d) => s + (d.qty || 1), 0) || 0

  return (
    <StorekeeperMobileLayout
      profile={{ id: profile.id, name: profile.name, email: profile.email, avatarUrl: profile.avatar_url }}
      pendingCash={totalPendingCash}
      pendingReturns={totalPendingReturns}
    >
      {children}
    </StorekeeperMobileLayout>
  )
}
