import { createBrowserClient } from '@supabase/ssr'
import { fetchWithSignInTimeout } from './sign-in'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: fetchWithSignInTimeout } },
  )
}
