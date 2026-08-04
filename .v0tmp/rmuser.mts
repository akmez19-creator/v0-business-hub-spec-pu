import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

const email = 'v0-verify-temp@example.com'
const { data: list } = await admin.auth.admin.listUsers()
let removed = 0
for (const u of list?.users ?? []) {
  if (u.email === email) {
    await admin.auth.admin.deleteUser(u.id)
    removed++
  }
}
console.log('[v0] deleted auth users:', removed)

const { data: leftover } = await admin.from('profiles').select('id').eq('email', email)
console.log('[v0] leftover profiles:', leftover?.length ?? 0)
