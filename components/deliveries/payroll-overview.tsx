'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter
} from '@/components/ui/dialog'
import {
  Users, FileText, Settings, Loader2, Check, AlertCircle, Download,
  ChevronDown, ChevronUp, CalendarDays, Banknote, Eye, ScrollText,
  Clock, CheckCircle2, XCircle
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { savePayrollProfile, generatePayslip, bulkGeneratePayslips, reviewLetterRequest } from '@/lib/payroll-actions'
import { PayslipTemplate } from '@/components/payroll/payslip-template'
import { EmploymentLetter } from '@/components/payroll/employment-letter'

interface PayrollOverviewProps {
  contractors: any[]
  payrollProfiles: Record<string, any>
  payslips: Record<string, any[]>
  letterRequests: any[]
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

function getCurrentMonthLabel() {
  const now = new Date()
  return `${MONTHS[now.getMonth()]}-${now.getFullYear()}`
}

function getLast6Months(): string[] {
  const result: string[] = []
  const now = new Date()
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    result.push(`${MONTHS[d.getMonth()]}-${d.getFullYear()}`)
  }
  return result
}

export function PayrollOverview({ contractors, payrollProfiles, payslips, letterRequests }: PayrollOverviewProps) {
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonthLabel())
  const [isPending, startTransition] = useTransition()
  const [bulkDone, setBulkDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewPayslip, setViewPayslip] = useState<any | null>(null)
  const [viewLetter, setViewLetter] = useState<any | null>(null)
  const router = useRouter()

  const salariedContractors = contractors.filter(c => Number(c.monthly_salary) > 0)
  const monthOptions = getLast6Months()

  // Count stats
  const profiledCount = salariedContractors.filter(c => payrollProfiles[c.id]).length
  const monthPayslips = salariedContractors.filter(c =>
    payslips[c.id]?.some(p => p.month === selectedMonth)
  ).length

  function handleBulkGenerate() {
    setError(null)
    setBulkDone(false)
    startTransition(async () => {
      const result = await bulkGeneratePayslips(selectedMonth)
      if (result.error) setError(result.error)
      else { setBulkDone(true); setTimeout(() => setBulkDone(false), 3000); router.refresh() }
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payroll</h1>
          <p className="text-sm text-muted-foreground">Manage employee payslips and statutory deductions</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map(m => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10"><Users className="w-4 h-4 text-primary" /></div>
              <div>
                <p className="text-2xl font-bold">{salariedContractors.length}</p>
                <p className="text-xs text-muted-foreground">Salaried Employees</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10"><Settings className="w-4 h-4 text-blue-500" /></div>
              <div>
                <p className="text-2xl font-bold">{profiledCount}/{salariedContractors.length}</p>
                <p className="text-xs text-muted-foreground">Profiles Set Up</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-500/10"><FileText className="w-4 h-4 text-emerald-500" /></div>
              <div>
                <p className="text-2xl font-bold">{monthPayslips}/{salariedContractors.length}</p>
                <p className="text-xs text-muted-foreground">{selectedMonth} Payslips</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Bulk Generate */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">Generate Payslips for {selectedMonth}</p>
              <p className="text-xs text-muted-foreground">Generates payslips for all employees with a payroll profile set up</p>
            </div>
            <Button
              onClick={handleBulkGenerate}
              disabled={isPending || profiledCount === 0}
              className={cn(bulkDone ? 'bg-emerald-600 hover:bg-emerald-700' : '')}
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> :
               bulkDone ? <Check className="w-4 h-4 mr-2" /> : <FileText className="w-4 h-4 mr-2" />}
              {bulkDone ? 'Generated' : `Generate All (${profiledCount})`}
            </Button>
          </div>
          {error && (
            <div className="mt-2 flex items-center gap-2 text-sm text-red-500">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Letter Requests */}
      {letterRequests.filter(r => r.status === 'pending').length > 0 && (
        <Card className="border-amber-500/30">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              Pending Letter Requests ({letterRequests.filter(r => r.status === 'pending').length})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {letterRequests.filter(r => r.status === 'pending').map(req => (
              <LetterRequestRow
                key={req.id}
                request={req}
                contractor={contractors.find(c => c.id === req.contractor_id)}
                payrollProfile={payrollProfiles[req.contractor_id]}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Employee List */}
      <div className="space-y-3">
        {salariedContractors.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-muted-foreground">No employees with a fixed monthly salary set.</p>
              <p className="text-sm text-muted-foreground mt-1">Set a monthly salary on the Contractors page first.</p>
            </CardContent>
          </Card>
        )}
        {salariedContractors.map(contractor => (
          <EmployeePayrollCard
            key={contractor.id}
            contractor={contractor}
            payrollProfile={payrollProfiles[contractor.id]}
            payslipsList={payslips[contractor.id] || []}
            selectedMonth={selectedMonth}
            onViewPayslip={setViewPayslip}
            onViewLetter={() => setViewLetter(contractor)}
          />
        ))}
      </div>

      {/* Payslip Viewer Dialog */}
      {viewPayslip && (
        <Dialog open={!!viewPayslip} onOpenChange={() => setViewPayslip(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <PayslipTemplate
              payslip={viewPayslip}
              contractor={contractors.find(c => c.id === viewPayslip.contractor_id)}
              payrollProfile={payrollProfiles[viewPayslip.contractor_id]}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Employment Letter Dialog */}
      {viewLetter && (
        <Dialog open={!!viewLetter} onOpenChange={() => setViewLetter(null)}>
          <DialogContent className="max-w-4xl max-h-[95vh] overflow-y-auto">
            <EmploymentLetter
              contractor={viewLetter}
              payrollProfile={payrollProfiles[viewLetter.id]}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// ── Letter Request Approval Row ──
function LetterRequestRow({
  request,
  contractor,
  payrollProfile,
}: {
  request: any
  contractor: any
  payrollProfile: any
}) {
  const [isPending, startTransition] = useTransition()
  const [done, setDone] = useState<'approved' | 'rejected' | null>(null)
  const [viewLetter, setViewLetter] = useState(false)
  const router = useRouter()

  function handleAction(action: 'approved' | 'rejected') {
    startTransition(async () => {
      const result = await reviewLetterRequest(request.id, action)
      if (!result.error) {
        setDone(action)
        router.refresh()
      }
    })
  }

  const name = contractor?.name || request.contractors?.name || 'Unknown'
  const date = new Date(request.requested_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  if (done) {
    return (
      <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30">
        <span className="text-sm">{name}</span>
        <Badge
          variant="secondary"
          className={cn(
            'text-[9px]',
            done === 'approved' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
          )}
        >
          {done === 'approved' ? 'Approved' : 'Rejected'}
        </Badge>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30">
        <div>
          <p className="text-sm font-medium">{name}</p>
          <p className="text-[10px] text-muted-foreground">Requested {date} - Employment Confirmation Letter</p>
        </div>
        <div className="flex items-center gap-2">
          {contractor && payrollProfile && (
            <Button variant="outline" size="sm" onClick={() => setViewLetter(true)}>
              <Eye className="w-3 h-3 mr-1" /> Preview
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => handleAction('approved')}
            disabled={isPending}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleAction('rejected')}
            disabled={isPending}
            className="text-red-500 border-red-500/30 hover:bg-red-500/10"
          >
            <XCircle className="w-3 h-3 mr-1" /> Reject
          </Button>
        </div>
      </div>

      {viewLetter && contractor && payrollProfile && (
        <Dialog open={viewLetter} onOpenChange={setViewLetter}>
          <DialogContent className="max-w-4xl max-h-[95vh] overflow-y-auto">
            <EmploymentLetter
              contractor={contractor}
              payrollProfile={payrollProfile}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

// ── Employee Payroll Card ──
function EmployeePayrollCard({
  contractor,
  payrollProfile,
  payslipsList,
  selectedMonth,
  onViewPayslip,
  onViewLetter,
}: {
  contractor: any
  payrollProfile: any
  payslipsList: any[]
  selectedMonth: string
  onViewPayslip: (ps: any) => void
  onViewLetter: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [genDone, setGenDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const salary = Number(contractor.monthly_salary || 0)
  const hasProfile = !!payrollProfile
  const monthPayslip = payslipsList.find(p => p.month === selectedMonth)

  function handleGenerate() {
    setError(null)
    startTransition(async () => {
      const result = await generatePayslip(contractor.id, selectedMonth)
      if (result.error) setError(result.error)
      else { setGenDone(true); setTimeout(() => setGenDone(false), 3000); router.refresh() }
    })
  }

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
              {contractor.name?.charAt(0) || '?'}
            </div>
            <div>
              <p className="font-semibold text-sm">{contractor.name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <Badge variant="secondary" className="text-[9px]">
                  Rs {salary.toLocaleString()}/mo
                </Badge>
                {hasProfile ? (
                  <Badge variant="secondary" className="text-[9px] bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                    Profile Set
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[9px] bg-amber-500/10 text-amber-500 border-amber-500/20">
                    No Profile
                  </Badge>
                )}
                {monthPayslip && (
                  <Badge variant="secondary" className="text-[9px] bg-blue-500/10 text-blue-500 border-blue-500/20">
                    {selectedMonth} Ready
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {hasProfile && (
              <Button variant="outline" size="sm" onClick={onViewLetter}>
                <ScrollText className="w-3.5 h-3.5 mr-1" /> Letter
              </Button>
            )}
            {monthPayslip && (
              <Button variant="outline" size="sm" onClick={() => onViewPayslip(monthPayslip)}>
                <Eye className="w-3.5 h-3.5 mr-1" /> View
              </Button>
            )}
            {hasProfile && !monthPayslip && (
              <Button
                size="sm"
                onClick={handleGenerate}
                disabled={isPending}
                className={cn(genDone ? 'bg-emerald-600 hover:bg-emerald-700' : '')}
              >
                {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> :
                 genDone ? <Check className="w-3.5 h-3.5 mr-1" /> : <FileText className="w-3.5 h-3.5 mr-1" />}
                {genDone ? 'Done' : 'Generate'}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setShowSetup(true)}>
              <Settings className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {error && (
          <div className="mt-2 flex items-center gap-2 text-sm text-red-500">
            <AlertCircle className="w-4 h-4" />{error}
          </div>
        )}

        {/* Expanded: show past payslips */}
        {expanded && (
          <div className="mt-4 border-t pt-3">
            <p className="text-xs font-semibold text-muted-foreground mb-2">Past Payslips</p>
            {payslipsList.length === 0 ? (
              <p className="text-xs text-muted-foreground">No payslips generated yet.</p>
            ) : (
              <div className="space-y-1.5">
                {payslipsList.slice(0, 6).map(ps => (
                  <div key={ps.id} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                    <div className="flex items-center gap-2">
                      <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-sm font-medium">{ps.month}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-primary">
                        Rs {Number(ps.net_pay).toLocaleString()}
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => onViewPayslip(ps)}>
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Setup Dialog */}
        {showSetup && (
          <PayrollSetupDialog
            contractor={contractor}
            existingProfile={payrollProfile}
            open={showSetup}
            onClose={() => setShowSetup(false)}
          />
        )}
      </CardContent>
    </Card>
  )
}

// ── Payroll Profile Setup Dialog ──
function PayrollSetupDialog({
  contractor,
  existingProfile,
  open,
  onClose,
}: {
  contractor: any
  existingProfile: any
  open: boolean
  onClose: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const [form, setForm] = useState({
    employeeCode: existingProfile?.employee_code || '',
    nic: existingProfile?.nic || '',
    tan: existingProfile?.tan || '',
    post: existingProfile?.post || 'Officer',
    department: existingProfile?.department || 'Delivery',
    dateJoined: existingProfile?.date_joined || '',
    taxCategory: existingProfile?.tax_category || 'A',
    numDependents: existingProfile?.num_dependents || 0,
    hasBedridden: existingProfile?.has_bedridden_dependent || false,
    bankAccount: existingProfile?.bank_account || '',
    transportAllowance: existingProfile?.transport_allowance || 0,
    mealAllowance: existingProfile?.meal_allowance || 0,
    otherAllowance: existingProfile?.other_allowance || 0,
  })

  function handleSave() {
    setError(null)
    startTransition(async () => {
      const result = await savePayrollProfile({
        contractorId: contractor.id,
        employeeCode: form.employeeCode,
        nic: form.nic,
        tan: form.tan,
        post: form.post,
        department: form.department,
        dateJoined: form.dateJoined,
        taxCategory: form.taxCategory,
        numDependents: Number(form.numDependents),
        hasBedridden: form.hasBedridden,
        bankAccount: form.bankAccount,
        transportAllowance: Number(form.transportAllowance),
        mealAllowance: Number(form.mealAllowance),
        otherAllowance: Number(form.otherAllowance),
      })
      if (result.error) setError(result.error)
      else { setSaved(true); setTimeout(() => { setSaved(false); onClose() }, 1500); router.refresh() }
    })
  }

  const update = (key: string, val: any) => setForm(f => ({ ...f, [key]: val }))

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Payroll Profile - {contractor.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Employee Info */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Employee Info</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-muted-foreground font-medium block mb-1">Employee Code</label>
                <Input value={form.employeeCode} onChange={e => update('employeeCode', e.target.value)} placeholder="e.g. EMP001" className="h-8 text-sm" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium block mb-1">NIC</label>
                <Input value={form.nic} onChange={e => update('nic', e.target.value)} placeholder="e.g. S2405991902131" className="h-8 text-sm" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium block mb-1">TAN</label>
                <Input value={form.tan} onChange={e => update('tan', e.target.value)} placeholder="Tax Account Number" className="h-8 text-sm" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium block mb-1">Date Joined</label>
                <Input type="date" value={form.dateJoined} onChange={e => update('dateJoined', e.target.value)} className="h-8 text-sm" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium block mb-1">Post</label>
                <Input value={form.post} onChange={e => update('post', e.target.value)} className="h-8 text-sm" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium block mb-1">Department</label>
                <Input value={form.department} onChange={e => update('department', e.target.value)} className="h-8 text-sm" />
              </div>
            </div>
          </div>

          {/* Tax Category */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tax Info</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-muted-foreground font-medium block mb-1">Tax Category</label>
                <Select value={form.taxCategory} onValueChange={v => update('taxCategory', v)}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A">A - Single</SelectItem>
                    <SelectItem value="B">B - Married (spouse no income)</SelectItem>
                    <SelectItem value="C">C - Widowed/Divorced + child</SelectItem>
                    <SelectItem value="D">D - Married both earning</SelectItem>
                    <SelectItem value="E">E - Married, spouse retired</SelectItem>
                    <SelectItem value="F">F - Retired</SelectItem>
                    <SelectItem value="G">G - Single parent</SelectItem>
                    <SelectItem value="H">H - Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium block mb-1">Dependents</label>
                <Input type="number" min="0" max="10" value={form.numDependents} onChange={e => update('numDependents', e.target.value)} className="h-8 text-sm" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={form.hasBedridden} onChange={e => update('hasBedridden', e.target.checked)} className="rounded" />
              Bedridden next of kin (additional Rs 150,000 relief)
            </label>
          </div>

          {/* Allowances */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Allowances (Monthly)</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] text-muted-foreground font-medium block mb-1">Transport (Rs)</label>
                <Input type="number" value={form.transportAllowance} onChange={e => update('transportAllowance', e.target.value)} className="h-8 text-sm" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium block mb-1">Meal (Rs)</label>
                <Input type="number" value={form.mealAllowance} onChange={e => update('mealAllowance', e.target.value)} className="h-8 text-sm" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-medium block mb-1">Other (Rs)</label>
                <Input type="number" value={form.otherAllowance} onChange={e => update('otherAllowance', e.target.value)} className="h-8 text-sm" />
              </div>
            </div>
          </div>

          {/* Bank */}
          <div>
            <label className="text-[10px] text-muted-foreground font-medium block mb-1">Bank Account Number</label>
            <Input value={form.bankAccount} onChange={e => update('bankAccount', e.target.value)} placeholder="e.g. 000446905488" className="h-8 text-sm" />
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-red-500">
            <AlertCircle className="w-4 h-4" />{error}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={isPending}
            className={cn(saved ? 'bg-emerald-600 hover:bg-emerald-700' : '')}
          >
            {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> :
             saved ? <Check className="w-4 h-4 mr-2" /> : null}
            {saved ? 'Saved' : 'Save Profile'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
