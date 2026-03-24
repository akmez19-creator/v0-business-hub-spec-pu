'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { UserRole } from './types'

async function checkAdminOrManagerAccess() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { error: 'Not authenticated', authorized: false }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Not authorized', authorized: false }
  }

  return { error: null, authorized: true }
}

async function checkAdminAccess() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { error: 'Not authenticated', isAdmin: false }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') {
    return { error: 'Not authorized', isAdmin: false }
  }

  return { error: null, isAdmin: true }
}

export async function updateUserProfile(userId: string, data: { name?: string; email?: string; phone?: string }) {
  const { error: authError, isAdmin } = await checkAdminAccess()
  if (!isAdmin) return { error: authError }

  const supabase = await createClient()
  
  // Update profile
  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      name: data.name,
      phone: data.phone,
      ...(data.email && { email: data.email }),
    })
    .eq('id', userId)

  if (profileError) {
    return { error: 'Failed to update profile: ' + profileError.message }
  }

  // If email changed, update auth email too
  if (data.email) {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const adminClient = createAdminClient()
    
    const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(userId, {
      email: data.email,
    })
    
    if (authUpdateError) {
      return { error: 'Failed to update auth email: ' + authUpdateError.message }
    }
  }

  revalidatePath('/dashboard/admin/users')
  return { success: true }
}

export async function resetUserPassword(userId: string, newPassword: string) {
  const { error: authError, isAdmin } = await checkAdminAccess()
  if (!isAdmin) return { error: authError }

  const { createAdminClient } = await import('@/lib/supabase/server')
  const adminClient = createAdminClient()

  // Update password in Supabase Auth
  const { error: authUpdateError } = await adminClient.auth.admin.updateUserById(userId, {
    password: newPassword,
  })

  if (authUpdateError) {
    return { error: 'Failed to update auth password: ' + authUpdateError.message }
  }

  // Store plain password in profile
  const { error: profileError } = await adminClient
    .from('profiles')
    .update({ password_plain: newPassword, updated_at: new Date().toISOString() })
    .eq('id', userId)

  if (profileError) {
    return { error: 'Password updated in auth but failed to store: ' + profileError.message }
  }

  revalidatePath('/dashboard/admin/users')
  revalidatePath('/dashboard/admin/team')
  return { success: true }
}

export async function createUser(data: {
  email: string
  password: string
  name: string
  role: UserRole
  phone?: string
  approved?: boolean
}) {
  const { error: authError, isAdmin } = await checkAdminAccess()
  if (!isAdmin) return { error: authError }

  const { createAdminClient } = await import('@/lib/supabase/server')
  const adminClient = createAdminClient()

  // Create user in Supabase Auth
  const { data: authData, error: signUpError } = await adminClient.auth.admin.createUser({
    email: data.email,
    password: data.password,
    email_confirm: true, // Skip email verification
    user_metadata: {
      name: data.name,
      role: data.role,
      phone: data.phone || null,
    },
  })

  if (signUpError) {
    return { error: 'Failed to create user: ' + signUpError.message }
  }

  if (!authData.user) {
    return { error: 'User was not created' }
  }

  // Update profile with additional data (profile is auto-created by trigger)
  const { error: profileError } = await adminClient
    .from('profiles')
    .update({
      name: data.name,
      role: data.role,
      phone: data.phone || null,
      approved: data.approved ?? true, // Admin-created users are approved by default
      password_plain: data.password,
      updated_at: new Date().toISOString(),
    })
    .eq('id', authData.user.id)

  if (profileError) {
    return { error: 'User created but profile update failed: ' + profileError.message }
  }

  revalidatePath('/dashboard/admin/users')
  revalidatePath('/dashboard/admin/team')
  return { success: true, userId: authData.user.id }
}

export async function approveUser(userId: string) {
  const { error: authError, isAdmin } = await checkAdminAccess()
  if (!isAdmin) return { error: authError }

  const supabase = await createClient()
  
  const { error } = await supabase
    .from('profiles')
    .update({ approved: true, updated_at: new Date().toISOString() })
    .eq('id', userId)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/dashboard/admin/users')
  return { success: true }
}

