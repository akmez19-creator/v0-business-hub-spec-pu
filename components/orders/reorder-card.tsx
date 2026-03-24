'use client'

import { useState, useRef } from 'react'
import { cn } from '@/lib/utils'
import { StickyNote, Check } from 'lucide-react'
import { STATUS_LABELS } from '@/lib/types'
import type { DeliveryStatus } from '@/lib/types'

interface ReorderCardProps {
  order: {
    key: string
    customerName: string
    status: DeliveryStatus
    totalQty: number
    totalAmount: number
    deliveryNotes: string | null
    items: { id: string }[]
  }
}

export function ReorderCard({ order }: ReorderCardProps) {
  const [showNote, setShowNote] = useState(false)
  const [note, setNote] = useState(order.deliveryNotes || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function saveNote(value: string) {
    setSaving(true)
    setSaved(false)
    const { updateDeliveryNote } = await import('@/lib/delivery-actions')
    // Save note to the first delivery item (notes are per-client group)
    await updateDeliveryNote(order.items[0].id, value)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  function handleNoteChange(value: string) {
    setNote(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => saveNote(value), 800)
  }

  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground truncate">{order.customerName}</p>
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap shrink-0',
              order.status === 'delivered' ? 'bg-emerald-500/10 text-emerald-500' :
              order.status === 'nwd' ? 'bg-amber-500/10 text-amber-500' :
              order.status === 'cms' ? 'bg-red-500/10 text-red-500' :
              'bg-muted text-muted-foreground'
            )}>
              {STATUS_LABELS[order.status] || order.status}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {order.totalQty} item{order.totalQty !== 1 ? 's' : ''} &middot; Rs {order.totalAmount.toLocaleString()}
          </p>
        </div>
        {/* Note toggle */}
        <button
          onClick={() => setShowNote(!showNote)}
          className={cn(
            'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors',
            showNote || order.deliveryNotes
              ? 'bg-primary/10 text-primary'
              : 'bg-muted/50 text-muted-foreground hover:text-foreground'
          )}
        >
          <StickyNote className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Existing note preview (when collapsed) */}
      {!showNote && order.deliveryNotes && (
        <p className="text-[10px] text-muted-foreground italic mt-1 line-clamp-1">{order.deliveryNotes}</p>
      )}

      {/* Note input (when expanded) */}
      {showNote && (
        <div className="mt-2 relative">
          <textarea
            value={note}
            onChange={(e) => handleNoteChange(e.target.value)}
            placeholder="Add a remark..."
            rows={2}
            className="w-full text-xs bg-muted/50 border border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          <div className="absolute bottom-2 right-2">
            {saving && <span className="text-[9px] text-muted-foreground">Saving...</span>}
            {saved && (
              <span className="text-[9px] text-emerald-500 flex items-center gap-0.5">
                <Check className="w-2.5 h-2.5" /> Saved
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
