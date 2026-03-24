'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
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
import { 
  ChevronDown, 
  Package, 
  Truck, 
  CheckCircle, 
  XCircle,
  AlertTriangle,
  Loader2
} from 'lucide-react'
import type { Delivery } from '@/lib/types'
import { updateDeliveryStatus } from '@/lib/rider-actions'

interface RiderDeliveryStatusUpdateProps {
  delivery: Delivery
}

export function RiderDeliveryStatusUpdate({ delivery }: RiderDeliveryStatusUpdateProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showFailedDialog, setShowFailedDialog] = useState(false)
  const [failedType, setFailedType] = useState<'nwd' | 'cms' | null>(null)
  const [notes, setNotes] = useState('')

  const handleStatusUpdate = async (newStatus: string) => {
    if (newStatus === 'nwd' || newStatus === 'cms') {
      setFailedType(newStatus)
      setShowFailedDialog(true)
      return
    }

    startTransition(async () => {
      await updateDeliveryStatus(delivery.id, newStatus)
      router.refresh()
    })
  }

  const handleFailedSubmit = async () => {
    if (!failedType) return

    startTransition(async () => {
      await updateDeliveryStatus(delivery.id, failedType, notes)
      setShowFailedDialog(false)
      setFailedType(null)
      setNotes('')
      router.refresh()
    })
  }

  const getNextStatus = () => {
    if (delivery.status === 'assigned') return 'picked_up'
    if (delivery.status === 'picked_up') return 'delivered'
    return null
  }

  const nextStatus = getNextStatus()

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={isPending}>
            {isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                Update
                <ChevronDown className="w-4 h-4 ml-1" />
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel>Update Status</DropdownMenuLabel>
          <DropdownMenuSeparator />
          
          {delivery.status === 'assigned' && (
            <DropdownMenuItem onClick={() => handleStatusUpdate('picked_up')}>
              <Truck className="w-4 h-4 mr-2 text-amber-600" />
              Mark as Picked Up
            </DropdownMenuItem>
          )}
          
          {delivery.status === 'picked_up' && (
            <DropdownMenuItem onClick={() => handleStatusUpdate('delivered')}>
              <CheckCircle className="w-4 h-4 mr-2 text-green-600" />
              Mark as Delivered
            </DropdownMenuItem>
          )}
          
          {['assigned', 'picked_up'].includes(delivery.status) && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleStatusUpdate('nwd')} className="text-red-600">
                <XCircle className="w-4 h-4 mr-2" />
                NWD (Not with Dispatch)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleStatusUpdate('cms')} className="text-orange-600">
                <AlertTriangle className="w-4 h-4 mr-2" />
                CMS (Customer Reschedule)
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Failed Delivery Dialog */}
      <Dialog open={showFailedDialog} onOpenChange={setShowFailedDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {failedType === 'nwd' ? 'Not with Dispatch (NWD)' : 'Customer Reschedule (CMS)'}
            </DialogTitle>
            <DialogDescription>
              Please provide details about why this delivery could not be completed.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            <Textarea
              placeholder={failedType === 'nwd' 
                ? "e.g., Customer not available, wrong address, etc."
                : "e.g., Customer requested to reschedule for tomorrow, etc."
              }
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
            />
          </div>

          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setShowFailedDialog(false)
                setFailedType(null)
                setNotes('')
              }}
            >
              Cancel
            </Button>
            <Button 
              variant={failedType === 'nwd' ? 'destructive' : 'default'}
              onClick={handleFailedSubmit}
              disabled={isPending}
            >
              {isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              Confirm {failedType?.toUpperCase()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
