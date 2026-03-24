import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ContractorMobileLayout } from '@/components/contractor/mobile-layout'
import { ContractorSettingsContent } from '@/components/contractor/settings-content'

export default async function ContractorSettingsPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*, contractor_id')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/dashboard')

  let contractor = null
  const { data: contractorByProfile } = await supabase
    .from('contractors')
    .select('*')
    .eq('profile_id', user.id)
    .single()

  if (contractorByProfile) {
    contractor = contractorByProfile
  } else if (profile.contractor_id) {
    const { data: contractorById } = await supabase
      .from('contractors')
      .select('*')
      .eq('id', profile.contractor_id)
      .single()
    contractor = contractorById
  }

  if (!contractor) redirect('/dashboard/contractors')

  // Get global warehouse location from company_settings (set by admin)
  const { data: companySettings } = await supabase
    .from('company_settings')
    .select('warehouse_name, warehouse_lat, warehouse_lng')
    .limit(1)
    .single()

  // Merge admin warehouse into contractor data so settings page shows the correct location
  if (companySettings) {
    contractor.warehouse_name = companySettings.warehouse_name || contractor.warehouse_name
    contractor.warehouse_lat = companySettings.warehouse_lat || contractor.warehouse_lat
    contractor.warehouse_lng = companySettings.warehouse_lng || contractor.warehouse_lng
  }

  const { data: allRiders } = await supabase
    .from('riders')
    .select('id, name, is_active')
    .eq('contractor_id', contractor.id)

  const contractorAsRider = allRiders?.find(r =>
    r.name?.toLowerCase() === contractor.name?.toLowerCase()
  ) || null

  return (
    <ContractorMobileLayout
      profile={profile}
      companyName={contractor?.name}
      photoUrl={contractor?.photo_url}
      totalEarnings={0}
      riderCount={allRiders?.length || 0}
      isAlsoRider={!!contractorAsRider}
      hasPartners={contractor?.has_partners ?? false}
    >
      <ContractorSettingsContent
        profile={profile}
        contractor={contractor}
      />
    </ContractorMobileLayout>
  )
}
