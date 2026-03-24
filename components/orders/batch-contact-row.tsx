'use client'

import { useState, useRef } from 'react'
import { cn } from '@/lib/utils'
import { StickyNote, Check } from 'lucide-react'
import { STATUS_LABELS } from '@/lib/types'
import type { DeliveryStatus } from '@/lib/types'

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  assigned: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  picked_up: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  delivered: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  nwd: 'bg-red-500/15 text-red-400 border-red-500/30',
  cms: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
}

interface BatchContactRowProps {
  order: {
    key: string
    customerName: string
    contact1: string | null
    status: DeliveryStatus
    deliveryNotes: string | null
    items: { id: string }[]
  }
  selectedContacts: Set<string>
  toggleContact: (contact: string) => void
  limitReached?: boolean
}

export function BatchContactRow({ order, selectedContacts, toggleContact, limitReached }: BatchContactRowProps) {
  const [showNote, setShowNote] = useState(false)
  const [note, setNote] = useState(order.deliveryNotes || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function saveNote(value: string) {
    setSaving(true)
    setSaved(false)
    const { updateDeliveryNote } = await import('@/lib/delivery-actions')
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
    <div className="rounded-lg hover:bg-muted/50 transition-colors">
      <div className="flex items-center gap-3 px-3 py-2 cursor-pointer">
        <input
          type="checkbox"
          checked={selectedContacts.has(order.contact1!)}
          disabled={!!(limitReached && !selectedContacts.has(order.contact1!))}
          onChange={() => toggleContact(order.contact1!)}
          className="w-4 h-4 rounded border-border text-primary focus:ring-primary/30 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground truncate">{order.customerName}</p>
          <p className="text-xs text-muted-foreground">{order.contact1}</p>
          {/* Note preview when collapsed */}
          {!showNote && order.deliveryNotes && (
            <p className="text-[10px] text-muted-foreground/70 italic mt-0.5 line-clamp-1">{order.deliveryNotes}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={cn('flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border', STATUS_STYLE[order.status])}>
            {STATUS_LABELS[order.status]}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); setShowNote(!showNote) }}
            className={cn(
              'w-6 h-6 rounded-md flex items-center justify-center transition-colors',
              showNote || note
                ? 'bg-primary/10 text-primary'
                : 'bg-muted/50 text-muted-foreground hover:text-foreground'
            )}
          >
            <StickyNote className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Inline note */}
      {showNote && (
        <div className="px-3 pb-2 pl-10">
          <div className="relative">
            <textarea
              value={note}
              onChange={(e) => handleNoteChange(e.target.value)}
              placeholder="Add remark (directions, time, etc.)..."
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
        </div>
      )}
    </div>
  )
}
