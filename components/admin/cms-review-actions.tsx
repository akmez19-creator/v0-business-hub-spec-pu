'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Check, X, Edit3, Loader2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { reviewCmsModification } from '@/lib/admin-actions'

interface CmsReviewActionsProps {
  modification: {
    id: string
    target_delivery_id: string
    product_name: string
    qty: number
    unit_price: number
    total_price: number
    reason: string
    notes: string
    status: string
    new_price: number | null
    original_price: number | null
    original_qty: number | null
    created_at: string
    rider_name?: string
    contractor_name?: string
    customer_name?: string
    locality?: string
  }
  onReviewed?: () => void
}

export function CmsReviewActions({ modification, onReviewed }: CmsReviewActionsProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isAdjusting, setIsAdjusting] = useState(false)
  const [adjustedPrice, setAdjustedPrice] = useState(String(modification.new_price || 0))
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleAction = async (action: 'approve' | 'reject', finalPrice?: number) => {
    setIsLoading(true)
    setError(null)
    
    const result = await reviewCmsModification({
      modificationId: modification.id,
      deliveryId: modification.target_delivery_id,
      action,
      adjustedPrice: finalPrice,
    })
    
    setIsLoading(false)
    
    if (result.error) {
      setError(result.error)
    } else {
      setSuccess(action === 'approve' ? 'Approved' : 'Rejected')
      onReviewed?.()
    }
  }

  if (modification.status !== 'pending') {
    return (
      <Badge 
        variant="outline" 
        className={cn(
          "text-xs",
          modification.status === 'approved' && "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
          modification.status === 'rejected' && "bg-red-500/10 text-red-600 border-red-500/30"
        )}
      >
        {modification.status}
      </Badge>
    )
  }

  if (success) {
    return (
      <Badge 
        variant="outline" 
        className={cn(
          "text-xs",
          success === 'Approved' ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" : "bg-red-500/10 text-red-600 border-red-500/30"
        )}
      >
        {success}
      </Badge>
    )
  }

  const priceDiff = modification.new_price && modification.original_price 
    ? modification.new_price - modification.original_price 
    : 0
  const needsPriceReview = priceDiff !== 0
  const remainingQty = modification.original_qty ? modification.original_qty - modification.qty : null

  return (
    <div className="space-y-3">
      {/* Qty Info */}
      {modification.original_qty && (
        <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-400/20">
          <div className="flex items-center gap-2 text-[11px] text-amber-400 font-mono">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Qty: {modification.original_qty}x → {remainingQty}x</span>
            <span className="text-red-400">({modification.qty}x CMS)</span>
          </div>
        </div>
      )}
      
      {/* Price Info */}
      {needsPriceReview && (
        <div className="p-2 rounded-lg bg-purple-500/10 border border-purple-400/20">
          <div className="flex items-center gap-2 text-[11px] text-purple-400 font-mono">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Price adjusted by rider</span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-sm">
            <span className="text-white/50 line-through">Rs {modification.original_price}</span>
            <span className="text-white/30">→</span>
            <span className="text-purple-400 font-bold">Rs {modification.new_price}</span>
            <span className={cn(
              "text-xs font-mono",
              priceDiff < 0 ? "text-red-400" : "text-emerald-400"
            )}>
              ({priceDiff < 0 ? '' : '+'}{priceDiff})
            </span>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      {/* Adjust Price Mode */}
      {isAdjusting ? (
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">Rs</span>
            <Input
              type="number"
              value={adjustedPrice}
              onChange={(e) => setAdjustedPrice(e.target.value)}
              className="pl-9 h-9"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsAdjusting(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={() => handleAction('approve', parseFloat(adjustedPrice))}
            disabled={isLoading}
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save & Approve'}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="border-red-500/30 text-red-400 hover:bg-red-500/10"
            onClick={() => handleAction('reject')}
            disabled={isLoading}
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><X className="w-4 h-4 mr-1" /> Reject</>}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
            onClick={() => setIsAdjusting(true)}
            disabled={isLoading}
          >
            <Edit3 className="w-4 h-4 mr-1" /> Adjust
          </Button>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={() => handleAction('approve')}
            disabled={isLoading}
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Check className="w-4 h-4 mr-1" /> Approve</>}
          </Button>
        </div>
      )}
    </div>
  )
}
