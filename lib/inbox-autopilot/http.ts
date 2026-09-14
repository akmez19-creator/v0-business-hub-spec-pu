import 'server-only'
import { timingSafeEqual, createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { AutopilotError } from './contract'

export async function requireAutopilotAdmin(request?:Request) {
  if (request && request.method!=='GET') {
    const origin=request.headers.get('origin')
    const expected=new URL(request.url).origin
    if (!origin || origin!==expected) throw new AutopilotError('same_origin_required',403)
  }
  const client=await createClient()
  const {data:{user},error}=await client.auth.getUser()
  if (error || !user) throw new AutopilotError('authentication_required',401)
  const {data:profile,error:roleError}=await client.from('profiles').select('role,approved').eq('id',user.id).single()
  if (roleError || profile?.role!=='admin' || profile?.approved!==true) throw new AutopilotError('admin_required',403)
  return user.id
}
export async function smallJson(request:Request):Promise<Record<string,unknown>> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new AutopilotError('json_required',415)
  const raw=await request.text()
  if (raw.length>4096) throw new AutopilotError('request_too_large',413)
  try { const value=JSON.parse(raw); if (!value || Array.isArray(value) || typeof value!=='object') throw new Error(); return value }
  catch { throw new AutopilotError('invalid_request') }
}
export function cronAuthorized(request:Request) {
  const secret=process.env.CRON_SECRET
  const authorization=request.headers.get('authorization')
  if (!secret || !authorization || authorization.length>4096) return false
  const hash=(s:string)=>createHash('sha256').update(s).digest()
  return timingSafeEqual(hash(authorization),hash(`Bearer ${secret}`))
}
export function apiError(error:unknown) {
  const known=error instanceof AutopilotError
  return NextResponse.json({success:false,error:known?error.code:'autopilot_unavailable'},
    {status:known?error.status:503,headers:{'Cache-Control':'no-store'}})
}
export function apiOk(value:Record<string,unknown>) {
  return NextResponse.json({success:true,...value},{headers:{'Cache-Control':'no-store'}})
}
