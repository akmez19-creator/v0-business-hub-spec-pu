'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Clock, User, Calendar } from 'lucide-react'
import { createShift } from '@/lib/timetable-actions'

interface Staff {
  id: string
  type: string
  name: string
  role?: string
}

interface ShiftTemplate {
  id: string
  name: string
  start_time: string
  end_time: string
  break_duration: number
  color: string
}

interface AddShiftDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  staff: Staff[]
  shiftTemplates: ShiftTemplate[]
  selectedStaff?: { id: string; type: string; name: string } | null
  selectedDate?: Date | null
}

export function AddShiftDialog({
  open,
  onOpenChange,
  staff,
  shiftTemplates,
  selectedStaff,
  selectedDate,
}: AddShiftDialogProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const [staffId, setStaffId] = useState('')
  const [staffType, setStaffType] = useState('')
  const [shiftDate, setShiftDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [notes, setNotes] = useState('')

  // Reset form when dialog opens or selected staff/date changes
  useEffect(() => {
    if (open) {
      if (selectedStaff) {
        setStaffId(selectedStaff.id)
        setStaffType(selectedStaff.type)
      } else {
        setStaffId('')
        setStaffType('')
      }
      if (selectedDate) {
        setShiftDate(selectedDate.toISOString().split('T')[0])
      } else {
        setShiftDate(new Date().toISOString().split('T')[0])
      }
      setStartTime('')
      setEndTime('')
      setTemplateId('')
      setNotes('')
      setError(null)
    }
  }, [open, selectedStaff, selectedDate])

  // Apply template
  const handleTemplateChange = (id: string) => {
    setTemplateId(id)
    const template = shiftTemplates.find(t => t.id === id)
    if (template) {
      setStartTime(template.start_time.substring(0, 5))
      setEndTime(template.end_time.substring(0, 5))
    }
  }

  // Handle staff selection
  const handleStaffChange = (value: string) => {
    const [type, id] = value.split(':')
    setStaffType(type)
    setStaffId(id)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const result = await createShift({
        staff_id: staffId,
        staff_type: staffType,
        shift_date: shiftDate,
        scheduled_start: startTime,
        scheduled_end: endTime,
        notes: notes || null,
      })

      if (result.error) {
        setError(result.error)
      } else {
        onOpenChange(false)
        router.refresh()
      }
    } catch {
      setError('Failed to create shift')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            Add Shift
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Staff Selection */}
          <div className="space-y-2">
            <Label>Staff Member</Label>
            <Select 
              value={staffId ? `${staffType}:${staffId}` : ''} 
              onValueChange={handleStaffChange}
            >
              <SelectTrigger>
                <User className="w-4 h-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Select staff member" />
              </SelectTrigger>
              <SelectContent>
                {staff.map((s) => (
                  <SelectItem key={`${s.type}:${s.id}`} value={`${s.type}:${s.id}`}>
                    <div className="flex items-center gap-2">
                      <span>{s.name}</span>
                      <span className="text-xs text-muted-foreground capitalize">({s.type})</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date */}
          <div className="space-y-2">
            <Label>Date</Label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="date"
                value={shiftDate}
                onChange={(e) => setShiftDate(e.target.value)}
                className="pl-10"
                required
              />
            </div>
          </div>

          {/* Shift Template */}
          <div className="space-y-2">
            <Label>Quick Template (Optional)</Label>
            <Select value={templateId} onValueChange={handleTemplateChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select template or enter times below" />
              </SelectTrigger>
              <SelectContent>
                {shiftTemplates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full" 
                        style={{ backgroundColor: t.color }}
                      />
                      <span>{t.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {t.start_time.substring(0, 5)} - {t.end_time.substring(0, 5)}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Times */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Start Time</Label>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>End Time</Label>
              <Input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes (Optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes..."
              rows={2}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !staffId || !shiftDate || !startTime || !endTime}>
              {loading ? 'Creating...' : 'Create Shift'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
