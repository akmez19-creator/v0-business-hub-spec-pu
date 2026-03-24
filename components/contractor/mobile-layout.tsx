'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import useSWR from 'swr'
import { cn } from '@/lib/utils'
import { 
  LayoutDashboard, 
  Users, 
  Truck, 
  Package, 
  Wallet,
  Bell,
  Settings,
  TrendingUp,
  Zap,
  LogOut,
  User,
  X,
  Banknote,
  Maximize,
  Minimize,
  ChevronDown,
  UserPlus,
  FileSpreadsheet,
  WalletCards,
  FileText,
  Map,
  RotateCcw,
  Smartphone,
} from 'lucide-react'
import { signOut } from '@/lib/auth-actions'
import { NotificationBell } from '@/components/ui/notification-panel'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface MobileLayoutProps {
  children: React.ReactNode
  profile: {
    name?: string
    email: string
  }
  companyName?: string
  photoUrl?: string | null
  totalEarnings?: number
  riderCount?: number
  isAlsoRider?: boolean
  hasPartners?: boolean
}

export function ContractorMobileLayout({ 
  children, 
  profile,
  companyName,
  photoUrl,
  totalEarnings = 0,
  riderCount = 0,
  isAlsoRider = false,
  hasPartners = false
}: MobileLayoutProps) {
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [barsVisible, setBarsVisible] = useState(true)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navItems = getNavItems(isAlsoRider, hasPartners)

  const startHideTimer = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => setBarsVisible(false), 9000)
  }, [])

  const showBars = useCallback(() => {
    setBarsVisible(true)
    startHideTimer()
  }, [startHideTimer])

  const toggleFullscreen = async () => {
    const elem = document.documentElement as any
    const doc = document as any
    
    // Detect iOS - Fullscreen API not supported, use app-level focus mode only
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    
    if (!isFullscreen) {
      // Enter focus mode: hide app header/footer bars
      setIsFullscreen(true)
      setBarsVisible(false)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
      
      // On non-iOS, also try native fullscreen
      if (!isIOS) {
        try {
          if (elem.requestFullscreen) {
            await elem.requestFullscreen()
          } else if (elem.webkitRequestFullscreen) {
            await elem.webkitRequestFullscreen()
          } else if (elem.msRequestFullscreen) {
            await elem.msRequestFullscreen()
          }
        } catch (e) {}
      }
      // iOS: just hides app bars (header/footer) - no native fullscreen available
    } else {
      // Exit focus mode: restore bars
      setIsFullscreen(false)
      showBars()
      
      // Exit native fullscreen if active (non-iOS)
      const fsElement = doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement
      if (fsElement) {
        try {
          if (doc.exitFullscreen) {
            await doc.exitFullscreen()
          } else if (doc.webkitExitFullscreen) {
            await doc.webkitExitFullscreen()
          } else if (doc.msExitFullscreen) {
            await doc.msExitFullscreen()
          }
        } catch (e) {}
      }
    }
  }

  // Fetch real header stats
  const { data: stats } = useSWR('/api/contractor-stats', fetcher, {
    refreshInterval: 30000,
    fallbackData: { balanceOwed: totalEarnings, balanceAfterSalary: totalEarnings, monthlySalary: 0, activeDeliveries: 0, activeRiders: 0, riderCount },
  })
  const liveBalance = stats?.balanceOwed ?? totalEarnings
  const liveAfterSalary = stats?.balanceAfterSalary ?? liveBalance
  const liveSalary = stats?.monthlySalary ?? 0
  const liveActiveDeliveries = stats?.activeDeliveries ?? 0
  const liveActiveRiders = stats?.activeRiders ?? 0
  const liveRiderCount = stats?.riderCount ?? riderCount

  useEffect(() => {
    setMounted(true)
    startHideTimer()
    const doc = document as any
    const onFsChange = () => {
      const fsElement = doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement
      setIsFullscreen(!!fsElement)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    document.addEventListener('webkitfullscreenchange', onFsChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener('webkitfullscreenchange', onFsChange)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [startHideTimer])

  if (!mounted) return null

  return (
    <div className="min-h-screen bg-background game-bg flex flex-col">
      {/* Top grip handle to re-show header */}
      <button
        onClick={showBars}
        className={cn(
          "fixed top-1 left-1/2 -translate-x-1/2 z-40 transition-all duration-300",
          barsVisible ? "opacity-0 pointer-events-none -translate-y-2" : "opacity-100 translate-y-0"
        )}
        aria-label="Show header"
      >
        <div className="flex flex-col items-center gap-0.5 px-5 py-1.5 rounded-full glass-card border border-border/50 shadow-lg">
          <ChevronDown className="w-5 h-5 text-muted-foreground" />
        </div>
      </button>

      {/* Header - Auto-hide */}
      <header 
        className={cn(
          "glass-card fixed top-0 left-0 right-0 z-50 px-2 py-2 transition-transform duration-300 ease-in-out",
          barsVisible ? "translate-y-0" : "-translate-y-full"
        )}
        onPointerEnter={showBars}
        onTouchStart={showBars}
      >
        <div className="flex items-center justify-between">
          {/* Company Info */}
          <div className="flex items-center gap-3">
            <div className="relative">
  <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-accent to-primary flex items-center justify-center text-primary-foreground font-bold text-lg overflow-hidden">
  {photoUrl ? (
    <img src={photoUrl} alt={companyName || 'Profile'} className="w-full h-full object-cover" />
  ) : (
    companyName?.charAt(0) || profile.name?.charAt(0) || 'C'
  )}
  </div>
  <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-success flex items-center justify-center">
  <TrendingUp className="w-3 h-3 text-success-foreground" />
              </div>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-foreground">
                {companyName || profile?.name || 'Contractor'}
              </span>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Users className="w-3 h-3" />
                <span>{liveRiderCount} riders</span>
                <span className="text-border">|</span>
                <Zap className="w-3 h-3 text-primary" />
                <span className="text-primary font-medium">Active</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); toggleFullscreen() }}
              onClick={(e) => { e.stopPropagation(); toggleFullscreen() }}
              className="p-2 rounded-xl glass-card hover:glow-accent transition-all"
              aria-label={isFullscreen ? 'Exit focus mode' : 'Enter focus mode'}
            >
              {isFullscreen ? <Minimize className="w-5 h-5 text-foreground" /> : <Maximize className="w-5 h-5 text-foreground" />}
            </button>
            <NotificationBell className="rounded-xl glass-card hover:glow-accent transition-all" />
            <button 
              onClick={() => setShowProfileMenu(true)}
              className="p-2 rounded-xl glass-card hover:glow-primary transition-all"
            >
              <User className="w-5 h-5 text-foreground" />
            </button>
          </div>

          {/* Profile Menu — portaled to body to avoid transform issues */}
          {showProfileMenu && createPortal(
            <div className="fixed inset-0 z-[9999] flex items-end justify-center" style={{ paddingBottom: '5rem' }}>
              <div 
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={() => setShowProfileMenu(false)}
              />
              <div className="relative w-full max-w-sm mx-4 bg-card border border-border rounded-2xl p-5 shadow-2xl" style={{ animation: 'slideUp 0.2s ease-out' }}>
                <button 
                  onClick={() => setShowProfileMenu(false)}
                  className="absolute top-3 right-3 p-2 rounded-full hover:bg-muted transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
                
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent to-primary flex items-center justify-center text-primary-foreground font-bold text-lg overflow-hidden shrink-0">
                    {photoUrl ? (
                      <img src={photoUrl} alt={companyName || 'Profile'} className="w-full h-full object-cover" />
                    ) : (
    companyName?.charAt(0) || profile?.name?.charAt(0) || 'C'
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground text-sm truncate">{companyName || profile?.name || 'Contractor'}</p>
                    <p className="text-xs text-muted-foreground truncate">{profile?.email || ''}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Link
                    href="/dashboard/contractors/settings"
                    onClick={() => setShowProfileMenu(false)}
                    className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-muted transition-colors"
                  >
                    <Settings className="w-5 h-5 text-muted-foreground" />
                    <span className="text-sm">Profile Settings</span>
                  </Link>
                  <form action={signOut} className="w-full">
                    <button
                      type="submit"
                      className="flex items-center gap-3 w-full p-3 rounded-xl bg-destructive/10 hover:bg-destructive/20 text-destructive transition-colors"
                    >
                      <LogOut className="w-5 h-5" />
                      <span className="text-sm">Sign Out</span>
                    </button>
                  </form>
                </div>
              </div>
            </div>,
            document.body
          )}
        </div>

        {/* Quick Stats Bar */}
        <div className="mt-3 flex items-center gap-2.5 overflow-x-auto pb-1 -mx-1 px-1">
          <Link href="/dashboard/contractors/earnings" className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/20 border border-success/30 hover:bg-success/30 transition-colors">
            <Wallet className="w-4 h-4 text-success" />
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-success">Rs {liveBalance.toLocaleString()}</span>
              {liveSalary > 0 && (
                <span className="text-[9px] text-success/70 leading-none">
                  after salary: Rs {liveAfterSalary.toLocaleString()}
                </span>
              )}
            </div>
          </Link>
  <Link href="/dashboard/contractors/riders" className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/20 border border-accent/30 hover:bg-accent/30 transition-colors">
  <Users className="w-4 h-4 text-accent" />
  <span className="text-xs font-semibold text-accent">{liveActiveRiders} Active</span>
  </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className={cn("flex-1 overflow-y-auto px-1 transition-[padding] duration-300", barsVisible ? "pt-24 pb-20" : "pt-2 pb-2")} onClick={() => { if (barsVisible) { setBarsVisible(false); if (hideTimerRef.current) clearTimeout(hideTimerRef.current) } }}>
        <div className="stagger-children">
          {children}
        </div>
      </main>

      {/* Bottom Navigation - Auto-hide */}
      <nav 
        className={cn(
          "fixed bottom-0 left-0 right-0 z-50 safe-area-pb transition-transform duration-300 ease-in-out",
          barsVisible ? "translate-y-0" : "translate-y-full"
        )}
        onPointerEnter={showBars}
        onTouchStart={showBars}
      >
        <div className="mobile-nav">
          <div 
            className="flex items-center gap-0.5 px-1 py-1.5 overflow-x-auto scrollbar-hide scroll-smooth snap-x snap-mandatory"
            style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {navItems.map((item) => {
              const isMore = item.href === 'more'
              const isActive = isMore 
                ? showProfileMenu 
                : (pathname === item.href || (item.href !== '/dashboard/contractors' && pathname.startsWith(item.href)))
              const Icon = item.icon
              
              if (isMore) {
                return (
                  <button
                    key={item.href}
                    onClick={() => { setShowProfileMenu(true); showBars() }}
                    className={cn(
                      "snap-center relative flex flex-col items-center gap-0.5 min-w-[4.2rem] py-1.5 rounded-xl shrink-0",
                      isActive 
                        ? "text-accent" 
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <div className={cn(
                      "p-1.5 rounded-xl transition-all",
                      isActive && "bg-accent/20 glow-accent"
                    )}>
                      <Icon className={cn("w-5 h-5", isActive && "icon-spin")} />
                    </div>
                    <span className="text-[10px] font-medium">{item.label}</span>
                  </button>
                )
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={showBars}
                  className={cn(
                    "snap-center relative flex flex-col items-center gap-0.5 min-w-[4.2rem] py-1.5 rounded-xl shrink-0",
                    isActive 
                      ? "text-accent" 
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <div className={cn(
                    "p-1.5 rounded-xl transition-all",
                    isActive && "bg-accent/20 glow-accent"
                  )}>
                    <Icon className={cn("w-5 h-5", isActive && "icon-spin")} />
                  </div>
                  <span className="text-[10px] font-medium">{item.label}</span>
                </Link>
              )
            })}
          </div>
        </div>
      </nav>

      {/* Bottom grip handle to re-show nav */}
      <button
        onClick={showBars}
        className={cn(
          "fixed bottom-1 left-1/2 -translate-x-1/2 z-40 transition-all duration-300",
          barsVisible ? "opacity-0 pointer-events-none translate-y-2" : "opacity-100 translate-y-0"
        )}
        aria-label="Show navigation"
      >
        <div className="flex flex-col items-center gap-0.5 px-5 py-1.5 rounded-full glass-card border border-border/50 shadow-lg">
          <ChevronDown className="w-5 h-5 text-muted-foreground" />
        </div>
      </button>
    </div>
  )
}

const getNavItems = (_isAlsoRider: boolean, hasPartners: boolean) => {
  const items = [
    { href: '/dashboard/contractors', label: 'Home', icon: LayoutDashboard },
    { href: '/dashboard/contractors/riders', label: 'Team', icon: Users },
    { href: '/dashboard/contractors/my-deliveries', label: 'Assign', icon: UserPlus },
    ...(hasPartners ? [{ href: '/dashboard/contractors/partner-deliveries', label: 'Partner', icon: FileSpreadsheet }] : []),
    { href: '/dashboard/contractors/stock', label: 'Stock', icon: Package },
    { href: '/dashboard/contractors/deliveries', label: 'Orders', icon: Truck },
    { href: '/dashboard/contractors/map', label: 'Map', icon: Map },
    { href: '/dashboard/contractors/cash-collection', label: 'Cash', icon: Banknote },
    { href: '/dashboard/contractors/juice-collection', label: 'Juice', icon: Smartphone },
    { href: '/dashboard/contractors/returns', label: 'Rtrn', icon: RotateCcw },
    { href: '/dashboard/contractors/earnings', label: 'Earnings', icon: Wallet },
    { href: '/dashboard/contractors/accounting', label: 'Accounting', icon: FileText },
    { href: 'more', label: 'More', icon: User },
  ]
  return items
}
