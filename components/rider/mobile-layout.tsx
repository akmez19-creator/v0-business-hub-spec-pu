'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import useSWR from 'swr'
import { cn } from '@/lib/utils'
import { 
  LayoutDashboard, 
  Truck, 
  Package, 
  Wallet,
  User,
  Bell,
  Trophy,
  Zap,
  LogOut,
  Settings,
  X,
  Banknote,
  Maximize,
  Minimize,
  ChevronDown,
  Map,
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
  level?: number
  xp?: number
  xpToNextLevel?: number
}

const navItems = [
  { href: '/dashboard/riders', label: 'Home', icon: LayoutDashboard },
  { href: '/dashboard/riders/stock', label: 'Stock', icon: Package },
  { href: '/dashboard/riders/collections', label: 'Collect', icon: Banknote },
  { href: '/dashboard/riders/deliveries', label: 'Orders', icon: Truck },
  { href: '/dashboard/riders/map', label: 'Map', icon: Map },
  { href: '/dashboard/riders/earnings', label: 'Earnings', icon: Wallet },
  { href: 'more', label: 'More', icon: User },
]

export function RiderMobileLayout({ 
  children, 
  profile,
  level = 1,
  xp = 0,
  xpToNextLevel = 100
}: MobileLayoutProps) {
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [barsVisible, setBarsVisible] = useState(true)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const xpProgress = (xp / xpToNextLevel) * 100

  const startHideTimer = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => setBarsVisible(false), 3000)
  }, [])

  const showBars = useCallback(() => {
    setBarsVisible(true)
    startHideTimer()
  }, [startHideTimer])

  const toggleFullscreen = async () => {
    if (!isFullscreen) {
      // Enter focus mode: hide app bars on all platforms
      setIsFullscreen(true)
      setBarsVisible(false)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
      // Bonus: native fullscreen on Android/desktop
      try { await document.documentElement.requestFullscreen?.() } catch {}
    } else {
      // Exit focus mode: restore bars
      setIsFullscreen(false)
      showBars()
      // Exit native fullscreen if active
      if (document.fullscreenElement) {
        try { await document.exitFullscreen() } catch {}
      }
    }
  }

  // Fetch real header stats
  const { data: stats } = useSWR('/api/rider-stats', fetcher, {
    refreshInterval: 30000,
    fallbackData: { balanceOwed: 0, activeDeliveries: 0 },
  })
  const liveBalance = stats?.balanceOwed ?? 0
  const liveActive = stats?.activeDeliveries ?? 0

  useEffect(() => {
    setMounted(true)
    startHideTimer()
    const onFsChange = () => { if (document.fullscreenElement !== undefined) setIsFullscreen(!!document.fullscreenElement) }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [startHideTimer])

  const handleSignOut = async () => {
    await signOut()
  }

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
          {/* Profile & Level */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-primary-foreground font-bold text-sm">
                {profile.name?.charAt(0) || profile.email.charAt(0)}
              </div>
              <div className="absolute -bottom-1 -right-1 level-badge text-[10px] font-bold px-1.5 py-0.5 rounded-full text-primary-foreground">
                {level}
              </div>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-foreground">
                {profile.name || 'Rider'}
              </span>
              <div className="flex items-center gap-1.5">
                <Zap className="w-3 h-3 text-primary" />
                <div className="w-20 h-1.5 xp-bar">
                  <div 
                    className="xp-bar-fill" 
                    style={{ width: `${xpProgress}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {xp}/{xpToNextLevel}
                </span>
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
              className="relative p-2 rounded-xl glass-card hover:glow-primary transition-all"
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
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center text-primary-foreground font-bold text-lg shrink-0">
                    {profile.name?.charAt(0) || profile.email.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground text-sm truncate">{profile.name || 'Rider'}</p>
                    <p className="text-xs text-muted-foreground truncate">{profile.email}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Link
                    href="/dashboard/profile"
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
        <div className="mt-3 flex items-center gap-3 overflow-x-auto pb-1 -mx-1 px-1">
          <Link href="/dashboard/riders/earnings" className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full bg-success/20 border border-success/30 hover:bg-success/30 transition-colors">
            <Wallet className="w-4 h-4 text-success" />
            <span className="text-xs font-semibold text-success">Rs {liveBalance.toLocaleString()}</span>
          </Link>
          <Link href="/dashboard/riders/deliveries" className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/20 border border-accent/30 hover:bg-accent/30 transition-colors">
            <Truck className="w-4 h-4 text-accent" />
            <span className="text-xs font-semibold text-accent">{liveActive} Active</span>
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
                : (pathname === item.href || (item.href !== '/dashboard/riders' && pathname.startsWith(item.href)))
              const Icon = item.icon
              
              if (isMore) {
                return (
                  <button
                    key={item.href}
                    onClick={() => { setShowProfileMenu(true); showBars() }}
                    className={cn(
                      "snap-center relative flex flex-col items-center gap-0.5 min-w-[4.2rem] py-1.5 rounded-xl shrink-0",
                      isActive 
                        ? "text-primary" 
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <div className={cn(
                      "p-1.5 rounded-xl transition-all",
                      isActive && "bg-primary/20 glow-primary"
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
                      ? "text-primary" 
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <div className={cn(
                    "p-1.5 rounded-xl transition-all",
                    isActive && "bg-primary/20 glow-primary"
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