export async function revokeUser(userId: string) {
  const { error: authError, isAdmin } = await checkAdminAccess()
  if (!isAdmin) return { error: authError }

  const supabase = await createClient()
  
  const { error } = await supabase
    .from('profiles')
    .update({ approved: false, updated_at: new Date().toISOString() })
    .eq('id', userId)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/dashboard/admin/users')
  return { success: true }
}

export async function updateUserRole(userId: string, role: UserRole) {
  const { error: authError, isAdmin } = await checkAdminAccess()
  if (!isAdmin) return { error: authError }

  const supabase = await createClient()
  
  const { error } = await supabase
    .from('profiles')
    .update({ role, updated_at: new Date().toISOString() })
    .eq('id', userId)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/dashboard/admin/users')
  return { success: true }
}

export async function deleteUser(userId: string) {
  const { error: authError, isAdmin } = await checkAdminAccess()
  if (!isAdmin) return { error: authError }

  const supabase = await createClient()
  
  // Delete from profiles first
  const { error: profileError } = await supabase
    .from('profiles')
    .delete()
    .eq('id', userId)

  if (profileError) {
    return { error: profileError.message }
  }

  // Also delete from Supabase Auth to fully remove the user
  const { createAdminClient } = await import('@/lib/supabase/server')
  const adminClient = createAdminClient()
  
  const { error: authDeleteError } = await adminClient.auth.admin.deleteUser(userId)
  
  if (authDeleteError) {
    // Profile was deleted but auth user remains - log but don't fail
    console.error('Failed to delete auth user:', authDeleteError)
  }

  revalidatePath('/dashboard/admin/users')
  return { success: true }
}

export async function assignRiderToContractor(riderId: string, contractorId: string | null) {
  const { error: authError, isAdmin } = await checkAdminAccess()
  if (!isAdmin) return { error: authError }

  const supabase = await createClient()
  
  const { error } = await supabase
    .from('profiles')
    .update({ 
      contractor_id: contractorId,
      updated_at: new Date().toISOString()
    })
    .eq('id', riderId)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/dashboard/admin/users')
  revalidatePath('/dashboard/admin/team')
  return { success: true }
}

// Create a rider directly (virtual rider for delivery assignments)
// Uses the separate riders table - no auth account required
export async function createRider(name: string, phone?: string, contractorId?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) return { error: 'Not authenticated' }

  // Check if user is admin or manager
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Not authorized - only admins and managers can create riders' }
  }

  // Check for duplicate rider name under the same contractor
  if (contractorId) {
    const { data: existing } = await supabase
      .from('riders')
      .select('id')
      .eq('contractor_id', contractorId)
      .ilike('name', name.trim())
      .eq('is_active', true)
      .limit(1)
    if (existing && existing.length > 0) {
      return { error: `A rider named "${name.trim()}" already exists under this contractor` }
    }
  }

  // Insert into riders table (not profiles)
  const { data, error } = await supabase
    .from('riders')
    .insert({
      name: name.trim(),
      phone: phone || null,
      contractor_id: contractorId || null,
      is_active: true,
      created_by: user.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/dashboard/admin/team')
  revalidatePath('/dashboard/deliveries')
  return { success: true, riderId: data.id }
}

// Create multiple riders at once (for bulk import from Excel)
export async function createRidersBulk(riders: { name: string; phone?: string; contractorId?: string }[]) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) return { error: 'Not authenticated' }

  // Check if user is admin or manager
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Not authorized' }
  }

  // Filter out duplicates (riders that already exist under the same contractor)
  const filteredRiders: typeof riders = []
  for (const rider of riders) {
    if (rider.contractorId) {
      const { data: existing } = await supabase
        .from('riders')
        .select('id')
        .eq('contractor_id', rider.contractorId)
        .ilike('name', rider.name.trim())
        .eq('is_active', true)
        .limit(1)
      if (existing && existing.length > 0) continue
    }
    filteredRiders.push(rider)
  }

  if (filteredRiders.length === 0) {
    return { error: 'All riders already exist under their respective contractors' }
  }

  const riderRecords = filteredRiders.map(rider => ({
    name: rider.name.trim(),
    phone: rider.phone || null,
    contractor_id: rider.contractorId || null,
    is_active: true,
    created_by: user.id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }))
  
  const { error } = await supabase
    .from('riders')
    .insert(riderRecords)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/dashboard/admin/team')
  revalidatePath('/dashboard/deliveries')
  return { success: true, count: riders.length }
}

