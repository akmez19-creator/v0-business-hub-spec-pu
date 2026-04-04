'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Calendar,
  Clock,
  Users,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Filter,
  Download,
  UserCheck,
  UserX,
  AlertCircle,
  Coffee,
  Moon,
  Sun,
  Sunset,
} from 'lucide-react'
import { AddShiftDialog } from './add-shift-dialog'
import { EditScheduleDialog } from './edit-schedule-dialog'

interface Executive {
  id: string
  first_name: string
  last_name: string
  position: string | null
  department: string | null
  employment_type: string | null
}

interface Contractor {
  id: string
  name: string
  phone: string | null
  is_active: boolean
}

interface Profile {
  id: string
  name: string | null
  email: string
  role: string
}

interface ShiftTemplate {
  id: string
  name: string
  start_time: string
  end_time: string
  break_duration: number
  color: string
}

interface Shift {
  id: string
  staff_id: string
  staff_type: string
  shift_date: string
  scheduled_start: string | null
  scheduled_end: string | null
  actual_clock_in: string | null
  actual_clock_out: string | null
  status: string
  notes: string | null
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

interface LeaveRequest {
  id: string
  staff_id: string
  staff_type: string
  leave_type: string
  start_date: string
  end_date: string
  status: string
}

interface TimetableContentProps {
  executives: Executive[]
  contractors: Contractor[]
  profiles: Profile[]
  shiftTemplates: ShiftTemplate[]
  shifts: Shift[]
  schedules: Schedule[]
  leaveRequests: LeaveRequest[]
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const STATUS_COLORS: Record<string, string> = {
  scheduled: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  in_progress: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  absent: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  late: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  early_leave: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
}

const SHIFT_ICONS: Record<string, React.ElementType> = {
  'Morning Shift': Sun,
  'Afternoon Shift': Sunset,
  'Evening Shift': Moon,
  'Night Shift': Moon,
  'Full Day': Clock,
  'Half Day AM': Sun,
  'Half Day PM': Sunset,
}

export function TimetableContent({
  executives,
  contractors,
  profiles,
  shiftTemplates,
  shifts,
  schedules,
  leaveRequests,
}: TimetableContentProps) {
  const [currentWeek, setCurrentWeek] = useState(new Date())
  const [searchQuery, setSearchQuery] = useState('')
  const [staffTypeFilter, setStaffTypeFilter] = useState<string>('all')
  const [showAddShift, setShowAddShift] = useState(false)
  const [showEditSchedule, setShowEditSchedule] = useState(false)
  const [selectedStaff, setSelectedStaff] = useState<{ id: string; type: string; name: string } | null>(null)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)

  // Calculate week dates
  const weekDates = useMemo(() => {
    const dates: Date[] = []
    const start = new Date(currentWeek)
    start.setDate(start.getDate() - start.getDay())
    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      dates.push(d)
    }
    return dates
  }, [currentWeek])

  // Combine all staff
  const allStaff = useMemo(() => {
    const staff: Array<{ id: string; type: string; name: string; role?: string; department?: string }> = []
    
    executives.forEach(e => {
      staff.push({
        id: e.id,
        type: 'executive',
        name: `${e.first_name} ${e.last_name}`,
        role: e.position || undefined,
        department: e.department || undefined,
      })
    })
    
    contractors.forEach(c => {
      staff.push({
        id: c.id,
        type: 'contractor',
        name: c.name,
        role: 'Contractor',
      })
    })
    
    profiles.forEach(p => {
      staff.push({
        id: p.id,
        type: 'profile',
        name: p.name || p.email,
        role: p.role,
      })
    })
    
    return staff
  }, [executives, contractors, profiles])

  // Filter staff
  const filteredStaff = useMemo(() => {
    return allStaff.filter(s => {
      const matchesSearch = s.name.toLowerCase().includes(searchQuery.toLowerCase())
      const matchesType = staffTypeFilter === 'all' || s.type === staffTypeFilter
      return matchesSearch && matchesType
    })
  }, [allStaff, searchQuery, staffTypeFilter])

  // Get shift for a specific staff and date
  const getShiftForDate = (staffId: string, staffType: string, date: Date) => {
    const dateStr = date.toISOString().split('T')[0]
    return shifts.find(
      s => s.staff_id === staffId && s.staff_type === staffType && s.shift_date === dateStr
    )
  }

  // Get schedule for a specific staff and day
  const getScheduleForDay = (staffId: string, staffType: string, dayOfWeek: number) => {
    return schedules.find(
      s => s.staff_id === staffId && s.staff_type === staffType && s.day_of_week === dayOfWeek
    )
  }

  // Check if staff is on leave for a date
  const isOnLeave = (staffId: string, staffType: string, date: Date) => {
    const dateStr = date.toISOString().split('T')[0]
    return leaveRequests.find(
      l => l.staff_id === staffId && 
           l.staff_type === staffType && 
           l.status === 'approved' &&
           l.start_date <= dateStr && 
           l.end_date >= dateStr
    )
  }

