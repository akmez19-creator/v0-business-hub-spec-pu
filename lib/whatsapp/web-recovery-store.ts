import 'server-only'
import {createHash,randomBytes,randomUUID} from 'node:crypto'
import {connectInboxDatabase} from '@/lib/messenger/pg'
import {RECOVERY_BINDINGS,RECOVERY_LIMITS,PILOT_WA_ID,RecoveryError,scopeOf,type RecoveryScope,type ControlRequest,type WorkerRequest,type RecoveryObservation} from './web-recovery-contract'

type Row=Record<string,any>
export type RecoveryDb={query:(sql:string,values?:unknown[])=>Promise<{rows:Row[];rowCount?:number|null}>;end:()=>Promise<void>}
const hash=(value:string)=>createHash('sha256').update(value).digest('hex')
const observationHash=(o:RecoveryObservation)=>hash(JSON.stringify({sourceMessageId:o.sourceMessageId,direction:o.direction,kind:o.kind,text:o.text,unsupportedKind:o.unsupportedKind}))
const at=(v:unknown)=>v==null?null:new Date(v as string).toISOString()
const fail=(status:number,code:string,message:string):never=>{throw new RecoveryError(status,code,message)}
const controlOf=(r?:Row)=>({enabled:r?.enabled===true,responseSurface:r?.response_surface??'business_suite',
  version:Number(r?.version??0),operatorUserId:r?.operator_user_id??null})