// Get all riders
export async function getRiders() {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('riders')
    .select('*')
    .order('name')

  if (error) {
    return { error: error.message, riders: [] }
  }

  return { riders: data || [] }
}

// Get all contractors
export async function getContractors() {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('contractors')
    .select('*')
    .eq('is_active', true)
    .order('name')

  if (error) {
    return { error: error.message, contractors: [] }
  }

  return { contractors: data || [] }
}

// Link a user profile (who signed up as rider) to an existing rider record
export async function linkUserToRider(userId: string, riderId: string) {
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

  // Update the rider record to link to this user profile
  const { error: riderError } = await supabase
    .from('riders')
    .update({ 
      profile_id: userId,
      updated_at: new Date().toISOString()
    })
    .eq('id', riderId)

  if (riderError) {
    return { error: riderError.message }
  }

  // Also update the user profile with the rider_id for reference
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ 
      rider_id: riderId,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId)

  if (profileError) {
    return { error: profileError.message }
  }

  revalidatePath('/dashboard/admin/users')
  revalidatePath('/dashboard/admin/team')
  revalidatePath('/dashboard/deliveries/riders')
  return { success: true }
}

// Link a user profile (who signed up as contractor) to an existing contractor record
export async function linkUserToContractor(userId: string, contractorId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['admin', 'manager'].includes(profile.role)) {
    return { error: 'Not authorized' }
  }

  // First verify the contractor exists
  const { data: contractor, error: contractorCheckError } = await supabase
    .from('contractors')
    .select('id')
    .eq('id', contractorId)
    .single()

  if (contractorCheckError || !contractor) {
    return { error: 'Contractor not found' }
  }

  // Update the contractor record to link to this user profile
  const { error: contractorError } = await supabase
    .from('contractors')
    .update({ 
      profile_id: userId,
      updated_at: new Date().toISOString()
    })
    .eq('id', contractorId)

  if (contractorError) {
    return { error: contractorError.message }
  }

  // Also update the user profile with the contractor_id for reference
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ 
      contractor_id: contractorId,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId)

  if (profileError) {
    // Rollback contractor update if profile update fails
    await supabase
      .from('contractors')
      .update({ profile_id: null, updated_at: new Date().toISOString() })
      .eq('id', contractorId)
    return { error: profileError.message }
  }

  revalidatePath('/dashboard/admin/users')
  revalidatePath('/dashboard/admin/team')
  revalidatePath('/dashboard/deliveries/contractors')
  return { success: true }
}

// Unlink a user from a contractor
export async function unlinkUserFromContractor(userId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) return { error: 'Not authenticated' }

  const { data: adminProfile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!adminProfile || !['admin', 'manager'].includes(adminProfile.role)) {
    return { error: 'Not authorized' }
  }

  // Get the user's contractor_id first
  const { data: userProfile } = await supabase
    .from('profiles')
    .select('contractor_id')
    .eq('id', userId)
    .single()

  if (userProfile?.contractor_id) {
    // Remove profile_id from contractor
    await supabase
      .from('contractors')
      .update({ profile_id: null, updated_at: new Date().toISOString() })
      .eq('id', userProfile.contractor_id)
  }

  // Remove contractor_id from profile
  const { error } = await supabase
    .from('profiles')
    .update({ contractor_id: null, updated_at: new Date().toISOString() })
    .eq('id', userId)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/admin/users')
  return { success: true }
}

// Unlink a user from a rider
export async function unlinkUserFromRider(userId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) return { error: 'Not authenticated' }

  const { data: adminProfile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!adminProfile || !['admin', 'manager'].includes(adminProfile.role)) {
    return { error: 'Not authorized' }
  }

  // Get the user's rider_id first
  const { data: userProfile } = await supabase
    .from('profiles')
    .select('rider_id')
    .eq('id', userId)
    .single()

  if (userProfile?.rider_id) {
    // Remove profile_id from rider
    await supabase
      .from('riders')
      .update({ profile_id: null, updated_at: new Date().toISOString() })
      .eq('id', userProfile.rider_id)
  }

  // Remove rider_id from profile
  const { error } = await supabase
    .from('profiles')
    .update({ rider_id: null, updated_at: new Date().toISOString() })
    .eq('id', userId)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/admin/users')
  return { success: true }
}

