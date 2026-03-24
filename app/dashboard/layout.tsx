import React from "react"
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DashboardSidebar } from '@/components/dashboard/sidebar'
import { DashboardHeader } from '@/components/dashboard/header'
import { RoleSwitcherProvider } from '@/components/dashboard/role-switcher-context'
import type { Profile } from '@/lib/types'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    redirect('/auth/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) {
    redirect('/auth/login')
  }

  // Check if user is approved (except admin)
  if (!profile.approved && profile.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md text-center space-y-6">
          <div className="mx-auto w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-foreground">Account Pending Approval</h1>
            <p className="text-muted-foreground">
              Hi {profile.name || profile.email}, your email has been verified successfully.
            </p>
            <p className="text-muted-foreground">
              Your account is now awaiting approval from an administrator. 
              You will receive full access once approved.
            </p>
          </div>
          <div className="pt-4 border-t border-border">
            <p className="text-sm text-muted-foreground mb-3">
              Signed in as <span className="font-medium text-foreground">{profile.email}</span>
            </p>
            <form action="/auth/sign-out" method="POST">
              <button 
                type="submit"
                className="text-sm text-primary hover:underline"
              >
                Sign out and use a different account
              </button>
            </form>
          </div>
        </div>
      </div>
    )
  }

  // For contractor, rider, and storekeeper roles, use a minimal layout (they have their own mobile navigation)
  const isMobileRole = profile.role === 'contractor' || profile.role === 'rider' || profile.role === 'storekeeper'

  if (isMobileRole) {
    return (
      <RoleSwitcherProvider actualRole={profile.role}>
        <div className="min-h-screen bg-background">
          {children}
        </div>
      </RoleSwitcherProvider>
    )
  }

  // For admin, manager, marketing_agent - use full desktop layout with sidebar
  return (
    <RoleSwitcherProvider actualRole={profile.role}>
      <div className="flex h-screen overflow-hidden bg-background">
        <DashboardSidebar profile={profile as Profile} />
        <div className="flex flex-col flex-1 overflow-hidden">
          <DashboardHeader profile={profile as Profile} />
          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </RoleSwitcherProvider>
  )
}
