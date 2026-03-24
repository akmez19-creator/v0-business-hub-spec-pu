'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent
} from '@/components/ui/dialog'
import {
  FileText, CalendarDays, Banknote, Eye, Loader2, Check,
  AlertCircle, ScrollText, Clock, CheckCircle2, XCircle, Plus
} from 'lucide-react'
import { PayslipTemplate } from '@/components/payroll/payslip-template'
import { EmploymentLetter } from '@/components/payroll/employment-letter'
import { contractorGenerateOwnPayslip, requestLetter } from '@/lib/payroll-actions'
import { cn } from '@/lib/utils'

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

function getCurrentMonthLabel() {
  const now = new Date()
  return `${MONTHS[now.getMonth()]}-${now.getFullYear()}`
}

interface ContractorPayslipsContentProps {
  contractor: any
  payrollProfile: any
  payslips: any[]
  letterRequests: any[]
  isAdmin?: boolean
}

export function ContractorPayslipsContent({
  contractor,
  payrollProfile,
  payslips = [],
  letterRequests = [],
  isAdmin = false,
}: ContractorPayslipsContentProps) {
  const [viewPayslip, setViewPayslip] = useState<any | null>(null)
  const [viewLetter, setViewLetter] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [genError, setGenError] = useState<string | null>(null)
  const [genSuccess, setGenSuccess] = useState(false)
  const [letterPending, setLetterPending] = useState(false)
  const [letterMsg, setLetterMsg] = useState<string | null>(null)
  const router = useRouter()

  // Ensure arrays are never undefined
  const safePayslips = payslips || []
  const safeLetterRequests = letterRequests || []

  const monthlySalary = Number(contractor?.monthly_salary || 0)
  const currentMonth = getCurrentMonthLabel()
  const hasCurrentMonthPayslip = safePayslips.some(p => p.month === currentMonth)
  const hasPayrollProfile = !!payrollProfile
  const canGenerate = hasPayrollProfile && monthlySalary > 0 && !hasCurrentMonthPayslip

  // Letter request status
  const latestLetterReq = safeLetterRequests.find(r => r.status === 'approved') || safeLetterRequests[0]
  const hasApprovedLetter = safeLetterRequests.some(r => r.status === 'approved')
  const hasPendingLetter = safeLetterRequests.some(r => r.status === 'pending')

  function handleGenerate() {
    setGenError(null)
    setGenSuccess(false)
    startTransition(async () => {
      const result = await contractorGenerateOwnPayslip(contractor.id, currentMonth)
      if (result.error) {
        setGenError(result.error)
      } else {
        setGenSuccess(true)
        setTimeout(() => setGenSuccess(false), 3000)
        router.refresh()
      }
    })
  }

  function handleRequestLetter() {
    setLetterMsg(null)
    setLetterPending(true)
    startTransition(async () => {
      const result = await requestLetter(contractor.id)
      setLetterPending(false)
      if (result.error) {
        setLetterMsg(result.error)
      } else {
        setLetterMsg('Letter request sent! Admin will review shortly.')
        router.refresh()
      }
    })
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="text-center py-3">
        <h2 className="text-lg font-bold text-foreground">Payslips</h2>
        <p className="text-xs text-muted-foreground">View and generate your payslips</p>
      </div>

      {/* Salary Summary */}
      {monthlySalary > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Banknote className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Monthly Salary</p>
                  <p className="text-lg font-bold text-primary">Rs {monthlySalary.toLocaleString()}</p>
                </div>
              </div>
              {payrollProfile && (
                <Badge variant="secondary" className="text-[9px] bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                  {payrollProfile.post || 'Employee'}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Generate Current Month Payslip */}
      {canGenerate && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Generate {currentMonth} Payslip</p>
                <p className="text-[10px] text-muted-foreground">Once generated, it cannot be changed</p>
              </div>
              <Button
                size="sm"
                onClick={handleGenerate}
                disabled={isPending}
                className={cn(genSuccess ? 'bg-emerald-600 hover:bg-emerald-700' : '')}
              >
                {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> :
                 genSuccess ? <Check className="w-3.5 h-3.5 mr-1.5" /> :
                 <Plus className="w-3.5 h-3.5 mr-1.5" />}
                {genSuccess ? 'Generated' : 'Generate'}
              </Button>
            </div>
            {genError && (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-red-500">
                <AlertCircle className="w-3.5 h-3.5" />
                {genError}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {hasCurrentMonthPayslip && (
        <div className="flex items-center gap-1.5 px-1 text-xs text-emerald-600">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>{currentMonth} payslip already generated</span>
        </div>
      )}

      {/* Employment Letter Section */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <ScrollText className="w-5 h-5 text-blue-500" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Employment Confirmation Letter</p>
              <p className="text-[10px] text-muted-foreground">Request a letter from admin - available once approved</p>
            </div>
          </div>

          {/* Status + Actions */}
          <div className="space-y-2">
            {hasApprovedLetter ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs text-emerald-600">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Letter approved - you can view/print it</span>
                </div>
                <Button size="sm" variant="outline" onClick={() => setViewLetter(true)}>
                  <Eye className="w-3.5 h-3.5 mr-1.5" /> View Letter
                </Button>
              </div>
            ) : hasPendingLetter ? (
              <div className="flex items-center gap-1.5 text-xs text-amber-600">
                <Clock className="w-3.5 h-3.5" />
                <span>Letter request pending admin approval</span>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={handleRequestLetter}
                disabled={letterPending || !hasPayrollProfile}
                className="w-full"
              >
                {letterPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> :
                 <ScrollText className="w-3.5 h-3.5 mr-1.5" />}
                Request Employment Letter
              </Button>
            )}

            {/* Show rejected if last was rejected */}
            {latestLetterReq?.status === 'rejected' && !hasPendingLetter && !hasApprovedLetter && (
              <div className="flex items-center gap-1.5 text-xs text-red-500 mt-1">
                <XCircle className="w-3.5 h-3.5" />
                <span>Previous request was declined{latestLetterReq.admin_note ? `: ${latestLetterReq.admin_note}` : ''}</span>
              </div>
            )}

            {letterMsg && (
              <p className="text-xs text-muted-foreground mt-1">{letterMsg}</p>
            )}

            {!hasPayrollProfile && (
              <p className="text-[10px] text-muted-foreground">Payroll profile must be set up by admin before requesting.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* No payslips state */}
      {safePayslips.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-50" />
            <p className="text-sm text-muted-foreground">No payslips available yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Generate your first payslip above or wait for admin.</p>
          </CardContent>
        </Card>
      )}

      {/* Payslip Cards */}
      {safePayslips.map(ps => {
        const netPay = Number(ps.net_pay || 0)
        const gross = Number(ps.gross_emoluments || 0)
        const totalDeductions = Number(ps.total_employee_deductions || 0)

        return (
          <Card key={ps.id} className="overflow-hidden">
            <CardContent className="py-0 px-0">
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <CalendarDays className="w-4 h-4 text-muted-foreground" />
                    <span className="font-semibold text-sm">{ps.month}</span>
                  </div>
                  <Badge variant="secondary" className="text-[9px] bg-blue-500/10 text-blue-500 border-blue-500/20">
                    {ps.status || 'generated'}
                  </Badge>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Gross Emoluments</span>
                    <span className="font-medium">Rs {gross.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Employee Deductions</span>
                    <span className="font-medium text-red-500">- Rs {totalDeductions.toLocaleString()}</span>
                  </div>
                  <div className="h-px bg-border my-1.5" />
                  <div className="flex justify-between">
                    <span className="font-semibold">Net Pay</span>
                    <span className="font-bold text-primary text-sm">Rs {netPay.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              <div className="border-t px-4 py-2.5 bg-muted/20 flex items-center justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setViewPayslip(ps)}>
                  <Eye className="w-3.5 h-3.5 mr-1.5" /> View Payslip
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      })}

      {safePayslips.length > 0 && (
        <p className="text-center text-[10px] text-muted-foreground">
          Showing last {safePayslips.length} payslip{safePayslips.length !== 1 ? 's' : ''}
        </p>
      )}

      {/* Payslip Viewer Dialog */}
      {viewPayslip && (
        <Dialog open={!!viewPayslip} onOpenChange={() => setViewPayslip(null)}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <PayslipTemplate
              payslip={viewPayslip}
              contractor={contractor}
              payrollProfile={payrollProfile}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* Employment Letter Dialog */}
      {viewLetter && hasApprovedLetter && (
        <Dialog open={viewLetter} onOpenChange={setViewLetter}>
          <DialogContent className="max-w-4xl max-h-[95vh] overflow-y-auto">
            <EmploymentLetter
              contractor={contractor}
              payrollProfile={payrollProfile}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// Alias export for backward compatibility
export { ContractorPayslipsContent as PayslipsContent }
