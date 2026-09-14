'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Profile } from '@/lib/types'
import { useEffectiveRole } from './role-switcher-context'
import { RoleSwitcher } from './role-switcher'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ArrowUpRight, ChevronDown, Command, Compass, Expand, Layers3, LogOut, Menu, Minimize2, PanelTopClose, PanelTopOpen, Search, SlidersHorizontal, Sparkles, Star, Tv, User, X } from 'lucide-react'
import { findCurrentDestination, getDefaultPins, getNavigationDestinations, navigationGroups, type NavigationGroup } from './navigation-model'
import styles from './dashboard-workspace.module.css'

type Filter = NavigationGroup | 'all' | 'pinned'
type Preferences = { key: string; pins: string[]; wide: boolean; compactInbox: boolean }

/** Pages whose own layout is the work surface: the chrome collapses to one thin bar by default. */
const COMPACT_ROUTES = ['/dashboard/inbox']

export function DashboardWorkspace({ profile, children }: { profile: Profile; children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const effectiveRole = useEffectiveRole()
  const destinations = useMemo(() => getNavigationDestinations(effectiveRole), [effectiveRole])
  const current = findCurrentDestination(destinations, pathname)
  const group = navigationGroups.find(item => item.id === current?.group)
  const currentTitle = pathname === '/dashboard/profile' ? 'Profile settings' : current?.label ?? 'Workspace'
  const allowedGroups = navigationGroups.filter(item => destinations.some(destination => destination.group === item.id))
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const launcherRef = useRef<HTMLElement | null>(null)
  const menuRef = useRef<HTMLButtonElement>(null)
  const navigatorRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const storageKey = `akmez.workspace.v1.${profile.id}.${effectiveRole}`
  const [preferences, setPreferences] = useState<Preferences | null>(null)
  const saved = preferences?.key === storageKey ? preferences : { key: storageKey, pins: getDefaultPins(destinations), wide: false, compactInbox: true }
  const pins = saved.pins.map(href => destinations.find(item => item.href === href)).filter(item => item !== undefined)
  const compactRoute = COMPACT_ROUTES.some(route => pathname === route || pathname.startsWith(route + '/'))
  const compact = compactRoute && saved.compactInbox

  useEffect(() => {
    let next: Preferences = { key: storageKey, pins: getDefaultPins(getNavigationDestinations(effectiveRole)), wide: false, compactInbox: true }
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
      if (value && Array.isArray(value.pins)) {
        next = { key: storageKey, pins: [...new Set<string>(value.pins.filter((item: unknown): item is string => typeof item === 'string'))].slice(0, 8), wide: value.wide === true, compactInbox: value.compactInbox !== false }
      }
    } catch { /* Storage is optional; the menu still works in private mode. */ }
    setPreferences(next)
  }, [storageKey, effectiveRole])

  function updatePreferences(next: Preferences) {
    setPreferences(next)
    try { localStorage.setItem(storageKey, JSON.stringify({ pins: next.pins, wide: next.wide, compactInbox: next.compactInbox })); return true }
    catch { setNotice('Your changes work for this visit. This browser could not save them.'); return false }
  }

  function showMenu(nextFilter: Filter, launcher?: HTMLElement) {
    launcherRef.current = launcher ?? (document.activeElement instanceof HTMLElement ? document.activeElement : menuRef.current)
    setFilter(nextFilter)
    setQuery('')
    setNotice('')
    setOpen(true)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !event.altKey) {
        const otherModal = Array.from(document.querySelectorAll('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], dialog[open]')).some(element => element !== navigatorRef.current)
        // Existing mobile More/profile sheets use a direct-body portal without dialog semantics.
        const legacySheet = document.querySelector('body > .fixed.inset-0[class~="z-[9999]"]')
        if (otherModal || legacySheet) return
        event.preventDefault()
        if (open) searchRef.current?.focus()
        else {
          launcherRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : menuRef.current
          setFilter('all'); setQuery(''); setNotice(''); setOpen(true)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => { setOpen(false); setQuery(''); mainRef.current?.scrollTo({ top: 0, behavior: 'instant' }) }, [pathname])
  useEffect(() => { setFilter('all'); setQuery('') }, [effectiveRole])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleDestinations = destinations.filter(item => {
    // Typing searches every permitted page, even when opened from a group.
    if (normalizedQuery) return `${item.label} ${item.section} ${item.href} ${navigationGroups.find(g => g.id === item.group)?.label}`.toLocaleLowerCase().includes(normalizedQuery)
    return filter === 'all' || (filter === 'pinned' ? saved.pins.includes(item.href) : item.group === filter)
  })

  function togglePin(href: string) {
    const allowedPins = pins.map(item => item.href)
    if (allowedPins.includes(href)) {
      if (updatePreferences({ ...saved, pins: saved.pins.filter(item => item !== href) })) setNotice('Shortcut removed.')
    } else if (allowedPins.length >= 8) {
      setNotice('Your shortcut bar has eight pages. Unpin one to make room.')
    } else {
      if (updatePreferences({ ...saved, pins: [...allowedPins, href] })) setNotice('Shortcut pinned. Saved on this device.')
    }
  }

  async function handleSignOut() {
    setSigningOut(true)
    try {
      const { error } = await createClient().auth.signOut()
      if (error) throw error
      router.push('/auth/login')
      router.refresh()
    } catch {
      setSigningOut(false)
      setNotice('Sign out did not complete. Please try again.')
    }
  }

  return (
    <div data-dashboard-shell data-width={saved.wide ? 'wide' : 'focus'} data-compact={compact ? 'true' : undefined} className={styles.shell}>
      <div className={styles.ambient} aria-hidden="true" />
      <a className={styles.skipLink} href="#akmez-workspace-content">Skip to page content</a>
      <header className={styles.canopy}>
        <div className={styles.topbar}>
          <button type="button" className={styles.brand} onClick={event => showMenu('all', event.currentTarget)} aria-label="Open Akmez workspace menu">
            <span className={styles.brandMark}><Layers3 aria-hidden="true" /></span>
            <span className={styles.brandText}><strong>AKMEZ</strong><span>YOUR CONNECTED WORKSPACE</span></span>
          </button>
          <div className={styles.context}><span>{group?.label ?? 'Account'} /</span><strong>{currentTitle}</strong></div>
          <button type="button" className={styles.searchTrigger} onClick={event => showMenu('all', event.currentTarget)} aria-label="Search all workspace pages">
            <Search aria-hidden="true" /><span>Where would you like to go?</span><kbd className={styles.shortcutKey}>Ctrl K</kbd>
          </button>
          <div className={styles.topActions}>
            {compactRoute && <button type="button" className={styles.chromeToggle} onClick={() => updatePreferences({ ...saved, compactInbox: !saved.compactInbox })} aria-pressed={!saved.compactInbox} aria-label={saved.compactInbox ? 'Show navigation bars' : 'Hide navigation bars'} title={saved.compactInbox ? 'Show the navigation and shortcut bars' : 'Hide them to give the inbox the full screen'}>
              {saved.compactInbox ? <PanelTopOpen aria-hidden="true" /> : <PanelTopClose aria-hidden="true" />}<span>{saved.compactInbox ? 'Menu' : 'Hide menu'}</span>
            </button>}
            <div className={styles.roleWrap}><RoleSwitcher /></div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={styles.accountButton} aria-label="Open account menu">
                  <span className={styles.avatar}>{(profile.name || profile.email).charAt(0).toUpperCase()}</span>
                  <span className={styles.accountText}><strong>{profile.name || profile.email}</strong><span>{effectiveRole.replaceAll('_', ' ')}</span></span>
                  <ChevronDown aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={styles.profileMenu}>
                <DropdownMenuLabel>{profile.name || 'Your account'}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild><Link href="/dashboard/profile" prefetch={false}><User aria-hidden="true" /> Profile settings</Link></DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} disabled={signingOut}><LogOut aria-hidden="true" />{signingOut ? 'Signing out…' : 'Sign out'}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <nav className={styles.groupbar} aria-label="Workspace navigation">
          <button ref={menuRef} type="button" className={styles.menuButton} onClick={event => showMenu('all', event.currentTarget)} aria-haspopup="dialog"><Menu aria-hidden="true" /><span>All pages</span></button>
          {destinations.some(item => item.href === '/dashboard/ads') && <Link href="/dashboard/ads?view=tv" prefetch={false} className={`${styles.groupButton} ${styles.tvLink}`} aria-label="Ads Manager TV Mode" title="Open Ads Manager in TV Mode"><Tv aria-hidden="true" /><span>TV Mode</span></Link>}
          {allowedGroups.map(item => <button key={item.id} type="button" className={styles.groupButton} data-active={current?.group === item.id} onClick={event => showMenu(item.id, event.currentTarget)} aria-haspopup="dialog"><item.icon className={styles.groupIcon} aria-hidden="true" /><span>{item.label}</span><ChevronDown aria-hidden="true" /></button>)}
          <button type="button" className={styles.viewToggle} onClick={() => updatePreferences({ ...saved, wide: !saved.wide })} aria-pressed={saved.wide} aria-label="Use wider workspace" title={saved.wide ? 'Switch to focused width' : 'More room for tables'}>{saved.wide ? <Minimize2 aria-hidden="true" /> : <Expand aria-hidden="true" />}<span>{saved.wide ? 'Wide' : 'Focus'}</span></button>
        </nav>
        <nav className={styles.quickbar} aria-label="Pinned pages">
          <span className={styles.quickLabel}><Star aria-hidden="true" /> YOUR SHORTCUTS</span>
          {pins.map(item => <Link key={item.href} href={item.href} prefetch={false} className={styles.quickLink} data-active={current?.href === item.href} aria-current={current?.href === item.href ? 'page' : undefined}><item.icon aria-hidden="true" /><span>{item.label}</span></Link>)}
          <button type="button" className={styles.pinEditor} onClick={event => showMenu('pinned', event.currentTarget)} title="Personalize shortcuts"><SlidersHorizontal aria-hidden="true" /><span>Edit</span></button>
        </nav>
      </header>

      <main id="akmez-workspace-content" ref={mainRef} tabIndex={-1} data-dashboard-content className={styles.content}>
        <div data-dashboard-workspace className={styles.contentInner}>{children}</div>
      </main>
      <span className={styles.srOnly} role="status">{open ? '' : notice}</span>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent ref={navigatorRef} className={styles.dialog} showCloseButton={false} onOpenAutoFocus={event => { event.preventDefault(); searchRef.current?.focus() }} onCloseAutoFocus={event => { event.preventDefault(); const target = launcherRef.current; (target?.isConnected ? target : menuRef.current)?.focus() }}>
          <div className={styles.dialogHeader}>
            <div><div className={styles.dialogEyebrow}><Compass aria-hidden="true" /> AKMEZ / NAVIGATOR</div><DialogTitle className={styles.dialogTitle}>Your next move, one step away.</DialogTitle><DialogDescription className={styles.dialogDescription}>Find a page, explore a workspace, or pin your everyday tools.</DialogDescription></div>
            <button type="button" className={styles.iconButton} onClick={() => setOpen(false)} aria-label="Close workspace menu"><X aria-hidden="true" /></button>
          </div>
          <div className={styles.dialogSearchWrap}><Search aria-hidden="true" /><input ref={searchRef} className={styles.searchInput} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search pages, workflows or tools…" aria-label="Search workspace pages" autoComplete="off" />{query ? <button type="button" className={styles.clearButton} onClick={() => { setQuery(''); searchRef.current?.focus() }} aria-label="Clear menu search"><X aria-hidden="true" /></button> : <kbd className={styles.shortcutKey}>ESC</kbd>}</div>
          <div className={styles.dialogBody}>
            <nav className={styles.categories} aria-label="Filter workspace pages">
              <button type="button" className={styles.category} aria-pressed={!query && filter === 'all'} onClick={() => { setFilter('all'); setQuery('') }}><Command aria-hidden="true" /><span>All pages</span><span className={styles.categoryCount}>{destinations.length}</span></button>
              <button type="button" className={styles.category} aria-pressed={!query && filter === 'pinned'} onClick={() => { setFilter('pinned'); setQuery('') }}><Star aria-hidden="true" /><span>Your shortcuts</span><span className={styles.categoryCount}>{pins.length}</span></button>
              {allowedGroups.map(item => <button key={item.id} type="button" className={styles.category} aria-pressed={!query && filter === item.id} onClick={() => { setFilter(item.id); setQuery('') }}><item.icon aria-hidden="true" /><span>{item.label}</span><span className={styles.categoryCount}>{destinations.filter(destination => destination.group === item.id).length}</span></button>)}
            </nav>
            <div className={styles.results}>
              <div className={styles.resultHeading}><span>{normalizedQuery ? `Results for “${query.trim()}”` : filter === 'all' ? 'Explore your workspace' : filter === 'pinned' ? 'Your everyday essentials' : navigationGroups.find(item => item.id === filter)?.description}</span><span role="status">{visibleDestinations.length} {visibleDestinations.length === 1 ? 'page' : 'pages'}</span></div>
              {visibleDestinations.length ? <div className={styles.resultGrid}>{visibleDestinations.map(item => <div className={styles.destination} key={item.href} data-active={current?.href === item.href}>
                <Link href={item.href} prefetch={false} className={styles.destinationLink} aria-current={current?.href === item.href ? 'page' : undefined} onClick={() => setOpen(false)}><span className={styles.destinationIcon}><item.icon aria-hidden="true" /></span><span className={styles.destinationCopy}><strong>{item.label}</strong><span>{item.section === item.label ? navigationGroups.find(groupItem => groupItem.id === item.group)?.label : item.section}</span></span><ArrowUpRight className={styles.destinationArrow} aria-hidden="true" /></Link>
                <button type="button" className={styles.starButton} aria-pressed={pins.some(pin => pin.href === item.href)} onClick={() => togglePin(item.href)} aria-label={`${pins.some(pin => pin.href === item.href) ? 'Unpin' : 'Pin'} ${item.section === item.label ? item.label : item.section + ' ' + item.label}`}><Star aria-hidden="true" /></button>
              </div>)}</div> : <div className={styles.emptyState}><Sparkles aria-hidden="true" /><h3>{filter === 'pinned' && !query ? 'Make this space yours.' : 'No matching pages.'}</h3><p>{filter === 'pinned' && !query ? 'Explore All pages and select a star to keep your favorites close.' : 'Try a name like stock, collections or Blueprint.'}</p><button type="button" className={styles.menuButton} onClick={() => { setQuery(''); setFilter('all') }}>Explore all pages</button></div>}
            </div>
          </div>
          <div className={styles.dialogFooter}><span className={styles.hint} role="status">{notice || 'Star a page to pin it. Shortcuts are saved on this device.'}</span><span className={styles.hint}>Tab to move · Enter to open · Esc to close</span></div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
