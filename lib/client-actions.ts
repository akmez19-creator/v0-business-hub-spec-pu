'use server'

import { createClient as createSupabaseClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Client } from '@/lib/types'

export async function getClients(filters?: {
  search?: string
  city?: string
  source?: string
}) {
  const supabase = await createSupabaseClient()
  
  let query = supabase
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false })
  
  if (filters?.search) {
    query = query.or(`name.ilike.%${filters.search}%,phone.ilike.%${filters.search}%,email.ilike.%${filters.search}%`)
  }
  
  if (filters?.city) {
    query = query.eq('city', filters.city)
  }
  
  if (filters?.source) {
    query = query.eq('source', filters.source)
  }
  
  const { data, error } = await query
  
  if (error) {
    console.error('Error fetching clients:', error)
    return []
  }
  
  return data as Client[]
}

export async function getClientById(id: string) {
  const supabase = await createSupabaseClient()
  
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .single()
  
  if (error) {
    console.error('Error fetching client:', error)
    return null
  }
  
  return data as Client
}

export async function createClient(clientData: {
  name: string
  phone?: string
  email?: string
  address?: string
  city?: string
  notes?: string
  source?: string
}) {
  const supabase = await createSupabaseClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }
  
  const { data, error } = await supabase
    .from('clients')
    .insert({
      ...clientData,
      created_by: user.id,
    })
    .select()
    .single()
  
  if (error) {
    console.error('Error creating client:', error)
    return { error: error.message }
  }
  
  revalidatePath('/dashboard/clients', 'max')
  return { data }
}

export async function updateClient(id: string, clientData: Partial<Client>) {
  const supabase = await createSupabaseClient()
  
  const { data, error } = await supabase
    .from('clients')
    .update({
      ...clientData,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()
  
  if (error) {
    console.error('Error updating client:', error)
    return { error: error.message }
  }
  
  revalidatePath('/dashboard/clients', 'max')
  return { data }
}

export async function deleteClient(id: string) {
  const supabase = await createSupabaseClient()
  
  const { error } = await supabase
    .from('clients')
    .delete()
    .eq('id', id)
  
  if (error) {
    console.error('Error deleting client:', error)
    return { error: error.message }
  }
  
  revalidatePath('/dashboard/clients', 'max')
  return { success: true }
}

export async function importClients(clients: Array<{
  name: string
  phone?: string
  email?: string
  address?: string
  city?: string
  notes?: string
}>) {
  const supabase = await createSupabaseClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Not authenticated' }
  }
  
  const clientsWithMeta = clients.map(client => ({
    ...client,
    source: 'import' as const,
    created_by: user.id,
  }))
  
  const { data, error } = await supabase
    .from('clients')
    .insert(clientsWithMeta)
    .select()
  
  if (error) {
    console.error('Error importing clients:', error)
    return { error: error.message, imported: 0 }
  }
  
  // Log the import
  await supabase.from('clients_import_log').insert({
    filename: 'bulk_import',
    total_rows: clients.length,
    successful_rows: data?.length || 0,
    failed_rows: clients.length - (data?.length || 0),
    status: 'completed',
    imported_by: user.id,
    completed_at: new Date().toISOString(),
  })
  
  revalidatePath('/dashboard/clients', 'max')
  return { data, imported: data?.length || 0 }
}

export async function getClientStats() {
  const supabase = await createSupabaseClient()
  
  const { count: totalClients } = await supabase
    .from('clients')
    .select('*', { count: 'exact', head: true })
  
  const { data: sourceStats } = await supabase
    .from('clients')
    .select('source')
  
  const sourceCounts = sourceStats?.reduce((acc, client) => {
    acc[client.source || 'manual'] = (acc[client.source || 'manual'] || 0) + 1
    return acc
  }, {} as Record<string, number>) || {}
  
  const { data: cityStats } = await supabase
    .from('clients')
    .select('city')
  
  const cityCounts = cityStats?.reduce((acc, client) => {
    if (client.city) {
      acc[client.city] = (acc[client.city] || 0) + 1
    }
    return acc
  }, {} as Record<string, number>) || {}
  
  return {
    totalClients: totalClients || 0,
    sourceCounts,
    cityCounts,
  }
}
