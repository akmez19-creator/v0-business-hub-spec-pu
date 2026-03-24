'use client'

import React from "react"

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import type { Profile, UserRole } from '@/lib/types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { RoleSwitcher } from './role-switcher'
import { useEffectiveRole } from './role-switcher-context'
import {
  Package,
  LayoutDashboard,
  Truck,
  Users,
  UserCog,
  Database,
  Bike,
  Building2,
  Menu,
  LogOut,
  User,
  ChevronDown,
  ChevronRight,
  BarChart3,
  Wallet,
  Banknote,
  BoxesIcon,
  ShoppingCart,
} from 'lucide-react'

interface SubNavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

interface NavItem {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles: UserRole[]
  subItems?: SubNavItem[]
}

const navItems: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Overview',
    icon: LayoutDashboard,
    roles: ['admin', 'manager', 'marketing_agent', 'contractor', 'rider'],
  },
  {
    href: '/dashboard/deliveries',
    label: 'Deliveries',
    icon: Truck,
    roles: ['admin', 'manager'],
    subItems: [
      { href: '/dashboard/deliveries', label: 'Dashboard', icon: BarChart3 },
      { href: '/dashboard/deliveries/all', label: 'All Deliveries', icon: Truck },
      { href: '/dashboard/deliveries/riders', label: 'Riders', icon: Bike },
      { href: '/dashboard/deliveries/contractors', label: 'Contractors', icon: Building2 },
      { href: '/dashboard/deliveries/collections', label: 'Collections', icon: Banknote },
      { href: '/dashboard/deliveries/payments', label: 'Payments', icon: Wallet },
      { href: '/dashboard/deliveries/inventory', label: 'Inventory', icon: BoxesIcon },
      { href: '/dashboard/deliveries/purchase-orders', label: 'Purchase Orders', icon: ShoppingCart },
      { href: '/dashboard/deliveries/stock', label: 'Stock', icon: Package },
    ],
  },
  {
    href: '/dashboard/clients',
    label: 'Client Database',
    icon: Database,
    roles: ['admin', 'manager', 'marketing_agent'],
  },
  {
    href: '/dashboard/riders',
    label: 'My Dashboard',
    icon: Bike,
    roles: ['rider'],
    subItems: [
      { href: '/dashboard/riders', label: 'Overview', icon: LayoutDashboard },
      { href: '/dashboard/riders/deliveries', label: 'My Deliveries', icon: Truck },
      { href: '/dashboard/riders/collections', label: 'Collections', icon: Banknote },
      { href: '/dashboard/riders/stock', label: 'My Stock', icon: Package },
      { href: '/dashboard/riders/earnings', label: 'My Earnings', icon: Wallet },
    ],
  },
  {
    href: '/dashboard/contractors',
    label: 'My Dashboard',
    icon: Building2,
    roles: ['contractor'],
    subItems: [
      { href: '/dashboard/contractors', label: 'Overview', icon: LayoutDashboard },
      { href: '/dashboard/contractors/riders', label: 'My Riders', icon: Users },
      { href: '/dashboard/contractors/deliveries', label: 'Deliveries', icon: Truck },
      { href: '/dashboard/contractors/collections', label: 'Collections', icon: Banknote },
      { href: '/dashboard/contractors/stock', label: 'Stock', icon: Package },
      { href: '/dashboard/contractors/wallet', label: 'Wallet', icon: Wallet },
    ],
  },
  {
    href: '/dashboard/admin/users',
    label: 'User Management',
    icon: UserCog,
    roles: ['admin'],
  },
  {
    href: '/dashboard/admin/team',
    label: 'Team Overview',
    icon: Users,
    roles: ['admin', 'manager'],
  },
]

export function DashboardHeader({ profile }: { profile: Profile }) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  // Auto-expand based on current path
  const getDefaultMobileExpanded = () => {
    if (pathname.startsWith('/dashboard/deliveries')) return ['/dashboard/deliveries']
    if (pathname.startsWith('/dashboard/contractors')) return ['/dashboard/contractors']
    if (pathname.startsWith('/dashboard/riders')) return ['/dashboard/riders']
    return []
  }
  const [expandedMobileItems, setExpandedMobileItems] = useState<string[]>(getDefaultMobileExpanded())
  const effectiveRole = useEffectiveRole()
  
  const filteredNavItems = navItems.filter(item => 
    item.roles.includes(effectiveRole)
  )

  const toggleMobileExpanded = (href: string) => {
    setExpandedMobileItems(prev => 
      prev.includes(href) 
        ? prev.filter(h => h !== href)
        : [...prev, href]
    )
  }

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  // Get current page title
  const currentNavItem = navItems.find(item => 
    pathname === item.href || 
    (item.href !== '/dashboard' && pathname.startsWith(item.href))
  )
  const pageTitle = currentNavItem?.label || 'Dashboard'

  return (
    <header className="flex items-center justify-between h-16 px-6 border-b border-border bg-card">
      <div className="flex items-center gap-4">
        {/* Mobile Menu */}
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden">
              <Menu className="w-5 h-5" />
              <span className="sr-only">Open menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <div className="flex items-center gap-3 h-16 px-6 border-b border-border">
              <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary">
                <Package className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="font-semibold">Business Hub</span>
            </div>
            <nav className="p-4 space-y-1 overflow-y-auto max-h-[calc(100vh-4rem)]">
              {filteredNavItems.map((item) => {
                const isActive = pathname === item.href || 
                  (item.href !== '/dashboard' && pathname.startsWith(item.href))
                const hasSubItems = item.subItems && item.subItems.length > 0
                const isExpanded = expandedMobileItems.includes(item.href)
                
                if (hasSubItems) {
                  return (
                    <div key={item.href}>
                      <button
                        onClick={() => toggleMobileExpanded(item.href)}
                        className={cn(
                          'flex items-center justify-between w-full px-3 py-2 rounded-md text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-accent text-accent-foreground'
                            : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                        )}
                      >
                        <span className="flex items-center gap-3">
                          <item.icon className="w-4 h-4" />
                          {item.label}
                        </span>
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </button>
                      
                      {isExpanded && (
                        <div className="ml-4 mt-1 space-y-1 border-l border-border pl-3">
                          {item.subItems?.map((subItem) => {
                            const isSubActive = pathname === subItem.href
                            return (
                              <Link
                                key={subItem.href}
                                href={subItem.href}
                                onClick={() => setMobileMenuOpen(false)}
                                className={cn(
                                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                                  isSubActive
                                    ? 'bg-accent text-accent-foreground font-medium'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                                )}
                              >
                                <subItem.icon className="w-4 h-4" />
                                {subItem.label}
                              </Link>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                }
                
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                    )}
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </Link>
                )
              })}
            </nav>
          </SheetContent>
        </Sheet>
        
        <h1 className="text-lg font-semibold">{pageTitle}</h1>
      </div>

      <div className="flex items-center gap-3">
        {/* Role Switcher (Admin Only) */}
        <RoleSwitcher />

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-medium text-sm">
                {profile.name?.charAt(0).toUpperCase() || profile.email.charAt(0).toUpperCase()}
              </div>
              <span className="hidden sm:inline-block max-w-[120px] truncate">
                {profile.name || profile.email}
              </span>
              <ChevronDown className="w-4 h-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="truncate">{profile.name || 'User'}</span>
                <span className="text-xs font-normal text-muted-foreground truncate">
                  {profile.email}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/dashboard/profile" className="flex items-center">
                <User className="w-4 h-4 mr-2" />
                Profile Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
              <LogOut className="w-4 h-4 mr-2" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
