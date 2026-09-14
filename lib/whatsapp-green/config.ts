import 'server-only'
import { createHash, timingSafeEqual } from 'node:crypto'
import { GREEN_SCOPES, type GreenBinding, greenFail } from './contract'

const hostAllowlist = new Set(['7107.api.greenapi.com']) // Actual console host observed for the linked pilot. Add a second host only after exact verification.
const digest = (value:string) => createHash('sha256').update(value).digest()
export function configuredGreenBindings(env:Record<string,string|undefined> = process.env): GreenBinding[] {
  const bindings:GreenBinding[]=[]
  for (const scope of GREEN_SCOPES) {
    const prefix=`WHATSAPP_GREEN_${scope.env}_`
    const get=(key:string)=>env[prefix+key]?.trim()??''
    if (!get('INSTANCE_ID')) continue
    const instanceId=get('INSTANCE_ID'),apiToken=get('API_TOKEN'),webhookToken=get('WEBHOOK_TOKEN'),accountId=get('ACCOUNT_ID'),version=Number(get('VERSION')||'1')
    let apiUrl:URL
    try { apiUrl=new URL(get('API_URL')) } catch { greenFail('PROVIDER_CONFIGURATION_INVALID',503) }
    if (!/^[1-9]\d{0,19}$/.test(instanceId)||!/^[-_a-zA-Z0-9]{16,256}$/.test(apiToken)||!/^[-_a-zA-Z0-9]{32,200}$/.test(webhookToken)||!/^\d{5,25}@(c\.us|lid)$/.test(accountId)||!Number.isSafeInteger(version)||version<1||
      apiUrl.protocol!=='https:'||apiUrl.username||apiUrl.password||apiUrl.port||apiUrl.pathname!=='/'||apiUrl.search||apiUrl.hash||!hostAllowlist.has(apiUrl.hostname)) greenFail('PROVIDER_CONFIGURATION_INVALID',503)
    if(instanceId.includes(apiToken)||accountId.includes(apiToken)||apiUrl.origin.includes(apiToken)||apiToken===webhookToken)greenFail('PROVIDER_CONFIGURATION_INVALID',503)
    if(bindings.some(b=>b.instanceId===instanceId||b.webhookToken===webhookToken||b.accountId===accountId))greenFail('PROVIDER_CONFIGURATION_COLLISION',503)
    bindings.push({...scope,instanceId,apiToken,webhookToken,accountId,apiUrl:apiUrl.origin,enabled:get('ENABLED')==='true',version})
  }
  return bindings
}
export function greenBindingForBearer(authorization:string|null,bindings:GreenBinding[]):GreenBinding {
  if(!authorization||authorization.length>240||!authorization.startsWith('Bearer '))greenFail('UNAUTHORIZED',401)
  const token=authorization.slice(7),candidate=digest(token)
  const found=bindings.filter(b=>timingSafeEqual(candidate,digest(b.webhookToken)))
  if(found.length!==1)greenFail('UNAUTHORIZED',401)
  if(!found[0].enabled)greenFail('PROVIDER_PAUSED',503)
  return found[0]
}
