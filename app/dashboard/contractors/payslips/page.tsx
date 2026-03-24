import { redirect } from 'next/navigation'

// Payslips has been renamed to Accounting
export default function ContractorPayslipsPage() {
  redirect('/dashboard/contractors/accounting')
}
