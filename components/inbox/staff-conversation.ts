import { AUTOPILOT_OWNER_IDS, type AutopilotStaffTask } from './autopilot-client'
import type { UnifiedThread } from '@/lib/inbox/unified'

export const STAFF_CONVERSATION_EVENT='akmez:open-staff-conversation'
export type StaffConversationIdentity=Pick<AutopilotStaffTask,'businessKey'|'channel'|'ownerId'|'customerId'|'conversationKey'|'customerName'>
export function staffConversationIdentity(value:unknown):StaffConversationIdentity|null{
  if(!value||typeof value!=='object'||Array.isArray(value))return null
  const v=value as Record<string,unknown>
  if(v.businessKey!=='made_by_moris'&&v.businessKey!=='destockage'||v.channel!=='messenger'&&v.channel!=='whatsapp'||
    typeof v.customerId!=='string'||!/^\d{5,30}$/.test(v.customerId)||v.ownerId!==AUTOPILOT_OWNER_IDS[v.businessKey][v.channel]||
    v.conversationKey!==`${v.channel}:${v.ownerId}:${v.customerId}`||!(v.customerName===null||typeof v.customerName==='string'&&v.customerName.length<=200))return null
  return{businessKey:v.businessKey,channel:v.channel,ownerId:v.ownerId as string,customerId:v.customerId,conversationKey:v.conversationKey,customerName:v.customerName}
}
/** Unloaded conversations can be read by exact scope. Sending stays unavailable
 * until the regular server list supplies current permissions/window metadata. */
export function staffConversationThread(identity:StaffConversationIdentity,loaded:UnifiedThread[]):UnifiedThread{
  const key=identity.conversationKey,existing=loaded.find(t=>t.key===key&&t.channel===identity.channel&&t.recipientId===identity.customerId&&
    (t.channel==='messenger'?t.pageId===identity.ownerId:t.phoneNumberId===identity.ownerId))
  if(existing)return existing
  return{key,channel:identity.channel,nativeId:identity.customerId,name:identity.customerName||'Customer conversation',snippet:'Opened from staff review',updatedAt:null,
    unreadCount:0,outsideWindow:true,canSend:false,source:identity.businessKey==='made_by_moris'?'Made By Moris':'Destockage',
    pageId:AUTOPILOT_OWNER_IDS[identity.businessKey].messenger,phoneNumberId:identity.channel==='whatsapp'?identity.ownerId:null,recipientId:identity.customerId,
    adId:null,adName:null,product:null,productId:null,productCategory:null,productSource:null,campaignId:null,campaignName:null,campaignActive:false,stage:'dormant',messageCount:0}
}
export function openStaffConversation(task:AutopilotStaffTask):void{
  const identity=staffConversationIdentity(task)
  if(identity&&typeof window!=='undefined')window.dispatchEvent(new CustomEvent(STAFF_CONVERSATION_EVENT,{detail:identity}))
}
