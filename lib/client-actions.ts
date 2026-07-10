'use server'

import { createClient as createSupabaseClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Client, ClientSortKey, ClientOrderHistoryItem } from '@/lib/types'

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

// Paginated + filtered listing that scales to 500k+ clients.
// All filtering happens in Postgres against indexed columns.
export async function getClientsPage(opts: {
  search?: string
  status?: string
  page?: number
  pageSize?: number
  sortBy?: ClientSortKey
  sortDir?: 'asc' | 'desc'
}) {
  const supabase = await createSupabaseClient()
  const page = Math.max(1, opts.page || 1)
  const pageSize = Math.min(100, Math.max(10, opts.pageSize || 50))
  const from = (page - 1) * pageSize

  const CLIENT_SORT_COLUMNS: Record<ClientSortKey, string> = {
    total_sales: 'total_sales',
    total_orders: 'total_orders',
    delivered_rate: 'delivered_rate',
  }
  const sortColumn = CLIENT_SORT_COLUMNS[opts.sortBy || 'total_sales'] || 'total_sales'
  const ascending = opts.sortDir === 'asc'

  let query = supabase
    .from('clients')
    .select('*', { count: 'exact' })
    .order(sortColumn, { ascending })
    .order('created_at', { ascending: false })
    .range(from, from + pageSize - 1)

  if (opts.search) {
    const s = opts.search.trim()
    query = query.or(`name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%`)
  }
  if (opts.status && opts.status !== 'all') {
    query = query.eq('client_status', opts.status)
  }

  const { data, count, error } = await query
  if (error) {
    console.error('Error fetching clients page:', error)
    return { clients: [] as Client[], total: 0 }
  }
  return { clients: (data || []) as Client[], total: count || 0 }
}

export async function getClientDetail(clientId: string) {
  const supabase = await createSupabaseClient()

  const { data: client, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .maybeSingle()

  if (error || !client) {
    return { client: null as Client | null, orders: [] as ClientOrderHistoryItem[] }
  }

  let orders: ClientOrderHistoryItem[] = []
  if (client.phone) {
    // Live delivery history matched by normalized phone (imported history is
    // aggregate-only and has no per-order rows, so this covers app orders).
    const { data: hist } = await supabase.rpc('get_client_order_history', {
      p_phone: client.phone,
      p_limit: 200,
    })
    orders = (hist || []) as ClientOrderHistoryItem[]
  }

  return { client: client as Client, orders }
}

export async function getClientStats() {
  const supabase = await createSupabaseClient()

  // Head-only count queries stay fast at 500k+ rows (indexed client_status)
  const [totalRes, goodRes, avgRes, badRes] = await Promise.all([
    supabase.from('clients').select('*', { count: 'exact', head: true }),
    supabase.from('clients').select('*', { count: 'exact', head: true }).eq('client_status', 'good'),
    supabase.from('clients').select('*', { count: 'exact', head: true }).eq('client_status', 'average'),
    supabase.from('clients').select('*', { count: 'exact', head: true }).eq('client_status', 'bad'),
  ])

  return {
    total: totalRes.count || 0,
    good: goodRes.count || 0,
    average: avgRes.count || 0,
    bad: badRes.count || 0,
  }
}