/** Dependency injection is for isolated database fixtures, never a browser-side adapter. */
export function createRecoveryStore(connect:()=>Promise<RecoveryDb> = connectInboxDatabase) {
  async function admin(db:RecoveryDb,userId:string) {
    const p=(await db.query('select role,approved from public.profiles where id=$1 for share',[userId])).rows[0]
    if(!p?.approved || p.role!=='admin') fail(403,'ADMIN_REQUIRED','This internal recovery pilot requires an approved administrator.')
  }
  async function transaction<T>(userId:string,scope:RecoveryScope|null,fn:(db:RecoveryDb)=>Promise<T>):Promise<T> {
    const db=await connect()
    try {
      await db.query('begin'); await db.query("set local statement_timeout='5000ms'"); await db.query("set local lock_timeout='2000ms'")
      await admin(db,userId)
      if(scope) {
        scopeOf(scope)
        await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['wa-web-recovery',scope.phoneNumberId,scope.waId])])
        const b=RECOVERY_BINDINGS.find(v=>v.phoneNumberId===scope.phoneNumberId)!
        const n=(await db.query('select phone_number_id,page_id,display_phone,can_read from public.whatsapp_inbox_numbers where phone_number_id=$1 for share',[scope.phoneNumberId])).rows[0]
        if(!n?.can_read || n.page_id!==b.pageId || String(n.display_phone??'').replace(/\D/g,'')!==b.businessPhone)
          fail(403,'NUMBER_UNAVAILABLE','The verified business number is not available for this pilot.')
        const c=(await db.query('select phone_number_id,wa_id from public.whatsapp_conversations where phone_number_id=$1 and wa_id=$2 for share',[scope.phoneNumberId,scope.waId])).rows[0]
        if(!c) fail(404,'CONVERSATION_REQUIRED','The internal test contact has no stored conversation on this business number.')
      }
      const result=await fn(db); await db.query('commit'); return result
    } catch(error) { await db.query('rollback').catch(()=>{}); throw error }
    finally { await db.end().catch(()=>{}) }
  }
  async function readFrom(db:RecoveryDb,scope:RecoveryScope) {
    const values=[scope.phoneNumberId,scope.waId]
    const c=(await db.query('select * from public.whatsapp_web_recovery_controls where phone_number_id=$1 and wa_id=$2',values)).rows[0]
    const job=(await db.query('select * from public.whatsapp_web_recovery_jobs where phone_number_id=$1 and wa_id=$2 order by requested_at desc,id desc limit 1',values)).rows[0]
    const copies=await db.query('select * from public.whatsapp_web_observations where phone_number_id=$1 and wa_id=$2 order by first_observed_at desc,source_message_id desc limit 101',values)
    const latest=(await db.query('select observed_at,coverage from public.whatsapp_web_snapshots where phone_number_id=$1 and wa_id=$2 order by observed_at desc,snapshot_id desc limit 1',values)).rows[0]
    const missing=(await db.query("select count(*)::integer as count from public.whatsapp_messages where phone_number_id=$1 and wa_id=$2 and direction='out' and (type='external' or coalesce(raw #>> '{_inbox,receiptOnly}','false')='true')",values)).rows[0]
    const expired=job?.state==='leased' && new Date(job.lease_expires_at).getTime()<=Date.now()
    return {scope:{waId:scope.waId,...RECOVERY_BINDINGS.find(b=>b.phoneNumberId===scope.phoneNumberId)!},control:controlOf(c),
      status:{state:expired?'failed':job?.state??'not_checked',lastAttemptAt:at(job?.claimed_at),lastCopiedAt:at(latest?.observed_at),
        coverage:latest?.coverage??'unknown',reason:expired?'connection_lost':job?.reason??null,
        leaseExpiresAt:at(job?.lease_expires_at),unresolvedReceiptCount:Number(missing?.count??0)},
      observations:copies.rows.slice(0,100).map(r=>({sourceMessageId:r.source_message_id,direction:r.direction,text:r.body,kind:r.kind,
        sentAt:at(r.sent_at),displayedSentAt:r.displayed_sent_at,unsupportedKind:r.unsupported_kind,firstObservedAt:at(r.first_observed_at),source:'whatsapp-web'})),
      hasMore:copies.rows.length>100}
  }
  async function enqueue(db:RecoveryDb,scope:RecoveryScope,userId:string,controlVersion:number) {
    await db.query("update public.whatsapp_web_recovery_jobs set state='failed',reason='connection_lost' where phone_number_id=$1 and wa_id=$2 and state='leased' and lease_expires_at<=clock_timestamp()",[scope.phoneNumberId,scope.waId])
    await db.query(`insert into public.whatsapp_web_recovery_jobs(id,phone_number_id,wa_id,state,requested_by,control_version)
      values($1,$2,$3,'queued',$4,$5) on conflict(phone_number_id,wa_id) where state in ('queued','leased') do nothing`,
      [randomUUID(),scope.phoneNumberId,scope.waId,userId,controlVersion])
  }
  return {
    async handshake(userId:string) {
      return transaction(userId,null,async db=>{
        const rows=(await db.query(`select n.*,c.enabled,c.response_surface,c.version,c.operator_user_id
          from public.whatsapp_inbox_numbers n left join public.whatsapp_web_recovery_controls c
          on c.phone_number_id=n.phone_number_id and c.wa_id=$2 where n.phone_number_id=any($1::text[])`,[RECOVERY_BINDINGS.map(b=>b.phoneNumberId),PILOT_WA_ID])).rows
        return {ownerUserId:userId,pilotClientId:PILOT_WA_ID,limits:RECOVERY_LIMITS,bindings:RECOVERY_BINDINGS.flatMap(b=>{
          const r=rows.find(n=>n.phone_number_id===b.phoneNumberId)
          return r?.can_read && r.page_id===b.pageId && String(r.display_phone??'').replace(/\D/g,'')===b.businessPhone?
            [{...b,...controlOf(r),controlVersion:Number(r.version??0)}]:[]
        })}
      })
    },
    async read(userId:string,scope:RecoveryScope) {return transaction(userId,scope,db=>readFrom(db,scope))},
    async control(userId:string,request:ControlRequest) {
      return transaction(userId,request,async db=>{
        const values=[request.phoneNumberId,request.waId]
        await db.query('insert into public.whatsapp_web_recovery_controls(phone_number_id,wa_id) values($1,$2) on conflict do nothing',values)
        const c=(await db.query('select * from public.whatsapp_web_recovery_controls where phone_number_id=$1 and wa_id=$2 for update',values)).rows[0]
        if(Number(c.version)!==request.expectedVersion) fail(409,'STALE_CONTROL','Recovery settings changed. Refresh before trying again.')
        if(request.action==='configure') {
          await db.query(`update public.whatsapp_web_recovery_controls set enabled=$3,response_surface=$4,operator_user_id=$5,
            version=version+1,updated_at=clock_timestamp() where phone_number_id=$1 and wa_id=$2`,[...values,request.enabled,request.responseSurface,userId])
          await db.query("update public.whatsapp_web_recovery_jobs set state='paused',reason='control_changed' where phone_number_id=$1 and wa_id=$2 and state in ('queued','leased')",values)
          if(request.enabled) await enqueue(db,request,userId,Number(c.version)+1)
        } else {
          if(!c.enabled || c.operator_user_id!==userId) fail(409,'RECOVERY_DISABLED','Enable recovery as the current operator before requesting a copy.')
          await enqueue(db,request,userId,Number(c.version))
        }
        return readFrom(db,request)
      })
    },
    async worker(userId:string,request:WorkerRequest) {
      return transaction(userId,request,async db=>{
        const scopeValues=[request.phoneNumberId,request.waId]
        if(request.action==='complete') {
          await db.query('select pg_advisory_xact_lock(hashtextextended($1,0))',[`wa-web-recovery-snapshot:${request.snapshotId}`])
          const prior=(await db.query('select * from public.whatsapp_web_snapshots where snapshot_id=$1',[request.snapshotId])).rows[0]
          if(prior) {
            if(prior.phone_number_id!==request.phoneNumberId || prior.wa_id!==request.waId || prior.observed_by!==userId ||
              prior.connection_id!==request.connectionId || prior.job_id!==request.jobId || prior.claim_hash!==hash(request.claimToken) || prior.payload_hash!==hash(JSON.stringify(request)))
              fail(409,'SNAPSHOT_CONFLICT','This snapshot identifier already belongs to a different capture.')
            return {snapshotId:request.snapshotId,stored:prior.stored_count,duplicates:prior.duplicate_count,replayed:true,coverage:prior.coverage}
          }
        }
        const c=(await db.query('select * from public.whatsapp_web_recovery_controls where phone_number_id=$1 and wa_id=$2 for update',scopeValues)).rows[0]
        if(!c?.enabled || c.operator_user_id!==userId) fail(409,'RECOVERY_DISABLED','Recovery is paused or belongs to another operator.')
        if(request.action==='claim') {
          await db.query("update public.whatsapp_web_recovery_jobs set state='failed',reason='connection_lost' where phone_number_id=$1 and wa_id=$2 and state='leased' and lease_expires_at<=clock_timestamp()",scopeValues)
          const job=(await db.query("select * from public.whatsapp_web_recovery_jobs where phone_number_id=$1 and wa_id=$2 and state='queued' order by requested_at,id limit 1 for update",scopeValues)).rows[0]
          if(!job || Number(job.control_version)!==Number(c.version)) fail(409,'NO_QUEUED_JOB','Request recovery in Akmez before uploading a reviewed copy.')
          const claimToken=randomBytes(32).toString('hex')
          const updated=(await db.query(`update public.whatsapp_web_recovery_jobs set state='leased',claimed_by=$2,connection_id=$3,
            claim_hash=$4,claimed_at=clock_timestamp(),lease_expires_at=clock_timestamp()+interval '120 seconds',reason=null where id=$1 returning lease_expires_at`,
            [job.id,userId,request.connectionId,hash(claimToken)])).rows[0]
          return {jobId:job.id,claimToken,leaseExpiresAt:at(updated.lease_expires_at),controlVersion:Number(c.version)}
        }
        const job=(await db.query('select *,lease_expires_at>clock_timestamp() as lease_valid from public.whatsapp_web_recovery_jobs where id=$1 for update',[request.jobId])).rows[0]
        if(!job || job.phone_number_id!==request.phoneNumberId || job.wa_id!==request.waId || job.state!=='leased' ||
          !job.lease_valid || job.claimed_by!==userId || job.connection_id!==request.connectionId || job.claim_hash!==hash(request.claimToken) || Number(job.control_version)!==Number(c.version))
          fail(409,'STALE_LEASE','The recovery claim expired or its ownership changed. Request a new recovery job.')
        if(request.action==='fail') {
          await db.query("update public.whatsapp_web_recovery_jobs set state='failed',reason=$2 where id=$1",[request.jobId,request.reason])
          return {jobId:request.jobId,state:'failed',reason:request.reason}
        }
        // All submitted observations remain separate from canonical Cloud messages.
        const existing=(await db.query('select * from public.whatsapp_web_observations where phone_number_id=$1 and wa_id=$2 and source_message_id=any($3::text[])',
          [...scopeValues,request.observations.map(o=>o.sourceMessageId)])).rows
        let stored=0,duplicates=0
        for(const o of request.observations) {
          const prior=existing.find(r=>r.source_message_id===o.sourceMessageId)
          if(prior && (prior.content_hash!==observationHash(o) ||
            (prior.sent_at!==null && o.sentAt!==null && new Date(prior.sent_at).getTime()!==Date.parse(o.sentAt))))
            fail(409,'CONTENT_CONFLICT','A source message changed. Its original copied content was preserved.')
          if(prior) duplicates++; else stored++
        }
        await db.query(`insert into public.whatsapp_web_snapshots(snapshot_id,phone_number_id,wa_id,job_id,connection_id,observed_by,
          claim_hash,payload_hash,captured_at,coverage,stored_count,duplicate_count) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [request.snapshotId,...scopeValues,request.jobId,request.connectionId,userId,hash(request.claimToken),hash(JSON.stringify(request)),request.capturedAt,request.completeness,stored,duplicates])
        for(const o of request.observations) {
          if(existing.some(r=>r.source_message_id===o.sourceMessageId)) continue
          await db.query(`insert into public.whatsapp_web_observations(phone_number_id,wa_id,source_message_id,direction,kind,body,sent_at,
            displayed_sent_at,unsupported_kind,content_hash,first_snapshot_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [...scopeValues,o.sourceMessageId,o.direction,o.kind,o.text,o.sentAt,o.displayedSentAt,o.unsupportedKind,observationHash(o),request.snapshotId])
        }
        await db.query("update public.whatsapp_web_recovery_jobs set state='partial',reason='coverage_not_verified' where id=$1",[request.jobId])
        return {snapshotId:request.snapshotId,stored,duplicates,replayed:false,coverage:request.completeness}
      })
    },
  }
}
export const recoveryStore=createRecoveryStore()
