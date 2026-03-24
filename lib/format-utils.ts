// Currency formatting for Mauritian Rupee
export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return 'Rs 0'
  return `Rs ${amount.toLocaleString('en-MU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

// Phone formatting for Mauritius (+230 XXXX XXXX)
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return ''
  
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '')
  
  // If already has country code
  if (digits.startsWith('230')) {
    const local = digits.slice(3)
    if (local.length === 8) {
      return `+230 ${local.slice(0, 4)} ${local.slice(4)}`
    }
    return `+230 ${local}`
  }
  
  // If local number (8 digits)
  if (digits.length === 8) {
    return `+230 ${digits.slice(0, 4)} ${digits.slice(4)}`
  }
  
  // Return as-is if format doesn't match
  return phone
}

// Parse phone to store format (just digits with country code)
export function parsePhone(phone: string): string {
  if (!phone) return ''
  
  const digits = phone.replace(/\D/g, '')
  
  // Add country code if not present
  if (digits.length === 8) {
    return `230${digits}`
  }
  
  return digits
}

// Date formatting
export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return ''
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  })
}

// Status display helpers
export const statusLabels: Record<string, string> = {
  pending: 'Pending',
  assigned: 'Assigned',
  picked_up: 'Picked Up',
  delivered: 'Delivered',
  nwd: 'NWD', // No one Was there to Deliver
  cms: 'CMS', // Cancelled / Customer issue
}

export const statusColors: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  assigned: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  picked_up: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  delivered: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  nwd: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  cms: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
}

// Role display helpers
export const roleLabels: Record<string, string> = {
  admin: 'Admin',
  manager: 'Manager',
  marketing_agent: 'Marketing Agent',
  contractor: 'Contractor',
  rider: 'Rider',
  storekeeper: 'Storekeeper',
}

export const roleColors: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  manager: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  marketing_agent: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  contractor: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
  rider: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200',
  storekeeper: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
}

// Module access per role as per specification
export const moduleAccess: Record<string, string[]> = {
  admin: ['facebook-ads', 'product-master', 'settings', 'orders', 'admin', 'logistics', 'sales', 'clients'],
  manager: ['facebook-ads', 'product-master', 'orders', 'logistics', 'sales', 'clients'],
  marketing_agent: ['facebook-ads', 'product-master', 'sales', 'clients'],
  contractor: ['logistics', 'orders'],
  rider: ['logistics'],
  storekeeper: ['logistics', 'orders'],
}

export function hasModuleAccess(role: string, module: string): boolean {
  return moduleAccess[role]?.includes(module) ?? false
}

// Payment eligibility - riders only get paid for delivered status
export function isPaymentEligible(status: string): boolean {
  return status === 'delivered'
}