  const navigateWeek = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentWeek)
    newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7))
    setCurrentWeek(newDate)
  }

  const goToToday = () => {
    setCurrentWeek(new Date())
  }

  const formatTime = (time: string | null) => {
    if (!time) return '-'
    return time.substring(0, 5)
  }

  const handleCellClick = (staff: typeof allStaff[0], date: Date) => {
    setSelectedStaff({ id: staff.id, type: staff.type, name: staff.name })
    setSelectedDate(date)
    setShowAddShift(true)
  }

  // Stats
  const todayStr = new Date().toISOString().split('T')[0]
  const todayShifts = shifts.filter(s => s.shift_date === todayStr)
  const workingNow = todayShifts.filter(s => s.status === 'in_progress').length
  const scheduledToday = todayShifts.length
  const onLeaveToday = leaveRequests.filter(l => 
    l.status === 'approved' && l.start_date <= todayStr && l.end_date >= todayStr
  ).length

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Staff Timetable</h1>
          <p className="text-muted-foreground">Manage staff schedules and shifts</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowEditSchedule(true)}>
            <Calendar className="w-4 h-4 mr-2" />
            Edit Schedules
          </Button>
          <Button onClick={() => setShowAddShift(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Shift
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                <UserCheck className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{workingNow}</p>
                <p className="text-xs text-muted-foreground">Working Now</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{scheduledToday}</p>
                <p className="text-xs text-muted-foreground">Scheduled Today</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
                <Coffee className="w-5 h-5 text-orange-600 dark:text-orange-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{onLeaveToday}</p>
                <p className="text-xs text-muted-foreground">On Leave</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                <Users className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{allStaff.length}</p>
                <p className="text-xs text-muted-foreground">Total Staff</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters & Navigation */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            {/* Week Navigation */}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => navigateWeek('prev')}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button variant="outline" onClick={goToToday}>Today</Button>
              <Button variant="outline" size="icon" onClick={() => navigateWeek('next')}>
                <ChevronRight className="w-4 h-4" />
              </Button>
              <span className="text-sm font-medium ml-2">
                {weekDates[0]?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {weekDates[6]?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </span>
            </div>

            <div className="flex-1" />

            {/* Search & Filters */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search staff..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 w-48"
                />
              </div>
              <Select value={staffTypeFilter} onValueChange={setStaffTypeFilter}>
                <SelectTrigger className="w-36">
                  <Filter className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Staff</SelectItem>
                  <SelectItem value="executive">Executives</SelectItem>
                  <SelectItem value="contractor">Contractors</SelectItem>
                  <SelectItem value="profile">Team Members</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Timetable Grid */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b">
                <th className="text-left p-3 font-medium text-muted-foreground w-48 sticky left-0 bg-card z-10">
                  Staff Member
                </th>
                {weekDates.map((date, i) => {
                  const isToday = date.toDateString() === new Date().toDateString()
                  return (
                    <th 
                      key={i} 
                      className={`text-center p-3 font-medium min-w-[100px] ${
                        isToday ? 'bg-primary/5' : ''
                      }`}
                    >
                      <div className="text-xs text-muted-foreground">{DAYS[i]}</div>
                      <div className={`text-sm ${isToday ? 'text-primary font-bold' : ''}`}>
                        {date.getDate()}
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {filteredStaff.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-muted-foreground">
                    No staff found
                  </td>
                </tr>
              ) : (
                filteredStaff.map((staff) => (
                  <tr key={`${staff.type}-${staff.id}`} className="border-b hover:bg-muted/50">
                    <td className="p-3 sticky left-0 bg-card z-10">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium text-sm">
                          {staff.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium text-sm">{staff.name}</div>
                          <div className="text-xs text-muted-foreground capitalize">{staff.role || staff.type}</div>
                        </div>
                      </div>
                    </td>
                    {weekDates.map((date, dayIndex) => {
                      const shift = getShiftForDate(staff.id, staff.type, date)
                      const schedule = getScheduleForDay(staff.id, staff.type, dayIndex)
                      const leave = isOnLeave(staff.id, staff.type, date)
                      const isToday = date.toDateString() === new Date().toDateString()

                      return (
                        <td 
                          key={dayIndex} 
                          className={`p-2 text-center cursor-pointer hover:bg-muted/80 transition-colors ${
                            isToday ? 'bg-primary/5' : ''
                          }`}
                          onClick={() => handleCellClick(staff, date)}
                        >
                          {leave ? (
                            <div className="bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded px-2 py-1 text-xs">
                              <Coffee className="w-3 h-3 inline mr-1" />
                              {leave.leave_type}
                            </div>
                          ) : shift ? (
                            <div className={`rounded px-2 py-1 text-xs ${STATUS_COLORS[shift.status] || 'bg-muted'}`}>
                              <div className="font-medium">
                                {formatTime(shift.scheduled_start)} - {formatTime(shift.scheduled_end)}
                              </div>
                              {shift.status !== 'scheduled' && (
                                <div className="text-[10px] mt-0.5 capitalize">{shift.status.replace('_', ' ')}</div>
                              )}
                            </div>
                          ) : schedule && !schedule.is_off_day ? (
                            <div className="bg-muted/50 rounded px-2 py-1 text-xs text-muted-foreground">
                              {formatTime(schedule.start_time)} - {formatTime(schedule.end_time)}
                            </div>
                          ) : schedule?.is_off_day ? (
                            <div className="text-xs text-muted-foreground">Off</div>
                          ) : (
                            <div className="text-xs text-muted-foreground/50">-</div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Shift Templates Legend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Shift Templates</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {shiftTemplates.map((template) => {
              const Icon = SHIFT_ICONS[template.name] || Clock
              return (
                <div 
                  key={template.id}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
                  style={{ backgroundColor: `${template.color}20`, color: template.color }}
                >
                  <Icon className="w-3 h-3" />
                  {template.name}: {formatTime(template.start_time)} - {formatTime(template.end_time)}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Dialogs */}
      <AddShiftDialog
        open={showAddShift}
        onOpenChange={setShowAddShift}
        staff={allStaff}
        shiftTemplates={shiftTemplates}
        selectedStaff={selectedStaff}
        selectedDate={selectedDate}
      />
      
      <EditScheduleDialog
        open={showEditSchedule}
        onOpenChange={setShowEditSchedule}
        staff={allStaff}
        schedules={schedules}
      />
    </div>
  )
}