// Unlink a rider from user (by rider ID)
export async function unlinkRider(riderId: string) {
  const { error: authError, authorized } = await checkAdminOrManagerAccess()
  if (!authorized) return { error: authError }

  const supabase = await createClient()

  // Get the rider's profile_id first
  const { data: rider } = await supabase
    .from('riders')
    .select('profile_id')
    .eq('id', riderId)
    .single()

  if (rider?.profile_id) {
    // Remove rider_id from profile
    await supabase
      .from('profiles')
      .update({ rider_id: null, updated_at: new Date().toISOString() })
      .eq('id', rider.profile_id)
  }

  // Remove profile_id from rider
  const { error } = await supabase
    .from('riders')
    .update({ profile_id: null, updated_at: new Date().toISOString() })
    .eq('id', riderId)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/deliveries/riders')
  revalidatePath('/dashboard/admin/users')
  return { success: true }
}

// Unlink a contractor from user (by contractor ID)
export async function unlinkContractor(contractorId: string) {
  const { error: authError, authorized } = await checkAdminOrManagerAccess()
  if (!authorized) return { error: authError }

  const supabase = await createClient()

  // Get the contractor's profile_id first
  const { data: contractor } = await supabase
    .from('contractors')
    .select('profile_id')
    .eq('id', contractorId)
    .single()

  if (contractor?.profile_id) {
    // Remove contractor_id from profile
    await supabase
      .from('profiles')
      .update({ contractor_id: null, updated_at: new Date().toISOString() })
      .eq('id', contractor.profile_id)
  }

  // Remove profile_id from contractor
  const { error } = await supabase
    .from('contractors')
    .update({ profile_id: null, updated_at: new Date().toISOString() })
    .eq('id', contractorId)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/deliveries/contractors')
  revalidatePath('/dashboard/admin/users')
  return { success: true }
}

// Get unlinked riders (riders without a profile_id)
export async function getUnlinkedRiders() {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('riders')
    .select('id, name, phone')
    .is('profile_id', null)
    .eq('is_active', true)
    .order('name')

  if (error) {
    return { error: error.message, riders: [] }
  }

  return { riders: data || [] }
}

// Get unlinked contractors (contractors without a profile_id)
export async function getUnlinkedContractors() {
  const supabase = await createClient()
  
  const { data, error } = await supabase
    .from('contractors')
    .select('id, name, phone, email')
    .is('profile_id', null)
    .eq('is_active', true)
    .order('name')

  if (error) {
    return { error: error.message, contractors: [] }
  }

  return { contractors: data || [] }
}

// Update rider
export async function updateRider(riderId: string, data: {
  name: string
  phone: string | null
  contractor_id: string | null
}) {
  const { error: authError, authorized } = await checkAdminOrManagerAccess()
  if (!authorized) return { error: authError }

  const supabase = await createClient()
  
  const { error } = await supabase
    .from('riders')
    .update({
      name: data.name,
      phone: data.phone,
      contractor_id: data.contractor_id,
      updated_at: new Date().toISOString()
    })
    .eq('id', riderId)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/deliveries/riders')
  revalidatePath('/dashboard/admin/team')
  revalidatePath('/dashboard/deliveries/contractors')
  return { success: true }
}

// Delete rider
export async function deleteRider(riderId: string) {
  const { error: authError, authorized } = await checkAdminOrManagerAccess()
  if (!authorized) return { error: authError }

  const supabase = await createClient()
  
  // Soft delete by setting is_active to false
  const { error } = await supabase
    .from('riders')
    .update({
      is_active: false,
      updated_at: new Date().toISOString()
    })
    .eq('id', riderId)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/deliveries/riders')
  revalidatePath('/dashboard/admin/team')
  return { success: true }
}

// Update contractor
export async function updateContractor(contractorId: string, data: {
  name: string
  phone: string | null
  email: string | null
  has_partners?: boolean
}) {
  const { error: authError, authorized } = await checkAdminOrManagerAccess()
  if (!authorized) return { error: authError }

  const supabase = await createClient()
  
  const { error } = await supabase
    .from('contractors')
    .update({
      name: data.name,
      phone: data.phone,
      email: data.email,
      has_partners: data.has_partners ?? false,
      updated_at: new Date().toISOString()
    })
    .eq('id', contractorId)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/deliveries/contractors')
  revalidatePath('/dashboard/admin/team')
  return { success: true }
}

