import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ContractorMobileLayout } from '@/components/contractor/mobile-layout'
import { PartnerContent } from '@/components/contractor/partner-content'

export default async function PartnerDeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<{ sheet?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/dashboard')

  // Get contractor
  let contractor = null
  const { data: contractorByProfile } = await supabase
    .from('contractors')
    .select('*')
    .eq('profile_id', user.id)
    .single()

  if (contractorByProfile) {
    contractor = contractorByProfile
  } else if (profile?.contractor_id) {
    const { data: contractorById } = await supabase
      .from('contractors')
      .select('*')
      .eq('id', profile.contractor_id)
      .single()
    contractor = contractorById
  }

  if (!contractor) redirect('/dashboard')

  // Guard: only allow if contractor has partner access
  if (!contractor.has_partners) redirect('/dashboard/contractors')

  // Get riders
  const { data: allRiders } = await supabase
    .from('riders')
    .select('id, name, is_active')
    .eq('contractor_id', contractor.id)
    .order('name')

  const riders = allRiders || []

  const contractorAsRider = riders.find(r =>
    r.name?.toLowerCase() === contractor.name?.toLowerCase()
  ) || null

  // Get partner sheets for this contractor
  const { data: partnerSheets } = await supabase
    .from('partner_sheets')
    .select('*')
    .eq('contractor_id', contractor.id)
    .order('created_at', { ascending: false })

  const sheets = partnerSheets || []
  const activeSheet = params.sheet
    ? sheets.find(s => s.id === params.sheet) || sheets[0]
    : sheets[0]

  // Get ALL deliveries for this sheet (no date filter - fresh daily upload)
  let deliveries: Record<string, unknown>[] = []

  if (activeSheet) {
    const { data } = await supabase
      .from('partner_deliveries')
      .select('*, riders(name)')
      .eq('sheet_id', activeSheet.id)
      .order('sheet_row_number', { ascending: true })

    deliveries = data || []
  }

  // Get localities from master table for mapping UI
  const { data: localityRows } = await supabase
    .from('localities')
    .select('name')
    .eq('is_active', true)
    .order('name')
  const canonicalRegions = (localityRows || []).map(r => r.name)

  // Get unmapped addresses (addresses with no locality set)
  const unmappedAddresses = [...new Set(
    (deliveries as any[])
      .filter(d => d.address && !d.locality)
      .map(d => (d.address as string).trim())
  )].sort()

  return (
    <ContractorMobileLayout
      profile={profile}
      companyName={contractor.name}
      photoUrl={contractor.photo_url}
      totalEarnings={0}
      riderCount={riders.length}
      isAlsoRider={!!contractorAsRider}
      hasPartners={contractor.has_partners ?? false}
    >
      <PartnerContent
        contractorId={contractor.id}
        sheets={sheets}
        activeSheet={activeSheet || null}
        deliveries={deliveries as any[]}
        riders={riders.map(r => ({ id: r.id, name: r.name }))}
        canonicalRegions={canonicalRegions}
        unmappedAddresses={unmappedAddresses}
      />
    </ContractorMobileLayout>
  )
}
