'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { calculatePayroll, type PayrollInput } from '@/lib/payroll-calc'

// ── Save/Update Payroll Profile ──
export async function savePayrollProfile(data: {
  contractorId: string
  employeeCode?: string
  nic?: string
  tan?: string
  post?: string
  department?: string
  dateJoined?: string
  taxCategory?: string
  numDependents?: number
  hasBedridden?: boolean
  bankAccount?: string
  transportAllowance?: number
  mealAllowance?: number
  otherAllowance?: number
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Not authorized' }
  }

  const adminDb = await createAdminClient()

  // Check if profile exists
  const { data: existing } = await adminDb
    .from('employee_payroll_profiles')
    .select('id')
    .eq('contractor_id', data.contractorId)
    .single()

  const profileData = {
    contractor_id: data.contractorId,
    employee_code: data.employeeCode || null,
    nic: data.nic || null,
    tan: data.tan || null,
    post: data.post || 'Officer',
    department: data.department || 'Delivery',
    date_joined: data.dateJoined || null,
    tax_category: data.taxCategory || 'A',
    num_dependents: data.numDependents || 0,
    has_bedridden_dependent: data.hasBedridden || false,
    bank_account: data.bankAccount || null,
    transport_allowance: data.transportAllowance || 0,
    meal_allowance: data.mealAllowance || 0,
    other_allowance: data.otherAllowance || 0,
    updated_at: new Date().toISOString(),
  }

  if (existing) {
    const { error } = await adminDb
      .from('employee_payroll_profiles')
      .update(profileData)
      .eq('id', existing.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await adminDb
      .from('employee_payroll_profiles')
      .insert(profileData)
    if (error) return { error: error.message }
  }

  revalidatePath('/dashboard/deliveries/payroll')
  return { success: true }
}

// ── Generate Payslip for a Contractor/Month ──
export async function generatePayslip(contractorId: string, month: string, overrides?: {
  overtime?: number
  absenceDeduction?: number
  advances?: number
  leaveTaken?: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Not authorized' }
  }

  const adminDb = await createAdminClient()

  // Get payroll profile
  const { data: payProfile } = await adminDb
    .from('employee_payroll_profiles')
    .select('*')
    .eq('contractor_id', contractorId)
    .single()

  if (!payProfile) return { error: 'No payroll profile found. Please set up employee details first.' }

  // Get contractor salary
  const { data: contractor } = await adminDb
    .from('contractors')
    .select('monthly_salary, name')
    .eq('id', contractorId)
    .single()

  if (!contractor) return { error: 'Contractor not found' }
  if (!contractor.monthly_salary || Number(contractor.monthly_salary) <= 0) {
    return { error: 'No fixed monthly salary set for this contractor.' }
  }

  const basicSalary = Number(contractor.monthly_salary)

  // Calculate payroll
  const payrollInput: PayrollInput = {
    basicSalary,
    transportAllowance: Number(payProfile.transport_allowance) || 0,
    overtime: overrides?.overtime || 0,
    mealAllowance: Number(payProfile.meal_allowance) || 0,
    otherAllowance: Number(payProfile.other_allowance) || 0,
    absenceDeduction: overrides?.absenceDeduction || 0,
    advances: overrides?.advances || 0,
    taxCategory: payProfile.tax_category || 'A',
    numDependents: payProfile.num_dependents || 0,
    hasBedridden: payProfile.has_bedridden_dependent || false,
  }

  const result = calculatePayroll(payrollInput)

  // Parse month to get period dates
  const monthParts = month.split('-')
  const monthNames: Record<string, number> = {
    'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
    'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11,
  }
  const monthIdx = monthNames[monthParts[0]] ?? 0
  const year = parseInt(monthParts[1]) || new Date().getFullYear()

  let startMonth = monthIdx - 1
  let startYear = year
  if (startMonth < 0) { startMonth = 11; startYear-- }

  const periodStart = `${startYear}-${String(startMonth + 1).padStart(2, '0')}-23`
  const periodEnd = `${year}-${String(monthIdx + 1).padStart(2, '0')}-22`

  const payslipData = {
    contractor_id: contractorId,
    payroll_profile_id: payProfile.id,
    month,
    period_start: periodStart,
    period_end: periodEnd,
    basic_salary: result.basicSalary,
    transport_allowance: result.transportAllowance,
    overtime: result.overtime,
    meal_allowance: result.mealAllowance,
    other_allowance: result.otherAllowance,
    gross_emoluments: result.grossEmoluments,
    absence_deduction: result.absenceDeduction,
    employee_csg: result.employeeCsg,
    employee_nsf: result.employeeNsf,
    paye: result.paye,
    total_employee_deductions: result.totalEmployeeDeductions,
    employer_csg: result.employerCsg,
    employer_nsf: result.employerNsf,
    employer_levy: result.employerLevy,
    employer_prgf: result.employerPrgf,
    total_employer_contributions: result.totalEmployerContributions,
    net_pay: result.netPay,
    advances: overrides?.advances || 0,
    leaves_taken: overrides?.leaveTaken || 'NIL',
    status: 'generated',
    generated_by: user.id,
    updated_at: new Date().toISOString(),
  }

  // Upsert (update if exists for that month)
  const { data: existing } = await adminDb
    .from('payslips')
    .select('id')
    .eq('contractor_id', contractorId)
    .eq('month', month)
    .single()

  if (existing) {
    const { error } = await adminDb
      .from('payslips')
      .update(payslipData)
      .eq('id', existing.id)
    if (error) return { error: error.message }
  } else {
    const { error } = await adminDb
      .from('payslips')
      .insert(payslipData)
    if (error) return { error: error.message }
  }

  revalidatePath('/dashboard/deliveries/payroll')
  revalidatePath('/dashboard/contractors/payslips')
  return { success: true }
}

// ── Contractor Self-Generate Payslip (once per month, then locked) ──
export async function contractorGenerateOwnPayslip(contractorId: string, month: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const adminDb = await createAdminClient()

  // Verify the user owns this contractor
  const { data: contractor } = await adminDb
    .from('contractors')
    .select('id, profile_id, monthly_salary, name')
    .eq('id', contractorId)
    .single()

  if (!contractor || contractor.profile_id !== user.id) {
    return { error: 'Not authorized to generate payslip for this profile' }
  }

  // Check if payslip already exists for this month
  const { data: existing } = await adminDb
    .from('payslips')
    .select('id')
    .eq('contractor_id', contractorId)
    .eq('month', month)
    .single()

  if (existing) {
    return { error: 'Payslip already exists for this month. It cannot be regenerated.' }
  }

  // Get payroll profile
  const { data: payProfile } = await adminDb
    .from('employee_payroll_profiles')
    .select('*')
    .eq('contractor_id', contractorId)
    .single()

  if (!payProfile) return { error: 'No payroll profile set up. Please contact admin.' }
  if (!contractor.monthly_salary || Number(contractor.monthly_salary) <= 0) {
    return { error: 'No fixed monthly salary set. Please contact admin.' }
  }

  const basicSalary = Number(contractor.monthly_salary)

  const payrollInput = {
    basicSalary,
    transportAllowance: Number(payProfile.transport_allowance) || 0,
    overtime: 0,
    mealAllowance: Number(payProfile.meal_allowance) || 0,
    otherAllowance: Number(payProfile.other_allowance) || 0,
    absenceDeduction: 0,
    advances: 0,
    taxCategory: payProfile.tax_category || 'A',
    numDependents: payProfile.num_dependents || 0,
    hasBedridden: payProfile.has_bedridden_dependent || false,
  }

  const result = calculatePayroll(payrollInput)

  const MONTHS_MAP: Record<string, number> = {
    'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
    'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11,
  }
  const parts = month.split('-')
  const mIdx = MONTHS_MAP[parts[0]] ?? 0
  const yr = parseInt(parts[1]) || new Date().getFullYear()
  let sM = mIdx - 1, sY = yr
  if (sM < 0) { sM = 11; sY-- }

  const { error: insertError } = await adminDb
    .from('payslips')
    .insert({
      contractor_id: contractorId,
      payroll_profile_id: payProfile.id,
      month,
      period_start: `${sY}-${String(sM + 1).padStart(2, '0')}-23`,
      period_end: `${yr}-${String(mIdx + 1).padStart(2, '0')}-22`,
      basic_salary: result.basicSalary,
      transport_allowance: result.transportAllowance,
      overtime: result.overtime,
      meal_allowance: result.mealAllowance,
      other_allowance: result.otherAllowance,
      gross_emoluments: result.grossEmoluments,
      absence_deduction: result.absenceDeduction,
      employee_csg: result.employeeCsg,
      employee_nsf: result.employeeNsf,
      paye: result.paye,
      total_employee_deductions: result.totalEmployeeDeductions,
      employer_csg: result.employerCsg,
      employer_nsf: result.employerNsf,
      employer_levy: result.employerLevy,
      employer_prgf: result.employerPrgf,
      total_employer_contributions: result.totalEmployerContributions,
      net_pay: result.netPay,
      advances: 0,
      leaves_taken: 'NIL',
      status: 'generated',
      generated_by: user.id,
    })

  if (insertError) return { error: insertError.message }

  revalidatePath('/dashboard/contractors/payslips')
  return { success: true }
}

// ── Request Employment Letter ──
export async function requestLetter(contractorId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const adminDb = await createAdminClient()

  // Verify the user owns this contractor
  const { data: contractor } = await adminDb
    .from('contractors')
    .select('id, profile_id')
    .eq('id', contractorId)
    .single()

  if (!contractor || contractor.profile_id !== user.id) {
    return { error: 'Not authorized' }
  }

  // Check for existing pending request
  const { data: existing } = await adminDb
    .from('letter_requests')
    .select('id, status')
    .eq('contractor_id', contractorId)
    .in('status', ['pending', 'approved'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (existing?.status === 'pending') {
    return { error: 'You already have a pending letter request.' }
  }

  const { error: insertError } = await adminDb
    .from('letter_requests')
    .insert({
      contractor_id: contractorId,
      letter_type: 'employment_confirmation',
      status: 'pending',
      requested_at: new Date().toISOString(),
    })

  if (insertError) return { error: insertError.message }

  revalidatePath('/dashboard/contractors/payslips')
  revalidatePath('/dashboard/deliveries/payroll')
  return { success: true }
}

// ── Approve/Reject Letter Request (Admin) ──
export async function reviewLetterRequest(requestId: string, action: 'approved' | 'rejected', note?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Not authorized' }
  }

  const adminDb = await createAdminClient()

  const { error } = await adminDb
    .from('letter_requests')
    .update({
      status: action,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
      admin_note: note || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/deliveries/payroll')
  revalidatePath('/dashboard/contractors/payslips')
  return { success: true }
}

// ── Bulk Generate Payslips for All Salaried Contractors ──
export async function bulkGeneratePayslips(month: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Not authorized' }
  }

  const adminDb = await createAdminClient()

  // Get all contractors with monthly salary and payroll profiles
  const { data: contractors } = await adminDb
    .from('contractors')
    .select('id, monthly_salary')
    .gt('monthly_salary', 0)
    .eq('is_active', true)

  if (!contractors?.length) return { error: 'No salaried contractors found' }

  const results: { contractorId: string; success: boolean; error?: string }[] = []

  for (const c of contractors) {
    const result = await generatePayslip(c.id, month)
    results.push({
      contractorId: c.id,
      success: !!result.success,
      error: result.error,
    })
  }

  revalidatePath('/dashboard/deliveries/payroll')
  return { success: true, results }
}
