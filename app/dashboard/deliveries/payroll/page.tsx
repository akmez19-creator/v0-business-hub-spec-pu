import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { PayrollOverview } from '@/components/deliveries/payroll-overview'

export default async function PayrollPage() {
  const supabase = await createClient()
  const adminDb = createAdminClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await adminDb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    redirect('/dashboard')
  }

  // Get all contractors with fixed monthly salary
  const { data: contractors } = await adminDb
    .from('contractors')
    .select('id, name, phone, email, monthly_salary, is_active')
    .order('name')

  // Get payroll profiles
  const { data: payrollProfiles } = await adminDb
    .from('employee_payroll_profiles')
    .select('*')

  // Get all payslips
  const { data: payslips } = await adminDb
    .from('payslips')
    .select('*')
    .order('created_at', { ascending: false })

  // Get pending letter requests
  const { data: letterReqs } = await adminDb
    .from('letter_requests')
    .select('*, contractors(name, email)')
    .order('created_at', { ascending: false })

  // Build maps
  const profileMap: Record<string, any> = {}
  for (const pp of payrollProfiles || []) {
    profileMap[pp.contractor_id] = pp
  }

  const payslipMap: Record<string, any[]> = {}
  for (const ps of payslips || []) {
    if (!payslipMap[ps.contractor_id]) payslipMap[ps.contractor_id] = []
    payslipMap[ps.contractor_id].push(ps)
  }

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <PayrollOverview
        contractors={contractors || []}
        payrollProfiles={profileMap}
        payslips={payslipMap}
        letterRequests={letterReqs || []}
      />
    </div>
  )
}