// Delete contractor
export async function deleteContractor(contractorId: string) {
  const { error: authError, authorized } = await checkAdminOrManagerAccess()
  if (!authorized) return { error: authError }

  const supabase = await createClient()
  
  // Check if contractor has any riders
  const { data: riders } = await supabase
    .from('riders')
    .select('id')
    .eq('contractor_id', contractorId)
    .eq('is_active', true)
    .limit(1)

  if (riders && riders.length > 0) {
    return { error: 'Cannot delete contractor with assigned riders. Please reassign or remove riders first.' }
  }

  // Soft delete by setting is_active to false
  const { error } = await supabase
    .from('contractors')
    .update({
      is_active: false,
      updated_at: new Date().toISOString()
    })
    .eq('id', contractorId)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/deliveries/contractors')
  revalidatePath('/dashboard/admin/team')
  return { success: true }
}

// Create new contractor
export async function createContractor(data: {
  name: string
  phone?: string | null
  email?: string | null
}) {
  const { error: authError, authorized } = await checkAdminOrManagerAccess()
  if (!authorized) return { error: authError }

  const supabase = await createClient()
  
  const { data: newContractor, error } = await supabase
    .from('contractors')
    .insert({
      name: data.name,
      phone: data.phone || null,
      email: data.email || null,
      is_active: true,
    })
    .select()
    .single()

  if (error) return { error: error.message }

  revalidatePath('/dashboard/deliveries/contractors')
  revalidatePath('/dashboard/admin/team')
  return { success: true, contractor: newContractor }
}

// Assign rider to contractor
export async function assignRiderToContractorNew(riderId: string, contractorId: string | null) {
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

  const { error } = await supabase
    .from('riders')
    .update({ 
      contractor_id: contractorId,
      updated_at: new Date().toISOString()
    })
    .eq('id', riderId)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/dashboard/admin/team')
  revalidatePath('/dashboard/deliveries')
  return { success: true }
}

// ── Update Rider NIC Data (from AI scan) ──
export async function updateRiderNicData(riderId: string, data: {
  surname?: string
  first_name?: string
  surname_at_birth?: string
  nic_number?: string
  gender?: string
  date_of_birth?: string
  photo_url?: string
  nic_photo_url?: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { createAdminClient } = await import('@/lib/supabase/server')
  const adminDb = createAdminClient()

  // Save NIC fields only -- do NOT overwrite rider nickname
  const updateData: Record<string, any> = {
    ...data,
    updated_at: new Date().toISOString(),
  }

  const { error } = await adminDb
    .from('riders')
    .update(updateData)
    .eq('id', riderId)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/dashboard/admin/team')
  revalidatePath('/dashboard/deliveries')
  revalidatePath('/dashboard/contractors')
  return { success: true }
}

// ── Update Contractor NIC Data (from AI scan) ──
export async function updateContractorNicData(contractorId: string, data: {
  surname?: string
  first_name?: string
  surname_at_birth?: string
  nic_number?: string
  gender?: string
  date_of_birth?: string
  photo_url?: string
  nic_photo_url?: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { createAdminClient } = await import('@/lib/supabase/server')
  const adminDb = createAdminClient()

  // Save NIC fields only -- do NOT overwrite contractor nickname
  const updateData: Record<string, any> = {
    ...data,
    updated_at: new Date().toISOString(),
  }

  const { error } = await adminDb
    .from('contractors')
    .update(updateData)
    .eq('id', contractorId)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/dashboard/admin/team')
  revalidatePath('/dashboard/contractors')
  return { success: true }
}

// ── Save Contractor Avatar URL ──
export async function saveContractorAvatar(contractorId: string, photoUrl: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { createAdminClient } = await import('@/lib/supabase/server')
  const adminDb = createAdminClient()

  const { error } = await adminDb
    .from('contractors')
    .update({ photo_url: photoUrl, updated_at: new Date().toISOString() })
    .eq('id', contractorId)

  if (error) return { error: error.message }

  revalidatePath('/dashboard/contractors')
  revalidatePath('/dashboard/contractors/settings')
  return { success: true }
}
