import 'server-only'
import { connectInboxDatabase } from '@/lib/messenger/pg'
import { AUTOPILOT_BUSINESSES } from './contract'
import { autopilotStore } from './runtime'

export async function autopilotStatus() {
  const [configs,jobs]=await Promise.all([autopilotStore.listConfigs(),autopilotStore.listRecentJobs(undefined,30)])
  const db=await connectInboxDatabase()
  let paused=new Set<string>()
  try {
    const rows=(await db.query("SELECT business_code,channel,owner_id,customer_id FROM public.inbox_autopilot_controls WHERE paused=true AND business_code IN ('MBM','DBM')")).rows
    paused=new Set(rows.map(r=>`${r.business_code}:${r.channel}:${r.owner_id}:${r.customer_id}`))
  } finally {await db.end().catch(()=>{})}
  return {
    businesses:configs.map(c=>({...c,state:!c.enabled?'paused':c.reason?'failed':'enabled'})),
    jobs:jobs.map(j=>{
      const owner=j.scope.channel==='messenger'?j.scope.pageId:j.scope.phoneNumberId
      const customerId=j.scope.channel==='messenger'?j.scope.psid:j.scope.waId
      return {id:j.id,businessKey:j.businessKey,conversationKey:j.conversationKey,customerName:j.customerName,
        state:j.state,reason:j.reason,updatedAt:j.updatedAt,channel:j.scope.channel,customerId,
        manualTakeover:paused.has(`${AUTOPILOT_BUSINESSES[j.businessKey].code}:${j.scope.channel}:${owner}:${customerId}`)}
    }),
    permissions:{canManage:true},
  }
}
