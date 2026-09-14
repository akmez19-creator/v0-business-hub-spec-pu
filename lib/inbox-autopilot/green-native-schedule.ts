import 'server-only'

type Db={query(text:string,params?:unknown[]):Promise<{rows:Array<Record<string,any>>}>}
export type NativeCandidate={waId:string;inboundMessageId:string;attempts:number}
export type NativePassOutcome={state:string;reason:string;jobId?:string}

/** Automatic attempts per newest inbound message. Further work belongs to staff. */
export const NATIVE_MAX_PASSES=3
const FIRST_COOLDOWN_MS=5*60_000
const MAX_COOLDOWN_MS=30*60_000

/** Attempt 1 -> 5 min, attempt 2 -> 10 min, attempt 3 -> exhausted (still 20 min for the record). */
export function nativeCooldownMs(attempts:number):number{
 if(!Number.isInteger(attempts)||attempts<1)return FIRST_COOLDOWN_MS
 return Math.min(MAX_COOLDOWN_MS,FIRST_COOLDOWN_MS*2**(attempts-1))
}

const safeReason=(v:unknown)=>typeof v==='string'&&/^[a-z_]{1,100}$/.test(v)?v:'native_run_unavailable'

/** One candidate per pass, chosen fairly: never-attempted conversations first (newest inbound
 * first among them), then the least recently attempted. Rows still cooling down or already at
 * the attempt bound are skipped. Existing job rows keep their original exclusion rules. */
export async function selectNativeCandidate(db:Db,business:{phoneNumberId:string;code:string}):Promise<NativeCandidate|null>{
 const row=(await db.query(`SELECT c.wa_id,m.provider_message_id,COALESCE(p.attempts,0) AS attempts FROM public.whatsapp_green_conversations c
   JOIN LATERAL(SELECT provider_message_id,instance_id,direction,provider_accepted_at FROM public.whatsapp_green_messages
     WHERE phone_number_id=c.phone_number_id AND wa_id=c.wa_id ORDER BY provider_accepted_at DESC NULLS LAST,id DESC LIMIT 1)m ON true
   LEFT JOIN public.inbox_autopilot_green_jobs j ON j.phone_number_id=c.phone_number_id AND j.wa_id=c.wa_id AND j.instance_id=m.instance_id AND j.inbound_message_id=m.provider_message_id
   LEFT JOIN public.inbox_autopilot_green_passes p ON p.phone_number_id=c.phone_number_id AND p.wa_id=c.wa_id AND p.inbound_message_id=m.provider_message_id
   WHERE c.phone_number_id=$1 AND m.direction='in' AND m.provider_accepted_at>clock_timestamp()-interval '24 hours' AND m.provider_accepted_at<=clock_timestamp()
     AND NOT EXISTS(SELECT 1 FROM public.inbox_autopilot_controls h WHERE h.business_code=$2 AND h.channel='whatsapp' AND h.owner_id=$1 AND h.customer_id=c.wa_id AND h.paused)
     AND (j.id IS NULL OR (j.state='processing' AND j.attempt_id IS NULL AND j.lease_expires_at<clock_timestamp()))
     AND (p.attempts IS NULL OR (p.attempts<$3 AND p.next_eligible_at<=clock_timestamp()))
   ORDER BY (p.attempts IS NULL) DESC,p.last_run_at ASC NULLS FIRST,m.provider_accepted_at DESC,c.wa_id LIMIT 1`,[business.phoneNumberId,business.code,NATIVE_MAX_PASSES])).rows[0]
 if(!row||typeof row.wa_id!=='string'||typeof row.provider_message_id!=='string')return null
 return{waId:row.wa_id,inboundMessageId:row.provider_message_id,attempts:Number(row.attempts)||0}
}

/** Record that a pass ran for this inbound, whatever the outcome. Accepted sends are excluded
 * by their job row anyway; recording them keeps the ledger complete for the status view.
 * Never touches job, intent, send or handover rows. */
export async function recordNativePass(db:Db,scope:{phoneNumberId:string;waId:string},inboundMessageId:string,outcome:NativePassOutcome):Promise<{attempts:number;exhausted:boolean}>{
 const row=(await db.query(`INSERT INTO public.inbox_autopilot_green_passes(phone_number_id,wa_id,inbound_message_id,attempts,last_state,last_reason,last_run_at,next_eligible_at)
   VALUES($1,$2,$3,1,$4,$5,clock_timestamp(),clock_timestamp()+($6::text)::interval)
   ON CONFLICT(phone_number_id,wa_id,inbound_message_id) DO UPDATE SET
     attempts=LEAST($7,public.inbox_autopilot_green_passes.attempts+1),last_state=EXCLUDED.last_state,last_reason=EXCLUDED.last_reason,last_run_at=clock_timestamp(),
     next_eligible_at=clock_timestamp()+((CASE LEAST($7,public.inbox_autopilot_green_passes.attempts+1) WHEN 1 THEN $6 WHEN 2 THEN $8 ELSE $9 END)::text)::interval
   RETURNING attempts`,[scope.phoneNumberId,scope.waId,inboundMessageId,safeReason(outcome.state),safeReason(outcome.reason),
   `${nativeCooldownMs(1)} milliseconds`,NATIVE_MAX_PASSES,`${nativeCooldownMs(2)} milliseconds`,`${nativeCooldownMs(3)} milliseconds`])).rows[0]
 const attempts=Number(row?.attempts)||NATIVE_MAX_PASSES
 return{attempts,exhausted:attempts>=NATIVE_MAX_PASSES}
}
