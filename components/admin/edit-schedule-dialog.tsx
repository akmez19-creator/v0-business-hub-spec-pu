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
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Calendar, User, Save } from 'lucide-react'
import { updateSchedule } from '@/lib/timetable-actions'

interface Staff {
  id: string
  type: string
  name: string
  role?: string
}

interface Schedule {
  id: string
  staff_id: string
  staff_type: string
  day_of_week: number
  start_time: string | null
  end_time: string | null
  is_off_day: boolean
}

interface EditScheduleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  staff: Staff[]
  schedules: Schedule[]
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function EditScheduleDialog({
  open,
  onOpenChange,
  staff,
  schedules,
}: EditScheduleDialogProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  
  const [selectedStaffId, setSelectedStaffId] = useState('')
  const [selectedStaffType, setSelectedStaffType] = useState('')
  const [weekSchedule, setWeekSchedule] = useState<Array<{
    day: number
    startTime: string
    endTime: string
    isOff: boolean
  }>>([])

  // Initialize week schedule
  useEffect(() => {
    if (selectedStaffId && selectedStaffType) {
      const schedule: typeof weekSchedule = []
      for (let day = 0; day < 7; day++) {
        const existing = schedules.find(
          s => s.staff_id === selectedStaffId && 
               s.staff_type === selectedStaffType && 
               s.day_of_week === day
        )
        schedule.push({
          day,
          startTime: existing?.start_time?.substring(0, 5) || '09:00',
          endTime: existing?.end_time?.substring(0, 5) || '18:00',
          isOff: existing?.is_off_day || (day === 0), // Default Sunday off
        })
      }
      setWeekSchedule(schedule)
    }
  }, [selectedStaffId, selectedStaffType, schedules])

  const handleStaffChange = (value: string) => {
    const [type, id] = value.split(':')
    setSelectedStaffType(type)
    setSelectedStaffId(id)
    setError(null)
    setSuccess(false)
  }

  const updateDaySchedule = (dayIndex: number, field: 'startTime' | 'endTime' | 'isOff', value: string | boolean) => {
    setWeekSchedule(prev => prev.map((d, i) => 
      i === dayIndex ? { ...d, [field]: value } : d
    ))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      const result = await updateSchedule({
        staff_id: selectedStaffId,
        staff_type: selectedStaffType,
        schedule: weekSchedule.map(d => ({
          day_of_week: d.day,
          start_time: d.isOff ? null : d.startTime,
          end_time: d.isOff ? null : d.endTime,
          is_off_day: d.isOff,
        })),
      })

      if (result.error) {
        setError(result.error)
      } else {
        setSuccess(true)
        router.refresh()
      }
    } catch {
      setError('Failed to update schedule')
    } finally {
      setLoading(false)
    }
  }

  const applyToAll = (field: 'startTime' | 'endTime', value: string) => {
    setWeekSchedule(prev => prev.map(d => ({
      ...d,
      [field]: d.isOff ? d[field] : value,
    })))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" />
            Edit Weekly Schedule
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Staff Selection */}
          <div className="space-y-2">
            <Label>Select Staff Member</Label>
            <Select 
              value={selectedStaffId ? `${selectedStaffType}:${selectedStaffId}` : ''} 
              onValueChange={handleStaffChange}
            >
              <SelectTrigger>
                <User className="w-4 h-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Select staff member to edit schedule" />
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

          {selectedStaffId && weekSchedule.length > 0 && (
            <>
              {/* Quick Apply */}
              <div className="bg-muted/50 rounded-lg p-4">
                <p className="text-sm font-medium mb-3">Quick Apply to All Working Days</p>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Start:</Label>
                    <Input
                      type="time"
                      className="w-28 h-8 text-xs"
                      defaultValue="09:00"
                      onChange={(e) => applyToAll('startTime', e.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">End:</Label>
                    <Input
                      type="time"
                      className="w-28 h-8 text-xs"
                      defaultValue="18:00"
                      onChange={(e) => applyToAll('endTime', e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Weekly Schedule */}
              <div className="space-y-3">
                {weekSchedule.map((day, index) => (
                  <div 
                    key={day.day} 
                    className={`flex items-center gap-4 p-3 rounded-lg border ${
                      day.isOff ? 'bg-muted/30 border-muted' : 'border-border'
                    }`}
                  >
                    <div className="w-24 font-medium text-sm">{DAYS[day.day]}</div>
                    
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={!day.isOff}
                        onCheckedChange={(checked) => updateDaySchedule(index, 'isOff', !checked)}
                      />
                      <Label className="text-xs text-muted-foreground">
                        {day.isOff ? 'Off' : 'Working'}
                      </Label>
                    </div>

                    {!day.isOff && (
                      <>
                        <div className="flex items-center gap-2">
                          <Input
                            type="time"
                            value={day.startTime}
                            onChange={(e) => updateDaySchedule(index, 'startTime', e.target.value)}
                            className="w-28 h-8 text-xs"
                          />
                          <span className="text-muted-foreground">to</span>
                          <Input
                            type="time"
                            value={day.endTime}
                            onChange={(e) => updateDaySchedule(index, 'endTime', e.target.value)}
                            className="w-28 h-8 text-xs"
                          />
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Error/Success Messages */}
          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
              {error}
            </div>
          )}
          {success && (
            <div className="text-sm text-green-600 bg-green-100 dark:bg-green-900/30 dark:text-green-400 p-3 rounded-lg">
              Schedule updated successfully!
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button 
              type="submit" 
              disabled={loading || !selectedStaffId}
            >
              <Save className="w-4 h-4 mr-2" />
              {loading ? 'Saving...' : 'Save Schedule'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
