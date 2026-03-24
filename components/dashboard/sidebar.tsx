'use client'

import React, { useState } from "react"
import { Wallet } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import type { Profile, UserRole } from '@/lib/types'
import { useEffectiveRole, useRoleSwitcher } from './role-switcher-context'
import { Badge } from '@/components/ui/badge'
import {
  Package,
  LayoutDashboard,
  Truck,
  Users,
  UserCog,
  Database,
  Bike,
  Building2,
  ChevronDown,
  ChevronRight,
  BarChart3,
  Banknote,
  BoxesIcon,
  ShoppingCart,
  TrendingDown,
  FileText,
  MapPin,
  Map,
  Settings,
  Download,
  Network,
  TrendingUp,
  X,
  Menu,
  LogOut,
  User,
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
  color?: string
}

const navItems: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Overview',
    icon: LayoutDashboard,
    roles: ['admin', 'manager', 'marketing_agent', 'contractor', 'rider'],
    color: '#f97316',
  },
  {
    href: '/dashboard/deliveries',
    label: 'Deliveries',
    icon: Truck,
    roles: ['admin', 'manager'],
    color: '#06b6d4',
    subItems: [
      { href: '/dashboard/deliveries', label: 'Dashboard', icon: BarChart3 },
      { href: '/dashboard/deliveries/all', label: 'All Deliveries', icon: Truck },
      { href: '/dashboard/deliveries/riders', label: 'Riders', icon: Bike },
      { href: '/dashboard/deliveries/contractors', label: 'Contractors', icon: Building2 },
    ],
  },
  {
    href: '/dashboard/finance',
    label: 'Finance',
    icon: Banknote,
    roles: ['admin', 'manager'],
    color: '#10b981',
    subItems: [
      { href: '/dashboard/deliveries/collections', label: 'Collections', icon: Banknote },
      { href: '/dashboard/deliveries/payments', label: 'Payments', icon: Wallet },
      { href: '/dashboard/deliveries/payroll', label: 'Payroll', icon: FileText },
      { href: '/dashboard/admin/deductions', label: 'Deductions', icon: TrendingDown },
    ],
  },
  {
    href: '/dashboard/inventory',
    label: 'Inventory',
    icon: BoxesIcon,
    roles: ['admin', 'manager'],
    color: '#8b5cf6',
    subItems: [
      { href: '/dashboard/deliveries/inventory', label: 'Stock Levels', icon: BoxesIcon },
      { href: '/dashboard/deliveries/purchase-orders', label: 'Purchase Orders', icon: ShoppingCart },
      { href: '/dashboard/deliveries/stock', label: 'Stock Tracking', icon: Package },
    ],
  },
  {
    href: '/dashboard/clients',
    label: 'Clients',
    icon: Database,
    roles: ['admin', 'manager', 'marketing_agent'],
    color: '#ec4899',
  },
  {
    href: '/dashboard/riders',
    label: 'My Dashboard',
    icon: Bike,
    roles: ['rider'],
    color: '#06b6d4',
    subItems: [
      { href: '/dashboard/riders', label: 'Overview', icon: LayoutDashboard },
      { href: '/dashboard/riders/deliveries', label: 'My Deliveries', icon: Truck },
      { href: '/dashboard/riders/map', label: 'Map', icon: Map },
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
    color: '#f97316',
    subItems: [
      { href: '/dashboard/contractors', label: 'Overview', icon: LayoutDashboard },
      { href: '/dashboard/contractors/riders', label: 'My Riders', icon: Users },
      { href: '/dashboard/contractors/deliveries', label: 'Deliveries', icon: Truck },
      { href: '/dashboard/contractors/map', label: 'Map', icon: Map },
      { href: '/dashboard/contractors/collections', label: 'Collections', icon: Banknote },
      { href: '/dashboard/contractors/stock', label: 'Stock', icon: Package },
      { href: '/dashboard/contractors/earnings', label: 'Earnings', icon: TrendingUp },
      { href: '/dashboard/contractors/accounting', label: 'Accounting', icon: FileText },
      { href: '/dashboard/contractors/wallet', label: 'Wallet', icon: Wallet },
    ],
  },
  {
    href: '/dashboard/storekeeper',
    label: 'Store Ops',
    icon: BoxesIcon,
    roles: ['storekeeper'],
    color: '#10b981',
    subItems: [
      { href: '/dashboard/storekeeper', label: 'Overview', icon: LayoutDashboard },
      { href: '/dashboard/storekeeper/cash-collection', label: 'Cash Collection', icon: Banknote },
      { href: '/dashboard/storekeeper/stock-out', label: 'Stock Out', icon: Package },
      { href: '/dashboard/storekeeper/stock-in', label: 'Stock In', icon: BoxesIcon },
      { href: '/dashboard/storekeeper/history', label: 'History', icon: FileText },
    ],
  },
  {
    href: '/dashboard/marketing-back-office',
    label: 'Back Office',
    icon: BarChart3,
    roles: ['marketing_back_office'],
    color: '#8b5cf6',
    subItems: [
      { href: '/dashboard/marketing-back-office', label: 'Overview', icon: LayoutDashboard },
      { href: '/dashboard/marketing-back-office/stock', label: 'Stock', icon: BoxesIcon },
      { href: '/dashboard/marketing-back-office/sales', label: 'Sales Report', icon: TrendingUp },
      { href: '/dashboard/marketing-back-office/orders', label: 'Create Order', icon: ShoppingCart },
      { href: '/dashboard/marketing-back-office/deliveries', label: 'Deliveries', icon: Truck },
      { href: '/dashboard/marketing-back-office/clients', label: 'Clients', icon: Database },
    ],
  },
  {
    href: '/dashboard/marketing-front-office',
    label: 'Front Office',
    icon: Users,
    roles: ['marketing_front_office'],
    color: '#ec4899',
    subItems: [
      { href: '/dashboard/marketing-front-office', label: 'Overview', icon: LayoutDashboard },
      { href: '/dashboard/marketing-front-office/orders', label: 'New Order', icon: ShoppingCart },
      { href: '/dashboard/marketing-front-office/clients', label: 'Clients', icon: Database },
      { href: '/dashboard/marketing-front-office/follow-up', label: 'Follow Up', icon: FileText },
    ],
  },
  {
    href: '/dashboard/admin/users',
    label: 'Users',
    icon: UserCog,
    roles: ['admin'],
    color: '#f59e0b',
  },
  {
    href: '/dashboard/admin/team',
    label: 'Team',
    icon: Users,
    roles: ['admin', 'manager'],
    color: '#6366f1',
  },
  {
    href: '/dashboard/admin/regions',
    label: 'Regions',
    icon: MapPin,
    roles: ['admin', 'manager'],
    color: '#ef4444',
  },
  {
    href: '/dashboard/admin/settings',
    label: 'Settings',
    icon: Settings,
    roles: ['admin'],
    color: '#64748b',
  },
  {
    href: '/dashboard/admin/blueprint',
    label: 'Blueprint',
    icon: Network,
    roles: ['admin'],
    color: '#0ea5e9',
  },
  {
    href: '/dashboard/tools',
    label: 'Tools',
    icon: Download,
    roles: ['admin', 'manager', 'marketing_agent', 'marketing_back_office', 'marketing_front_office'],
    color: '#8b5cf6',
  },
]

