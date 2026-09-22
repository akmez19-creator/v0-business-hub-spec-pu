import 'server-only'
import { connectInboxDatabase } from '@/lib/messenger/pg'
import { AUTOPILOT_BUSINESSES } from './contract'
import { autopilotStore } from './runtime'

export async function autopilotStatus() {
  const [configs,jobs,staffQueue]=await Promise.all([autopilotStore.listConfigs(),autopilotStore.listRecentJobs(undefined,30),autopilotStore.listStaffTasks(25)])
  const db=await connectInboxDatabase()
  let paused=new Set<string>()
  // The agent must see who spoke last and what was said: a bare reason code beside a name told
  // them nothing (measured 14 Sep: four Messenger threads already closed by staff were shown
  // as "Needs staff review" with no message). Display only - never fed back into any decision.
  const latest=new Map<string,{direction:'in'|'out';text:string|null;at:string}>()
  try {
    const rows=(await db.query("SELECT business_code,channel,owner_id,customer_id FROM public.inbox_autopilot_controls WHERE paused=true AND business_code IN ('MBM','DBM')")).rows
    paused=new Set(rows.map(r=>`${r.business_code}:${r.channel}:${r.owner_id}:${r.customer_id}`))
    const messenger=jobs.flatMap(j=>j.scope.channel==='messenger'?[[j.scope.pageId,j.scope.psid] as const]:[])
    const whatsapp=jobs.flatMap(j=>j.scope.channel==='whatsapp'?[[j.scope.phoneNumberId,j.scope.waId] as const]:[])
    if(messenger.length){
      const r=await db.query(`SELECT k.page_id,k.psid,m.direction,left(m.body,240) AS text,m.created_at
        FROM unnest($1::text[],$2::text[]) AS k(page_id,psid)
        JOIN LATERAL (SELECT direction,body,created_at FROM public.messenger_messages x WHERE x.page_id=k.page_id AND x.psid=k.psid ORDER BY created_at DESC,mid DESC LIMIT 1) m ON true`,
        [messenger.map(k=>k[0]),messenger.map(k=>k[1])])
      for(const row of r.rows)latest.set(`messenger:${row.page_id}:${row.psid}`,{direction:row.direction==='in'?'in':'out',text:typeof row.text==='string'&&row.text.trim()?row.text:null,at:new Date(row.created_at).toISOString()})
    }
    if(whatsapp.length){
      const r=await db.query(`SELECT k.phone_number_id,k.wa_id,m.direction,left(m.body,240) AS text,m.created_at
        FROM unnest($1::text[],$2::text[]) AS k(phone_number_id,wa_id)
        JOIN LATERAL (SELECT direction,body,created_at FROM public.whatsapp_messages x WHERE x.phone_number_id=k.phone_number_id AND x.wa_id=k.wa_id ORDER BY created_at DESC,id DESC LIMIT 1) m ON true`,
        [whatsapp.map(k=>k[0]),whatsapp.map(k=>k[1])])
      for(const row of r.rows)latest.set(`whatsapp:${row.phone_number_id}:${row.wa_id}`,{direction:row.direction==='in'?'in':'out',text:typeof row.text==='string'&&row.text.trim()?row.text:null,at:new Date(row.created_at).toISOString()})
    }
  } finally {await db.end().catch(()=>{})}
  return {
    staffTasks:staffQueue.tasks,staffTasksHasMore:staffQueue.hasMore,
    businesses:configs.map(c=>({...c,state:!c.enabled?'paused':c.reason?'failed':'enabled'})),
    jobs:jobs.map(j=>{
      const owner=j.scope.channel==='messenger'?j.scope.pageId:j.scope.phoneNumberId
      const customerId=j.scope.channel==='messenger'?j.scope.psid:j.scope.waId
      return {id:j.id,businessKey:j.businessKey,conversationKey:j.conversationKey,customerName:j.customerName,
        state:j.state,reason:j.reason,updatedAt:j.updatedAt,channel:j.scope.channel,customerId,
        manualTakeover:paused.has(`${AUTOPILOT_BUSINESSES[j.businessKey].code}:${j.scope.channel}:${owner}:${customerId}`),
        latestMessage:latest.get(`${j.scope.channel}:${owner}:${customerId}`)??null}
    }),
    permissions:{canManage:true},
  }
}
