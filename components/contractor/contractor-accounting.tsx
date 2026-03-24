// Accounting Module v2 - Mobile-first design
'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { 
  FileText, Receipt, Wallet, Calendar, TrendingDown, FileCheck, Plus, 
  Fuel, Wrench, Car, Package, Check, ChevronRight, AlertCircle, Loader2, X
} from 'lucide-react'
import { ContractorPayslipsContent } from './payslips-content'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import useSWR, { mutate } from 'swr'

const fetcher = (url: string) => fetch(url).then(res => res.json())

interface AccountingContentProps {
  contractorId: string
  payrollProfile: any
  contractor: any
  riders?: Array<{
    id: string
    name: string
    rider_payment_settings?: { payment_type: string; daily_rate?: number }
  }>
  companySettings: any
  pastPayslips: any[]
  letterRequests: any[]
}

export function AccountingContent({
  contractorId,
  contractor,
  payrollProfile,
  riders = [],
  companySettings,
  pastPayslips = [],
  letterRequests = [],
}: AccountingContentProps) {
  const [activeView, setActiveView] = useState<'menu' | 'payslips' | 'deductions' | 'expenses' | 'receipts' | 'workdays' | 'letters'>('menu')

  // Fetch expenses and deductions for counts
  const { data: expenses = [] } = useSWR(
    `/api/expenses?ownerType=contractor&ownerId=${contractorId}`,
    fetcher
  )
  const { data: deductions = [] } = useSWR(
    `/api/deductions?targetType=contractor&targetId=${contractorId}`,
    fetcher
  )

  const safeExpenses = Array.isArray(expenses) ? expenses : []
  const safeDeductions = Array.isArray(deductions) ? deductions : []
  const pendingDeductions = safeDeductions.filter((d: any) => d.status === 'pending')
  const dailyWageRiders = riders.filter(r => r.rider_payment_settings?.payment_type === 'daily_wage')

  const menuItems = [
    { 
      id: 'payslips', 
      label: 'Payslips', 
      icon: FileText, 
      color: 'text-primary',
      bg: 'bg-primary/10',
      description: 'View & generate payslips',
      count: pastPayslips.length,
      alert: false
    },
    { 
      id: 'deductions', 
      label: 'Deductions', 
      icon: TrendingDown, 
      color: 'text-red-500',
      bg: 'bg-red-500/10',
      description: 'Stock missing, damages',
      count: pendingDeductions.length,
      alert: pendingDeductions.length > 0
    },
    { 
      id: 'expenses', 
      label: 'Expenses', 
      icon: Wallet, 
      color: 'text-blue-500',
      bg: 'bg-blue-500/10',
      description: 'Track fuel & repairs',
      count: safeExpenses.length,
      alert: false
    },
    { 
      id: 'receipts', 
      label: 'Receipts', 
      icon: Receipt, 
      color: 'text-emerald-500',
      bg: 'bg-emerald-500/10',
      description: 'Payment receipts',
      count: pastPayslips.filter(p => p.status === 'paid').length,
      alert: false
    },
    { 
      id: 'workdays', 
      label: 'Work Days', 
      icon: Calendar, 
      color: 'text-violet-500',
      bg: 'bg-violet-500/10',
      description: 'Daily wage attendance',
      count: dailyWageRiders.length,
      alert: false
    },
    { 
      id: 'letters', 
      label: 'Letters', 
      icon: FileCheck, 
      color: 'text-cyan-500',
      bg: 'bg-cyan-500/10',
      description: 'Employment letters',
      count: letterRequests.length,
      alert: false
    },
  ]

  // Main Menu View
  if (activeView === 'menu') {
    const totalPendingDeductions = pendingDeductions.reduce((sum: number, d: any) => sum + (d.amount || 0), 0)
    
    return (
      <div className="space-y-4 pb-20">
        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="py-3 px-4">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Monthly Salary</p>
              <p className="text-lg font-bold text-primary">
                Rs {(contractor?.monthly_salary || 0).toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card className={totalPendingDeductions > 0 ? 'border-red-500/30' : ''}>
            <CardContent className="py-3 px-4">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Pending Deductions</p>
              <p className={cn("text-lg font-bold", totalPendingDeductions > 0 ? 'text-red-500' : 'text-emerald-500')}>
                Rs {totalPendingDeductions.toLocaleString()}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Menu Items */}
        <div className="space-y-2">
          {menuItems.map((item) => {
            const Icon = item.icon
            return (
              <Card 
                key={item.id}
                className={cn(
                  "cursor-pointer active:scale-[0.98] transition-transform",
                  item.alert && "border-red-500/30"
                )}
                onClick={() => setActiveView(item.id as any)}
              >
                <CardContent className="py-3 px-4">
                  <div className="flex items-center gap-3">
                    <div className={cn("p-2.5 rounded-xl", item.bg)}>
                      <Icon className={cn("w-5 h-5", item.color)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">{item.label}</p>
                        {item.count > 0 && (
                          <Badge 
                            variant={item.alert ? "destructive" : "secondary"} 
                            className="text-[9px] px-1.5 py-0"
                          >
                            {item.count}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate">{item.description}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    )
  }

  // Back button component
  const BackButton = () => (
    <Button 
      variant="ghost" 
      size="sm" 
      className="mb-3 -ml-2 text-muted-foreground"
      onClick={() => setActiveView('menu')}
    >
      <ChevronRight className="w-4 h-4 mr-1 rotate-180" />
      Back
    </Button>
  )

  // Payslips View
  if (activeView === 'payslips') {
    return (
      <div className="pb-20">
        <BackButton />
        <ContractorPayslipsContent
          contractor={contractor}
          payrollProfile={payrollProfile}
          payslips={pastPayslips}
          letterRequests={letterRequests}
          isAdmin={false}
        />
      </div>
    )
  }

  // Deductions View
  if (activeView === 'deductions') {
    return (
      <DeductionsMobileView 
        deductions={safeDeductions}
        onBack={() => setActiveView('menu')} 
      />
    )
  }

  // Expenses View
  if (activeView === 'expenses') {
    return (
      <ExpensesMobileView 
        contractorId={contractorId} 
        riders={riders} 
        onBack={() => setActiveView('menu')} 
      />
    )
  }

  // Receipts View
  if (activeView === 'receipts') {
    const receipts = pastPayslips
      .filter(p => p.status === 'paid')
      .map(p => ({
        id: p.id,
        month: p.month,
        amount: p.net_salary,
        date: p.paid_at || p.updated_at,
      }))

    return (
      <div className="space-y-4 pb-20">
        <BackButton />
        <div className="text-center py-2">
          <h2 className="text-lg font-bold">Receipts</h2>
          <p className="text-xs text-muted-foreground">Payment receipts</p>
        </div>
        
        {receipts.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <div className="p-3 rounded-full bg-emerald-500/10 w-fit mx-auto mb-3">
                <Receipt className="w-8 h-8 text-emerald-500/40" />
              </div>
              <p className="text-sm font-medium">No Receipts Yet</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Receipts are generated when payslips are marked as paid
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {receipts.map((receipt) => (
              <Card key={receipt.id}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-emerald-500/10">
                        <Receipt className="w-4 h-4 text-emerald-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{receipt.month}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {receipt.date ? format(new Date(receipt.date), 'dd MMM yyyy') : 'Paid'}
                        </p>
                      </div>
                    </div>
                    <p className="text-sm font-bold text-emerald-600">
                      Rs {receipt.amount?.toLocaleString()}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Work Days View
  if (activeView === 'workdays') {
    return (
      <WorkDaysMobileView 
        dailyWageRiders={dailyWageRiders}
        onBack={() => setActiveView('menu')} 
      />
    )
  }

  // Letters View
  if (activeView === 'letters') {
    return (
      <div className="pb-20">
        <BackButton />
        <ContractorPayslipsContent
          contractor={contractor}
          payrollProfile={payrollProfile}
          payslips={[]}
          letterRequests={letterRequests}
          isAdmin={false}
        />
      </div>
    )
  }



  return null
}

// Deductions Mobile View Component
function DeductionsMobileView({ 
  deductions,
  onBack
}: { 
  deductions: any[]
  onBack: () => void
}) {
  const pendingDeductions = deductions.filter(d => d.status === 'pending')
  const appliedDeductions = deductions.filter(d => d.status === 'applied')
  const reversedDeductions = deductions.filter(d => d.status === 'reversed')
  const totalPending = pendingDeductions.reduce((sum, d) => sum + (d.amount || 0), 0)

  const DEDUCTION_TYPE_LABELS: Record<string, string> = {
    stock_missing: 'Stock Missing',
    cash_short: 'Cash Short',
    damage: 'Damage',
    advance: 'Advance',
    other: 'Other',
  }

  return (
    <div className="space-y-4 pb-20">
      <Button 
        variant="ghost" 
        size="sm" 
        className="mb-1 -ml-2 text-muted-foreground"
        onClick={onBack}
      >
        <ChevronRight className="w-4 h-4 mr-1 rotate-180" />
        Back
      </Button>

      <div>
        <h2 className="text-lg font-bold">Deductions</h2>
        <p className="text-xs text-muted-foreground">View deductions from your account</p>
      </div>

      {/* Pending Alert */}
      {totalPending > 0 && (
        <Card className="border-red-500/30 bg-red-500/5">
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <div>
                <p className="text-sm font-bold text-red-500">Rs {totalPending.toLocaleString()} pending</p>
                <p className="text-[10px] text-muted-foreground">Will be deducted from next payout</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {deductions.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <div className="p-3 rounded-full bg-amber-500/10 w-fit mx-auto mb-3">
              <TrendingDown className="w-8 h-8 text-amber-500/40" />
            </div>
            <p className="text-sm font-medium">No Deductions</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Deductions for stock missing, damages, or cash short will appear here
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {deductions.map((d) => (
            <Card key={d.id} className={d.status === 'reversed' ? 'opacity-60' : ''}>
              <CardContent className="py-3 px-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "p-2 rounded-lg",
                      d.status === 'pending' ? 'bg-red-500/10' : 
                      d.status === 'applied' ? 'bg-amber-500/10' : 'bg-muted'
                    )}>
                      <TrendingDown className={cn(
                        "w-4 h-4",
                        d.status === 'pending' ? 'text-red-500' : 
                        d.status === 'applied' ? 'text-amber-500' : 'text-muted-foreground'
                      )} />
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {DEDUCTION_TYPE_LABELS[d.deduction_type] || d.deduction_type}
                      </p>
                      <p className="text-[10px] text-muted-foreground line-clamp-2">{d.reason}</p>
                      <p className="text-[9px] text-muted-foreground mt-1">
                        {format(new Date(d.created_at), 'dd MMM yyyy')}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={cn(
                      "font-bold",
                      d.status === 'reversed' ? 'line-through text-muted-foreground' : 'text-red-500'
                    )}>
                      Rs {d.amount?.toLocaleString()}
                    </p>
                    <Badge 
                      variant={d.status === 'pending' ? 'destructive' : d.status === 'applied' ? 'default' : 'secondary'}
                      className="text-[8px] mt-1"
                    >
                      {d.status}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

// Expenses Mobile View Component
function ExpensesMobileView({ 
  contractorId, 
  riders,
  onBack
}: { 
  contractorId: string
  riders: Array<{ id: string; name: string; rider_payment_settings?: any }>
  onBack: () => void
}) {
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [saving, setSaving] = useState(false)
  const [expenseType, setExpenseType] = useState('fuel')
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseDescription, setExpenseDescription] = useState('')
  const [expenseRider, setExpenseRider] = useState('none')

  // Fetch expenses from API
  const { data: expenses = [], error, isLoading } = useSWR(
    `/api/expenses?ownerType=contractor&ownerId=${contractorId}`,
    fetcher
  )

  const safeExpenses = Array.isArray(expenses) ? expenses : []

  const expenseTypes = [
    { value: 'fuel', label: 'Fuel', icon: Fuel, category: 'vehicle' },
    { value: 'maintenance', label: 'Repair', icon: Wrench, category: 'vehicle' },
    { value: 'servicing', label: 'Service', icon: Car, category: 'vehicle' },
    { value: 'insurance', label: 'Insurance', icon: FileText, category: 'vehicle' },
    { value: 'other', label: 'Other', icon: Package, category: 'operational' },
  ]

  const handleAddExpense = async () => {
    if (!expenseType || !expenseAmount || parseFloat(expenseAmount) <= 0) return

    setSaving(true)
    try {
      const typeConfig = expenseTypes.find(t => t.value === expenseType)
      const isForRider = expenseRider && expenseRider !== 'none'

      const response = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expense_type: expenseType,
          category: typeConfig?.category || 'operational',
          owner_type: isForRider ? 'rider' : 'contractor',
          owner_id: isForRider ? expenseRider : contractorId,
          amount: parseFloat(expenseAmount),
          description: expenseDescription || null,
          expense_date: format(new Date(), 'yyyy-MM-dd'),
        }),
      })

      if (response.ok) {
        mutate(`/api/expenses?ownerType=contractor&ownerId=${contractorId}`)
        setShowAddDialog(false)
        setExpenseType('fuel')
        setExpenseAmount('')
        setExpenseDescription('')
        setExpenseRider('none')
      }
    } catch (error) {
      console.error('Error adding expense:', error)
    } finally {
      setSaving(false)
    }
  }

  const totalExpenses = safeExpenses.reduce((sum: number, e: any) => sum + (e.amount || 0), 0)

  return (
    <div className="space-y-4 pb-20">
      <Button 
        variant="ghost" 
        size="sm" 
        className="mb-1 -ml-2 text-muted-foreground"
        onClick={onBack}
      >
        <ChevronRight className="w-4 h-4 mr-1 rotate-180" />
        Back
      </Button>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Expenses</h2>
          <p className="text-xs text-muted-foreground">Track your costs</p>
        </div>
        <Button size="sm" onClick={() => setShowAddDialog(true)}>
          <Plus className="w-4 h-4 mr-1" />
          Add
        </Button>
      </div>

      {/* Total Card */}
      {safeExpenses.length > 0 && (
        <Card className="bg-blue-500/5 border-blue-500/20">
          <CardContent className="py-3 px-4">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Total This Month</p>
            <p className="text-xl font-bold text-blue-600">Rs {totalExpenses.toLocaleString()}</p>
          </CardContent>
        </Card>
      )}

      {/* Loading State */}
      {isLoading && (
        <Card>
          <CardContent className="py-8 text-center">
            <Loader2 className="w-6 h-6 mx-auto animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground mt-2">Loading expenses...</p>
          </CardContent>
        </Card>
      )}

      {/* Expense List */}
      {!isLoading && safeExpenses.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <div className="p-3 rounded-full bg-blue-500/10 w-fit mx-auto mb-3">
              <Wallet className="w-8 h-8 text-blue-500/40" />
            </div>
            <p className="text-sm font-medium">No Expenses</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Tap "Add" to record fuel, repairs, or other costs
            </p>
          </CardContent>
        </Card>
      ) : !isLoading && (
        <div className="space-y-2">
          {safeExpenses.map((expense: any) => {
            const typeInfo = expenseTypes.find(t => t.value === expense.expense_type)
            const Icon = typeInfo?.icon || Wallet
            return (
              <Card key={expense.id}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-blue-500/10">
                        <Icon className="w-4 h-4 text-blue-500" />
                      </div>
                      <div>
                        <p className="text-sm font-medium capitalize">{typeInfo?.label || expense.expense_type}</p>
                        {expense.description && (
                          <p className="text-[10px] text-muted-foreground truncate max-w-[150px]">
                            {expense.description}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold">Rs {expense.amount?.toLocaleString()}</p>
                      <p className="text-[9px] text-muted-foreground">
                        {format(new Date(expense.expense_date || expense.created_at), 'dd MMM')}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Add Expense Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-[95vw] rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-base">Add Expense</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {/* Quick Type Selection */}
            <div className="grid grid-cols-5 gap-2">
              {expenseTypes.map(type => {
                const Icon = type.icon
                const isSelected = expenseType === type.value
                return (
                  <button
                    key={type.value}
                    onClick={() => setExpenseType(type.value)}
                    className={cn(
                      "flex flex-col items-center gap-1 p-2 rounded-lg border transition-colors",
                      isSelected 
                        ? "border-blue-500 bg-blue-500/10" 
                        : "border-border hover:bg-muted"
                    )}
                  >
                    <Icon className={cn("w-5 h-5", isSelected ? "text-blue-500" : "text-muted-foreground")} />
                    <span className={cn("text-[9px]", isSelected ? "text-blue-500 font-medium" : "text-muted-foreground")}>
                      {type.label}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Amount (Rs)</Label>
              <Input
                type="number"
                inputMode="numeric"
                placeholder="0"
                value={expenseAmount}
                onChange={(e) => setExpenseAmount(e.target.value)}
                className="text-lg font-bold h-12"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Description (optional)</Label>
              <Input
                placeholder="e.g., Fuel for delivery"
                value={expenseDescription}
                onChange={(e) => setExpenseDescription(e.target.value)}
              />
            </div>

            {riders.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Rider (optional)</Label>
                <Select value={expenseRider} onValueChange={setExpenseRider}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select rider" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">My expense</SelectItem>
                    {riders.map(rider => (
                      <SelectItem key={rider.id} value={rider.id}>
                        {rider.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <Button 
              onClick={handleAddExpense} 
              className="w-full h-11"
              disabled={saving || !expenseType || !expenseAmount || parseFloat(expenseAmount) <= 0}
            >
              {saving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Check className="w-4 h-4 mr-2" />
              )}
              Save Expense
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Work Days Mobile View Component
function WorkDaysMobileView({ 
  dailyWageRiders,
  onBack
}: { 
  dailyWageRiders: Array<{ id: string; name: string; rider_payment_settings?: { payment_type: string; daily_rate?: number } }>
  onBack: () => void
}) {
  const [attendance, setAttendance] = useState<Record<string, 'present' | 'absent'>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Initialize attendance state
  useEffect(() => {
    const initial: Record<string, 'present' | 'absent'> = {}
    dailyWageRiders.forEach(r => {
      initial[r.id] = 'present'
    })
    setAttendance(initial)
  }, [dailyWageRiders])

  const toggleAttendance = (riderId: string) => {
    setAttendance(prev => ({
      ...prev,
      [riderId]: prev[riderId] === 'present' ? 'absent' : 'present'
    }))
    setSaved(false)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const workDays = Object.entries(attendance).map(([riderId, status]) => ({
        rider_id: riderId,
        work_date: format(new Date(), 'yyyy-MM-dd'),
        status,
      }))

      const response = await fetch('/api/work-days', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workDays }),
      })

      if (response.ok) {
        setSaved(true)
      }
    } catch (error) {
      console.error('Error saving attendance:', error)
    } finally {
      setSaving(false)
    }
  }

  const today = format(new Date(), 'EEE, dd MMM')
  const presentCount = Object.values(attendance).filter(v => v === 'present').length

  return (
    <div className="space-y-4 pb-20">
      <Button 
        variant="ghost" 
        size="sm" 
        className="mb-1 -ml-2 text-muted-foreground"
        onClick={onBack}
      >
        <ChevronRight className="w-4 h-4 mr-1 rotate-180" />
        Back
      </Button>

      <div>
        <h2 className="text-lg font-bold">Work Days</h2>
        <p className="text-xs text-muted-foreground">{today} - Mark attendance</p>
      </div>

      {dailyWageRiders.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <div className="p-3 rounded-full bg-violet-500/10 w-fit mx-auto mb-3">
              <Calendar className="w-8 h-8 text-violet-500/40" />
            </div>
            <p className="text-sm font-medium">No Daily Wage Riders</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              This is for tracking attendance of riders on daily wage payment type
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary */}
          <Card className="bg-violet-500/5 border-violet-500/20">
            <CardContent className="py-3 px-4">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Today</p>
                  <p className="text-lg font-bold text-violet-600">{presentCount} / {dailyWageRiders.length}</p>
                  <p className="text-[10px] text-muted-foreground">present</p>
                </div>
                {saved && (
                  <Badge variant="outline" className="text-emerald-600 border-emerald-600">
                    <Check className="w-3 h-3 mr-1" />
                    Saved
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Rider List */}
          <div className="space-y-2">
            {dailyWageRiders.map((rider) => {
              const isPresent = attendance[rider.id] === 'present'
              return (
                <Card 
                  key={rider.id}
                  className={cn(
                    "cursor-pointer active:scale-[0.98] transition-all",
                    isPresent ? "border-emerald-500/30" : "border-red-500/30"
                  )}
                  onClick={() => toggleAttendance(rider.id)}
                >
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{rider.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          Daily rate: Rs {rider.rider_payment_settings?.daily_rate || 0}
                        </p>
                      </div>
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center transition-colors",
                        isPresent ? "bg-emerald-500" : "bg-red-500"
                      )}>
                        {isPresent ? (
                          <Check className="w-5 h-5 text-white" />
                        ) : (
                          <X className="w-5 h-5 text-white" />
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Save Button */}
          <Button 
            onClick={handleSave} 
            className="w-full h-11"
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Check className="w-4 h-4 mr-2" />
            )}
            Save Attendance
          </Button>
        </>
      )}
    </div>
  )
}
