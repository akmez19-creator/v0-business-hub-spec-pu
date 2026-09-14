create or replace function public.import_1688_guard(p_item uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('item',to_jsonb(i),'product',to_jsonb(p),'variants',coalesce((select jsonb_agg(to_jsonb(v) order by v.id) from public.product_variants v where v.product_id=p.id),'[]'::jsonb),'references',coalesce((select jsonb_agg(to_jsonb(o) order by o.id) from public.purchase_orders o where o.product_id=p.id or o.id=i.source_import_id),'[]'::jsonb),'mappings',coalesce((select jsonb_agg(to_jsonb(m) order by m.offer_id,m.sku_key) from public.product_1688_sku_links m where m.product_id=p.id),'[]'::jsonb),'preference',(select to_jsonb(s) from public.product_1688_preferences s where s.product_id=p.id))
 from public.import_reorder_items i join public.products p on p.id=i.product_id where i.id=p_item and i.status<>'excluded' and p.is_active is true
$$;
create or replace function public.import_1688_queue(p_actor uuid,p_operation text,p_id uuid,p_key uuid,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.import_reorder_1688_runs; j public.import_reorder_1688_jobs; c public.import_reorder_1688_checks; x jsonb; claimed jsonb; idx integer:=0; t integer; a integer; v_reason text; authorized boolean; old_attempt jsonb;
begin
 authorized:=p_actor is not null and exists(select 1 from public.profiles where id=p_actor and role in ('admin','manager'));
 if p_operation in ('enqueue','stop','dispatch-failed','redispatch') and not authorized then raise exception 'Not allowed' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('1688-durable-queue',0));
 if p_operation='reserve' then perform pg_advisory_xact_lock(hashtextextended('1688-global-provider-slots',0)); end if;
 if p_operation='enqueue' then
  select * into r from public.import_reorder_1688_runs where request_key=p_key for update;
  if found then
   if r.actor_id is distinct from p_actor or r.request_hash is distinct from p_payload->>'hash' then raise exception 'Request key already used' using errcode='40001'; end if;
   return jsonb_build_object('run',to_jsonb(r));
  end if;
  if jsonb_typeof(p_payload->'jobs') is distinct from 'array' or jsonb_array_length(p_payload->'jobs') not between 1 and 200 then raise exception 'Select 1 to 200 saved products'; end if;
  update public.import_reorder_1688_runs set stop_requested=true,status='paused',reason='Interrupted attempt; explicit resume requested',updated_at=now() where id in (select run_id from public.import_reorder_1688_jobs where lease_key is not null and lease_until<=now()) or (status in ('running','stopping') and updated_at<now()-interval '3 minutes');
  update public.import_reorder_1688_checks c2 set status='paused',stop_requested=true,lease_key=null,lease_until=null,updated_at=now() from public.import_reorder_1688_jobs j2 where j2.lease_key is not null and j2.lease_until<=now() and c2.item_id=j2.item_id and c2.generation=j2.check_generation;
  update public.import_reorder_1688_jobs set status='interrupted',lease_key=null,lease_until=null,reason='Interrupted attempt; reserved budget retained',updated_at=now() where lease_key is not null and lease_until<=now();
  update public.import_reorder_1688_jobs j2 set status='stopped',updated_at=now() from public.import_reorder_1688_runs r2 where j2.run_id=r2.id and r2.stop_requested and j2.status in ('queued','running') and j2.lease_key is null;
  insert into public.import_reorder_1688_runs(request_key,request_hash,actor_id) values(p_key,p_payload->>'hash',p_actor) returning * into r;
  for x in select value from jsonb_array_elements(p_payload->'jobs') loop
   if public.import_1688_guard((x->>'itemId')::uuid) is distinct from x->'guard' or x->'guard' is null then raise exception 'Saved product changed. Reload before checking.' using errcode='40001'; end if;
   if exists(select 1 from public.import_reorder_1688_jobs where item_id=(x->>'itemId')::uuid and status in ('queued','running')) then raise exception 'This product already has an accepted background check' using errcode='55P03'; end if;
   idx:=idx+1;
   insert into public.import_reorder_1688_jobs(run_id,item_id,position,mode,item_revision,generation,version,context,guard) values(r.id,(x->>'itemId')::uuid,idx,x->>'mode',(x->>'revision')::integer,(x->>'generation')::integer,(x->>'version')::integer,x->'context',x->'guard');
  end loop;
  return jsonb_build_object('run',to_jsonb(r));
 end if;
 if p_operation in ('claim-run','stop','abort-run','dispatch-failed','redispatch','finish-run') then select * into r from public.import_reorder_1688_runs where id=p_id for update;
 else
  select * into j from public.import_reorder_1688_jobs where id=p_id;
  select * into r from public.import_reorder_1688_runs where id=j.run_id for update;
  select * into j from public.import_reorder_1688_jobs where id=p_id for update;
 end if;
 if r.id is null then raise exception 'Background check unavailable'; end if;
 if p_operation='dispatch-failed' then
  update public.import_reorder_1688_runs set status='dispatch_unknown',reason='Background start was not acknowledged. Retry dispatch explicitly; accepted jobs are preserved.',updated_at=now() where id=r.id and workflow_id is null and not stop_requested;
  return jsonb_build_object('accepted',true);
 end if;
 if p_operation='redispatch' then return jsonb_build_object('run',to_jsonb(r)); end if;
 if p_operation='claim-run' then
  if r.stop_requested or r.status in ('complete','paused') then return jsonb_build_object('owned',false); end if;
  if not authorized or r.actor_id is distinct from p_actor then
   update public.import_reorder_1688_runs set stop_requested=true,status='paused',reason='Initiating buyer is no longer authorized',updated_at=now() where id=r.id;
   update public.import_reorder_1688_jobs set status='stopped',reason='Buyer authorization changed',updated_at=now() where run_id=r.id and status='queued';
   return jsonb_build_object('owned',false);
  end if;
  if r.workflow_id is not null and r.workflow_id is distinct from p_payload->>'workflowId' then return jsonb_build_object('owned',false); end if;
  update public.import_reorder_1688_runs set workflow_id=p_payload->>'workflowId',status='running',reason=null,updated_at=now() where id=r.id;
  return jsonb_build_object('owned',true,'jobs',(select jsonb_agg(id order by position) from public.import_reorder_1688_jobs where run_id=r.id));
 end if;
 if p_operation in ('stop','abort-run') then
  if p_operation='abort-run' and (r.workflow_id is distinct from p_payload->>'workflowId' or r.actor_id is distinct from p_actor) then return jsonb_build_object('action','done'); end if;
  update public.import_reorder_1688_runs set stop_requested=true,status='stopping',reason='Buyer stopped remaining work. Dispatched lookups may finish.',updated_at=now() where id=r.id and status not in ('complete','paused');
  update public.import_reorder_1688_jobs set status='stopped',reason='Stopped before dispatch',updated_at=now() where run_id=r.id and status in ('queued','running') and lease_key is null;
  update public.import_reorder_1688_checks c2 set stop_requested=true,status='paused',updated_at=now() from public.import_reorder_1688_jobs j2 where j2.run_id=r.id and c2.item_id=j2.item_id and c2.generation=j2.check_generation and j2.lease_key is null and c2.status='running';
  return jsonb_build_object('stopped',true);
 end if;
 if r.workflow_id is distinct from p_payload->>'workflowId' or r.actor_id is distinct from p_actor then return jsonb_build_object('action','done'); end if;
 update public.import_reorder_1688_runs set updated_at=now() where id=r.id;
 if p_operation='finish-run' then
  update public.import_reorder_1688_runs set status=case when stop_requested or exists(select 1 from public.import_reorder_1688_jobs where run_id=r.id and status<>'complete') then 'paused' else 'complete' end,updated_at=now() where id=r.id;
  return jsonb_build_object('action','done');
 end if;
 if j.id is null then return jsonb_build_object('action','done'); end if;
 if p_operation='stale' then
  update public.import_reorder_1688_jobs set status='stale',reason='Product, variant, source or quantity changed',updated_at=now() where id=j.id and lease_key is null;
  update public.import_reorder_1688_checks set status='paused',stop_requested=true,updated_at=now() where item_id=j.item_id and generation=j.check_generation and lease_key is null;
  return jsonb_build_object('action','done');
 end if;
 if p_operation='interrupt' then
  v_reason:=coalesce(p_payload->>'reason','Attempt interrupted; explicit resume is required');
  update public.import_reorder_1688_runs set stop_requested=true,status='paused',reason=v_reason,updated_at=now() where id=r.id;
  update public.import_reorder_1688_jobs set status=case when id=j.id then 'interrupted' else 'stopped' end,reason=v_reason,updated_at=now() where run_id=r.id and (id=j.id or status in ('queued','running') and lease_key is null);
  update public.import_reorder_1688_checks set status='paused',stop_requested=true,updated_at=now() where item_id=j.item_id and generation=j.check_generation;
  return jsonb_build_object('action','done');
 end if;
 if p_operation='initialize' then
  if j.check_generation is not null then return jsonb_build_object('action','next'); end if;
  if not authorized or r.stop_requested or j.status<>'queued' then update public.import_reorder_1688_jobs set status='stopped',updated_at=now() where id=j.id; return jsonb_build_object('action','done'); end if;
  if public.import_1688_guard(j.item_id) is distinct from j.guard then return public.import_1688_queue(p_actor,'stale',j.id,p_key,p_payload); end if;
  claimed:=public.import_reorder_1688_transition(p_actor,j.item_id,j.item_revision,j.generation,j.version,j.id,r.id,'start',p_payload);
  c:=jsonb_populate_record(null::public.import_reorder_1688_checks,claimed->'check');
  update public.import_reorder_1688_jobs set status='running',check_generation=c.generation,tmapi_reserved=coalesce((c.evidence->'paid'->>'tmapi')::integer,0),ai_reserved=coalesce((c.evidence->'paid'->>'ai')::integer,0),tmapi_actual=case when j.mode='resume' then coalesce((select prev.tmapi_actual from public.import_reorder_1688_jobs prev where prev.item_id=j.item_id and prev.check_generation=j.generation and prev.id<>j.id order by prev.created_at desc,prev.id limit 1),(c.evidence->'paid'->>'tmapi')::integer,0) else 0 end,ai_actual=case when j.mode='resume' then coalesce((select prev.ai_actual from public.import_reorder_1688_jobs prev where prev.item_id=j.item_id and prev.check_generation=j.generation and prev.id<>j.id order by prev.created_at desc,prev.id limit 1),(c.evidence->'paid'->>'ai')::integer,0) else 0 end,updated_at=now() where id=j.id;
  return jsonb_build_object('action','next');
 end if;
 select * into c from public.import_reorder_1688_checks where item_id=j.item_id for update;
 if p_operation='reserve' then
  if j.lease_key is not null and j.lease_until<=now() then return public.import_1688_queue(p_actor,'interrupt',j.id,p_key,jsonb_build_object('workflowId',r.workflow_id,'reason','An attempt was interrupted. Reserved budget is retained; resume explicitly.')); end if;
  select value into old_attempt from jsonb_array_elements(j.attempts) where value->>'key'=p_key::text;
  if old_attempt is not null then return jsonb_build_object('action',case when old_attempt->>'state'='saved' then 'next' else 'wait' end); end if;
  if j.status not in ('running','queued') then return jsonb_build_object('action','done'); end if;
  if not authorized or r.stop_requested then
   update public.import_reorder_1688_jobs set status='stopped',reason=case when not authorized then 'Buyer authorization changed' else reason end,updated_at=now() where id=j.id and lease_key is null;
   update public.import_reorder_1688_checks set status='paused',stop_requested=true,updated_at=now() where item_id=j.item_id and generation=j.check_generation and lease_key is null;
   return jsonb_build_object('action','done');
  end if;
  if j.lease_key is not null then return jsonb_build_object('action','wait'); end if;
  if public.import_1688_guard(j.item_id) is distinct from j.guard or c.generation is distinct from j.check_generation or c.version is distinct from (p_payload->>'version')::integer or c.context_hash is distinct from p_payload->>'contextHash' then return public.import_1688_queue(p_actor,'stale',j.id,p_key,p_payload); end if;
  if c.status<>'running' or c.stop_requested then update public.import_reorder_1688_jobs set status='stopped',updated_at=now() where id=j.id; return jsonb_build_object('action','done'); end if;
  if exists(select 1 from public.import_reorder_1688_jobs where lease_key is not null and lease_until<=now() and status='running') then return public.import_1688_queue(p_actor,'interrupt',j.id,p_key,jsonb_build_object('workflowId',r.workflow_id,'reason','An interrupted provider attempt requires review before more paid work.')); end if;
  if (select count(*) from public.import_reorder_1688_checks where lease_key is not null and lease_until>now())>=3 then return jsonb_build_object('action','wait'); end if;
  if c.evidence->'stages'->>c.cursor is distinct from p_payload->>'stage' then raise exception 'Stage changed'; end if;
  t:=(p_payload->>'tmapi')::integer; a:=(p_payload->>'ai')::integer;
  if t is null or a is null or t not between 0 and 1 or a not between 0 and 1 or t+a>1 then raise exception 'Invalid bounded reservation'; end if;
  if j.tmapi_reserved+t>15 or j.ai_reserved+a>7 or jsonb_array_length(j.attempts)>=100 then return public.import_1688_queue(p_actor,'interrupt',j.id,p_key,jsonb_build_object('workflowId',r.workflow_id,'reason','Attempt budget reached. No further lookup was dispatched.')); end if;
  update public.import_reorder_1688_jobs set lease_key=p_key,lease_until=now()+interval '120 seconds',tmapi_reserved=tmapi_reserved+t,ai_reserved=ai_reserved+a,attempts=attempts||jsonb_build_array(jsonb_build_object('key',p_key,'stage',p_payload->>'stage','tmapi',t,'ai',a,'state','reserved','at',now())),updated_at=now() where id=j.id;
  update public.import_reorder_1688_checks set lease_key=p_key,lease_until=now()+interval '120 seconds',version=version+1,last_stage_key=p_key,evidence=jsonb_set(evidence,'{paid}',jsonb_build_object('tmapi',j.tmapi_reserved+t,'ai',j.ai_reserved+a)),updated_at=now() where item_id=j.item_id;
  return jsonb_build_object('action','execute','check',to_jsonb(c));
 end if;
 if p_operation='complete' then
  if j.lease_key is distinct from p_key then return jsonb_build_object('action','done'); end if;
  if c.generation is distinct from j.check_generation or c.lease_key is distinct from p_key then return public.import_1688_queue(p_actor,'interrupt',j.id,p_key,jsonb_build_object('workflowId',r.workflow_id,'reason','Research changed before its result could be saved.')); end if;
  if public.import_1688_guard(j.item_id) is distinct from j.guard then
   update public.import_reorder_1688_jobs set status='stale',lease_key=null,lease_until=null,reason='Evidence changed during lookup. Paid result was discarded; no fresh lookup started.',tmapi_actual=tmapi_actual+coalesce((p_payload->>'actualTmapi')::integer,0),ai_actual=ai_actual+coalesce((p_payload->>'actualAi')::integer,0),attempts=(select jsonb_agg(case when value->>'key'=p_key::text then value||jsonb_build_object('state','discarded','savedAt',now()) else value end order by ord) from jsonb_array_elements(attempts) with ordinality a(value,ord)),updated_at=now() where id=j.id;
   update public.import_reorder_1688_checks set status='paused',stop_requested=true,lease_key=null,lease_until=null,version=version+1,updated_at=now() where item_id=j.item_id;
   return jsonb_build_object('action','done');
  end if;
  x:=jsonb_set(p_payload->'evidence','{paid}',jsonb_build_object('tmapi',j.tmapi_reserved,'ai',j.ai_reserved));
  v_reason:=p_payload->>'stopReason';
  update public.import_reorder_1688_checks set evidence=x,cursor=cursor+1,status=case when r.stop_requested or v_reason is not null then 'partial' else p_payload->>'status' end,version=version+1,lease_key=null,lease_until=null,updated_at=now(),finished_at=case when r.stop_requested or p_payload->>'status'<>'running' then now() else null end,previous_success=case when p_payload->>'status'='complete' then jsonb_build_object('evidence',x,'context',context,'checkedAt',now()) else previous_success end where item_id=j.item_id returning * into c;
  update public.import_reorder_1688_jobs set status=case when c.status='running' then 'running' else c.status end,lease_key=null,lease_until=null,reason=v_reason,tmapi_actual=tmapi_actual+coalesce((p_payload->>'actualTmapi')::integer,0),ai_actual=ai_actual+coalesce((p_payload->>'actualAi')::integer,0),attempts=(select jsonb_agg(case when value->>'key'=p_key::text then value||jsonb_build_object('state','saved','savedAt',now()) else value end order by ord) from jsonb_array_elements(attempts) with ordinality x(value,ord)),updated_at=now() where id=j.id;
  if v_reason is not null then
   update public.import_reorder_1688_runs set stop_requested=true,status='paused',reason=v_reason,updated_at=now() where id=r.id;
   update public.import_reorder_1688_jobs set status='stopped',reason=v_reason,updated_at=now() where run_id=r.id and status in ('queued','running') and lease_key is null;
  end if;
  return jsonb_build_object('action',case when c.status='running' and v_reason is null then 'next' else 'done' end);
 end if;
 raise exception 'Invalid queue operation';
end $$;
revoke all on function public.import_1688_guard(uuid),public.import_1688_queue(uuid,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.import_1688_guard(uuid),public.import_1688_queue(uuid,text,uuid,uuid,jsonb) to service_role;
