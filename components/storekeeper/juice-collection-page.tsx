'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ChevronDown, Smartphone, Check, Loader2, User, Calendar, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'

interface Delivery {
  id: string
  index_no: string | null
  customer_name: string | null
  payment_juice: number
  delivery_date: string
  rider_id: string | null
  rider_name: string
  contractor_id: string | null
  juice_collected: boolean
  contractor_juice_counted: number
  contractor_juice_counted_at: string | null
  juice_transfer_screenshot: string | null
  juice_transfer_reference: string | null
  juice_transfer_amount: number | null
  juice_transferred_at: string | null
}

interface Contractor {
  id: string
  name: string
  photo_url: string | null
}

interface Props {
  userId: string
  deliveries: Delivery[]
  contractors: Contractor[]
  availableDates: string[]
  selectedDate: string
}

const fmtRs = (n: number) => `Rs ${n.toLocaleString('en-MU')}`

export function JuiceCollectionPage({ userId, deliveries, contractors, availableDates, selectedDate }: Props) {
  const router = useRouter()
  const [activeContractor, setActiveContractor] = useState<string | null>(null)
  const [showDatePicker, setShowDatePicker] = useState(false)

  // Filter deliveries for selected date
  const dateDeliveries = useMemo(() => 
    deliveries.filter(d => d.delivery_date === selectedDate),
    [deliveries, selectedDate]
  )

  // Group deliveries by contractor
  const contractorDeliveries = useMemo(() => {
    const map = new Map<string, Delivery[]>()
    for (const d of dateDeliveries) {
      if (d.contractor_id) {
        const existing = map.get(d.contractor_id) || []
        existing.push(d)
        map.set(d.contractor_id, existing)
      }
    }
    return map
  }, [dateDeliveries])

  // Get contractors with pending juice
  const contractorsWithJuice = useMemo(() => 
    contractors.filter(c => contractorDeliveries.has(c.id)),
    [contractors, contractorDeliveries]
  )

  // Calculate totals
  const totalExpected = dateDeliveries.reduce((t, d) => t + d.payment_juice, 0)

  // Get active contractor details
  const activeContractorData = activeContractor 
    ? contractors.find(c => c.id === activeContractor)
    : null
  const activeDeliveries = activeContractor 
    ? contractorDeliveries.get(activeContractor) || []
    : []

  // If viewing a contractor's sheet
  if (activeContractor && activeContractorData) {
    return (
      <ContractorJuiceSheet
        contractor={activeContractorData}
        deliveries={activeDeliveries}
        userId={userId}
        date={selectedDate}
        onBack={() => setActiveContractor(null)}
        onSuccess={() => {
          // Navigate to stock-in (returns) page after collection
          router.push(`/dashboard/storekeeper/stock-in?contractor=${activeContractor}`)
        }}
      />
    )
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-md border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <button 
            onClick={() => router.back()}
            className="p-2 rounded-full bg-muted/50 hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">Juice Collection</h1>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Date Selector */}
        <button
          onClick={() => setShowDatePicker(!showDatePicker)}
          className="w-full flex items-center justify-between p-4 rounded-2xl bg-muted/30 border"
        >
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-purple-500" />
            <span className="font-medium">
              {selectedDate === new Date().toISOString().split('T')[0] ? 'Today' : 
               new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
            </span>
          </div>
          <ChevronDown className={cn("w-5 h-5 transition-transform", showDatePicker && "rotate-180")} />
        </button>

        {showDatePicker && (
          <div className="rounded-xl border bg-card p-2 space-y-1">
            {availableDates.map(date => (
              <button
                key={date}
                onClick={() => {
                  router.push(`/dashboard/storekeeper/juice-collection?date=${date}`)
                  setShowDatePicker(false)
                }}
                className={cn(
                  "w-full text-left px-4 py-2.5 rounded-lg transition-colors",
                  date === selectedDate ? "bg-purple-500/20 text-purple-400" : "hover:bg-muted"
                )}
              >
                {date === new Date().toISOString().split('T')[0] ? 'Today' : 
                 new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </button>
            ))}
          </div>
        )}

        {/* Summary Card */}
        <Card className="border-2 border-purple-500/30 bg-gradient-to-br from-purple-500/10 to-violet-500/5">
          <CardContent className="py-5 px-6 text-center">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Smartphone className="w-5 h-5 text-purple-400" />
              <span className="text-xs uppercase text-purple-400/70 font-semibold tracking-wider">Juice to Collect</span>
            </div>
            <div className="text-4xl font-black text-purple-400 mb-1">{fmtRs(totalExpected)}</div>
            <div className="text-sm text-muted-foreground">{contractorsWithJuice.length} contractors</div>
          </CardContent>
        </Card>

        {/* Contractor List */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">
            Contractors with Juice Payments
          </h2>
          
          {contractorsWithJuice.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center text-muted-foreground">
                <Smartphone className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>No pending Juice payments</p>
              </CardContent>
            </Card>
          ) : (
            contractorsWithJuice.map(contractor => {
              const cDeliveries = contractorDeliveries.get(contractor.id) || []
              const total = cDeliveries.reduce((t, d) => t + d.payment_juice, 0)
              const hasTransferProof = cDeliveries.some(d => d.juice_transfer_reference)
              const transferRef = cDeliveries.find(d => d.juice_transfer_reference)?.juice_transfer_reference
              const transferAmount = cDeliveries.find(d => d.juice_transfer_amount)?.juice_transfer_amount || 0
              
              return (
                <button
                  key={contractor.id}
                  onClick={() => setActiveContractor(contractor.id)}
                  className="w-full text-left"
                >
                  <Card className={cn(
                    "transition-all hover:border-purple-500/50",
                    hasTransferProof ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"
                  )}>
                    <CardContent className="py-4 px-4">
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          {contractor.photo_url ? (
                            <img 
                              src={contractor.photo_url} 
                              alt={contractor.name}
                              className="w-12 h-12 rounded-full object-cover"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center">
                              <User className="w-6 h-6 text-purple-400" />
                            </div>
                          )}
                          {hasTransferProof ? (
                            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center">
                              <Check className="w-3 h-3 text-white" />
                            </div>
                          ) : (
                            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center">
                              <span className="text-[10px] text-white font-bold">!</span>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate">{contractor.name}</p>
                          {hasTransferProof ? (
                            <p className="text-xs text-emerald-500 font-medium">
                              Transfer confirmed • {transferRef}
                            </p>
                          ) : (
                            <p className="text-xs text-amber-500 font-medium">
                              Pending transfer proof
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className={cn(
                            "text-lg font-bold",
                            hasTransferProof ? "text-emerald-500" : "text-amber-500"
                          )}>
                            {fmtRs(hasTransferProof ? transferAmount : total)}
                          </p>
                          <p className="text-[10px] text-muted-foreground">
                            {cDeliveries.length} delivery{cDeliveries.length !== 1 ? 's' : ''}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

// Contractor Juice Sheet Component
function ContractorJuiceSheet({ 
  contractor, 
  deliveries, 
  userId,
  date,
  onBack,
  onSuccess 
}: { 
  contractor: Contractor
  deliveries: Delivery[]
  userId: string
  date: string
  onBack: () => void
  onSuccess: () => void
}) {
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  // Calculate totals
  const totalExpected = deliveries.reduce((t, d) => t + d.payment_juice, 0)
  
  // Check if contractor has uploaded transfer proof
  const hasTransferProof = deliveries.some(d => d.juice_transfer_reference)
  const transferScreenshot = deliveries.find(d => d.juice_transfer_screenshot)?.juice_transfer_screenshot
  const transferReference = deliveries.find(d => d.juice_transfer_reference)?.juice_transfer_reference
  const transferAmount = deliveries.find(d => d.juice_transfer_amount)?.juice_transfer_amount || 0
  const transferredAt = deliveries.find(d => d.juice_transferred_at)?.juice_transferred_at

  // Use transfer amount if available, otherwise expected
  const counted = hasTransferProof ? transferAmount : totalExpected
  const diff = counted - totalExpected

  const handleSave = async () => {
    // Prevent collection if no transfer proof
    if (!hasTransferProof) {
      alert('Cannot collect: Contractor has not uploaded their transfer proof yet.')
      return
    }
    
    // Prevent collection if amounts don't match
    if (diff !== 0) {
      alert('Cannot collect: Amount mismatch between transfer and expected.')
      return
    }
    
    setSaving(true)
    try {
      const ids = deliveries.map(d => d.id)
      
      // Mark deliveries as juice collected
      await supabase
        .from('deliveries')
        .update({
          juice_collected: true,
          juice_collected_by: userId,
          juice_collected_at: new Date().toISOString(),
        })
        .in('id', ids)

      onSuccess()
    } catch (error) {
      console.error('Error collecting juice:', error)
      alert('Failed to collect juice. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-background pb-32">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-md border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <button 
            onClick={onBack}
            className="p-2 rounded-full bg-muted/50 hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3 flex-1">
            {contractor.photo_url ? (
              <img 
                src={contractor.photo_url} 
                alt={contractor.name}
                className="w-10 h-10 rounded-full object-cover"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
                <User className="w-5 h-5 text-purple-400" />
              </div>
            )}
            <div>
              <h1 className="font-bold">{contractor.name}</h1>
              <p className="text-xs text-muted-foreground">Juice Collection</p>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Transfer Proof Section */}
        {hasTransferProof ? (
          <Card className="border-emerald-500/50 bg-emerald-500/10">
            <CardContent className="py-4 px-4">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                <p className="text-sm font-bold text-emerald-500">Transfer Confirmed by Contractor</p>
              </div>
              
              {/* Transaction Reference */}
              <div className="bg-background/50 rounded-lg p-3 mb-3">
                <p className="text-[10px] text-muted-foreground uppercase mb-1">Transaction Reference</p>
                <p className="font-mono font-bold text-emerald-400">{transferReference}</p>
              </div>
              
              {/* Transfer Amount */}
              <div className="bg-background/50 rounded-lg p-3 mb-3">
                <p className="text-[10px] text-muted-foreground uppercase mb-1">Transfer Amount</p>
                <p className="text-2xl font-black text-emerald-400">{fmtRs(transferAmount)}</p>
                {transferredAt && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Transferred on {new Date(transferredAt).toLocaleDateString('en-US', { 
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
                    })}
                  </p>
                )}
              </div>
              
              {/* Screenshot Preview */}
              {transferScreenshot && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase mb-2">Transfer Screenshot</p>
                  <a href={transferScreenshot} target="_blank" rel="noopener noreferrer">
                    <img 
                      src={transferScreenshot} 
                      alt="Transfer proof" 
                      className="w-full rounded-lg border border-emerald-500/30 hover:opacity-90 transition-opacity"
                    />
                  </a>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-amber-500/50 bg-amber-500/10">
            <CardContent className="py-6 px-4 text-center">
              <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center mx-auto mb-3">
                <Smartphone className="w-6 h-6 text-amber-500" />
              </div>
              <p className="font-bold text-amber-500 mb-1">Pending Transfer Proof</p>
              <p className="text-xs text-muted-foreground">
                Contractor has not yet uploaded their MCB Juice transfer screenshot.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Status Card */}
        <Card className={cn(
          "border-2",
          diff === 0 ? "border-emerald-500" : diff > 0 ? "border-blue-500" : "border-amber-500"
        )}>
          <CardContent className="py-4 px-5">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">To Collect</p>
                <p className={cn(
                  "text-3xl font-black",
                  diff === 0 ? "text-emerald-500" : diff > 0 ? "text-blue-500" : "text-amber-500"
                )}>
                  {fmtRs(counted)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground uppercase">vs Expected</p>
                <p className={cn(
                  "text-xl font-bold",
                  diff === 0 ? "text-emerald-500" : diff > 0 ? "text-blue-500" : "text-amber-500"
                )}>
                  {diff === 0 ? 'MATCH' : diff > 0 ? `+${fmtRs(diff)}` : fmtRs(diff)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Deliveries List */}
        <div className="rounded-2xl bg-card border overflow-hidden">
          <div className="px-4 py-3 bg-purple-500/10 border-b border-purple-500/20">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-purple-400" />
              <span className="text-sm font-bold text-purple-400">Juice Payments</span>
              <span className="ml-auto text-sm font-bold text-purple-400">{fmtRs(totalExpected)}</span>
            </div>
          </div>
          
          <div className="divide-y">
            {deliveries.map(d => (
              <div key={d.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{d.customer_name || d.index_no}</p>
                  <p className="text-xs text-muted-foreground">{d.rider_name}</p>
                </div>
                <p className="font-semibold text-purple-400">{fmtRs(d.payment_juice)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Save Button - Only enabled when amounts match */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-background via-background to-transparent">
        <button
          onClick={handleSave}
          disabled={saving || !hasTransferProof || diff !== 0}
          className={cn(
            "w-full py-4 rounded-2xl font-bold text-lg shadow-lg transition-all",
            hasTransferProof && diff === 0
              ? "bg-gradient-to-r from-purple-500 to-violet-600 text-white active:scale-[0.98]"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          {saving ? (
            <Loader2 className="w-5 h-5 animate-spin mx-auto" />
          ) : !hasTransferProof ? (
            'Waiting for Contractor Transfer Proof'
          ) : diff !== 0 ? (
            `Amount Mismatch (${diff > 0 ? '+' : ''}${fmtRs(diff)})`
          ) : (
            `Collect ${fmtRs(counted)}`
          )}
        </button>
      </div>
    </div>
  )
}
