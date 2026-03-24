'use client'

import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Printer } from 'lucide-react'

interface EmploymentLetterProps {
  contractor: any
  payrollProfile: any
  showActions?: boolean
}

function formatLetterDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${day} / ${month} / ${d.getFullYear()}`
}

function salaryInWords(amount: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

  if (amount === 0) return 'Zero'

  function convert(n: number): string {
    if (n < 20) return ones[n]
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '')
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convert(n % 100) : '')
    if (n < 100000) return convert(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convert(n % 1000) : '')
    if (n < 10000000) return convert(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '')
    return convert(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + convert(n % 10000000) : '')
  }

  return convert(amount)
}

function getStartYear(dateJoined: string): string {
  if (!dateJoined) return '2025'
  const d = new Date(dateJoined)
  return String(d.getFullYear())
}

export function EmploymentLetter({ contractor, payrollProfile, showActions = true }: EmploymentLetterProps) {
  const printRef = useRef<HTMLDivElement>(null)
  const salary = Number(contractor?.monthly_salary || 0)
  const name = contractor?.name || 'N/A'
  const nic = payrollProfile?.nic || 'N/A'
  const post = payrollProfile?.post || 'Delivery Rider'
  const dateJoined = payrollProfile?.date_joined || ''
  const startYear = getStartYear(dateJoined)

  function handlePrint() {
    const content = printRef.current
    if (!content) return
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Employment Letter - ${name}</title>
        <style>
          @page { size: A4 portrait; margin: 40mm 25mm 30mm 25mm; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.6; color: #000; }
          .letter { max-width: 700px; margin: 0 auto; padding: 0; }
          .title { text-align: center; font-size: 14pt; font-weight: bold; letter-spacing: 1px; margin-bottom: 24pt; }
          .date { margin-bottom: 16pt; }
          .greeting { margin-bottom: 16pt; }
          .body-para { margin-bottom: 12pt; text-align: justify; }
          .closing { margin-top: 12pt; margin-bottom: 48pt; }
          .sig-block { margin-top: 48pt; line-height: 1.4; }
          .sig-name { font-weight: bold; }
          .sig-images { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 40pt; }
          .sig-images img { height: 80px; }
          @media print {
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        ${content.innerHTML}
      </body>
      </html>
    `)
    win.document.close()
    setTimeout(() => { win.print() }, 300)
  }

  return (
    <div>
      {showActions && (
        <div className="flex justify-end gap-2 mb-4 print:hidden">
          <Button onClick={handlePrint} size="sm" variant="outline">
            <Printer className="w-4 h-4 mr-1.5" />
            Print / Save PDF
          </Button>
        </div>
      )}

      <div
        ref={printRef}
        className="bg-white text-black mx-auto"
        style={{
          width: '210mm',
          minHeight: '297mm',
          padding: '40mm 25mm 30mm 25mm',
          fontFamily: "'Times New Roman', Times, serif",
          fontSize: '12pt',
          lineHeight: '1.6',
        }}
      >
        <div className="letter">
          {/* Title */}
          <p style={{ textAlign: 'center', fontSize: '14pt', fontWeight: 'bold', letterSpacing: '1px', marginBottom: '24pt' }}>
            EMPLOYMENT CONFIRMATION LETTER
          </p>

          {/* Date */}
          <p style={{ marginBottom: '16pt' }}>
            Date: {formatLetterDate(new Date())}
          </p>

          {/* Greeting */}
          <p style={{ marginBottom: '16pt' }}>
            To Whom It May Concern,
          </p>

          {/* Body */}
          <p style={{ marginBottom: '12pt', textAlign: 'justify' as const }}>
            This letter is to confirm that Mr. {name}, holder of
            NIC No: {nic} is currently employed with A AKMEZ GROUP LTD as a {post}.
          </p>

          <p style={{ marginBottom: '12pt', textAlign: 'justify' as const }}>
            He has been working with our company since start of {startYear} and is employed on a full-time
            basis.
          </p>

          <p style={{ marginBottom: '12pt', textAlign: 'justify' as const }}>
            His monthly salary/remuneration is Rs {salary.toLocaleString()} ({salaryInWords(salary)} Mauritian Rupees) per month.
          </p>

          <p style={{ marginBottom: '12pt', textAlign: 'justify' as const }}>
            This letter is issued upon the employee's request for official purposes and may be used as proof
            of employment.
          </p>

          <p style={{ marginBottom: '12pt', textAlign: 'justify' as const }}>
            Should you require any additional information, please contact the undersigned.
          </p>

          {/* Closing */}
          <p style={{ marginTop: '12pt', marginBottom: '48pt' }}>
            Yours faithfully,
          </p>

          {/* Signature Block */}
          <div style={{ marginTop: '48pt', lineHeight: '1.4' }}>
            <p style={{ fontWeight: 'bold' }}>Mohammad Akmez Gunga</p>
            <p>Director</p>
            <p>A AKMEZ GROUP LTD</p>
            <p>BRN: C19167358</p>
            <p>Address: 44 Camp-Le-Juge Forest Side</p>
            <p>Tel: 5258 3671</p>
          </div>
        </div>
      </div>
    </div>
  )
}
