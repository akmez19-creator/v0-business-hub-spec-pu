'use client'

import { useState, useMemo, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { createClient } from '@/lib/supabase/client'
import {
  Banknote, CheckCircle2, RotateCcw, AlertTriangle, Loader2, Package, Users, ChevronRight, Eye, EyeOff
} from 'lucide-react'

interface ContractorCashTotal {
  id: string
  name: string
  photoUrl: string | null
  pendingCash: number
  pendingDates: number
}

interface CMSItem {
  id: string
  delivery_date: string
  contractor_id: string | null
  contractor_name: string
  contractor_photo_url: string | null
  products: string | null
  qty: number
  stock_verified: boolean
}

interface GrandTotals {
  totalOrders: number
  totalCash: number
  collectedCash: number
  totalReturns: number
  verifiedReturns: number
}

interface Props {
  userId: string
  contractorCashTotals: ContractorCashTotal[]
  cmsItems: CMSItem[]
  grandTotals: GrandTotals
}

function fmtRs(n: number | undefined | null) { return `Rs ${(n || 0).toLocaleString()}` }

// Format cash with asterisks when hidden
function fmtRsHidden() { return 'Rs *****' }

export function StorekeeperModule({ userId, contractorCashTotals, cmsItems, grandTotals }: Props) {
  const router = useRouter()
  const [resetConfirm, setResetConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [showCash, setShowCash] = useState(false)
  
  // Auto-hide cash after 5 seconds
  const revealCash = useCallback(() => {
    setShowCash(true)
    setTimeout(() => setShowCash(false), 5000)
  }, [])

  // Calculate CMS returns by contractor
  const cmsReturnsByContractor = useMemo(() => {
    const map = new Map<string, { name: string; photoUrl: string | null; pendingReturns: number }>()
    for (const item of cmsItems) {
      const cKey = item.contractor_id || 'unknown'
      if (!map.has(cKey)) {
        map.set(cKey, { name: item.contractor_name, photoUrl: item.contractor_photo_url, pendingReturns: 0 })
      }
      if (!item.stock_verified) {
        map.get(cKey)!.pendingReturns += item.qty
      }
    }
    return map
  }, [cmsItems])

  // Calculate pending totals for display
  const pendingTotals = useMemo(() => {
    let pendingCash = 0
    let pendingReturns = 0
    for (const c of contractorCashTotals) {
      pendingCash += c.pendingCash
    }
    for (const [, data] of cmsReturnsByContractor) {
      pendingReturns += data.pendingReturns
    }
    return { pendingCash, pendingReturns }
  }, [contractorCashTotals, cmsReturnsByContractor])

  // Merge contractors with pending cash and/or pending returns into one list
  const mergedContractors = useMemo(() => {
    const map = new Map<string, {
      id: string
      name: string
      photoUrl: string | null
      pendingCash: number
      pendingDates: number
      pendingReturns: number
    }>()

    // Add contractors with pending cash
    for (const c of contractorCashTotals) {
      map.set(c.id, {
        id: c.id,
        name: c.name,
        photoUrl: c.photoUrl,
        pendingCash: c.pendingCash,
        pendingDates: c.pendingDates,
        pendingReturns: 0,
      })
    }

    // Add/merge contractors with pending returns
    for (const [id, data] of cmsReturnsByContractor.entries()) {
      if (data.pendingReturns > 0) {
        if (map.has(id)) {
          map.get(id)!.pendingReturns = data.pendingReturns
        } else {
          map.set(id, {
            id,
            name: data.name,
            photoUrl: data.photoUrl,
            pendingCash: 0,
            pendingDates: 0,
            pendingReturns: data.pendingReturns,
          })
        }
      }
    }

    // Sort by total pending (cash + returns count)
    return [...map.values()].sort((a, b) => (b.pendingCash + b.pendingReturns) - (a.pendingCash + a.pendingReturns))
  }, [contractorCashTotals, cmsReturnsByContractor])

  // For summary counts
  const uncollectedContractors = contractorCashTotals
  const contractorsWithReturns = mergedContractors.filter(c => c.pendingReturns > 0)

  async function handleResetAll() {
    setResetting(true)
    const supabase = createClient()
    // Reset cash collection
    await supabase.from('deliveries').update({ cash_collected: false, cash_collected_at: null, cash_collected_by: null }).eq('status', 'delivered')
    // Reset stock verification (CMS returns)
    await supabase.from('deliveries').update({ stock_verified: false, stock_verified_at: null, stock_verified_by: null }).eq('status', 'cms')
    // Reset stock out validation
    await supabase.from('deliveries').update({ stock_out: false, stock_out_at: null, stock_out_by: null }).not('stock_out', 'is', null)
    // Clear sessions
    await supabase.from('cash_collection_sessions').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    setResetting(false)
    setResetConfirm(false)
    router.refresh()
  }

  return (
    <div className="space-y-4 px-2 pb-20">
      {/* Grand Totals */}
      <div className="grid grid-cols-2 gap-3">
        <div className={cn(
          "glass-card rounded-2xl p-4 border",
          pendingTotals.pendingCash > 0 ? "border-amber-500/40 bg-amber-500/5" : "border-emerald-500/40 bg-emerald-500/5"
        )}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Banknote className={cn("w-5 h-5", pendingTotals.pendingCash > 0 ? "text-amber-400" : "text-emerald-400")} />
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Uncollected Cash</span>
            </div>
            <button type="button" onClick={revealCash} className="p-1.5 rounded-lg hover:bg-white/10 active:scale-95 transition-all">
              {showCash ? <EyeOff className="w-4 h-4 text-muted-foreground" /> : <Eye className="w-4 h-4 text-muted-foreground" />}
            </button>
          </div>
          <div className={cn("text-2xl font-bold", pendingTotals.pendingCash > 0 ? "text-amber-400" : "text-emerald-400")}>
            {showCash ? fmtRs(pendingTotals.pendingCash) : fmtRsHidden()}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {uncollectedContractors.length} contractor{uncollectedContractors.length !== 1 ? 's' : ''} pending
          </div>
        </div>

        <div className={cn(
          "glass-card rounded-2xl p-4 border",
          pendingTotals.pendingReturns > 0 ? "border-violet-500/40 bg-violet-500/5" : "border-emerald-500/40 bg-emerald-500/5"
        )}>
          <div className="flex items-center gap-2 mb-2">
            <RotateCcw className={cn("w-5 h-5", pendingTotals.pendingReturns > 0 ? "text-violet-400" : "text-emerald-400")} />
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Pending Returns</span>
          </div>
          <div className={cn("text-2xl font-bold", pendingTotals.pendingReturns > 0 ? "text-violet-400" : "text-emerald-400")}>
            {pendingTotals.pendingReturns} items
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {contractorsWithReturns.length} contractor{contractorsWithReturns.length !== 1 ? 's' : ''} pending
          </div>
        </div>
      </div>

      {/* All clear message */}
      {pendingTotals.pendingCash === 0 && pendingTotals.pendingReturns === 0 && (
        <div className="glass-card rounded-2xl p-6 border border-emerald-500/40 bg-emerald-500/5 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
          <div className="font-bold text-lg text-emerald-400">All Clear!</div>
          <div className="text-sm text-muted-foreground mt-1">All cash collected & returns verified</div>
        </div>
      )}

      {/* Merged Contractors List */}
      {mergedContractors.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span className="font-bold text-sm">Contractors</span>
          </div>
          <div className="space-y-2">
            {mergedContractors.map(c => (
              <div key={c.id} className="glass-card rounded-xl p-3">
                <div className="flex items-center gap-3">
                  {c.photoUrl ? (
                    <Image src={c.photoUrl} alt={c.name} width={40} height={40} className="w-10 h-10 rounded-xl object-cover shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-muted/30 flex items-center justify-center shrink-0">
                      <Users className="w-5 h-5 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-sm truncate">{c.name}</div>
                    <div className="flex items-center gap-3 mt-1.5">
                      {c.pendingCash > 0 && (
                        <Link href={`/dashboard/storekeeper/cash-collection?contractor=${c.id}`}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-400 text-xs font-bold active:scale-95 transition-all">
                          <Banknote className="w-3.5 h-3.5 shrink-0" />
                          <span>{showCash ? fmtRs(c.pendingCash) : fmtRsHidden()}</span>
                        </Link>
                      )}
                      {c.pendingReturns > 0 && (
                        <Link href={`/dashboard/storekeeper/stock-in?contractor=${c.id}`}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-500/20 text-violet-400 text-xs font-bold active:scale-95 transition-all">
                          <Package className="w-3.5 h-3.5 shrink-0" />
                          <span>{c.pendingReturns} returns</span>
                        </Link>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reset (testing) */}
      {(grandTotals.collectedCash > 0 || grandTotals.verifiedReturns > 0) && (
        <div className="flex justify-end">
          <button type="button" onClick={() => setResetConfirm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs text-red-400 border border-red-500/30 hover:bg-red-500/10 active:scale-95 transition-all">
            <RotateCcw className="w-3 h-3" /> Reset All (Testing)
          </button>
        </div>
      )}

      {/* Reset confirmation dialog */}
      <Dialog open={resetConfirm} onOpenChange={setResetConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset All Data?</DialogTitle>
            <DialogDescription>
              This will reset stock out validation, unmark all cash as uncollected, and all returns as unverified. This is for testing only.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleResetAll} disabled={resetting}>
              {resetting ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Resetting...</> : 'Reset All'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
