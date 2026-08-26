'use client'
// Returns verification v2 - auto-advance flow

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import {
  Package, ArrowLeft, Loader2, Users, CheckCircle2,
  ChevronLeft, ChevronRight, Calendar, Check, RotateCcw, AlertTriangle,
  ArrowLeftRight, Clock, ChevronDown, Truck
} from 'lucide-react'
import {
  groupReturns, splitBySource, FOLLOW_UP_SALES_TYPES, type ReturnGroup,
} from '@/lib/returns-merge'

interface ReturnItem {
  id: string
  product: string
  qty: number
  date: string
  riderName: string
  verified: boolean
  salesType?: string
  source: 'delivery' | 'return_collection'
  /** From incomingToStore(): why this product is the one coming back. */
  incomingKind?: 'unsold' | 'collected' | 'cms'
  customerName?: string | null
  /** What went OUT, so an exchange reads in both directions. */
  gaveProduct?: string | null
  fromVan?: boolean
  /**
   * Going back out on this day. DISPLAY ONLY - the pile stays on the day the
   * goods physically returned, and this is not part of the merge key.
   */
  rescheduledTo?: string | null
  /**
   * An agent ticked "rider kept it" when rescheduling. ADVISORY - it is set on
   * 1 of 66 rescheduled rows, so its absence proves nothing and it must never
   * remove the tick. It only warns the storekeeper to expect a gap.
   */
  vanHint?: boolean
}

/** A row where NOTHING has physically moved. Shown, but never counted. */
interface AwaitingItem {
  id: string
  product: string
  qty: number
  date: string
  riderName: string
  salesType?: string | null
  customerName?: string | null
  reason: string
  rescheduledTo?: string | null
  /**
   * The goods are on a rider's van, not merely un-dispatched. Drives a truck
   * icon instead of a clock, because "waiting in the warehouse" and "riding
   * around with JEFFREY" need different actions from the storekeeper.
   */
  onVan?: boolean
}

interface Contractor {
  id: string
  name: string
  items: ReturnItem[]
  awaiting?: AwaitingItem[]
  pendingQty: number
  verifiedQty: number
}

// Single source of truth - the component used to keep its own copy, which is
// how the two screens drifted apart before.
const FOLLOW_UP_TYPES: readonly string[] = FOLLOW_UP_SALES_TYPES

/**
 * OWNER'S RULE: refund / trade-in / exchange are counted FIRST - each has a
 * client owed something, so a mistake there is a person to call back rather
 * than just a wrong number in a pile.
 *
 * That decision now lives in `groupReturns()` as `group.settlementKind`,
 * because it has to be made per PILE, not per order: a pile earns the front if
 * ANY order in it is a live settlement. A follow-up whose client was MISSED is
 * only unsold stock coming back, so it does NOT earn the front - it is
 * labelled instead, so it can never read as a completed swap.
 */

interface Props {
  userId: string
  contractors: Contractor[]
  allContractors: Contractor[]  // All contractors with pending returns across all dates
  selectedDate: string
  availableDates: string[]
  totalPendingAll: number  // Total pending across ALL dates
  selectedContractorId?: string | null  // Pre-select and expand this contractor
}

/**
 * NEVER PUT A FIXED HEIGHT ON THE VIEW CONTAINERS IN THIS FILE.
 * This has now broken TWICE, both times reported as "cannot scroll on mobile".
 *
 * `StorekeeperMobileLayout` (components/storekeeper/mobile-layout.tsx) already
 * owns the scroll container: its `<main>` is `flex-1 overflow-y-auto pt-28 pb-20`.
 * Adding `h-[calc(100dvh-...)] flex flex-col` here gives the child a hard height
 * inside that already-scrolling parent, with no scroller of its own. Flex items
 * default to `flex-shrink: 1`, so the cards are COMPRESSED rather than allowed
 * to overflow - and every card is `overflow-hidden` (needed for its rounded
 * corners), so the compression SILENTLY SLICES ROWS AWAY.
 *
 * The rows are DESTROYED, not merely below the fold. Measured at 390x844 with
 * JEFFREY's real 17 pending items:
 *   fixed height: pending card 532px visible vs 1700px natural -> 5/17 items
 *                 reachable; the awaiting card 33px of 100px -> 0/1.
 *   natural flow: 17/17 and 1/1.
 * `pageScrollable` was already `true` in the broken version, which is why
 * scrolling never revealed them and why this reads as a scroll bug.
 *
 * The height was also simply wrong: `100dvh - 6rem` reserves 96px, but the
 * layout's own chrome is `pt-28` + `pb-20` = 192px.
 */
