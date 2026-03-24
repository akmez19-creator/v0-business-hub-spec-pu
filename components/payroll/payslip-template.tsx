'use client'

import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Printer } from 'lucide-react'

interface PayslipTemplateProps {
  payslip: any
  contractor: any
  payrollProfile: any
  showActions?: boolean
}

function fmt(n: number | string | null | undefined): string {
  const val = Number(n || 0)
  return val.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtOrBlank(n: number | string | null | undefined): string {
  const val = Number(n || 0)
  if (val === 0) return ''
  return val.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const day = String(d.getDate()).padStart(2, '0')
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
  return `${day}-${months[d.getMonth()]}-${d.getFullYear()}`
}

function formatDateJoined(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const day = d.getDate()
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const yr = String(d.getFullYear()).slice(-2)
  return `${day}-${months[d.getMonth()]}-${yr}`
}

const PRINT_STYLES = `
  @page { size: A5 landscape; margin: 8mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; font-size: 9px; line-height: 1.3; }
  .slip { width: 210mm; max-width: 210mm; padding: 0; }
  .top-row { display: flex; justify-content: space-between; align-items: stretch; border: 1px solid #000; margin-bottom: 0; }
  .company { flex: 1; padding: 6px 10px; text-align: center; border-right: 1px solid #000; }
  .company h1 { font-size: 16px; font-weight: 900; margin-bottom: 4px; }
  .company p { font-size: 8.5px; margin: 1px 0; }
  .period { width: 200px; padding: 6px 10px; text-align: right; font-size: 8.5px; }
  .period .title { font-weight: bold; font-size: 12px; text-align: center; margin-bottom: 3px; }
  .period p { margin: 1px 0; }
  .section-title { font-weight: bold; font-size: 11px; text-align: center; margin: 6px 0 3px; }
  table { width: 100%; border-collapse: collapse; }
  td, th { border: 1px solid #000; padding: 2px 5px; font-size: 8.5px; vertical-align: middle; }
  th { background: #d9d9d9; font-weight: bold; text-align: left; }
  th.r, td.r { text-align: right; }
  td.c, th.c { text-align: center; }
  td.b { font-weight: bold; }
  .emp td.lbl { font-weight: bold; text-align: center; width: 80px; }
  .emp td.val { width: calc(50% - 80px); }
  .net-row { background: #d9d9d9; }
  .net-row td { font-weight: bold; text-align: center; padding: 4px 5px; font-size: 10px; }
  .foot td { text-align: center; font-size: 8px; padding: 3px 5px; }
  .disclaimer { text-align: center; font-size: 7.5px; color: #555; margin-top: 6px; }
  .disclaimer p { margin: 2px 0; }
  .payroll-row td { height: 14px; }
  .totals-row td { border-top: 2px solid #000; font-weight: bold; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`

export function PayslipTemplate({ payslip, contractor, payrollProfile, showActions = true }: PayslipTemplateProps) {
  const printRef = useRef<HTMLDivElement>(null)

  function handlePrint() {
    if (!printRef.current) return
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`<!DOCTYPE html><html><head><title>Payslip - ${contractor?.name || 'Employee'} - ${payslip.month}</title><style>${PRINT_STYLES}</style></head><body>${printRef.current.innerHTML}</body></html>`)
    w.document.close()
    setTimeout(() => { w.print() }, 300)
  }

  const gross = Number(payslip.gross_emoluments || 0)
  const totalDed = Number(payslip.total_employee_deductions || 0)
  const totalEmp = Number(payslip.total_employer_contributions || 0)
  const netPay = Number(payslip.net_pay || 0)
  const advances = Number(payslip.advances || 0)

  // The inner HTML that gets printed AND displayed
  const slipContent = (
    <div className="slip">
      {/* ── TOP ROW: Company + Payslip Period ── */}
      <div className="top-row">
        <div className="company">
          <h1>A Akmez Group Ltd</h1>
          <p>44 CAMP-LE-JUGE,</p>
          <p>FOREST-SIDE, CUREPIPE</p>
          <p>Tel: 6732002</p>
          <p>BRN: C19167358</p>
        </div>
        <div className="period">
          <p className="title">Payslip</p>
          <p>Period Start: {formatDate(payslip.period_start)}</p>
          <p>Period End: {formatDate(payslip.period_end)}</p>
          <p style={{ marginTop: 6 }}>Month: {payslip.month}</p>
          <p>Advance: Rs {fmt(advances)}</p>
        </div>
      </div>

      {/* ── EMPLOYEE ── */}
      <p className="section-title">EMPLOYEE</p>
      <table className="emp">
        <tbody>
          <tr>
            <td className="lbl">CODE</td>
            <td className="val">{payrollProfile?.employee_code || ''}</td>
            <td className="lbl">POST</td>
            <td className="val">{payrollProfile?.post || 'Officer'}</td>
          </tr>
          <tr>
            <td className="lbl">NAME</td>
            <td className="val">{contractor?.name || ''}</td>
            <td className="lbl">DEPARTMENT</td>
            <td className="val">{payrollProfile?.department || 'Delivery'}</td>
          </tr>
          <tr>
            <td className="lbl">NIC</td>
            <td className="val">{payrollProfile?.nic || ''}</td>
            <td className="lbl" rowSpan={2}>DATE JOINED</td>
            <td className="val" rowSpan={2}>{payrollProfile?.date_joined ? formatDateJoined(payrollProfile.date_joined) : ''}</td>
          </tr>
          <tr>
            <td className="lbl">TAN</td>
            <td className="val">{payrollProfile?.tan || ''}</td>
          </tr>
        </tbody>
      </table>

      {/* ── PAYROLL ── */}
      <p className="section-title">PAYROLL</p>
      <table>
        <thead>
          <tr>
            <th>Code / Sections</th>
            <th className="r" style={{ width: 100 }}>Revenues</th>
            <th className="r" style={{ width: 100 }}>Deductions</th>
            <th className="r" style={{ width: 100 }}>Employer</th>
          </tr>
        </thead>
        <tbody>
          <tr className="payroll-row">
            <td>1000 / Basic Salary</td>
            <td className="r">{fmt(payslip.basic_salary)}</td>
            <td></td>
            <td></td>
          </tr>
          <tr className="payroll-row">
            <td>2000 / Transport Allowance</td>
            <td className="r">{fmtOrBlank(payslip.transport_allowance)}</td>
            <td></td>
            <td></td>
          </tr>
          <tr className="payroll-row">
            <td>1100/1150 Overtime</td>
            <td className="r">{fmtOrBlank(payslip.overtime)}</td>
            <td></td>
            <td></td>
          </tr>
          <tr className="payroll-row">
            <td>3000 / Meal Allowance</td>
            <td className="r">{fmtOrBlank(payslip.meal_allowance)}</td>
            <td></td>
            <td></td>
          </tr>
          <tr className="payroll-row">
            <td>3180/ Other Allowance</td>
            <td className="r">{fmt(payslip.other_allowance)}</td>
            <td></td>
            <td></td>
          </tr>
          <tr className="payroll-row">
            <td>3900/ Absence</td>
            <td></td>
            <td className="r">{fmt(payslip.absence_deduction)}</td>
            <td></td>
          </tr>
          <tr className="payroll-row">
            <td>4010 / CSG</td>
            <td></td>
            <td className="r">{fmt(payslip.employee_csg)}</td>
            <td className="r">{fmt(payslip.employer_csg)}</td>
          </tr>
          <tr className="payroll-row">
            <td>4100 / NSF</td>
            <td></td>
            <td className="r">{fmt(payslip.employee_nsf)}</td>
            <td className="r">{fmt(payslip.employer_nsf)}</td>
          </tr>
          <tr className="payroll-row">
            <td>4102 / PAYE</td>
            <td></td>
            <td className="r">{fmt(payslip.paye)}</td>
            <td></td>
          </tr>
          <tr className="payroll-row">
            <td>4103 / PRGF</td>
            <td></td>
            <td></td>
            <td className="r">{fmt(payslip.employer_prgf)}</td>
          </tr>
          <tr className="payroll-row">
            <td>4200 / LEVY</td>
            <td></td>
            <td></td>
            <td className="r">{fmt(payslip.employer_levy)}</td>
          </tr>
          {/* Totals */}
          <tr className="totals-row">
            <td></td>
            <td className="r">{fmt(gross)}</td>
            <td className="r">{fmt(totalDed)}</td>
            <td className="r">{fmt(totalEmp)}</td>
          </tr>
        </tbody>
      </table>

      {/* ── NET PAY ── */}
      <table style={{ marginTop: 4 }}>
        <tbody>
          <tr className="net-row">
            <td style={{ width: '50%' }}>NET PAY</td>
            <td>Rs {fmt(netPay)}</td>
          </tr>
        </tbody>
      </table>

      {/* ── FOOTER ── */}
      <table className="foot" style={{ marginTop: 4 }}>
        <tbody>
          <tr>
            <td>Payment Method: {payslip.payment_method || 'Bank Transfer'}</td>
            <td>{payrollProfile?.bank_account || ''}</td>
            <td>Leaves taken (period):</td>
            <td>{payslip.leaves_taken || 'NIL'}</td>
          </tr>
        </tbody>
      </table>

      {/* ── DISCLAIMER ── */}
      <div className="disclaimer">
        <p>This is a computer-generated document.</p>
        <p>In order to enforce your rights, this document must be kept for an unlimited period of time.</p>
      </div>
    </div>
  )

  return (
    <div>
      {showActions && (
        <div className="flex items-center justify-end gap-2 mb-3 print:hidden">
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="w-4 h-4 mr-1.5" /> Print / Download PDF
          </Button>
        </div>
      )}

      {/* On-screen preview styled like A5 */}
      <div
        ref={printRef}
        className="mx-auto bg-white text-black shadow-lg border border-border"
        style={{
          width: '210mm',
          minHeight: '148mm',
          padding: '8mm',
          fontFamily: 'Arial, Helvetica, sans-serif',
          fontSize: '9px',
          lineHeight: 1.3,
          color: '#000',
        }}
      >
        <style dangerouslySetInnerHTML={{ __html: `
          .slip .top-row { display: flex; justify-content: space-between; align-items: stretch; border: 1px solid #000; }
          .slip .company { flex: 1; padding: 6px 10px; text-align: center; border-right: 1px solid #000; }
          .slip .company h1 { font-size: 16px; font-weight: 900; margin-bottom: 4px; }
          .slip .company p { font-size: 8.5px; margin: 1px 0; }
          .slip .period { width: 200px; padding: 6px 10px; text-align: right; font-size: 8.5px; }
          .slip .period .title { font-weight: bold; font-size: 12px; text-align: center; margin-bottom: 3px; }
          .slip .period p { margin: 1px 0; }
          .slip .section-title { font-weight: bold; font-size: 11px; text-align: center; margin: 6px 0 3px; }
          .slip table { width: 100%; border-collapse: collapse; }
          .slip td, .slip th { border: 1px solid #000; padding: 2px 5px; font-size: 8.5px; vertical-align: middle; }
          .slip th { background: #d9d9d9; font-weight: bold; text-align: left; }
          .slip th.r, .slip td.r { text-align: right; }
          .slip td.c, .slip th.c { text-align: center; }
          .slip .emp td.lbl { font-weight: bold; text-align: center; width: 80px; }
          .slip .payroll-row td { height: 14px; }
          .slip .totals-row td { border-top: 2px solid #000; font-weight: bold; }
          .slip .net-row { background: #d9d9d9; }
          .slip .net-row td { font-weight: bold; text-align: center; padding: 4px 5px; font-size: 10px; }
          .slip .foot td { text-align: center; font-size: 8px; padding: 3px 5px; }
          .slip .disclaimer { text-align: center; font-size: 7.5px; color: #555; margin-top: 6px; }
          .slip .disclaimer p { margin: 2px 0; }
        `}} />
        {slipContent}
      </div>
    </div>
  )
}
