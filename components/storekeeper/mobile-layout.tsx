'use client'
// Updated menu icon to ChevronDown - v2

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Banknote,
  Package,
  History,
  Settings,
  LogOut,
  User,
  X,
  Maximize,
  Minimize,
  ChevronDown,
  Warehouse,
  Calculator,
  RotateCcw,
  Sparkles,
  Loader2,
  Truck,
  Wallet,
  CreditCard,
  Wine,
} from 'lucide-react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { signOut } from '@/lib/auth-actions'
import { NotificationBell } from '@/components/ui/notification-panel'

interface StorekeeperLayoutProps {
  children: React.ReactNode
  profile: {
    id: string
    name?: string
    email: string
    avatarUrl?: string | null
  }
  pendingCash?: number
  pendingReturns?: number
}

export function StorekeeperMobileLayout({
  children,
  profile,
  pendingCash = 0,
  pendingReturns = 0,
}: StorekeeperLayoutProps) {
  const pathname = usePathname()
  const [mounted, setMounted] = useState(false)
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [barsVisible, setBarsVisible] = useState(true)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile.avatarUrl || null)
  const [generatingAvatar, setGeneratingAvatar] = useState(false)

  const startHideTimer = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => setBarsVisible(false), 9000)
  }, [])

  const generateAvatar = async () => {
    setGeneratingAvatar(true)
    try {
      const res = await fetch('/api/generate-avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: profile.name || 'Store Keeper', style: 'professional' })
      })
      const data = await res.json()
      if (data.url) {
        setAvatarUrl(data.url)
        // Save to profile
        const supabase = createClient()
        await supabase.from('profiles').update({ avatar_url: data.url }).eq('id', profile.id)
      } else if (data.error) {
        console.error('Avatar generation failed:', data.error)
      }
    } catch (e) {
      console.error('Failed to generate avatar:', e)
    }
    setGeneratingAvatar(false)
  }

  const showBars = useCallback(() => {
    setBarsVisible(true)
    startHideTimer()
  }, [startHideTimer])

  const toggleFullscreen = async () => {
    const elem = document.documentElement as any
    if (!isFullscreen) {
      setIsFullscreen(true)
      setBarsVisible(false)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
      // Try different fullscreen APIs for cross-browser/mobile support
      try {
        if (elem.requestFullscreen) {
          await elem.requestFullscreen()
        } else if (elem.webkitRequestFullscreen) {
          await elem.webkitRequestFullscreen() // Safari/iOS
        } else if (elem.msRequestFullscreen) {
          await elem.msRequestFullscreen() // IE/Edge
        }
      } catch (e) {
        console.log('[v0] Fullscreen not supported, using CSS fallback')
      }
    } else {
      setIsFullscreen(false)
      showBars()
      const doc = document as any
      try {
        if (doc.exitFullscreen) {
          await doc.exitFullscreen()
        } else if (doc.webkitExitFullscreen) {
          await doc.webkitExitFullscreen()
        } else if (doc.msExitFullscreen) {
          await doc.msExitFullscreen()
        }
      } catch (e) {
        console.log('[v0] Exit fullscreen error')
      }
    }
  }

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

  const navItems = [
    { href: '/dashboard/storekeeper', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/dashboard/storekeeper/stock-out', label: 'Stock Out', icon: Truck },
    { href: '/dashboard/storekeeper/cash-collection', label: 'Cash', icon: Banknote },
    { href: '/dashboard/storekeeper/juice-collection', label: 'Juice', icon: Wine },
    { href: '/dashboard/storekeeper/stock-in', label: 'Returns', icon: Package },
    { href: '/dashboard/storekeeper/daily-summary', label: 'Log', icon: Calculator },
    { href: '/dashboard/storekeeper/balance', label: 'Balance', icon: Wallet },
    { href: '/dashboard/storekeeper/payments', label: 'Payments', icon: CreditCard },
    { href: 'more', label: 'More', icon: User },
  ]

  return (
    <div className="min-h-screen bg-background game-bg flex flex-col">
      {/* Top grip to re-show header */}
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

      {/* Header */}
      <header
        className={cn(
          "glass-card fixed top-0 left-0 right-0 z-50 px-3 py-2 transition-transform duration-300 ease-in-out",
          barsVisible ? "translate-y-0" : "-translate-y-full"
        )}
        onPointerEnter={showBars}
        onTouchStart={showBars}
      >
        <div className="flex items-center justify-between">
          {/* Profile Info */}
          <div className="flex items-center gap-3">
            <div className="relative">
              {avatarUrl ? (
                <Image src={avatarUrl} alt={profile.name || 'Avatar'} width={44} height={44} className="w-11 h-11 rounded-xl object-cover" />
              ) : (
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center text-white font-bold text-lg">
                  {profile.name?.charAt(0) || 'S'}
                </div>
              )}
              <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                <Warehouse className="w-3 h-3 text-white" />
              </div>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-foreground">
                {profile.name || 'Store Keeper'}
              </span>
              <span className="text-xs text-muted-foreground">Store Operations</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFullscreen() }}
              className="p-2 rounded-xl glass-card hover:glow-accent transition-all active:scale-95"
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

          {/* Profile Menu Portal */}
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
                  <div className="relative shrink-0">
                    {avatarUrl ? (
                      <Image src={avatarUrl} alt={profile.name || 'Avatar'} width={48} height={48} className="w-12 h-12 rounded-xl object-cover" />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 flex items-center justify-center text-white font-bold text-lg">
                        {profile.name?.charAt(0) || 'S'}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={generateAvatar}
                      disabled={generatingAvatar}
                      className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-accent flex items-center justify-center text-white hover:bg-accent/80 transition-colors disabled:opacity-50"
                      title="Generate AI Avatar"
                    >
                      {generatingAvatar ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    </button>
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground text-sm truncate">{profile.name || 'Store Keeper'}</p>
                    <p className="text-xs text-muted-foreground truncate">{profile.email}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Link
                    href="/dashboard/storekeeper/settings"
                    onClick={() => setShowProfileMenu(false)}
                    className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-muted transition-colors"
                  >
                    <Settings className="w-5 h-5 text-muted-foreground" />
                    <span className="text-sm">Settings</span>
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
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/20 border border-amber-500/30">
            <Banknote className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-semibold text-amber-500">Rs {pendingCash.toLocaleString()} pending</span>
          </div>
          <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-500/20 border border-violet-500/30">
            <RotateCcw className="w-4 h-4 text-violet-400" />
            <span className="text-xs font-semibold text-violet-400">{pendingReturns} returns</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main
        className={cn("flex-1 overflow-y-auto px-1 transition-[padding] duration-300", barsVisible ? "pt-28 pb-20" : "pt-2 pb-2")}
        onClick={(e) => { 
          // Only hide bars if clicking directly on main, not on children
          if (e.target === e.currentTarget && barsVisible) { 
            setBarsVisible(false)
            if (hideTimerRef.current) clearTimeout(hideTimerRef.current) 
          } 
        }}
      >
        <div className="stagger-children">
          {children}
        </div>
      </main>

      {/* Bottom Navigation */}
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
                : (pathname === item.href || (item.href !== '/dashboard/storekeeper' && pathname.startsWith(item.href)))
              const Icon = item.icon

              if (isMore) {
                return (
                  <button
                    key={item.href}
                    onClick={() => { setShowProfileMenu(true); showBars() }}
                    className={cn(
                      "snap-center relative flex flex-col items-center gap-0.5 min-w-[4.2rem] py-1.5 rounded-xl shrink-0",
                      isActive ? "text-accent" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <div className={cn("p-1.5 rounded-xl transition-all", isActive && "bg-accent/20 glow-accent")}>
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
                    isActive ? "text-accent" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <div className={cn("p-1.5 rounded-xl transition-all", isActive && "bg-accent/20 glow-accent")}>
                    <Icon className={cn("w-5 h-5", isActive && "icon-spin")} />
                  </div>
                  <span className="text-[10px] font-medium">{item.label}</span>
                </Link>
              )
            })}
          </div>
        </div>
      </nav>

      {/* Bottom grip to re-show nav */}
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
