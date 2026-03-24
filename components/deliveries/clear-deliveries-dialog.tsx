'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { clearAllDeliveries } from '@/lib/delivery-actions'

export function ClearDeliveriesDialog() {
  const [open, setOpen] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const handleClear = async () => {
    if (confirmation !== 'DELETE ALL') {
      setError('Please type DELETE ALL to confirm')
      return
    }

    setLoading(true)
    setError(null)

    const result = await clearAllDeliveries()

    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }

    setOpen(false)
    setConfirmation('')
    setLoading(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      setOpen(isOpen)
      if (!isOpen) {
        setConfirmation('')
        setError(null)
      }
    }}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          <Trash2 className="mr-2 h-4 w-4" />
          Clear All
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Clear All Deliveries
          </DialogTitle>
          <DialogDescription className="text-left">
            This action cannot be undone. This will permanently delete all delivery records from the database.
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <p className="text-sm font-medium text-destructive">
              Warning: All delivery data will be permanently deleted including:
            </p>
            <ul className="mt-2 list-inside list-disc text-sm text-muted-foreground">
              <li>All delivery records</li>
              <li>Assignment history</li>
              <li>Status updates</li>
              <li>Import logs</li>
            </ul>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="confirmation">
              Type <span className="font-mono font-bold text-destructive">DELETE ALL</span> to confirm
            </Label>
            <Input
              id="confirmation"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder="DELETE ALL"
              className="font-mono"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleClear}
            disabled={loading || confirmation !== 'DELETE ALL'}
          >
            {loading ? 'Deleting...' : 'Delete All Deliveries'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
