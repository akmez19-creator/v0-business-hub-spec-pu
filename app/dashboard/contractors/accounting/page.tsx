import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { ContractorMobileLayout } from '@/components/contractor/mobile-layout'
import { AccountingContent } from '@/components/contractor/contractor-accounting'

export default async function ContractorAccountingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) redirect('/auth/sign-in')

  const adminDb = createAdminClient()
  
  const { data: profile } = await adminDb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/auth/sign-in')

  const { data: contractor } = await adminDb
    .from('contractors')
    .select('*')
    .eq('profile_id', user.id)
    .single()

  if (!contractor) redirect('/dashboard')

  const { data: payrollProfile } = await adminDb
    .from('contractor_payroll_profiles')
    .select('*')
    .eq('contractor_id', contractor.id)
    .single()

  const { data: pastPayslips } = await adminDb
    .from('contractor_payslips')
    .select('*')
    .eq('contractor_id', contractor.id)
    .order('year', { ascending: false })
    .order('month', { ascending: false })

  const { data: letterRequests } = await adminDb
    .from('letter_requests')
    .select('*')
    .eq('contractor_id', contractor.id)
    .order('created_at', { ascending: false })

  const { data: riders } = await adminDb
    .from('riders')
    .select(`
      id, 
      name,
      rider_payment_settings (
        payment_type,
        daily_rate
      )
    `)
    .eq('contractor_id', contractor.id)

  const { data: companySettings } = await adminDb
    .from('company_settings')
    .select('*')
    .limit(1)
    .single()

  const ridersWithPaymentSettings = (riders || []).map(r => ({
    id: r.id,
    name: r.name,
    rider_payment_settings: r.rider_payment_settings?.[0] ? {
      payment_type: r.rider_payment_settings[0].payment_type || 'per_delivery',
      daily_rate: r.rider_payment_settings[0].daily_rate || 0
    } : undefined
  }))

  return (
    <ContractorMobileLayout
      profile={profile}
      contractor={contractor}
    >
      <AccountingContent
        contractorId={contractor.id}
        payrollProfile={payrollProfile}
        contractor={{
          id: contractor.id,
          name: contractor.name,
          monthly_salary: contractor.monthly_salary || 0
        }}
        riders={ridersWithPaymentSettings}
        companySettings={companySettings ? {
          company_name: companySettings.company_name || '',
          company_address: companySettings.company_address || '',
          brn: companySettings.brn || '',
          logo_url: companySettings.logo_url,
          stamp_url: companySettings.stamp_url,
        } : null}
        pastPayslips={pastPayslips || []}
        letterRequests={letterRequests || []}
      />
    </ContractorMobileLayout>
  )
}
