'use client'

import { useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import {
  Smartphone, ArrowLeft, CheckCircle2, Loader2,
  Calendar, ChevronLeft, ChevronRight, RotateCcw,
  AlertTriangle, ShieldAlert, Scale, Upload, Camera, X, Image as ImageIcon
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

function fmtRs(n: number) { return `Rs ${n.toLocaleString()}` }

function fmtDate(d: string) {
  const dt = new Date(d + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  if (dt.getTime() === today.getTime()) return 'Today'
  if (dt.getTime() === yesterday.getTime()) return 'Yesterday'
  return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

interface JuiceDelivery {
  id: string
  index_no?: string
  customer_name: string
  payment_juice: number
  delivery_date: string
  rider_id?: string
  rider_name?: string | null
  contractor_juice_counted?: number | null
  contractor_juice_counted_at?: string | null
}

interface CollectedDelivery {
  id: string
  index_no?: string
  customer_name: string
  payment_juice: number
  delivery_date: string
  rider_id?: string
  rider_name?: string | null
  juice_collected_at?: string | null
}

interface Props {
  contractorId: string
  deliveries: JuiceDelivery[]
  collectedByStore?: CollectedDelivery[]
  availableDates: string[]
  selectedDate: string
}

export function ContractorJuiceCollectionPage({ contractorId, deliveries, collectedByStore = [], availableDates, selectedDate }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [currentDate, setCurrentDate] = useState(selectedDate)
  const [showCountingSheet, setShowCountingSheet] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  // Group deliveries by date
  const deliveriesByDate = useMemo(() => {
    const map: Record<string, JuiceDelivery[]> = {}
    for (const d of deliveries) {
      const date = d.delivery_date
      if (!map[date]) map[date] = []
      map[date].push(d)
    }
    return map
  }, [deliveries])

  // Current date's deliveries
  const currentDeliveries = deliveriesByDate[currentDate] || []
  const uncounted = currentDeliveries.filter(d => !d.contractor_juice_counted_at)
  const counted = currentDeliveries.filter(d => d.contractor_juice_counted_at)
  
  const totalExpected = currentDeliveries.reduce((sum, d) => sum + Number(d.payment_juice || 0), 0)
  const totalCounted = counted.reduce((sum, d) => sum + Number(d.contractor_juice_counted || 0), 0)
  const totalUncounted = uncounted.reduce((sum, d) => sum + Number(d.payment_juice || 0), 0)

  // Reset counted for current date
  const handleResetCounting = async () => {
    setResetting(true)
    const countedIds = counted.map(d => d.id)
    if (countedIds.length > 0) {
      const { error } = await supabase
        .from('deliveries')
        .update({
          contractor_juice_counted: null,
          contractor_juice_counted_at: null,
          juice_transfer_screenshot: null,
          juice_transfer_reference: null,
          juice_transfer_amount: null,
          juice_transferred_at: null,
        })
        .in('id', countedIds)
      
      if (error) {
        console.error('[v0] Reset error:', error)
        alert('Failed to reset: ' + error.message)
      }
    }
    setShowResetConfirm(false)
    setResetting(false)
    router.refresh()
  }

  // Navigate between dates
  const dateIdx = availableDates.indexOf(currentDate)
  const navigateDate = (dir: number) => {
    const newIdx = dateIdx + dir
    if (newIdx >= 0 && newIdx < availableDates.length) {
      setCurrentDate(availableDates[newIdx])
    }
  }

  // Show counting sheet for uncounted deliveries
  if (showCountingSheet && uncounted.length > 0) {
    return (
      <JuiceCountingSheet
        contractorId={contractorId}
        deliveries={uncounted}
        totalExpected={totalUncounted}
        date={currentDate}
        onBack={() => setShowCountingSheet(false)}
        onSuccess={() => {
          setShowCountingSheet(false)
          router.refresh()
        }}
      />
    )
  }

  return (
    <div className="space-y-4 pb-20">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
          <Smartphone className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-bold">MCB Juice Collection</h1>
          <p className="text-xs text-muted-foreground">Verify Juice payments from deliveries</p>
        </div>
      </div>

      {/* Date Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigateDate(-1)}
          disabled={dateIdx <= 0}
          className="p-2 rounded-xl bg-muted/50 disabled:opacity-30"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="text-center">
          <div className="flex items-center justify-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <span className="font-semibold">{fmtDate(currentDate)}</span>
          </div>
          <p className="text-[10px] text-muted-foreground">{currentDate}</p>
        </div>
        <button
          onClick={() => navigateDate(1)}
          disabled={dateIdx >= availableDates.length - 1}
          className="p-2 rounded-xl bg-muted/50 disabled:opacity-30"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card className={totalUncounted > 0 ? "border-violet-500/30" : "border-muted"}>
          <CardContent className="py-3 px-4">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">To Verify</p>
            <p className={cn("text-xl font-bold", totalUncounted > 0 ? "text-violet-500" : "text-muted-foreground")}>
              {fmtRs(totalUncounted)}
            </p>
            <p className="text-[9px] text-muted-foreground">{uncounted.length} deliveries</p>
          </CardContent>
        </Card>
        <Card className={totalCounted > 0 ? "border-emerald-500/30" : "border-muted"}>
          <CardContent className="py-3 px-4">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Verified</p>
            <p className={cn("text-xl font-bold", totalCounted > 0 ? "text-emerald-500" : "text-muted-foreground")}>
              {fmtRs(totalCounted)}
            </p>
            <p className="text-[9px] text-muted-foreground">{counted.length} deliveries</p>
          </CardContent>
        </Card>
      </div>

      {/* Verify Button */}
      {uncounted.length > 0 && (
        <button
          onClick={() => setShowCountingSheet(true)}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-white font-bold text-lg shadow-lg transition-all active:scale-[0.98]"
        >
          <Smartphone className="w-6 h-6" />
          Verify Juice ({fmtRs(totalUncounted)})
        </button>
      )}

      {/* Reset Confirmation Dialog */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl p-6 max-w-sm w-full space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <RotateCcw className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="font-semibold">Reset Juice Verification</h3>
                <p className="text-xs text-muted-foreground">For {fmtDate(currentDate)}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              This will reset the Juice verification for {counted.length} deliveries ({fmtRs(totalCounted)}). You will need to verify again.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="flex-1 py-2.5 rounded-xl bg-muted hover:bg-muted/80 font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleResetCounting}
                disabled={resetting}
                className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-medium text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                {resetting ? 'Resetting...' : 'Reset'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Already Verified Section */}
      {counted.length > 0 && (() => {
        const countedTotal = counted.reduce((sum, d) => sum + Number(d.contractor_juice_counted || 0), 0)
        const expectedTotal = counted.reduce((sum, d) => sum + Number(d.payment_juice || 0), 0)
        const isMatch = countedTotal === expectedTotal
        const shortAmount = expectedTotal - countedTotal

        return (
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                {isMatch ? (
                  <>
                    <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    </div>
                    <p className="text-xs font-semibold text-emerald-500">Ready for Store Collection</p>
                  </>
                ) : (
                  <>
                    <div className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center animate-pulse">
                      <ShieldAlert className="w-4 h-4 text-red-500" />
                    </div>
                    <p className="text-xs font-semibold text-red-500">Amount Mismatch</p>
                  </>
                )}
              </div>
              <button
                onClick={() => setShowResetConfirm(true)}
                className="text-[10px] px-2 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-500 font-medium flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                Reset
              </button>
            </div>
            
            {/* Mismatch Warning */}
            {!isMatch && (
              <Card className="mb-4 border-2 border-red-500/50 bg-red-950/30">
                <CardContent className="py-4 px-4">
                  <div className="flex items-center gap-3 mb-3">
                    <AlertTriangle className="w-6 h-6 text-red-400" />
                    <div>
                      <p className="text-lg font-bold text-red-400">
                        {shortAmount > 0 ? `Short: ${fmtRs(shortAmount)}` : `Over: ${fmtRs(Math.abs(shortAmount))}`}
                      </p>
                      <p className="text-xs text-red-300/70">Juice Payment Discrepancy</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-black/30 rounded-xl p-3 border border-violet-500/30">
                      <p className="text-[10px] text-violet-400/80 uppercase mb-1">Expected</p>
                      <p className="text-lg font-bold text-violet-400">{fmtRs(expectedTotal)}</p>
                    </div>
                    <div className="bg-black/30 rounded-xl p-3 border border-red-500/30">
                      <p className="text-[10px] text-red-400/80 uppercase mb-1">Your Verification</p>
                      <p className="text-lg font-bold text-red-400">{fmtRs(countedTotal)}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
            
            <Card className={cn("border", isMatch ? "border-emerald-500/20" : "border-red-500/20")}>
              <CardContent className="py-3 px-4">
                <div className="flex justify-between items-center mb-1">
                  <p className="text-sm font-medium">{counted.length} deliveries</p>
                  <p className={cn("text-lg font-bold", isMatch ? "text-emerald-500" : "text-red-400")}>{fmtRs(countedTotal)}</p>
                </div>
                {isMatch && (
                  <p className="text-[10px] text-emerald-500/70">Matches expected {fmtRs(expectedTotal)}</p>
                )}
              </CardContent>
            </Card>
          </div>
        )
      })()}

      {/* Delivery List */}
      {currentDeliveries.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground px-1">Deliveries for {fmtDate(currentDate)}</p>
          {currentDeliveries.map(d => (
            <Card key={d.id} className={cn(
              "border transition-all",
              d.contractor_juice_counted_at ? "border-emerald-500/20 bg-emerald-500/5" : "border-violet-500/20"
            )}>
              <CardContent className="py-2.5 px-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{d.customer_name}</p>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      {d.index_no && <span>#{d.index_no}</span>}
                      {d.rider_name && <span>by {d.rider_name}</span>}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={cn(
                      "font-bold",
                      d.contractor_juice_counted_at ? "text-emerald-500" : "text-violet-500"
                    )}>
                      {fmtRs(d.payment_juice)}
                    </p>
                    {d.contractor_juice_counted_at && (
                      <div className="flex items-center gap-1 text-[9px] text-emerald-500">
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Verified</span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty State */}
      {currentDeliveries.length === 0 && (
        <div className="text-center py-12">
          <Smartphone className="w-12 h-12 mx-auto text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">No Juice payments for this date</p>
        </div>
      )}

      {/* Collected by Store Section */}
      {collectedByStore.length > 0 && (
        <div className="mt-6 pt-4 border-t border-border">
          <p className="text-xs font-medium text-muted-foreground mb-3">Already Collected by Store</p>
          <div className="space-y-2 opacity-60">
            {collectedByStore.slice(0, 5).map(d => (
              <Card key={d.id} className="border-muted">
                <CardContent className="py-2 px-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm truncate">{d.customer_name}</p>
                      <p className="text-[9px] text-muted-foreground">{fmtDate(d.delivery_date)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-muted-foreground">{fmtRs(d.payment_juice)}</p>
                      <p className="text-[9px] text-emerald-500">Collected</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Juice Counting Sheet - with screenshot upload and auto-extraction
function JuiceCountingSheet({
  contractorId,
  deliveries,
  totalExpected,
  date,
  onBack,
  onSuccess,
}: {
  contractorId: string
  deliveries: JuiceDelivery[]
  totalExpected: number
  date: string
  onBack: () => void
  onSuccess: () => void
}) {
  const router = useRouter()
  const supabase = createClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  const [screenshot, setScreenshot] = useState<File | null>(null)
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [extractedData, setExtractedData] = useState<{
    transactionReference: string | null
    amount: number | null
    recipientName: string | null
    transactionDate: string | null
  } | null>(null)
  const [manualReference, setManualReference] = useState('')
  const [saving, setSaving] = useState(false)

  const extractedAmount = extractedData?.amount || 0
  const diff = extractedAmount - totalExpected
  const transactionRef = extractedData?.transactionReference || manualReference

  // Handle file selection
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setScreenshot(file)
    setScreenshotPreview(URL.createObjectURL(file))
    setExtractedData(null)

    // Auto-extract transaction details
    setExtracting(true)
    try {
      const formData = new FormData()
      formData.append('screenshot', file)

      const response = await fetch('/api/extract-juice-transfer', {
        method: 'POST',
        body: formData,
      })

      const result = await response.json()
      if (result.success && result.data) {
        setExtractedData(result.data)
      }
    } catch (error) {
      console.error('Error extracting transfer details:', error)
    } finally {
      setExtracting(false)
    }
  }

  // Clear screenshot
  const clearScreenshot = () => {
    setScreenshot(null)
    setScreenshotPreview(null)
    setExtractedData(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleSave = async () => {
    console.log('[v0] handleSave called', { screenshot: !!screenshot, transactionRef, diff, extractedAmount })
    if (!screenshot || !transactionRef) {
      console.log('[v0] Missing screenshot or transactionRef')
      return
    }
    
    // Prevent collection if amounts don't match
    if (diff !== 0) {
      alert('Cannot verify: Amount mismatch. The transfer amount must match the expected amount.')
      return
    }

    setSaving(true)
    try {
      // Upload screenshot to blob storage
      console.log('[v0] Uploading screenshot...')
      const formData = new FormData()
      formData.append('file', screenshot)
      
      const uploadRes = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })
      
      if (!uploadRes.ok) {
        const errorText = await uploadRes.text()
        console.error('[v0] Upload failed:', uploadRes.status, errorText)
        alert('Failed to upload screenshot: ' + errorText)
        setSaving(false)
        return
      }
      
      const uploadJson = await uploadRes.json()
      console.log('[v0] Upload response:', uploadJson)
      const screenshotUrl = uploadJson.url || uploadJson.pathname

      if (!screenshotUrl) {
        console.error('[v0] No URL returned from upload')
        alert('Failed to upload screenshot')
        setSaving(false)
        return
      }

      const ids = deliveries.map(d => d.id)
      const now = new Date().toISOString()
      console.log('[v0] Updating deliveries:', ids)

      // Update all deliveries with juice transfer details
      for (let i = 0; i < ids.length; i++) {
        const { error } = await supabase
          .from('deliveries')
          .update({
            contractor_juice_counted: i === 0 ? extractedAmount : 0,
            contractor_juice_counted_at: now,
            juice_transfer_screenshot: i === 0 ? screenshotUrl : null,
            juice_transfer_reference: i === 0 ? transactionRef : null,
            juice_transfer_amount: i === 0 ? extractedAmount : null,
            juice_transferred_at: now,
          })
          .eq('id', ids[i])
        
        if (error) {
          console.error('[v0] Error updating delivery', ids[i], error)
        }
      }

      console.log('[v0] All updates complete, calling onSuccess')
      onSuccess()
    } catch (error) {
      console.error('[v0] Error saving juice verification:', error)
      alert('Error saving: ' + (error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="p-2 rounded-xl bg-muted/50 hover:bg-muted transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h2 className="text-lg font-bold">Upload Juice Transfer</h2>
          <p className="text-xs text-muted-foreground">{fmtDate(date)} - {deliveries.length} deliveries</p>
        </div>
      </div>

      {/* Expected Amount Card */}
      <Card className="border-violet-500/30 bg-violet-500/10 mb-4">
        <CardContent className="py-4 px-4 text-center">
          <p className="text-xs text-violet-400 uppercase tracking-wide mb-1">Amount to Transfer</p>
          <p className="text-3xl font-black text-violet-400">{fmtRs(totalExpected)}</p>
          <p className="text-[10px] text-muted-foreground mt-1">Transfer to HOT SALES MARKETING LTD</p>
        </CardContent>
      </Card>

      {/* Screenshot Upload */}
      <div className="mb-4">
        <label className="text-xs font-medium text-muted-foreground block mb-2">
          Upload MCB Juice Transfer Screenshot
        </label>
        
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFileSelect}
          className="hidden"
        />

        {!screenshot ? (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-8 border-2 border-dashed border-violet-500/30 rounded-2xl bg-violet-500/5 hover:bg-violet-500/10 transition-colors flex flex-col items-center gap-2"
          >
            <div className="w-12 h-12 rounded-full bg-violet-500/20 flex items-center justify-center">
              <Camera className="w-6 h-6 text-violet-500" />
            </div>
            <p className="text-sm font-medium text-violet-400">Tap to upload screenshot</p>
            <p className="text-[10px] text-muted-foreground">The transaction reference will be extracted automatically</p>
          </button>
        ) : (
          <div className="relative">
            <img
              src={screenshotPreview!}
              alt="Transfer screenshot"
              className="w-full rounded-2xl border-2 border-violet-500/30"
            />
            <button
              onClick={clearScreenshot}
              className="absolute top-2 right-2 p-2 rounded-full bg-black/60 hover:bg-black/80"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </div>
        )}
      </div>

      {/* Extracting Status */}
      {extracting && (
        <Card className="border-violet-500/30 bg-violet-500/10 mb-4">
          <CardContent className="py-4 px-4 flex items-center justify-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-violet-500" />
            <p className="text-sm text-violet-400">Extracting transaction details...</p>
          </CardContent>
        </Card>
      )}

      {/* Extracted Data Display */}
      {extractedData && !extracting && (
        <div className="space-y-3 mb-4">
          {/* Transaction Reference */}
          <Card className={cn(
            "border-2",
            transactionRef ? "border-emerald-500/30 bg-emerald-500/10" : "border-amber-500/30 bg-amber-500/10"
          )}>
            <CardContent className="py-3 px-4">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Transaction Reference</p>
              {extractedData?.transactionReference ? (
                <p className="text-lg font-bold text-emerald-400 font-mono">
                  {extractedData.transactionReference}
                </p>
              ) : (
                <div>
                  <input
                    type="text"
                    value={manualReference}
                    onChange={(e) => setManualReference(e.target.value)}
                    placeholder="Enter reference (e.g., FT25342DSH15\BNK)"
                    className="w-full px-3 py-2 rounded-lg bg-background border border-amber-500/30 text-sm font-mono placeholder:text-muted-foreground"
                  />
                  <p className="text-[10px] text-amber-400 mt-1">Could not auto-extract. Please enter manually.</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Extracted Amount vs Expected */}
          <Card className={cn(
            "border-2",
            diff === 0 ? "border-emerald-500 bg-emerald-500/10" : "border-red-500 bg-red-500/10"
          )}>
            <CardContent className="py-3 px-4">
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase mb-1">Transfer Amount</p>
                  <p className={cn("text-xl font-bold", diff === 0 ? "text-emerald-500" : "text-red-500")}>
                    {fmtRs(extractedAmount)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase mb-1">Expected</p>
                  <p className="text-xl font-bold text-violet-500">{fmtRs(totalExpected)}</p>
                </div>
              </div>
              
              {diff === 0 ? (
                <div className="flex items-center gap-2 text-emerald-500">
                  <CheckCircle2 className="w-5 h-5" />
                  <p className="text-sm font-semibold">Amount Matches!</p>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-red-500">
                  <AlertTriangle className="w-5 h-5" />
                  <p className="text-sm font-semibold">
                    {diff > 0 ? `Over by ${fmtRs(diff)}` : `Short by ${fmtRs(Math.abs(diff))}`}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Other Details */}
          {extractedData.recipientName && (
            <Card className="border-muted">
              <CardContent className="py-2 px-4">
                <p className="text-[10px] text-muted-foreground">Recipient</p>
                <p className="text-sm font-medium">{extractedData.recipientName}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Delivery List */}
      <div className="space-y-2 mb-6">
        <p className="text-xs font-medium text-muted-foreground">Deliveries included:</p>
        {deliveries.slice(0, 5).map(d => (
          <Card key={d.id} className="border-violet-500/20">
            <CardContent className="py-2 px-3">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{d.customer_name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {d.index_no && `#${d.index_no}`} {d.rider_name && `by ${d.rider_name}`}
                  </p>
                </div>
                <p className="font-bold text-violet-500">{fmtRs(d.payment_juice)}</p>
              </div>
            </CardContent>
          </Card>
        ))}
        {deliveries.length > 5 && (
          <p className="text-xs text-muted-foreground text-center">
            +{deliveries.length - 5} more deliveries
          </p>
        )}
      </div>

      {/* Save Button */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-background via-background to-transparent">
        <button
          onClick={handleSave}
          disabled={saving || !transactionRef || diff !== 0}
          className={cn(
            "w-full py-4 rounded-2xl font-bold text-lg shadow-lg transition-all",
            diff === 0 && transactionRef
              ? "bg-gradient-to-r from-emerald-500 to-emerald-600 text-white active:scale-[0.98]"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          )}
        >
          {saving ? (
            <Loader2 className="w-5 h-5 animate-spin mx-auto" />
          ) : !screenshot ? (
            'Upload Screenshot First'
          ) : extracting ? (
            'Extracting...'
          ) : !transactionRef ? (
            'Enter Transaction Reference'
          ) : diff !== 0 ? (
            `Amount Mismatch (${diff > 0 ? '+' : ''}${fmtRs(diff)})`
          ) : (
            `Confirm Transfer ${fmtRs(extractedAmount)}`
          )}
        </button>
      </div>
    </div>
  )
}
