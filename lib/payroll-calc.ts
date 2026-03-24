// Mauritius Payroll Calculator - MRA Statutory Deductions
// Based on MRA tax tables and statutory rates

export interface PayrollInput {
  basicSalary: number
  transportAllowance?: number
  overtime?: number
  mealAllowance?: number
  otherAllowance?: number
  absenceDeduction?: number
  advances?: number
  taxCategory?: string // A, B, C, D, E, F, G, H
  numDependents?: number
  hasBedridden?: boolean
}

export interface PayrollResult {
  // Revenues
  basicSalary: number
  transportAllowance: number
  overtime: number
  mealAllowance: number
  otherAllowance: number
  grossEmoluments: number

  // Employee deductions
  absenceDeduction: number
  employeeCsg: number
  employeeNsf: number
  paye: number
  totalEmployeeDeductions: number

  // Employer contributions
  employerCsg: number
  employerNsf: number
  employerLevy: number
  employerPrgf: number
  totalEmployerContributions: number

  // Net
  netPay: number
  advances: number
}

// MRA PAYE annual thresholds (2024/2025 onwards)
// Category A: Single person
// Category B: Married, spouse has no income
// Category C: Widowed or divorced with dependent child
// etc.
// Annual income exempt thresholds by category
function getAnnualExemptThreshold(category: string, numDependents: number, hasBedridden: boolean): number {
  // Base thresholds (annual) - updated per MRA
  const baseThresholds: Record<string, number> = {
    'A': 390000,  // Single
    'B': 500000,  // Married (spouse no income)
    'C': 440000,  // Widowed/Divorced with dependent
    'D': 550000,  // Married both earning
    'E': 500000,  // Married, spouse retired
    'F': 550000,  // Retired
    'G': 390000,  // Single parent
    'H': 500000,  // Other
  }

  let threshold = baseThresholds[category] || baseThresholds['A']

  // Additional for dependents (Rs 50,000 per dependent up to 3)
  const depRelief = Math.min(numDependents, 3) * 50000
  threshold += depRelief

  // Additional Rs 150,000 for bedridden next of kin
  if (hasBedridden) {
    threshold += 150000
  }

  return threshold
}

// Calculate PAYE on monthly basis
// Mauritius progressive rates:
// First Rs 500,000 annual (exempt based on category) = 0%
// Next annual band: 10% up to certain amount
// Then 20% on remainder
function calculateMonthlyPAYE(
  annualGross: number,
  category: string,
  numDependents: number,
  hasBedridden: boolean
): number {
  const exemptThreshold = getAnnualExemptThreshold(category, numDependents, hasBedridden)
  const taxable = Math.max(0, annualGross - exemptThreshold)

  if (taxable <= 0) return 0

  let tax = 0
  // 10% on the first Rs 500,000 of taxable income
  const firstBand = Math.min(taxable, 500000)
  tax += firstBand * 0.10

  // 20% on the remainder
  if (taxable > 500000) {
    tax += (taxable - 500000) * 0.20
  }

  // Return monthly PAYE (annual / 12)
  return Math.round(tax / 12)
}

export function calculatePayroll(input: PayrollInput): PayrollResult {
  const basicSalary = input.basicSalary || 0
  const transportAllowance = input.transportAllowance || 0
  const overtime = input.overtime || 0
  const mealAllowance = input.mealAllowance || 0
  const otherAllowance = input.otherAllowance || 0
  const absenceDeduction = input.absenceDeduction || 0
  const advances = input.advances || 0
  const category = input.taxCategory || 'A'
  const numDependents = input.numDependents || 0
  const hasBedridden = input.hasBedridden || false

  // Gross emoluments
  const grossEmoluments = basicSalary + transportAllowance + overtime + mealAllowance + otherAllowance

  // Employee statutory deductions (on gross)
  const employeeCsg = Math.round(grossEmoluments * 0.015 * 100) / 100  // 1.5%
  const employeeNsf = Math.round(grossEmoluments * 0.0055 * 100) / 100  // 0.55%

  // PAYE - calculated based on annualized gross
  const annualGross = grossEmoluments * 12
  const paye = calculateMonthlyPAYE(annualGross, category, numDependents, hasBedridden)

  const totalEmployeeDeductions = Math.round((absenceDeduction + employeeCsg + employeeNsf + paye) * 100) / 100

  // Employer contributions (on gross)
  const employerCsg = Math.round(grossEmoluments * 0.03 * 100) / 100    // 3%
  const employerNsf = Math.round(grossEmoluments * 0.025 * 100) / 100   // 2.5%
  const employerLevy = Math.round(grossEmoluments * 0.01 * 100) / 100   // 1%
  const employerPrgf = Math.round(grossEmoluments * 0.045 * 100) / 100  // 4.5%
  const totalEmployerContributions = Math.round((employerCsg + employerNsf + employerLevy + employerPrgf) * 100) / 100

  // Net pay
  const netPay = Math.round((grossEmoluments - totalEmployeeDeductions - advances) * 100) / 100

  return {
    basicSalary,
    transportAllowance,
    overtime,
    mealAllowance,
    otherAllowance,
    grossEmoluments,
    absenceDeduction,
    employeeCsg,
    employeeNsf,
    paye,
    totalEmployeeDeductions,
    employerCsg,
    employerNsf,
    employerLevy,
    employerPrgf,
    totalEmployerContributions,
    netPay,
    advances,
  }
}

// Get period start/end for a month string like "JAN-2026"
export function getPayPeriod(monthStr: string, dateJoined?: string): { start: Date; end: Date; label: string } {
  const parts = monthStr.split('-')
  const monthNames: Record<string, number> = {
    'JAN': 0, 'FEB': 1, 'MAR': 2, 'APR': 3, 'MAY': 4, 'JUN': 5,
    'JUL': 6, 'AUG': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DEC': 11,
  }
  const monthIdx = monthNames[parts[0]] ?? 0
  const year = parseInt(parts[1]) || new Date().getFullYear()

  // Period: 23rd of previous month to 22nd of current month
  let startMonth = monthIdx - 1
  let startYear = year
  if (startMonth < 0) { startMonth = 11; startYear-- }

  const start = new Date(startYear, startMonth, 23)
  const end = new Date(year, monthIdx, 22)

  return {
    start,
    end,
    label: `${start.getDate()}-${start.toLocaleString('en', { month: 'short' }).toUpperCase()}-${startYear} to ${end.getDate()}-${end.toLocaleString('en', { month: 'short' }).toUpperCase()}-${year}`
  }
}

// Generate list of months from startDate to now
export function getMonthRange(startDate: string): string[] {
  const months: string[] = []
  const now = new Date()
  const start = new Date(startDate)
  
  // Start from the month after joining
  let current = new Date(start.getFullYear(), start.getMonth() + 1, 1)
  
  while (current <= now) {
    const monthName = current.toLocaleString('en', { month: 'short' }).toUpperCase()
    const year = current.getFullYear()
    months.push(`${monthName}-${year}`)
    current = new Date(current.getFullYear(), current.getMonth() + 1, 1)
  }

  return months
}
