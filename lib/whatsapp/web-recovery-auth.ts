import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { RecoveryError } from './web-recovery-contract'

/** Profile approval and admin role are rechecked in the database transaction. */
export async function requireRecoveryUser(request:Request, mode:'cookie'|'bearer'):Promise<string> {
  if(mode==='cookie') {
    const client=await createClient(); const {data,error}=await client.auth.getUser()
    if(error || !data.user) throw new RecoveryError(401,'AUTH_REQUIRED','Sign in to Akmez to continue.')
    return data.user.id
  }
  const authorization=request.headers.get('authorization')
  if(!authorization?.startsWith('Bearer ') || authorization.length>8192)
    throw new RecoveryError(401,'AUTH_REQUIRED','Sign in to the Akmez recovery extension to continue.')
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY
  if(!url || !key) throw new RecoveryError(503,'SERVICE_UNAVAILABLE','Recovery is temporarily unavailable.')
  const client=createSupabaseClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
  const {data,error}=await client.auth.getUser(authorization.slice(7))
  if(error || !data.user) throw new RecoveryError(401,'AUTH_REQUIRED','Sign in to the Akmez recovery extension to continue.')
  return data.user.id
}
