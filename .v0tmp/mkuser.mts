import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

const email = 'v0-verify-temp@example.com'
const password = 'V0Verify!' + Math.random().toString(36).slice(2, 10)

// Clean up any leftover from a previous run
const { data: list } = await admin.auth.admin.listUsers()
for (const u of list?.users ?? []) {
  if (u.email === email) await admin.auth.admin.deleteUser(u.id)
}

const { data, error } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
})
if (error) {
  console.log('[v0] create failed:', error.message)
  process.exit(1)
}
console.log('[v0] created', data.user?.id)
console.log('[v0] EMAIL=' + email)
console.log('[v0] PASSWORD=' + password)
