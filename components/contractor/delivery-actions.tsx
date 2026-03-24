'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { MoreHorizontal, Eye, Phone, MapPin, Navigation, ExternalLink } from 'lucide-react'
import type { Delivery } from '@/lib/types'

const MAPS_URL_REGEX = new RegExp('https?://(maps\\.app\\.goo\\.gl|goo\\.gl/maps|www\\.google\\.com/maps|maps\\.google\\.com|google\\.com/maps)[^\\s)}"\'\\]]*', 'gi')

function RichNoteText({ text, label }: { text: string; label?: string }) {
  const matches: { url: string; start: number; end: number }[] = []
  let match: RegExpExecArray | null
  const regex = new RegExp(MAPS_URL_REGEX.source, MAPS_URL_REGEX.flags)
  while ((match = regex.exec(text)) !== null) {
    matches.push({ url: match[0], start: match.index, end: match.index + match[0].length })
  }
  if (matches.length === 0) return <span>{text}</span>
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  const linkLabel = label ? `${label}'s Pin Location` : 'Pin Location'
  matches.forEach((link, i) => {
    if (link.start > lastIndex) {
      const before = text.slice(lastIndex, link.start).trim()
      if (before) parts.push(<span key={`t-${i}`}>{before} </span>)
    }
    parts.push(
      <a key={`l-${i}`} href={link.url} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 hover:text-blue-300 transition-colors text-xs font-medium no-underline"
      >
        <Navigation className="w-3 h-3 shrink-0" />{linkLabel}<ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-60" />
      </a>
    )
    lastIndex = link.end
  })
  if (lastIndex < text.length) {
    const after = text.slice(lastIndex).trim()
    if (after) parts.push(<span key="tail"> {after}</span>)
  }
  return <span>{parts}</span>
}

interface ContractorDeliveryActionsProps {
  delivery: Delivery
}

export function ContractorDeliveryActions({ delivery }: ContractorDeliveryActionsProps) {
  const [showDetails, setShowDetails] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <MoreHorizontal className="h-4 w-4" />
            <span className="sr-only">Actions</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setShowDetails(true)}>
            <Eye className="w-4 h-4 mr-2" />
            View Details
          </DropdownMenuItem>
          {delivery.contact_1 && (
            <DropdownMenuItem asChild>
              <a href={`tel:${delivery.contact_1}`}>
                <Phone className="w-4 h-4 mr-2" />
                Call Customer
              </a>
            </DropdownMenuItem>
          )}
          {delivery.locality && (
            <DropdownMenuItem asChild>
              <a 
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(delivery.locality || '')}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <MapPin className="w-4 h-4 mr-2" />
                View on Map
              </a>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Details Dialog */}
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Delivery Details</DialogTitle>
            <DialogDescription>
              Tracking: {delivery.index_no || 'N/A'}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Customer</p>
                <p className="font-medium">{delivery.customer_name}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <p className="font-medium capitalize">{delivery.status.replace('_', ' ')}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Contact 1</p>
                <p className="font-medium">{delivery.contact_1 || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Contact 2</p>
                <p className="font-medium">{delivery.contact_2 || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Locality</p>
                <p className="font-medium">{delivery.locality || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Amount</p>
                <p className="font-medium">Rs {(delivery.amount || 0).toFixed(2)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Quantity</p>
                <p className="font-medium">{delivery.qty}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Payment Method</p>
                <p className="font-medium">{
                  delivery.payment_method === 'juice' ? 'Juice' :
                  delivery.payment_method === 'cash' ? 'Cash' :
                  delivery.payment_method === 'juice_to_rider' ? 'Juice To Rider' :
                  delivery.payment_method === 'bank' ? 'Internet Banking' :
                  delivery.payment_method === 'already_paid' ? 'Already Paid' :
                  delivery.payment_method || '-'
                }</p>
              </div>
            </div>
            
            {delivery.products && (
              <div>
                <p className="text-sm text-muted-foreground">Products</p>
                <p className="font-medium">{delivery.products}</p>
              </div>
            )}
            
            {(delivery.notes || delivery.delivery_notes || delivery.client_response) && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground font-medium">Notes & Replies</p>
                {delivery.notes && (
                  <div className="p-2 rounded-lg bg-muted/50">
                    <p className="text-xs text-muted-foreground mb-0.5">Order Notes</p>
                    <p className="text-sm"><RichNoteText text={delivery.notes} label={delivery.customer_name} /></p>
                  </div>
                )}
                {delivery.delivery_notes && (
                  <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <p className="text-xs text-amber-400 mb-0.5">Remarks</p>
                    <p className="text-sm"><RichNoteText text={delivery.delivery_notes} label={delivery.customer_name} /></p>
                  </div>
                )}
                {delivery.client_response && (
                  <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                    <p className="text-xs text-emerald-400 mb-0.5">Client Reply</p>
                    <p className="text-sm"><RichNoteText text={delivery.client_response} label={delivery.customer_name} /></p>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDetails(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
