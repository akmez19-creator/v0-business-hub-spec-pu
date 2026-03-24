'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import useSWR from 'swr'
import { cn } from '@/lib/utils'
import { Bell, Check, CheckCheck, Package, Wallet, Truck, AlertTriangle, Info, Star, X, Banknote, ArrowDownCircle } from 'lucide-react'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const typeIcons: Record<string, { icon: typeof Bell; color: string }> = {
  delivery_assigned: { icon: Package, color: 'text-blue-400' },
  delivery_completed: { icon: Check, color: 'text-emerald-400' },
  delivery_failed: { icon: AlertTriangle, color: 'text-red-400' },
  payout: { icon: Wallet, color: 'text-amber-400' },
  stock_update: { icon: Truck, color: 'text-cyan-400' },
  rate_update: { icon: Star, color: 'text-orange-400' },
  info: { icon: Info, color: 'text-muted-foreground' },
  welcome: { icon: Star, color: 'text-amber-400' },
  withdrawal_request: { icon: Banknote, color: 'text-orange-400' },
  withdrawal_update: { icon: ArrowDownCircle, color: 'text-emerald-400' },
}

function timeAgo(date: string) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// Fallback links for notifications that don't have an explicit link
function getFallbackLink(type: string): string | null {
  const fallbacks: Record<string, string> = {
    withdrawal_request: '/dashboard/contractors/earnings',
    withdrawal_update: '/dashboard/riders/earnings',
    delivery_assigned: '/dashboard/riders/deliveries',
    delivery_completed: '/dashboard/deliveries',
    payout: '/dashboard/contractors/earnings',
    rate_update: '/dashboard/contractors/rates',
    order_modified: '/dashboard/orders',
  }
  return fallbacks[type] || null
}

interface NotificationPanelProps {
  className?: string
}

export function NotificationBell({ className }: NotificationPanelProps) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const { data, mutate } = useSWR('/api/notifications', fetcher, {
    refreshInterval: 15000,
    fallbackData: { notifications: [], unreadCount: 0 },
  })

  const notifications = data?.notifications || []
  const unreadCount = data?.unreadCount || 0

  // Close on escape key only - backdrop handles click-outside
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    if (open) document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])

  async function markAllRead() {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markAll: true }),
    })
    mutate()
  }

  async function markRead(id: string) {
    await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    })
    mutate()
  }

  return (
    <div ref={panelRef} className={cn('relative', className)}>
      {/* Bell Button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-lg hover:bg-muted/50 transition-colors"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <Bell className="w-5 h-5 text-muted-foreground" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-5 h-5 flex items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Panel — portaled full-width bottom sheet on mobile */}
      {open && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-end justify-center pointer-events-auto" style={{ paddingBottom: '5rem' }}>
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm pointer-events-auto"
            onClick={() => setOpen(false)}
          />
          <div className="relative z-10 w-full max-w-md mx-3 max-h-[60vh] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden flex flex-col pointer-events-auto" style={{ animation: 'slideUp 0.2s ease-out' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <h3 className="font-semibold text-sm text-foreground">Notifications</h3>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={markAllRead}
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    <CheckCheck className="w-3 h-3" />
                    Mark all read
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="p-1 rounded hover:bg-muted/50"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </div>

            {/* Notifications List */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4">
                  <Bell className="w-8 h-8 text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">No notifications yet</p>
                </div>
              ) : (
                <div>
                  {notifications.map((notif: {
                    id: string
                    type: string
                    title: string
                    message?: string
                    link?: string
                    is_read: boolean
                    created_at: string
                  }) => {
                    const typeInfo = typeIcons[notif.type] || typeIcons.info
                    const Icon = typeInfo.icon
                    const targetLink = notif.link || getFallbackLink(notif.type)
                    
                    const content = (
                      <>
                        <div className={cn('mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0', !notif.is_read ? 'bg-primary/10' : 'bg-muted/50')}>
                          <Icon className={cn('w-4 h-4', typeInfo.color)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={cn('text-sm truncate', !notif.is_read ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                              {notif.title}
                            </p>
                            {!notif.is_read && (
                              <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                            )}
                          </div>
                          {notif.message && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.message}</p>
                          )}
                          <p className="text-[10px] text-muted-foreground/60 mt-1">{timeAgo(notif.created_at)}</p>
                        </div>
                      </>
                    )
                    
                    // Use Link for navigation, mark as read on click
                    if (targetLink) {
                      return (
                        <Link
                          key={notif.id}
                          href={targetLink}
                          onClick={() => {
                            if (!notif.is_read) markRead(notif.id)
                            setOpen(false)
                          }}
                          className={cn(
                            'flex items-start gap-3 px-4 py-3 border-b border-border/50 hover:bg-muted/30 transition-colors',
                            !notif.is_read && 'bg-primary/5'
                          )}
                        >
                          {content}
                        </Link>
                      )
                    }
                    
                    // No link - just mark as read on click
                    return (
                      <div
                        key={notif.id}
                        onClick={() => {
                          if (!notif.is_read) markRead(notif.id)
                        }}
                        className={cn(
                          'flex items-start gap-3 px-4 py-3 border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer',
                          !notif.is_read && 'bg-primary/5'
                        )}
                      >
                        {content}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