export function DashboardSidebar({ profile }: { profile: Profile }) {
  const pathname = usePathname()
  
  // Auto-expand menu based on current path
  const getDefaultExpanded = () => {
    if (pathname.startsWith('/dashboard/marketing-back-office')) return '/dashboard/marketing-back-office'
    if (pathname.startsWith('/dashboard/marketing-front-office')) return '/dashboard/marketing-front-office'
    if (pathname.startsWith('/dashboard/deliveries')) return '/dashboard/deliveries'
    if (pathname.startsWith('/dashboard/finance') || pathname.includes('/collections') || pathname.includes('/payments') || pathname.includes('/payroll')) return '/dashboard/finance'
    if (pathname.startsWith('/dashboard/inventory') || pathname.includes('/purchase-orders') || pathname.includes('/stock')) return '/dashboard/inventory'
    if (pathname.startsWith('/dashboard/contractors')) return '/dashboard/contractors'
    if (pathname.startsWith('/dashboard/riders')) return '/dashboard/riders'
    if (pathname.startsWith('/dashboard/storekeeper')) return '/dashboard/storekeeper'
    return null
  }
  
  const [expandedItem, setExpandedItem] = useState<string | null>(getDefaultExpanded)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const effectiveRole = useEffectiveRole()
  const { isViewingAs } = useRoleSwitcher()
  
  const filteredNavItems = navItems.filter(item => 
    item.roles.includes(effectiveRole)
  )

  return (
    <aside className="hidden md:flex md:flex-col w-20 hover:w-72 transition-all duration-500 ease-out group/sidebar relative z-50">
      {/* Glass background */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-2xl border-r border-white/10" />
      
      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />
      
      {/* Content */}
      <div className="relative z-10 flex flex-col h-full">
        
        {/* Logo */}
        <div className="flex items-center h-20 px-4 border-b border-white/5">
          <div className="relative flex items-center gap-3">
            {/* 3D Logo cube */}
            <div 
              className="w-12 h-12 rounded-2xl flex items-center justify-center transform-gpu transition-all duration-500"
              style={{
                background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                boxShadow: '0 8px 32px rgba(249, 115, 22, 0.4), 0 0 0 1px rgba(255,255,255,0.1) inset',
                transform: 'perspective(500px) rotateY(-5deg) rotateX(5deg)',
              }}
            >
              <Package className="w-6 h-6 text-white" />
            </div>
            
            {/* Expanded logo text */}
            <div className="opacity-0 group-hover/sidebar:opacity-100 transition-all duration-300 whitespace-nowrap overflow-hidden">
              <h1 className="text-lg font-bold text-white">AKMEZ</h1>
              <p className="text-[10px] text-white/50 uppercase tracking-wider">Delivery Hub</p>
            </div>
          </div>
        </div>
        
        {/* Navigation - 3D Stacked Cards */}
        <nav className="flex-1 py-4 px-2 overflow-y-auto scrollbar-hide">
          <div className="space-y-1">
            {filteredNavItems.map((item, index) => {
              const isActive = pathname === item.href || 
                (item.href !== '/dashboard' && pathname.startsWith(item.href))
              const hasSubItems = item.subItems && item.subItems.length > 0
              const isExpanded = expandedItem === item.href
              const isHovered = hoveredIndex === index
              
              // Calculate 3D transform based on hover position
              const getTransform = () => {
                if (hoveredIndex === null) return 'perspective(1000px) rotateX(0deg) translateZ(0px)'
                const distance = Math.abs(index - hoveredIndex)
                if (distance === 0) return 'perspective(1000px) rotateX(0deg) translateZ(20px) scale(1.02)'
                if (distance === 1) return 'perspective(1000px) rotateX(0deg) translateZ(10px) scale(1.01)'
                return 'perspective(1000px) rotateX(0deg) translateZ(0px)'
              }
              
              return (
                <div key={item.href} className="relative">
                  {hasSubItems ? (
                    <button
                      onClick={() => setExpandedItem(isExpanded ? null : item.href)}
                      onMouseEnter={() => setHoveredIndex(index)}
                      onMouseLeave={() => setHoveredIndex(null)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-300',
                        isActive ? 'text-white' : 'text-white/60 hover:text-white'
                      )}
                      style={{
                        transform: getTransform(),
                        background: isActive 
                          ? `linear-gradient(135deg, ${item.color}20 0%, transparent 100%)`
                          : isHovered 
                            ? 'rgba(255,255,255,0.05)'
                            : 'transparent',
                        boxShadow: isActive 
                          ? `0 0 30px ${item.color}30, inset 0 0 0 1px ${item.color}40`
                          : isHovered 
                            ? '0 8px 32px rgba(0,0,0,0.3), inset 0 0 0 1px rgba(255,255,255,0.1)'
                            : 'none',
                      }}
                    >
                      {/* Icon with 3D effect */}
                      <div 
                        className="relative w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-300"
                        style={{
                          background: isActive 
                            ? `linear-gradient(135deg, ${item.color} 0%, ${item.color}cc 100%)`
                            : 'rgba(255,255,255,0.05)',
                          boxShadow: isActive 
                            ? `0 4px 20px ${item.color}50`
                            : 'none',
                          transform: isActive ? 'scale(1.05)' : 'scale(1)',
                        }}
                      >
                        <item.icon className={cn(
                          "w-5 h-5 transition-colors",
                          isActive ? "text-white" : "text-white/60"
                        )} />
                      </div>
                      
                      {/* Label */}
                      <span className="flex-1 text-left text-sm font-medium opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-300 whitespace-nowrap overflow-hidden">
                        {item.label}
                      </span>
                      
                      {/* Chevron */}
                      <div className="opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-300">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-white/40" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-white/40" />
                        )}
                      </div>
                    </button>
                  ) : (
                    <Link
                      href={item.href}
                      onMouseEnter={() => setHoveredIndex(index)}
                      onMouseLeave={() => setHoveredIndex(null)}
                      className={cn(
                        'flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-300',
                        isActive ? 'text-white' : 'text-white/60 hover:text-white'
                      )}
                      style={{
                        transform: getTransform(),
                        background: isActive 
                          ? `linear-gradient(135deg, ${item.color}20 0%, transparent 100%)`
                          : isHovered 
                            ? 'rgba(255,255,255,0.05)'
                            : 'transparent',
                        boxShadow: isActive 
                          ? `0 0 30px ${item.color}30, inset 0 0 0 1px ${item.color}40`
                          : isHovered 
                            ? '0 8px 32px rgba(0,0,0,0.3), inset 0 0 0 1px rgba(255,255,255,0.1)'
                            : 'none',
                      }}
                    >
                      <div 
                        className="relative w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-300"
                        style={{
                          background: isActive 
                            ? `linear-gradient(135deg, ${item.color} 0%, ${item.color}cc 100%)`
                            : 'rgba(255,255,255,0.05)',
                          boxShadow: isActive 
                            ? `0 4px 20px ${item.color}50`
                            : 'none',
                          transform: isActive ? 'scale(1.05)' : 'scale(1)',
                        }}
                      >
                        <item.icon className={cn(
                          "w-5 h-5 transition-colors",
                          isActive ? "text-white" : "text-white/60"
                        )} />
                      </div>
                      
                      <span className="flex-1 text-sm font-medium opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-300 whitespace-nowrap overflow-hidden">
                        {item.label}
                      </span>
                    </Link>
                  )}
                  
                  {/* Sub-items dropdown */}
                  {hasSubItems && isExpanded && (
                    <div className="mt-1 ml-4 pl-4 border-l border-white/10 space-y-1 opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-300">
                      {item.subItems?.map((subItem) => {
                        const isSubActive = pathname === subItem.href
                        return (
                          <Link
                            key={subItem.href}
                            href={subItem.href}
                            className={cn(
                              'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-200',
                              isSubActive 
                                ? 'text-white bg-white/10' 
                                : 'text-white/50 hover:text-white hover:bg-white/5'
                            )}
                          >
                            <subItem.icon className="w-4 h-4" />
                            <span>{subItem.label}</span>
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </nav>
        
        {/* User section */}
        <div className="p-3 border-t border-white/5">
          {isViewingAs && (
            <div className="mb-2 opacity-0 group-hover/sidebar:opacity-100 transition-opacity">
              <Badge variant="outline" className="w-full justify-center bg-amber-500/10 text-amber-400 border-amber-500/30 text-xs">
                Viewing as {effectiveRole.replace('_', ' ')}
              </Badge>
            </div>
          )}
          
          <div className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-white/5 transition-colors cursor-pointer">
            {/* Avatar */}
            <div 
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
              style={{
                background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                boxShadow: '0 4px 15px rgba(249, 115, 22, 0.3)',
              }}
            >
              {profile.name?.charAt(0).toUpperCase() || profile.email.charAt(0).toUpperCase()}
            </div>
            
            {/* User info */}
            <div className="flex-1 min-w-0 opacity-0 group-hover/sidebar:opacity-100 transition-opacity duration-300">
              <p className="text-sm font-medium text-white truncate">
                {profile.name || 'User'}
              </p>
              <p className="text-xs text-white/50 truncate">
                {effectiveRole.replace('_', ' ')}
              </p>
            </div>
            
            {/* Logout */}
            <form action="/auth/logout" method="post" className="opacity-0 group-hover/sidebar:opacity-100 transition-opacity">
              <button 
                type="submit"
                className="p-2 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </aside>
  )
}
