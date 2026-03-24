import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

const userIds = [
  'fae5aa1f-ed7e-44ba-b259-a0819a25f0fe',
  '21d1fa72-1413-49f6-8c40-e6d5a5d2c3f9',
  'bad3dc87-afef-493c-be88-c027e81f623d',
  'd7bdd7b3-09c8-4979-aa63-30acc438c6ff',
  'c3fff15d-48ff-46c0-b102-bb91e0709abd',
  '452b87cd-8f76-4f16-8f35-492f0a46d68a',
  '72a46d72-9406-4ae8-9c52-c6dde303239e',
]

for (const id of userIds) {
  const { error } = await adminClient.auth.admin.updateUserById(id, {
    password: '123456',
  })
  if (error) {
    console.log(`[FAIL] ${id}: ${error.message}`)
  } else {
    console.log(`[OK] ${id}: password reset to 123456`)
  }
}
console.log('Done!')