export function ReturnsPage({ userId, contractors, allContractors, selectedDate, availableDates, totalPendingAll, selectedContractorId }: Props) {
  const router = useRouter()
  const supabase = createClient()

  const [mode, setMode] = useState<'date' | 'contractor'>(selectedContractorId ? 'date' : 'contractor')
  const [activeContractorId, setActiveContractorId] = useState<string | null>(selectedContractorId || null)
  const [saving, setSaving] = useState<string | null>(null)
  const [verifyingAll, setVerifyingAll] = useState(false)
  const [status, setStatus] = useState('')
  
  // Track quantities and actions per item
  const [itemQuantities, setItemQuantities] = useState<Record<string, number>>({})
  const [itemActions, setItemActions] = useState<Record<string, 'verified' | 'missing' | null>>({})
  /**
   * Rows the storekeeper just recorded as never having come back. Kept locally
   * so the pile updates instantly, mirroring `locallyVerified` - the write is
   * already persisted and guarded by then.
   */
  const [notOnShelf, setNotOnShelf] = useState<Set<string>>(new Set())
  
  // Track locally verified items (to avoid page reload)
  const [locallyVerified, setLocallyVerified] = useState<Set<string>>(new Set())
  /** Which merged pile is showing its per-order breakdown. */
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const getItemQty = (itemId: string, originalQty: number) => itemQuantities[itemId] ?? originalQty
  const getItemAction = (itemId: string) => itemActions[itemId] ?? null

  const setItemQty = (itemId: string, qty: number) => {
    setItemQuantities(prev => ({ ...prev, [itemId]: Math.max(0, qty) }))
  }

  const setItemAction = (itemId: string, action: 'verified' | 'missing' | null) => {
    setItemActions(prev => ({ ...prev, [itemId]: action }))
  }

  const fmtDate = (d: string) => {
    const dt = new Date(d + 'T00:00:00')
    const today = new Date(); today.setHours(0,0,0,0)
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
    if (dt.getTime() === today.getTime()) return 'Today'
    if (dt.getTime() === yesterday.getTime()) return 'Yesterday'
    return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
  }

  const dateIdx = availableDates.indexOf(selectedDate)
  const displayContractors = mode === 'contractor' ? allContractors : contractors

  function navigateDate(dir: 'prev' | 'next') {
    const newIdx = dir === 'prev' ? dateIdx + 1 : dateIdx - 1
    if (newIdx >= 0 && newIdx < availableDates.length) {
      router.push(`/dashboard/storekeeper/stock-in?date=${availableDates[newIdx]}`)
    }
  }

  /**
   * Verify every order behind ONE merged product row.
   *
   * A merged pile can span BOTH tables - `deliveries.stock_verified` and
   * `return_collections.verified` - so the ids are routed by source. Ticking
   * "Make Up Pen x3" must not silently write to only one of them.
   */
  async function verifyGroup(group: ReturnGroup<ReturnItem>, contractorId: string) {
    const ids = group.entries.map(e => e.id)
    setSaving(group.key)
    setStatus('Verifying...')

    const { deliveryIds, collectionIds } = splitBySource(group.entries)
    const stamp = new Date().toISOString()

    if (deliveryIds.length) {
      const { error } = await supabase.from('deliveries').update({
        stock_verified: true, stock_verified_at: stamp, stock_verified_by: userId,
      }).in('id', deliveryIds)
      if (error) { setStatus(`Error: ${error.message}`); setSaving(null); return }
    }
    if (collectionIds.length) {
      const { error } = await supabase.from('return_collections').update({
        verified: true, verified_at: stamp, verified_by: userId,
      }).in('id', collectionIds)
      if (error) { setStatus(`Error: ${error.message}`); setSaving(null); return }
    }

    setLocallyVerified(prev => new Set([...prev, ...ids]))
    setSaving(null)
    setStatus('')
  }

  /**
   * "I cannot find this - the rider still has it."
   *
   * The storekeeper at the shelf is the only person who can actually see where
   * goods are, so this is the authoritative statement, not the agent's tick at
   * reschedule time (set on 1 of 66 rescheduled rows).
   *
   * Before this existed his only option was to mark the row missing, which was
   * pure client-side state - it vanished on reload and recorded a SHORTAGE
   * against stock that was never lost. This writes instead, and also sets
   * `reschedule_stock_mode` so the rider's own screen moves the item into
   * "keep on your van" without anyone re-entering it.
   *
   * GUARDED WRITE. A storekeeper's phone sleeps in his pocket; an update on a
   * dead Supabase session returns 204 with `error === null` and writes NOTHING.
   * `error` alone is not proof, so this selects the row back and treats zero
   * rows as failure - otherwise the row would silently reappear tomorrow.
   */
  async function markNotOnShelf(itemId: string, source: 'delivery' | 'return_collection') {
    if (source !== 'delivery') return
    setSaving(itemId)
    setStatus('Recording...')

    const { data, error } = await supabase
      .from('deliveries')
      .update({
        van_confirmed_by: userId,
        van_confirmed_at: new Date().toISOString(),
        reschedule_stock_mode: 'from_van',
      })
      .eq('id', itemId)
      .select('id')

    if (error) { setStatus(`Error: ${error.message}`); setSaving(null); return }
    if (!data || data.length === 0) {
      setStatus('Not saved - please sign in again')
      setSaving(null)
      return
    }

    setNotOnShelf(prev => new Set([...prev, itemId]))
    setSaving(null)
    setStatus('')
  }

  async function verifySingle(itemId: string, contractorId: string, source: 'delivery' | 'return_collection') {
    setSaving(itemId)
    setStatus('Verifying...')
    
    let error
    if (source === 'return_collection') {
      // Update return_collections table
      const result = await supabase.from('return_collections').update({
        verified: true,
        verified_at: new Date().toISOString(),
        verified_by: userId,
      }).eq('id', itemId)
      error = result.error
    } else {
      // Update deliveries table
      const result = await supabase.from('deliveries').update({
        stock_verified: true,
        stock_verified_at: new Date().toISOString(),
        stock_verified_by: userId,
      }).eq('id', itemId)
      error = result.error
    }
    
    if (error) {
      setStatus(`Error: ${error.message}`)
      setSaving(null)
      return
    }
    
    // Update local state instead of reloading
    setLocallyVerified(prev => new Set([...prev, itemId]))
    setSaving(null)
    setStatus('')
    
    // Check if all items for this contractor are now verified
    const contractor = displayContractors.find(c => c.id === contractorId)
    if (contractor) {
      const newVerifiedSet = new Set([...locallyVerified, itemId])
      const allVerified = contractor.items.every(item => item.verified || newVerifiedSet.has(item.id))
      
      if (allVerified) {
        // Find next contractor with unverified items
        const sortedContractors = [...displayContractors].sort((a, b) => b.items.length - a.items.length)
        const currentIndex = sortedContractors.findIndex(c => c.id === contractorId)
        
        let nextContractorId: string | null = null
        // Look for next unverified contractor after current one
        for (let i = currentIndex + 1; i < sortedContractors.length; i++) {
          const c = sortedContractors[i]
          const hasUnverified = c.items.some(item => !item.verified && !newVerifiedSet.has(item.id))
          if (hasUnverified) {
            nextContractorId = c.id
            break
          }
        }
        // If no next found, check from beginning (wrap around)
        if (!nextContractorId) {
          for (let i = 0; i < currentIndex; i++) {
            const c = sortedContractors[i]
            const hasUnverified = c.items.some(item => !item.verified && !newVerifiedSet.has(item.id))
            if (hasUnverified) {
              nextContractorId = c.id
              break
            }
          }
        }
        
        // Move to next contractor or go back to list
        if (nextContractorId) {
          setActiveContractorId(nextContractorId)
          setItemQuantities({})
          setItemActions({})
        } else {
          // All contractors done, go back to dashboard
          window.location.href = '/dashboard/storekeeper'
        }
      }
    }
  }

  async function verifyAllForContractor(contractorId: string) {
    setVerifyingAll(true)
    setStatus('Verifying all items...')
    
    const contractor = displayContractors.find(c => c.id === contractorId)
    if (!contractor) return

    const unverifiedItems = contractor.items.filter(i => !i.verified && !locallyVerified.has(i.id))
    const unverifiedIds = unverifiedItems.map(i => i.id)
    
    // Separate by source
    const deliveryIds = unverifiedItems.filter(i => i.source === 'delivery').map(i => i.id)
    const returnCollectionIds = unverifiedItems.filter(i => i.source === 'return_collection').map(i => i.id)
    
    // Update deliveries table
    if (deliveryIds.length > 0) {
      const { error } = await supabase.from('deliveries').update({
        stock_verified: true,
        stock_verified_at: new Date().toISOString(),
        stock_verified_by: userId,
      }).in('id', deliveryIds)
      
      if (error) {
        setStatus(`Error: ${error.message}`)
        setVerifyingAll(false)
        return
      }
    }
    
    // Update return_collections table
    if (returnCollectionIds.length > 0) {
      const { error } = await supabase.from('return_collections').update({
        verified: true,
        verified_at: new Date().toISOString(),
        verified_by: userId,
      }).in('id', returnCollectionIds)
      
      if (error) {
        setStatus(`Error: ${error.message}`)
        setVerifyingAll(false)
        return
      }
    }
    
    // Update local state
    setLocallyVerified(prev => new Set([...prev, ...unverifiedIds]))
    setVerifyingAll(false)
    setStatus('')
    
    // Find next contractor with unverified items
    const newVerifiedSet = new Set([...locallyVerified, ...unverifiedIds])
    const sortedContractors = [...displayContractors].sort((a, b) => b.items.length - a.items.length)
    const currentIndex = sortedContractors.findIndex(c => c.id === contractorId)
    
    let nextContractorId: string | null = null
    for (let i = currentIndex + 1; i < sortedContractors.length; i++) {
      const c = sortedContractors[i]
      const hasUnverified = c.items.some(item => !item.verified && !newVerifiedSet.has(item.id))
      if (hasUnverified) {
        nextContractorId = c.id
        break
      }
    }
    if (!nextContractorId) {
      for (let i = 0; i < currentIndex; i++) {
        const c = sortedContractors[i]
        const hasUnverified = c.items.some(item => !item.verified && !newVerifiedSet.has(item.id))
        if (hasUnverified) {
          nextContractorId = c.id
          break
        }
      }
    }
    
    if (nextContractorId) {
      setActiveContractorId(nextContractorId)
      setItemQuantities({})
      setItemActions({})
    } else {
      window.location.href = '/dashboard/storekeeper'
    }
  }

  // Get active contractor data
  const activeContractor = activeContractorId ? displayContractors.find(c => c.id === activeContractorId) : null

  // Reset state when selecting a new contractor
  const selectContractor = (id: string | null) => {
    setActiveContractorId(id)
    setItemQuantities({})
    setItemActions({})
    setStatus('')
  }

  // ── VERIFICATION VIEW ──
  if (activeContractor) {
    // A row he has just recorded as "rider still has it" leaves the countable
    // pile immediately. It is resolved, not outstanding - leaving it would keep
    // the list from reaching zero, the original sin of this screen.
    const pendingItems = activeContractor.items.filter(
      i => !i.verified && !locallyVerified.has(i.id) && !notOnShelf.has(i.id),
    )
    const verifiedItems = activeContractor.items.filter(i => i.verified || locallyVerified.has(i.id))
    // Rows recorded as never-returned join the read-only list in the same pass,
    // so the goods stay visible somewhere and cannot silently disappear.
    const justRecorded: AwaitingItem[] = activeContractor.items
      .filter(i => notOnShelf.has(i.id))
      .map(i => ({
        id: i.id,
        product: i.product,
        qty: i.qty,
        date: i.date,
        riderName: i.riderName,
        salesType: i.salesType,
        customerName: i.customerName,
        rescheduledTo: i.rescheduledTo,
        reason: 'You recorded this as never returned - rider still has it',
        onVan: true,
      }))
    const awaiting = [...(activeContractor.awaiting || []), ...justRecorded]

    // ONE ROW PER PRODUCT. He is counting a heap, so 3 Make Up Pen orders are
    // one pile of 3 - not three lines to add up in his head.
    //
    // Grouping happens AFTER the pending/verified split, so a half-received
    // product shows what is left rather than a stale total.
    //
    // Follow-ups first: a group counts as one if ANY entry is a follow-up. The
    // sort is STABLE (index tie-break) so nothing else reshuffles.
    const pendingGroups = groupReturns(pendingItems)
      .map((g, i) => ({ g, i }))
      .sort((a, b) => {
        const d = Number(!!b.g.settlementKind) - Number(!!a.g.settlementKind)
        return d !== 0 ? d : a.i - b.i
      })
      .map(x => x.g)

    const followUpGroupCount = pendingGroups.filter(g => !!g.settlementKind).length

    // NATURAL FLOW - do not put a height on this container. See the header
    // comment above `ReturnsPage` for the full reasoning; the short version is
    // that `StorekeeperMobileLayout` already owns the scroller, and a fixed
    // height here COMPRESSES the cards instead of overflowing them, which
    // silently destroys rows (measured: 12 of 17 unreachable).
    return (
      <div className="px-3 pb-4">
        {/* Header */}
        <div className="flex items-center gap-3 py-3 border-b border-border/30 mb-3">
          <button type="button" onClick={() => selectContractor(null)} 
            className="w-10 h-10 rounded-xl bg-muted/30 flex items-center justify-center active:scale-90">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <div className="font-bold text-lg">{activeContractor.name}</div>
            <div className="text-sm text-muted-foreground">
              <span className="text-violet-400 font-bold">{pendingItems.length}</span> pending, 
              <span className="text-emerald-400 font-bold ml-1">{verifiedItems.length}</span> verified
            </div>
          </div>
        </div>

        {/* Status */}
        {status && (
          <div className={cn("p-3 rounded-xl text-sm mb-3",
            status.startsWith('Error') ? "bg-red-500/20 text-red-300" : "bg-blue-500/20 text-blue-300"
          )}>
            {status}
          </div>
        )}

        {/* Verify All Button */}
        {pendingItems.length > 0 && (
          <button type="button" onClick={() => verifyAllForContractor(activeContractor.id)} disabled={verifyingAll}
            className="w-full h-14 rounded-2xl bg-emerald-500 text-white font-bold flex items-center justify-center gap-2 mb-3 active:scale-95 disabled:opacity-50">
            {verifyingAll ? <><Loader2 className="w-5 h-5 animate-spin" /> Verifying...</> 
              : <><CheckCircle2 className="w-5 h-5" /> Verify All ({pendingItems.length} items)</>}
          </button>
        )}

        {/* Says WHY the order changed, so the new sequence is not a mystery. */}
        {followUpGroupCount > 0 && (
          <div className="flex items-center gap-2 px-1 pb-2">
            <ArrowLeftRight className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-xs text-amber-400 font-medium">
              {followUpGroupCount} to settle - count these first
            </span>
          </div>
        )}

        {/* ONE ROW PER PRODUCT PILE */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden divide-y divide-border">
          {pendingGroups.map((group, gi) => {
            const kind = group.settlementKind
            const expanded = expandedKey === group.key
            // Named clients behind this pile - one pile can hold several.
            const clients = [...new Set(
              group.entries.map(e => e.customerName).filter(Boolean) as string[]
            )]
            // How much of this pile is already re-planned. A COUNT, not a date:
            // one pile can hold orders moved to several different days, so
            // naming a single day here would be a false statement.
            const goingBackOut = group.entries.filter(e => e.rescheduledTo).length

            return (
              <div key={group.key}>
                {/* Boundary between the two sections, so the reorder is legible. */}
                {gi === followUpGroupCount && followUpGroupCount > 0 && (
                  <div className="px-4 py-1.5 bg-muted/20 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Unsold returns
                  </div>
                )}

                <div className="px-4 py-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center shrink-0">
                    <Package className="w-5 h-5 text-violet-400" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{group.label}</span>
                      {kind && (
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase shrink-0",
                          kind === 'trade_in' ? "bg-purple-500/20 text-purple-400" :
                          kind === 'exchange' ? "bg-blue-500/20 text-blue-400" :
                          "bg-orange-500/20 text-orange-400"
                        )}>
                          {kind.replace('_', ' ')}
                        </span>
                      )}
                      {goingBackOut > 0 && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 bg-primary/15 text-primary">
                          {goingBackOut === group.entries.length
                            ? 'going back out'
                            : `${goingBackOut} going back out`}
                        </span>
                      )}
                    </div>

                    {/* A follow-up names a CLIENT and moves goods both ways. */}
                    {kind && (
                      <div className="text-xs text-amber-400/90 mt-0.5 truncate">
                        {clients.length > 0 && `${clients.join(', ')} - `}
                        took back this
                      </div>
                    )}

                    {/* An agent flagged one or more of these as kept by the
                        rider. A prompt to look, never a reason to skip: the
                        flag exists on 1 of 66 rescheduled rows, so it cannot
                        decide where goods are. */}
                    {group.entries.some(e => e.vanHint) && (
                      <div className="text-xs text-amber-400/90 mt-0.5 truncate">
                        {group.entries.every(e => e.vanHint)
                          ? 'agent says rider kept it - check the shelf'
                          : `${group.entries.filter(e => e.vanHint).length} may still be on the van`}
                      </div>
                    )}

                    {/* A follow-up the client never received: the replacement
                        came back unsold, their old item is still with them. */}
                    {!kind && group.entries.some(e => e.incomingKind === 'cms' && FOLLOW_UP_TYPES.includes(e.salesType || '')) && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Not completed - client missed
                      </div>
                    )}

                    {/* NOTE: no "quantity missing" warning here on purpose.
                        `incomingToStore()` already floors qty at 1, the same
                        convention the outbound sheets use, so a 0 in the DB
                        reaches this screen as 1 and the warning could never
                        fire. 4 live rows store qty 0 - flagged to the owner as
                        a data question rather than silently re-counted here. */}
                    <button
                      type="button"
                      onClick={() => setExpandedKey(expanded ? null : group.key)}
                      className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1"
                    >
                      {group.entries.length} {group.entries.length === 1 ? 'order' : 'orders'}
                      {group.entries.length > 1 && (
                        <ChevronDown className={cn('w-3 h-3 transition-transform', expanded && 'rotate-180')} />
                      )}
                    </button>
                  </div>

                  <div className="min-w-[40px] px-2 py-1.5 rounded-xl bg-violet-500/10 text-center shrink-0">
                    <p className="text-lg font-bold text-violet-400 tabular-nums">{group.totalQty}</p>
                  </div>

                  {/* "Cannot find it" for a pile that IS one order. Only shown
                      when there is exactly one, so it can never be ambiguous
                      which order is being recorded; bigger piles get the same
                      button per row in the breakdown below. */}
                  {group.entries.length === 1 && group.entries[0].source === 'delivery' && (
                    <button
                      type="button"
                      onClick={() => markNotOnShelf(group.entries[0].id, group.entries[0].source)}
                      disabled={saving === group.key || saving === group.entries[0].id}
                      title="Not on the shelf - rider still has it"
                      className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0 active:scale-95 disabled:opacity-50"
                    >
                      <Truck className="w-5 h-5 text-amber-400" />
                    </button>
                  )}

                  {/* Ticks the whole pile, routing ids to both tables. */}
                  <button
                    type="button"
                    onClick={() => verifyGroup(group, activeContractor.id)}
                    disabled={saving === group.key}
                    className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center shrink-0 active:scale-95 disabled:opacity-50"
                  >
                    {saving === group.key ? (
                      <Loader2 className="w-5 h-5 text-white animate-spin" />
                    ) : (
                      <Check className="w-5 h-5 text-white" />
                    )}
                  </button>
                </div>

                {/* Per-order breakdown, so ONE order can still be ticked when
                    the pile does not match what is physically there. */}
                {expanded && group.entries.length > 1 && (
                  <div className="bg-muted/10 divide-y divide-border/40">
                    {group.entries.map(e => (
                      <div key={e.id} className="pl-16 pr-4 py-2 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-xs truncate">
                            {e.customerName || 'No client name'}
                          </p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {e.product}
                            {mode === 'contractor' && ` · ${fmtDate(e.date)}`}
                            {` · ${e.riderName}`}
                          </p>
                          {/* Going back out. Still counted and ticked on THIS
                              day - the goods are on the shelf now. */}
                          {e.rescheduledTo && (
                            <p className="text-[10px] font-medium text-primary">
                              back out {fmtDate(e.rescheduledTo)}
                            </p>
                          )}
                          {/* The agent thought the rider kept this one. Said as
                              a warning, not a fact - it is right 1 time in 66,
                              and the tick stays live either way. */}
                          {e.vanHint && (
                            <p className="text-[10px] text-amber-400/90">
                              agent says rider kept it - check the shelf
                            </p>
                          )}
                        </div>
                        <span className="text-xs font-bold text-violet-400 tabular-nums shrink-0">
                          {e.qty}
                        </span>
                        {/* "Cannot find it." Persists, so it is no longer a
                            client-side missing flag that dies on reload. */}
                        {e.source === 'delivery' && (
                          <button
                            type="button"
                            onClick={() => markNotOnShelf(e.id, e.source)}
                            disabled={saving === e.id}
                            title="Not on the shelf - rider still has it"
                            className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0 active:scale-95 disabled:opacity-50"
                          >
                            <Truck className="w-4 h-4 text-amber-400" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => verifySingle(e.id, activeContractor.id, e.source)}
                          disabled={saving === e.id}
                          className="w-8 h-8 rounded-lg bg-emerald-500/80 flex items-center justify-center shrink-0 active:scale-95 disabled:opacity-50"
                        >
                          {saving === e.id ? (
                            <Loader2 className="w-4 h-4 text-white animate-spin" />
                          ) : (
                            <Check className="w-4 h-4 text-white" />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

        </div>

        {/* NOT ON YOUR SHELF.
            These used to sit in the list above with a tick button, so the
            storekeeper was asked to count goods that were not in front of him -
            and the list could never reach zero. No tick button here on purpose:
            there is nothing to verify.

            Deliberately NOT called "nothing moved yet". That was already untrue
            of the 58 NWD rows (they went out and were refused) and is untrue of
            a van-kept reschedule, which went out and stayed out. What every row
            here has in common is only that it is not on the storekeeper's
            shelf, so that is what the heading says. */}
        {awaiting.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center gap-2 px-1 mb-2">
              <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Not on your shelf ({awaiting.length})
              </span>
            </div>
            <div className="rounded-2xl border border-dashed border-border bg-muted/10 overflow-hidden divide-y divide-border/50">
              {awaiting.map(a => (
                <div key={a.id} className="px-4 py-3 flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                    a.onVan ? 'bg-amber-500/10' : 'bg-muted/30'
                  }`}>
                    {a.onVan
                      ? <Truck className="w-5 h-5 text-amber-500" aria-hidden="true" />
                      : <Clock className="w-5 h-5 text-muted-foreground" aria-hidden="true" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate text-muted-foreground">{a.product}</span>
                      {a.salesType && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold uppercase shrink-0 bg-muted/40 text-muted-foreground">
                          {a.salesType.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground/80 mt-0.5">
                      {a.reason}
                      {/* An order that never went out but has already been
                          re-planned. Says WHEN, so this row is not mistaken
                          for one nobody has dealt with. */}
                      {a.rescheduledTo && (
                        <span className="text-primary font-medium">
                          {' '}· moved to {fmtDate(a.rescheduledTo)}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                      {a.customerName ? `${a.customerName} · ` : ''}
                      {mode === 'contractor' && <span>{fmtDate(a.date)} · </span>}
                      {a.riderName}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground/60 shrink-0">not due</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Verified Items Section */}
        {verifiedItems.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-bold uppercase tracking-wider text-emerald-400 px-1 mb-2">Already Verified ({verifiedItems.length})</div>
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 overflow-hidden divide-y divide-border">
              {verifiedItems.map(item => (
                <div key={item.id} className="px-4 py-3 flex items-center gap-3 opacity-60">
                  {/* Verified Icon */}
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  </div>
                  
                  {/* Product Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{item.product}</span>
                      {item.salesType && item.salesType !== 'cms' && (
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase shrink-0",
                          item.salesType === 'trade_in' ? "bg-purple-500/20 text-purple-400" :
                          item.salesType === 'exchange' ? "bg-blue-500/20 text-blue-400" :
                          item.salesType === 'refund' ? "bg-orange-500/20 text-orange-400" :
                          "bg-muted/30 text-muted-foreground"
                        )}>
                          {item.salesType.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{item.riderName}</div>
                  </div>
                  
                  {/* Quantity */}
                  <div className="min-w-[40px] px-2 py-1.5 rounded-xl bg-emerald-500/10 text-center shrink-0">
                    <p className="text-lg font-bold text-emerald-400 tabular-nums">{item.qty}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary Footer */}
        {pendingItems.length > 0 && (
          <div className="glass-card rounded-xl p-3 mt-3 border-t border-border/30">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-muted-foreground">Verified:</span>
                  <span className="font-bold text-emerald-400">
                    {pendingItems.filter(i => getItemAction(i.id) === 'verified').length}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-red-400" />
                  <span className="text-muted-foreground">Missing:</span>
                  <span className="font-bold text-red-400">
                    {pendingItems.filter(i => getItemAction(i.id) === 'missing').length}
                  </span>
                </div>
              </div>
              <div className="text-muted-foreground">
                {pendingItems.filter(i => !getItemAction(i.id)).length} left
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── MAIN LIST VIEW ──
  // Compute adjusted counts accounting for locally verified items
  const getAdjustedCounts = (c: Contractor) => {
    const localVerifiedCount = c.items.filter(i => !i.verified && locallyVerified.has(i.id)).length
    const localVerifiedQty = c.items.filter(i => !i.verified && locallyVerified.has(i.id)).reduce((sum, i) => sum + i.qty, 0)
    return {
      verifiedQty: c.verifiedQty + localVerifiedQty,
      pendingQty: Math.max(0, c.pendingQty - localVerifiedQty),
      pendingCount: c.items.filter(i => !i.verified && !locallyVerified.has(i.id)).length,
    }
  }
  
  const totalItems = displayContractors.reduce((sum, c) => sum + c.items.length, 0)
  const totalVerified = displayContractors.reduce((sum, c) => sum + getAdjustedCounts(c).verifiedQty, 0)
  const totalPending = displayContractors.reduce((sum, c) => sum + getAdjustedCounts(c).pendingQty, 0)
  const progressPercent = totalItems > 0 ? Math.round((totalVerified / (totalVerified + totalPending)) * 100) : 0

  return (
    <div className="px-3 space-y-3">
      {/* Compact Header with Date Nav + Progress */}
      <div className="glass-card rounded-2xl p-3">
        {/* Top row: Back + Mode Toggle */}
        <div className="flex items-center justify-between mb-3">
          <Link href="/dashboard/storekeeper" className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex bg-muted/30 rounded-lg p-0.5">
            <button type="button" onClick={() => setMode('contractor')}
              className={cn("px-3 py-1.5 rounded-md text-xs font-bold transition-all",
                mode === 'contractor' ? "bg-violet-500 text-white" : "text-muted-foreground")}>
              Contractor
            </button>
            <button type="button" onClick={() => setMode('date')}
              className={cn("px-3 py-1.5 rounded-md text-xs font-bold transition-all",
                mode === 'date' ? "bg-violet-500 text-white" : "text-muted-foreground")}>
              Date
            </button>
          </div>
        </div>

        {/* Date Navigation (in date mode) or Title (in contractor mode) */}
        <div className="flex items-center justify-between mb-3">
          {mode === 'date' ? (
            <>
              <button type="button" onClick={() => navigateDate('prev')} disabled={dateIdx >= availableDates.length - 1}
                className="w-8 h-8 rounded-lg bg-muted/30 flex items-center justify-center disabled:opacity-30 active:scale-90">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-violet-400" />
                <span className="font-bold">{fmtDate(selectedDate)}</span>
              </div>
              <button type="button" onClick={() => navigateDate('next')} disabled={dateIdx <= 0}
                className="w-8 h-8 rounded-lg bg-muted/30 flex items-center justify-center disabled:opacity-30 active:scale-90">
                <ChevronRight className="w-4 h-4" />
              </button>
            </>
          ) : (
            <div className="flex items-center gap-2 w-full justify-center">
              <RotateCcw className="w-4 h-4 text-violet-400" />
              <span className="font-bold">All Pending Returns</span>
            </div>
          )}
        </div>

        {/* Progress Bar */}
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <div className="h-2 bg-muted/30 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[10px] text-muted-foreground">{totalVerified} verified</span>
              <span className="text-[10px] text-violet-400 font-bold">{totalPending} pending</span>
            </div>
          </div>
          <div className="text-2xl font-black text-violet-400">{totalPendingAll}</div>
        </div>
      </div>

      {/* Contractor List */}
      {displayContractors.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Package className="w-16 h-16 mx-auto mb-3 opacity-20" />
          <p className="font-medium">No pending returns</p>
        </div>
      ) : (
        <div className="space-y-2 pb-24">
          {displayContractors.map(c => {
            const adjusted = getAdjustedCounts(c)
            const allDone = adjusted.pendingQty === 0
            return (
              <button key={c.id} type="button" onClick={() => selectContractor(c.id)}
                className={cn(
                  "w-full glass-card rounded-2xl p-4 text-left active:scale-[0.98] transition-all",
                  allDone ? "border border-emerald-500/30 bg-emerald-500/5" : "border border-violet-500/30"
                )}>
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-12 h-12 rounded-xl flex items-center justify-center",
                    allDone ? "bg-gradient-to-br from-emerald-500 to-green-600" : "bg-gradient-to-br from-violet-500 to-purple-600"
                  )}>
                    {allDone ? <CheckCircle2 className="w-6 h-6 text-white" /> : <Users className="w-6 h-6 text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold truncate">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.items.length} items | {adjusted.pendingQty + adjusted.verifiedQty} qty
                    </div>
                  </div>
                  <div className="text-right">
                    {allDone ? (
                      <span className="text-xs font-bold text-emerald-400 bg-emerald-500/20 px-2 py-1 rounded-lg">Done</span>
                    ) : (
                      <>
                        <div className="text-xl font-bold text-violet-400">{adjusted.pendingQty}</div>
                        <div className="text-[10px] text-muted-foreground">pending</div>
                      </>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
