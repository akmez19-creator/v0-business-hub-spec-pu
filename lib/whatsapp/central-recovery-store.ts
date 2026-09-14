import 'server-only'
import {createHash,createHmac,randomBytes,randomUUID} from 'node:crypto'
import {connectInboxDatabase} from '@/lib/messenger/pg'
import {RECOVERY_BINDINGS,scopeOf,type RecoveryScope} from './web-recovery-contract'
import {CENTRAL_LIMITS,centralCompletion,centralFail,validateQr,type CentralAdminRequest,type CentralWorkerRequest} from './central-recovery-contract'

type Row=Record<string,any>
export type CentralDb={query:(sql:string,values?:unknown[])=>Promise<{rows:Row[];rowCount?:number|null}>;end:()=>Promise<void>}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
const at=(value:unknown)=>value==null?null:new Date(value as string).toISOString()
const time=(value:unknown)=>value==null?0:new Date(value as string).getTime()
const controlOf=(r?:Row)=>({enabled:r?.enabled===true,responseSurface:r?.response_surface??'business_suite',version:Number(r?.version??0),operatorUserId:r?.operator_user_id??null})
const pairToken=()=>`akm_pair_${randomBytes(32).toString('hex')}`
const workerToken=()=>`akm_worker_${randomBytes(32).toString('hex')}`
const claimFor=(s:Row)=>createHmac('sha256',Buffer.from(s.worker_hash,'hex')).update(JSON.stringify(['central-v03',s.session_id,Number(s.generation),s.operation_id])).digest('hex')
const current=(s:Row)=>s.connection_enabled&&time(s.worker_expires_at)>Date.now()&&time(s.last_seen_at)>Date.now()-CENTRAL_LIMITS.presenceSeconds*1000
const scopeFor=(s:Row)=>scopeOf({phoneNumberId:s.phone_number_id,waId:s.wa_id})

