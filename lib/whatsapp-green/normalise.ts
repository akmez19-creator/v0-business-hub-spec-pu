import { createHash } from 'node:crypto'
import { customerFromChat, greenFail, type GreenBinding, type GreenEvent, type GreenOrigin, type NormalizedObservation } from './contract'
const obj=(v:unknown):Record<string,any>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{}
const own=(v:Record<string,any>,key:string)=>Object.prototype.hasOwnProperty.call(v,key)
export function stableGreenJson(value:unknown):string {
  if(value===null||typeof value!=='object')return JSON.stringify(value)??'null'
  if(Array.isArray(value))return '['+value.map(stableGreenJson).join(',')+']'
  return '{'+Object.keys(value as object).sort().map(k=>JSON.stringify(k)+':'+stableGreenJson((value as any)[k])).join(',')+'}'
}
export const greenHash=(value:string)=>createHash('sha256').update(value).digest('hex')
const text=(v:unknown,max:number)=>typeof v==='string'&&v.length>0&&v.length<=max?v:null
const stamp=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<253402300800?new Date(v*1000).toISOString():null
function base(raw:unknown,receivedAt:string,origin:GreenOrigin,eventType:string):GreenEvent {
  if(!Number.isFinite(Date.parse(receivedAt)))greenFail('INVALID_OBSERVATION_TIME')
  const encoded=stableGreenJson(raw)
  if(Buffer.byteLength(encoded)>1024*1024)greenFail('EVENT_TOO_LARGE',413)
  const payloadHash=greenHash(encoded)
  return {eventKey:greenHash(origin+'\0'+payloadHash),eventType,receivedAt,providerTimestamp:null,payloadHash,observation:null,quarantineReason:null,raw,origin}
}
function observation(chatId:unknown,id:unknown,direction:'in'|'out',kind:unknown,currentText:unknown,at:string|null,edited:boolean,deleted:boolean,eventType:string):NormalizedObservation|null {
  const chat=text(chatId,100),messageId=text(id,300)
  if(!chat||!messageId||!/^\d{5,30}@(c\.us|lid)$/.test(chat))return null
  const body=typeof currentText==='string'&&currentText.trim().length&&currentText.length<=16000?currentText:null
  return {providerMessageId:messageId,providerChatId:chat,waId:customerFromChat(chat),direction,kind:deleted?'deleted':(kind==='textMessage'||kind==='extendedTextMessage'||kind==='quotedMessage')&&body?'text':'unsupported',text:deleted?null:body,providerAcceptedAt:at,edited,eventType}
}
export function normaliseWebhook(binding:GreenBinding,raw:unknown,receivedAt:string,quotedTextEnabled=true):GreenEvent {
  const r=obj(raw),instance=obj(r.instanceData),eventType=text(r.typeWebhook,100)??'unknown'
  if(String(instance.idInstance)!==binding.instanceId||instance.typeInstance!=='whatsapp'||![binding.accountId,binding.businessPhone+'@c.us'].includes(instance.wid))greenFail('PROVIDER_IDENTITY_MISMATCH',403)
  const event=base(raw,receivedAt,'webhook',eventType)
  event.providerTimestamp=stamp(r.timestamp)
  if(['outgoingMessageStatus','stateInstanceChanged','deviceInfo','incomingCall'].includes(eventType))return event
  const direction=eventType==='incomingMessageReceived'?'in':eventType==='outgoingMessageReceived'||eventType==='outgoingAPIMessageReceived'?'out':null
  if(!direction){event.quarantineReason='UNSUPPORTED_EVENT';return event}
  const sender=obj(r.senderData),data=obj(r.messageData),kind=data.typeMessage
  // Read only the current message's documented body, never its quote or media caption.
  const body=kind==='textMessage'?obj(data.textMessageData).textMessage:(kind==='extendedTextMessage'||kind==='quotedMessage'&&quotedTextEnabled)?obj(data.extendedTextMessageData).text:undefined
  event.observation=observation(sender.chatId,r.idMessage,direction,kind,body,event.providerTimestamp,false,false,eventType)
  if(event.observation&&direction==='in')event.observation.profileName=text(sender.chatName,150)??text(sender.senderName,150)
  event.quarantineReason=!event.observation?'MESSAGE_IDENTITY_UNAVAILABLE':!event.observation.waId?'CLIENT_MAPPING_UNVERIFIED':event.observation.kind==='unsupported'?'UNSUPPORTED_CONTENT':null
  return event
}
/** Current reply text only; quotedMessage contains the referenced original, never a fallback. */
export function currentHistoryText(raw:unknown,quotedTextEnabled=true):unknown {const r=obj(raw);return r.typeMessage==='quotedMessage'&&quotedTextEnabled?obj(r.extendedTextMessage).text:r.textMessage}
export function normaliseHistory(binding:GreenBinding,raw:unknown,receivedAt:string,origin:'history'|'journal'='history',quotedTextEnabled=true):GreenEvent {
  const r=obj(raw),eventType=origin==='history'?'historyMessage':'journalMessage',event=base(raw,receivedAt,origin,eventType)
  // Journal timestamps can be last-action time. Keep raw value but do not label it as message acceptance/send time.
  event.providerTimestamp=origin==='history'?stamp(r.timestamp):null
  const direction=r.type==='incoming'?'in':r.type==='outgoing'?'out':null
  if(!direction){event.quarantineReason='DIRECTION_UNAVAILABLE';return event}
  // The binding belongs to this authenticated request; records still must carry their own exact chat identity.
  if(!binding.instanceId)greenFail('PROVIDER_IDENTITY_MISMATCH',403)
  event.observation=observation(r.chatId,r.idMessage,direction,r.typeMessage==='quotedMessage'&&!quotedTextEnabled?'unsupported':r.typeMessage,currentHistoryText(r,quotedTextEnabled),event.providerTimestamp,r.isEdited===true,r.isDeleted===true,eventType)
  event.quarantineReason=!event.observation?'MESSAGE_IDENTITY_UNAVAILABLE':!event.observation.waId?'CLIENT_MAPPING_UNVERIFIED':event.observation.kind==='unsupported'?'UNSUPPORTED_CONTENT':null
  if(event.observation?.kind==='text'&&own(r,'isEdited')&&typeof r.isEdited!=='boolean')event.quarantineReason='MALFORMED_REVISION'
  return event
}