export function createCentralRecoveryStore(connect:()=>Promise<CentralDb>=connectInboxDatabase) {
  async function admin(db:CentralDb,actor:string) {
    const row=(await db.query('select role,approved from public.profiles where id=$1 for share',[actor])).rows[0]
    if(!row?.approved||row.role!=='admin')centralFail(403,'ADMIN_REQUIRED','An approved administrator is required.')
  }
  async function lockScope(db:CentralDb,scope:RecoveryScope) {
    scopeOf(scope)
    // Same lock order as the original recovery API: two interfaces cannot race scope controls.
    await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['wa-web-recovery',scope.phoneNumberId,scope.waId])])
    const b=RECOVERY_BINDINGS.find(x=>x.phoneNumberId===scope.phoneNumberId)!
    const n=(await db.query('select phone_number_id,page_id,display_phone,can_read from public.whatsapp_inbox_numbers where phone_number_id=$1 for share',[scope.phoneNumberId])).rows[0]
    if(!n?.can_read||n.page_id!==b.pageId||String(n.display_phone??'').replace(/\D/g,'')!==b.businessPhone)centralFail(403,'NUMBER_UNAVAILABLE','This business number is unavailable.')
    const c=(await db.query('select phone_number_id,wa_id from public.whatsapp_conversations where phone_number_id=$1 and wa_id=$2 for share',[scope.phoneNumberId,scope.waId])).rows[0]
    if(!c)centralFail(404,'CONVERSATION_REQUIRED','The Asla test conversation is not stored on this business number.')
  }
  async function transaction<T>(fn:(db:CentralDb)=>Promise<T>) {
    const db=await connect()
    try {await db.query('begin');await db.query("set local statement_timeout='5000ms'");await db.query("set local lock_timeout='2000ms'");const out=await fn(db);await db.query('commit');return out}
    catch(e){await db.query('rollback').catch(()=>{});throw e}finally{await db.end().catch(()=>{})}
  }
  const session=(db:CentralDb,scope:RecoveryScope)=>db.query('select * from public.whatsapp_web_central_sessions where phone_number_id=$1 and wa_id=$2 for update',[scope.phoneNumberId,scope.waId]).then(r=>r.rows[0])
  const controls=(db:CentralDb,scope:RecoveryScope)=>db.query('select * from public.whatsapp_web_recovery_controls where phone_number_id=$1 and wa_id=$2 for update',[scope.phoneNumberId,scope.waId]).then(r=>r.rows[0])
  async function disable(db:CentralDb,scope:RecoveryScope,actor:string) {
    await db.query('insert into public.whatsapp_web_recovery_controls(phone_number_id,wa_id) values($1,$2) on conflict do nothing',[scope.phoneNumberId,scope.waId])
    await db.query('update public.whatsapp_web_recovery_controls set enabled=false,operator_user_id=$3,version=version+1,updated_at=clock_timestamp() where phone_number_id=$1 and wa_id=$2',[scope.phoneNumberId,scope.waId,actor])
    await db.query("update public.whatsapp_web_recovery_jobs set state='paused',reason='control_changed' where phone_number_id=$1 and wa_id=$2 and state in ('queued','leased')",[scope.phoneNumberId,scope.waId])
  }
  async function expire(db:CentralDb,s:Row) {
    const qrStale=s.qr_png&&(time(s.qr_expires_at)<=Date.now()||!current(s))
    const operationStale=['queued','copying'].includes(s.operation_state)&&(time(s.operation_expires_at)<=Date.now()||!s.connection_enabled)
    if(qrStale)await db.query('update public.whatsapp_web_central_sessions set qr_png=null,qr_nonce=null,qr_expires_at=null where session_id=$1',[s.session_id])
    if(operationStale){await db.query("update public.whatsapp_web_recovery_jobs set state='failed',reason='request_expired' where id=$1 and state='leased'",[s.operation_id]);await db.query("update public.whatsapp_web_central_sessions set operation_state='failed',reason='request_expired' where session_id=$1",[s.session_id])}
    if(qrStale||operationStale)return await session(db,scopeFor(s))
    return s
  }
  async function readFrom(db:CentralDb,scope:RecoveryScope,actor:string) {
    let s=await session(db,scope)
    if(s&&s.actor_id!==actor)centralFail(403,'SESSION_OWNER_REQUIRED','This connection belongs to another administrator.')
    if(s)s=await expire(db,s)
    const c=await controls(db,scope),b=RECOVERY_BINDINGS.find(x=>x.phoneNumberId===scope.phoneNumberId)!
    const copies=(await db.query('select * from public.whatsapp_web_observations where phone_number_id=$1 and wa_id=$2 order by first_observed_at desc,source_message_id desc limit 101',[scope.phoneNumberId,scope.waId])).rows
    const last=(await db.query('select observed_at,coverage from public.whatsapp_web_snapshots where phone_number_id=$1 and wa_id=$2 order by observed_at desc,snapshot_id desc limit 1',[scope.phoneNumberId,scope.waId])).rows[0]
    const missing=(await db.query("select count(*)::integer as count from public.whatsapp_messages where phone_number_id=$1 and wa_id=$2 and direction='out' and (type='external' or coalesce(raw #>> '{_inbox,receiptOnly}','false')='true')",[scope.phoneNumberId,scope.waId])).rows[0]
    let state='disconnected'
    if(s)state=s.phase==='mismatch'?'mismatch':!s.connection_enabled?'paused':!s.worker_hash?'starting':!current(s)?'offline':s.phase==='linked'?'ready':s.phase
    const qr=s&&state==='qr'&&s.qr_png&&time(s.qr_expires_at)>Date.now()?{url:'/api/inbox/whatsapp/central/qr?'+new URLSearchParams({...scope,sessionId:s.session_id,generation:String(s.generation),nonce:s.qr_nonce}),expiresAt:at(s.qr_expires_at)}:null
    return {success:true,scope:{...scope,...b},control:controlOf(c),session:{id:s?.session_id??null,generation:Number(s?.generation??0),connectionEnabled:s?.connection_enabled===true,state,
      lastSeenAt:at(s?.last_seen_at),workerExpiresAt:at(s?.worker_expires_at),observedBusinessPhone:s?.observed_business_phone??null,reason:s?.reason??null,qr,
      operation:s?.operation_id?{id:s.operation_id,requestId:s.request_id,state:s.operation_state,expiresAt:at(s.operation_expires_at),reason:s.operation_state==='failed'||s.operation_state==='paused'?s.reason??null:null}:null},
      history:{unresolvedReceiptCount:Number(missing?.count??0),lastCopiedAt:at(last?.observed_at),coverage:last?.coverage??'unknown'},
      observations:copies.slice(0,100).map(r=>({sourceMessageId:r.source_message_id,direction:r.direction,text:r.body,kind:r.kind,sentAt:at(r.sent_at),displayedSentAt:r.displayed_sent_at,unsupportedKind:r.unsupported_kind,firstObservedAt:at(r.first_observed_at),source:'whatsapp-web'})),hasMore:copies.length>100}
  }
  return {
    async read(actor:string,scope:RecoveryScope){return transaction(async db=>{await admin(db,actor);await lockScope(db,scope);return readFrom(db,scope,actor)})},
    async qr(actor:string,scope:RecoveryScope,id:string,generation:number,nonce:string) {return transaction(async db=>{
      await admin(db,actor);await lockScope(db,scope);let s=await session(db,scope)
      if(s)s=await expire(db,s)
      if(!s||s.actor_id!==actor||s.session_id!==id||Number(s.generation)!==generation||s.qr_nonce!==nonce||s.phase!=='qr'||!current(s)||!s.qr_png||time(s.qr_expires_at)<=Date.now())centralFail(404,'QR_UNAVAILABLE','The connection code expired or is no longer available.')
      return s.qr_png as Buffer
    })},
    async control(actor:string,r:CentralAdminRequest) {return transaction(async db=>{
      await admin(db,actor);await lockScope(db,r);let s=await session(db,r)
      if(s&&s.actor_id!==actor)centralFail(403,'SESSION_OWNER_REQUIRED','This connection belongs to another administrator.')
      if(r.action==='pause') {
        await disable(db,r,actor)
        if(s)await db.query("update public.whatsapp_web_central_sessions set generation=generation+1,connection_enabled=false,phase='paused',reason='operator_paused',qr_png=null,qr_nonce=null,qr_expires_at=null,pair_hash=null,pair_expires_at=null,operation_state=case when operation_state in ('queued','copying') then 'paused' else operation_state end,updated_at=clock_timestamp() where session_id=$1",[s.session_id])
        else await db.query("insert into public.whatsapp_web_central_sessions(phone_number_id,wa_id,session_id,actor_id,generation,connection_enabled,phase,reason) values($1,$2,$3,$4,1,false,'paused','operator_paused')",[r.phoneNumberId,r.waId,randomUUID(),actor])
        return readFrom(db,r,actor)
      }
      if(Number(s?.generation??0)!==r.expectedGeneration)centralFail(409,'STALE_GENERATION','The connection changed. Refresh before continuing.')
      if(r.action==='connect') {
        await disable(db,r,actor)
        const reuse=s?.worker_hash&&s.worker_confirmed&&time(s.worker_expires_at)>Date.now()&&time(s.last_seen_at)>Date.now()-CENTRAL_LIMITS.presenceSeconds*1000,id=reuse?s.session_id:randomUUID(),gen=Number(s?.generation??0)+1,token=reuse?null:pairToken()
        await db.query(`insert into public.whatsapp_web_central_sessions(phone_number_id,wa_id,session_id,actor_id,generation,connection_enabled,phase,pair_hash,pair_expires_at)
          values($1,$2,$3,$4,$5,true,'starting',$6,case when $6::text is null then null else clock_timestamp()+interval '600 seconds' end)
          on conflict(phone_number_id,wa_id) do update set session_id=excluded.session_id,generation=excluded.generation,connection_enabled=true,phase='starting',reason=null,
          pair_hash=excluded.pair_hash,pair_expires_at=excluded.pair_expires_at,worker_hash=case when $7 then whatsapp_web_central_sessions.worker_hash else null end,
          worker_expires_at=case when $7 then whatsapp_web_central_sessions.worker_expires_at else null end,worker_instance_id=case when $7 then whatsapp_web_central_sessions.worker_instance_id else null end,
          worker_confirmed=case when $7 then whatsapp_web_central_sessions.worker_confirmed else false end,
          last_seen_at=null,report_sequence=0,observed_business_phone=null,qr_png=null,qr_nonce=null,qr_expires_at=null,operation_id=null,request_id=null,operation_state=null,operation_expires_at=null,updated_at=clock_timestamp()`,
          [r.phoneNumberId,r.waId,id,actor,gen,token?hash(token):null,Boolean(reuse)])
        const out=await readFrom(db,r,actor),fresh=await session(db,r)
        return {...out,...(token?{pairing:{token,sessionId:id,expiresAt:at(fresh.pair_expires_at)}}:{})}
      }
      if(!s||!current(s)||s.phase!=='linked'||s.observed_business_phone!==RECOVERY_BINDINGS.find(b=>b.phoneNumberId===r.phoneNumberId)!.businessPhone)centralFail(409,'WORKER_NOT_READY','Connect and verify this business in the central service first.')
      s=await expire(db,s)
      if(s.request_id===r.requestId)return readFrom(db,r,actor)
      if(['queued','copying'].includes(s.operation_state))centralFail(409,'FETCH_ACTIVE','A finite fetch is already active for this business.')
      await db.query('insert into public.whatsapp_web_recovery_controls(phone_number_id,wa_id) values($1,$2) on conflict do nothing',[r.phoneNumberId,r.waId])
      const c=await controls(db,r)
      if(c.operator_user_id&&c.operator_user_id!==actor)centralFail(409,'OPERATOR_MISMATCH','The recovery controls belong to another administrator.')
      await db.query('update public.whatsapp_web_recovery_controls set enabled=true,operator_user_id=$3,version=version+1,updated_at=clock_timestamp() where phone_number_id=$1 and wa_id=$2',[r.phoneNumberId,r.waId,actor])
      await db.query("update public.whatsapp_web_recovery_jobs set state='paused',reason='central_fetch_replaced' where phone_number_id=$1 and wa_id=$2 and state in ('queued','leased')",[r.phoneNumberId,r.waId])
      const op=randomUUID(),expires=new Date(Math.min(Date.now()+CENTRAL_LIMITS.operationSeconds*1000,time(s.worker_expires_at))).toISOString(),claim=claimFor({...s,operation_id:op})
      // Reserve as leased immediately so the old manual extension cannot consume this central request.
      await db.query(`insert into public.whatsapp_web_recovery_jobs(id,phone_number_id,wa_id,state,requested_by,control_version,claimed_by,connection_id,claim_hash,claimed_at,lease_expires_at)
        values($1,$2,$3,'leased',$4,$5,$4,$6,$7,clock_timestamp(),$8)`,[op,r.phoneNumberId,r.waId,actor,Number(c.version)+1,s.session_id,hash(claim),expires])
      await db.query("update public.whatsapp_web_central_sessions set operation_id=$2,request_id=$3,operation_state='queued',operation_expires_at=$4,reason=null where session_id=$1",[s.session_id,op,r.requestId,expires])
      return readFrom(db,r,actor)
    })},
    async worker(r:CentralWorkerRequest,authorization:string|null) {return transaction(async db=>{
      let s=(await db.query('select * from public.whatsapp_web_central_sessions where session_id=$1',[r.sessionId])).rows[0]
      if(!s)centralFail(401,'WORKER_UNAUTHORIZED','The worker session is unavailable or expired.')
      await admin(db,s.actor_id);await lockScope(db,scopeFor(s));s=await session(db,scopeFor(s))
      if(!s||s.session_id!==r.sessionId)centralFail(401,'WORKER_UNAUTHORIZED','The worker session is unavailable or expired.')
      if(r.action==='pair') {
        if(!s.connection_enabled||!s.pair_hash||s.pair_hash!==hash(r.pairToken)||time(s.pair_expires_at)<=Date.now()||s.worker_hash)centralFail(401,'PAIR_USED_OR_EXPIRED','Create a new service pairing request in Akmez.')
        const token=workerToken(),expiry=new Date(Date.now()+CENTRAL_LIMITS.workerSeconds*1000).toISOString()
        await db.query("update public.whatsapp_web_central_sessions set pair_hash=null,pair_expires_at=null,worker_hash=$2,worker_expires_at=$3,worker_instance_id=$4,last_seen_at=clock_timestamp(),phase='connecting' where session_id=$1",[s.session_id,hash(token),expiry,r.instanceId])
        return {success:true,sessionId:s.session_id,workerToken:token,workerExpiresAt:expiry,generation:Number(s.generation),scope:{...scopeFor(s),...RECOVERY_BINDINGS.find(b=>b.phoneNumberId===s.phone_number_id)!}}
      }
      const token=authorization?.startsWith('Bearer ')?authorization.slice(7):''
      if(!/^akm_worker_[0-9a-f]{64}$/.test(token)||hash(token)!==s.worker_hash||time(s.worker_expires_at)<=Date.now()||s.worker_instance_id!==r.instanceId)centralFail(401,'WORKER_UNAUTHORIZED','The worker session is unavailable or expired.')
      const scope=scopeFor(s),binding=RECOVERY_BINDINGS.find(b=>b.phoneNumberId===scope.phoneNumberId)!
      // Retry acknowledgement is checked before current generation/control gates: it never performs a new write.
      if(r.action==='complete') {
        const p=centralCompletion(r,scope)
        await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`wa-web-recovery-snapshot:${r.snapshotId}`])
        const old=(await db.query('select * from public.whatsapp_web_snapshots where snapshot_id=$1',[r.snapshotId])).rows[0]
        if(old){if(old.phone_number_id!==scope.phoneNumberId||old.wa_id!==scope.waId||old.observed_by!==s.actor_id||old.connection_id!==s.session_id||old.job_id!==r.operationId||old.claim_hash!==hash(r.claimToken)||old.payload_hash!==hash(JSON.stringify({...p,generation:r.generation})))centralFail(409,'SNAPSHOT_CONFLICT','This capture identifier belongs to a different result.');return {success:true,snapshotId:r.snapshotId,stored:old.stored_count,duplicates:old.duplicate_count,replayed:true,coverage:old.coverage}}
      }
      if(r.action==='poll') {
        if(!s.worker_confirmed)await db.query('update public.whatsapp_web_central_sessions set worker_confirmed=true where session_id=$1',[s.session_id])
        s=await expire(db,s)
        // Poll is not proof that the page/account is usable; only a verified report updates last_seen_at.
        const c=await controls(db,scope),job=s.operation_id?(await db.query('select * from public.whatsapp_web_recovery_jobs where id=$1',[s.operation_id])).rows[0]:null
        const active=['queued','copying'].includes(s.operation_state)&&time(s.operation_expires_at)>Date.now()
        if(active&&(!c?.enabled||c.operator_user_id!==s.actor_id||job?.state!=='leased'||Number(job.control_version)!==Number(c.version))){await db.query("update public.whatsapp_web_central_sessions set operation_state='paused',reason='control_changed' where session_id=$1",[s.session_id]);s={...s,operation_state:'paused',reason:'control_changed'}}
        const mayCapture=current(s)&&s.phase==='linked'&&s.observed_business_phone===binding.businessPhone&&['queued','copying'].includes(s.operation_state)&&r.generation===Number(s.generation)
        if(mayCapture){await db.query("update public.whatsapp_web_central_sessions set operation_state='copying' where session_id=$1",[s.session_id]);return {success:true,generation:Number(s.generation),scope:{...scope,...binding},command:{kind:'capture',operationId:s.operation_id,expiresAt:at(s.operation_expires_at),claimToken:claimFor(s)}}}
        return {success:true,generation:Number(s.generation),scope:{...scope,...binding},command:{kind:s.connection_enabled?'inspect_connection':'pause'}}
      }
      if(r.generation!==Number(s.generation)||!s.connection_enabled)centralFail(409,'STALE_GENERATION','The operation was paused or replaced.')
      if(r.action==='report') {
        if(r.sequence<=Number(s.report_sequence))return {success:true,generation:Number(s.generation),phase:s.phase,stale:true,qrExpiresAt:null}
        const mismatch=r.phase==='linked'&&r.businessPhone!==binding.businessPhone,phase=mismatch?'mismatch':r.phase
        if(mismatch)await disable(db,scope,s.actor_id)
        const png=r.phase==='qr'?validateQr(r.qrPngBase64!):null
        await db.query(`update public.whatsapp_web_central_sessions set phase=$2,observed_business_phone=$3,reason=$4,last_seen_at=$9,
          qr_png=$5,qr_nonce=$6,qr_expires_at=case when $5::bytea is null then null else $9::timestamptz+interval '30 seconds' end,
          operation_state=case when $7 and operation_state in ('queued','copying') then 'paused' else operation_state end,
          report_sequence=$8,connection_enabled=case when $7 then false else connection_enabled end,generation=generation+case when $7 then 1 else 0 end where session_id=$1`,
          [s.session_id,phase,r.businessPhone,mismatch?'business_mismatch':r.reason,png,png?randomUUID():null,mismatch,r.sequence,r.observedAt])
        return {success:true,generation:Number(s.generation)+(mismatch?1:0),phase,qrExpiresAt:png?new Date(Date.parse(r.observedAt)+CENTRAL_LIMITS.qrSeconds*1000).toISOString():null}
      }
      if(!['complete','fail'].includes(r.action))centralFail(400,'INVALID_REQUEST','Unsupported worker action.')
      const job=(await db.query('select *,lease_expires_at>clock_timestamp() as lease_valid from public.whatsapp_web_recovery_jobs where id=$1 for update',[r.operationId])).rows[0],c=await controls(db,scope)
      if(s.operation_id!==r.operationId||!['queued','copying'].includes(s.operation_state)||time(s.operation_expires_at)<=Date.now()||
        !c?.enabled||c.operator_user_id!==s.actor_id||!job||job.state!=='leased'||!job.lease_valid||job.phone_number_id!==scope.phoneNumberId||job.wa_id!==scope.waId||job.connection_id!==s.session_id||job.claimed_by!==s.actor_id||Number(job.control_version)!==Number(c.version)||job.claim_hash!==hash(r.claimToken))centralFail(409,'STALE_OPERATION','The finite fetch expired, disconnected, or was paused.')
      if(r.action==='fail') {await db.query("update public.whatsapp_web_recovery_jobs set state='failed',reason=$2 where id=$1",[r.operationId,r.reason]);await db.query("update public.whatsapp_web_central_sessions set operation_state='failed',reason=$2 where session_id=$1",[s.session_id,r.reason]);return {success:true,operationId:r.operationId,state:'failed'}}
      if(!current(s)||s.phase!=='linked'||s.observed_business_phone!==binding.businessPhone)centralFail(409,'STALE_OPERATION','The business browser is not currently verified for this capture.')
      const p=centralCompletion(r,scope)
      if(Date.parse(p.capturedAt)<time(job.claimed_at)-5000||Date.parse(p.capturedAt)>Date.now()+5000)centralFail(409,'CAPTURE_NOT_CURRENT','Capture this conversation after the current finite fetch request.')
      const existing=(await db.query('select * from public.whatsapp_web_observations where phone_number_id=$1 and wa_id=$2 and source_message_id=any($3::text[])',[scope.phoneNumberId,scope.waId,p.observations.map(o=>o.sourceMessageId)])).rows
      const contentHash=(o:typeof p.observations[number])=>hash(JSON.stringify({sourceMessageId:o.sourceMessageId,direction:o.direction,kind:o.kind,text:o.text,unsupportedKind:o.unsupportedKind}))
      let stored=0,duplicates=0
      for(const o of p.observations){const old=existing.find(x=>x.source_message_id===o.sourceMessageId);if(old&&(old.content_hash!==contentHash(o)||(old.sent_at!==null&&o.sentAt!==null&&time(old.sent_at)!==Date.parse(o.sentAt))))centralFail(409,'CONTENT_CONFLICT','An earlier copy of this source message differs and was preserved.');if(old)duplicates++;else stored++}
      await db.query(`insert into public.whatsapp_web_snapshots(snapshot_id,phone_number_id,wa_id,job_id,connection_id,observed_by,claim_hash,payload_hash,captured_at,coverage,stored_count,duplicate_count)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[p.snapshotId,scope.phoneNumberId,scope.waId,r.operationId,s.session_id,s.actor_id,hash(r.claimToken),hash(JSON.stringify({...p,generation:r.generation})),p.capturedAt,p.completeness,stored,duplicates])
      for(const o of p.observations){if(existing.some(x=>x.source_message_id===o.sourceMessageId))continue;await db.query(`insert into public.whatsapp_web_observations(phone_number_id,wa_id,source_message_id,direction,kind,body,sent_at,displayed_sent_at,unsupported_kind,content_hash,first_snapshot_id)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[scope.phoneNumberId,scope.waId,o.sourceMessageId,o.direction,o.kind,o.text,o.sentAt,o.displayedSentAt,o.unsupportedKind,contentHash(o),p.snapshotId])}
      await db.query("update public.whatsapp_web_recovery_jobs set state='partial',reason='coverage_not_verified' where id=$1",[r.operationId]);await db.query("update public.whatsapp_web_central_sessions set operation_state='partial',reason='coverage_not_verified' where session_id=$1",[s.session_id])
      return {success:true,snapshotId:p.snapshotId,stored,duplicates,replayed:false,coverage:p.completeness}
    })},
  }
}
export const centralRecoveryStore=createCentralRecoveryStore()
