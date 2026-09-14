create table public.foreign_supplier_profiles (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(btrim(display_name)) between 1 and 500),
  member_id text unique,
  identity_verified_at timestamptz,
  identity_verified_by uuid references public.profiles(id) on delete set null,
  internal_rating smallint check (internal_rating between 1 and 5),
  quality_revision integer not null default 0,
  note_count integer not null default 0,
  defect_count integer not null default 0,
  latest_note text,
  latest_note_at timestamptz,
  latest_note_author text,
  platform_rating numeric check (platform_rating between 0 and 5),
  platform_ratings jsonb not null default '[]',
  platform_observed_at timestamptz,
  platform_attempt_at timestamptz,
  platform_status text not null default 'not_checked' check (platform_status in ('not_checked','available','unavailable')),
  platform_error text,
  created_at timestamptz not null default now()
);
create table public.foreign_supplier_aliases (
  legacy_name text primary key check (legacy_name = btrim(legacy_name) and length(legacy_name) between 1 and 500),
  profile_id uuid not null references public.foreign_supplier_profiles(id) on delete restrict,
  provenance text not null check (provenance in ('legacy_note','exact_platform_name','buyer_confirmed')),
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index foreign_supplier_alias_profile on public.foreign_supplier_aliases(profile_id);
create table public.foreign_supplier_quality_notes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.foreign_supplier_profiles(id) on delete restrict,
  body text not null check (length(btrim(body)) between 1 and 4000),
  kind text not null check (kind in ('general','defect')),
  author_id uuid references public.profiles(id) on delete set null,
  author_name text not null,
  created_at timestamptz not null default now(),
  product_id uuid references public.products(id) on delete set null,
  import_id uuid references public.purchase_orders(id) on delete set null,
  product_caption text,
  import_caption text,
  rating_before smallint check (rating_before between 1 and 5),
  rating_after smallint check (rating_after between 1 and 5),
  rating_changed boolean not null,
  request_key uuid not null unique,
  request_hash text not null,
  saved_revision integer not null
);
create index foreign_supplier_note_history on public.foreign_supplier_quality_notes(profile_id,created_at desc,id desc);
create index foreign_supplier_note_product on public.foreign_supplier_quality_notes(product_id) where product_id is not null;
create index foreign_supplier_note_import on public.foreign_supplier_quality_notes(import_id) where import_id is not null;
create table public.import_reorder_1688_checks (
  item_id uuid primary key references public.import_reorder_items(id) on delete cascade,
  item_revision integer not null,
  generation integer not null default 1,
  version integer not null default 1,
  context_hash text not null,
  context jsonb not null check (jsonb_typeof(context) = 'object'),
  run_key uuid not null,
  actor_id uuid references public.profiles(id) on delete set null,
  status text not null check (status in ('running','paused','complete','partial','failed')),
  cursor integer not null default 0 check (cursor between 0 and 32),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 6000000),
  previous_success jsonb,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  lease_key uuid,
  lease_until timestamptz,
  stop_requested boolean not null default false,
  last_control_key uuid not null,
  last_control_hash text not null,
  last_stage_key uuid
);
create index import_reorder_1688_leases on public.import_reorder_1688_checks(lease_until) where lease_key is not null;

alter table public.foreign_supplier_profiles enable row level security;
alter table public.foreign_supplier_aliases enable row level security;
alter table public.foreign_supplier_quality_notes enable row level security;
alter table public.import_reorder_1688_checks enable row level security;
revoke all on public.foreign_supplier_profiles, public.foreign_supplier_aliases, public.foreign_supplier_quality_notes, public.import_reorder_1688_checks from public, anon, authenticated, service_role;
grant select on public.foreign_supplier_profiles, public.foreign_supplier_aliases, public.foreign_supplier_quality_notes, public.import_reorder_1688_checks to authenticated;
grant select,insert,update on public.foreign_supplier_profiles, public.foreign_supplier_aliases, public.import_reorder_1688_checks to service_role;
grant select,insert on public.foreign_supplier_quality_notes to service_role;
grant update(product_id) on public.foreign_supplier_quality_notes to service_role;
create policy foreign_supplier_profiles_buyers on public.foreign_supplier_profiles for select to authenticated using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role in ('admin','manager')));
create policy foreign_supplier_aliases_buyers on public.foreign_supplier_aliases for select to authenticated using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role in ('admin','manager')));
create policy foreign_supplier_notes_buyers on public.foreign_supplier_quality_notes for select to authenticated using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role in ('admin','manager')));
create policy import_reorder_checks_buyers on public.import_reorder_1688_checks for select to authenticated using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role in ('admin','manager')));

create function public.foreign_supplier_identity(p_actor uuid,p_name text,p_member text,p_names jsonb,p_confirmed boolean)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid; v_other uuid; v_member text; v_provenance text;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role in ('admin','manager')) then raise exception 'Not allowed' using errcode='42501'; end if;
  p_name:=btrim(p_name);
  if p_name is null or length(p_name) not between 1 and 500 then raise exception 'Invalid supplier name'; end if;
  perform pg_advisory_xact_lock(hashtextextended('foreign-supplier-identity',0));
  select profile_id into v_id from public.foreign_supplier_aliases where legacy_name=p_name;
  if v_id is null and not exists(select 1 from public.purchase_orders where btrim(supplier_name)=p_name) then raise exception 'Supplier is not in the import directory'; end if;
  if p_member is not null then
    if length(p_member) not between 1 and 200 then raise exception 'Invalid shop identity'; end if;
    if not p_confirmed and not (coalesce(p_names,'[]') ? p_name) then raise exception 'Supplier identity needs buyer confirmation'; end if;
    select id into v_other from public.foreign_supplier_profiles where member_id=p_member;
    if v_id is not null and v_other is not null and v_id<>v_other then raise exception 'Identity conflict: these suppliers already have separate quality records'; end if;
  end if;
  if v_id is null then
    v_id:=v_other;
    if v_id is null then insert into public.foreign_supplier_profiles(display_name) values(p_name) returning id into v_id; end if;
    v_provenance:=case when p_member is null then 'legacy_note' when p_confirmed then 'buyer_confirmed' else 'exact_platform_name' end;
    insert into public.foreign_supplier_aliases(legacy_name,profile_id,provenance,confirmed_by,confirmed_at) values(p_name,v_id,v_provenance,case when p_confirmed then p_actor end,case when p_confirmed then now() end);
  end if;
  select member_id into v_member from public.foreign_supplier_profiles where id=v_id for update;
  if p_member is not null then
    if v_member is not null and v_member<>p_member then raise exception 'Identity conflict: supplier is already bound to another shop'; end if;
    update public.foreign_supplier_profiles set member_id=p_member,identity_verified_at=coalesce(identity_verified_at,now()),identity_verified_by=coalesce(identity_verified_by,p_actor) where id=v_id;
    update public.foreign_supplier_aliases set provenance=case when p_confirmed then 'buyer_confirmed' else 'exact_platform_name' end,confirmed_by=case when p_confirmed then p_actor else confirmed_by end,confirmed_at=case when p_confirmed then now() else confirmed_at end where legacy_name=p_name;
  end if;
  return v_id;
end $$;

create function public.foreign_supplier_save_note(p_actor uuid,p_key uuid,p_hash text,p_payload jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_profile public.foreign_supplier_profiles%rowtype; v_note public.foreign_supplier_quality_notes%rowtype; v_id uuid; v_author text; v_product uuid; v_import uuid; v_product_name text; v_import_name text; v_import_supplier text; v_import_product uuid; v_rating smallint;
begin
  select coalesce(nullif(name,''),'Buyer') into v_author from public.profiles where id=p_actor and role in ('admin','manager');
  if not found then raise exception 'Not allowed' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('quality-note:'||p_key::text,0));
  select * into v_note from public.foreign_supplier_quality_notes where request_key=p_key;
  if found then
    if v_note.author_id is distinct from p_actor or v_note.request_hash<>p_hash then raise exception 'Request key already used for different content'; end if;
    return v_note.profile_id;
  end if;
  if length(btrim(coalesce(p_payload->>'body',''))) not between 1 and 4000 or p_payload->>'kind' not in ('general','defect') then raise exception 'Enter a quality note'; end if;
  v_id:=public.foreign_supplier_identity(p_actor,p_payload->>'name',null,'[]',false);
  select * into v_profile from public.foreign_supplier_profiles where id=v_id for update;
  if v_profile.quality_revision<>(p_payload->>'revision')::integer then raise exception 'Supplier changed. Review the latest rating and notes before saving.' using errcode='40001'; end if;
  v_rating:=(p_payload->>'rating')::smallint;
  v_product:=(p_payload->>'productId')::uuid;
  v_import:=(p_payload->>'importId')::uuid;
  if v_rating is not null and v_rating not between 1 and 5 then raise exception 'Rating must be between 1 and 5'; end if;
  if v_import is not null then
    select coalesce(index_no,id::text),supplier_name,product_id into v_import_name,v_import_supplier,v_import_product from public.purchase_orders where id=v_import;
    if not found or not exists(select 1 from public.foreign_supplier_aliases where profile_id=v_id and legacy_name=btrim(v_import_supplier)) then raise exception 'This import belongs to another supplier'; end if;
    if v_product is not null and v_import_product is distinct from v_product then raise exception 'Product does not match the selected import'; end if;
    v_product:=coalesce(v_product,v_import_product);
  end if;
  if v_product is not null then
    select name into v_product_name from public.products where id=v_product;
    if not found then raise exception 'Product no longer exists'; end if;
  end if;
  insert into public.foreign_supplier_quality_notes(profile_id,body,kind,author_id,author_name,product_id,import_id,product_caption,import_caption,rating_before,rating_after,rating_changed,request_key,request_hash,saved_revision)
    values(v_id,btrim(p_payload->>'body'),p_payload->>'kind',p_actor,v_author,v_product,v_import,v_product_name,v_import_name,v_profile.internal_rating,v_rating,v_profile.internal_rating is distinct from v_rating,p_key,p_hash,v_profile.quality_revision+1);
  update public.foreign_supplier_profiles set internal_rating=v_rating,quality_revision=quality_revision+1,note_count=note_count+1,defect_count=defect_count+case when p_payload->>'kind'='defect' then 1 else 0 end,latest_note=btrim(p_payload->>'body'),latest_note_at=now(),latest_note_author=v_author where id=v_id;
  return v_id;
end $$;

create function public.foreign_supplier_observe(p_actor uuid,p_profile uuid,p_member text,p_observation jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare v_at timestamptz; v_rating numeric;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role in ('admin','manager')) then raise exception 'Not allowed' using errcode='42501'; end if;
  v_at:=(p_observation->>'observedAt')::timestamptz;
  v_rating:=(p_observation->>'rating')::numeric;
  if v_at is null or v_at>now()+interval '1 minute' then raise exception 'Invalid observation timestamp'; end if;
  update public.foreign_supplier_profiles set
    platform_attempt_at=v_at,platform_status=case when v_rating is not null and p_observation->>'error' is null then 'available' else 'unavailable' end,
    platform_error=case when v_rating is null then coalesce(p_observation->>'error','Overall rating not published') else p_observation->>'error' end
    where id=p_profile and member_id=p_member and (platform_attempt_at is null or platform_attempt_at<=v_at);
  if v_rating is not null and p_observation->>'error' is null then
    update public.foreign_supplier_profiles set platform_rating=v_rating,platform_ratings=coalesce(p_observation->'ratings','[]'),platform_observed_at=v_at
      where id=p_profile and member_id=p_member and (platform_observed_at is null or platform_observed_at<=v_at);
  end if;
end $$;

create function public.import_reorder_1688_transition(p_actor uuid,p_item uuid,p_revision integer,p_generation integer,p_version integer,p_key uuid,p_run uuid,p_operation text,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_item public.import_reorder_items%rowtype; v_check public.import_reorder_1688_checks%rowtype; v_exists boolean; v_stage text; v_status text;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role in ('admin','manager')) then raise exception 'Not allowed' using errcode='42501'; end if;
  if p_operation='claim' then perform pg_advisory_xact_lock(hashtextextended('1688-global-provider-slots',0)); end if;
  perform pg_advisory_xact_lock(hashtextextended('1688-item:'||p_item::text,0));
  select * into v_item from public.import_reorder_items where id=p_item for share;
  if not found or v_item.status='excluded' then raise exception 'Reorder item is no longer on the list' using errcode='P0002'; end if;
  if v_item.revision<>p_revision then raise exception 'Reorder item changed. Reload before checking.' using errcode='40001'; end if;
  select * into v_check from public.import_reorder_1688_checks where item_id=p_item for update;
  v_exists:=found;
  if p_operation='start' then
    if v_exists and v_check.last_control_key=p_key then
      if v_check.last_control_hash is distinct from p_payload->>'requestHash' or v_check.actor_id is distinct from p_actor then raise exception 'Request key already used'; end if;
      return jsonb_build_object('check',to_jsonb(v_check),'claimed',false);
    end if;
    if coalesce(v_check.generation,0)<>p_generation then raise exception 'A newer check exists. Reload before continuing.' using errcode='40001'; end if;
    if v_exists and ((v_check.lease_key is not null and v_check.lease_until>now()) or (v_check.status='running' and v_check.updated_at>now()-interval '90 seconds')) then raise exception 'Another check is running. Stop it or wait for it to be interrupted.' using errcode='55P03'; end if;
    insert into public.import_reorder_1688_checks(item_id,item_revision,generation,version,context_hash,context,run_key,actor_id,status,evidence,last_control_key,last_control_hash)
      values(p_item,p_revision,p_generation+1,coalesce(v_check.version,0)+1,p_payload->>'contextHash',p_payload->'context',p_run,p_actor,'running',p_payload->'evidence',p_key,p_payload->>'requestHash')
      on conflict(item_id) do update set item_revision=excluded.item_revision,generation=excluded.generation,version=excluded.version,context_hash=excluded.context_hash,context=excluded.context,run_key=excluded.run_key,actor_id=excluded.actor_id,status='running',cursor=0,evidence=excluded.evidence,started_at=now(),updated_at=now(),finished_at=null,lease_key=null,lease_until=null,stop_requested=false,last_control_key=excluded.last_control_key,last_control_hash=excluded.last_control_hash,last_stage_key=null
      returning * into v_check;
    return jsonb_build_object('check',to_jsonb(v_check),'claimed',false);
  end if;
  if not v_exists or v_check.generation<>p_generation then raise exception 'A newer check exists. This response was discarded.' using errcode='40001'; end if;
  if p_operation='stop' then
    update public.import_reorder_1688_checks set stop_requested=true,status=case when status in ('complete','failed') then status else 'paused' end,version=version+1,updated_at=now() where item_id=p_item returning * into v_check;
    return jsonb_build_object('check',to_jsonb(v_check),'claimed',false);
  end if;
  if v_check.context_hash is distinct from p_payload->>'expectedHash' then raise exception 'Product or source evidence changed. Start a fresh check.' using errcode='40001'; end if;
  if p_operation='target' then
    if v_check.last_control_key=p_key and v_check.last_control_hash=p_payload->>'requestHash' then return jsonb_build_object('check',to_jsonb(v_check),'claimed',false); end if;
    if v_check.version<>p_version or (v_check.lease_key is not null and v_check.lease_until>now()) then raise exception 'Check changed or is still running. Reload before confirming a target.' using errcode='40001'; end if;
    update public.import_reorder_1688_checks set generation=generation+1,version=version+1,context=p_payload->'context',context_hash=p_payload->>'contextHash',evidence=p_payload->'evidence',status=case when status='running' then 'paused' else status end,lease_key=null,lease_until=null,stop_requested=true,last_control_key=p_key,last_control_hash=p_payload->>'requestHash',updated_at=now() where item_id=p_item returning * into v_check;
    return jsonb_build_object('check',to_jsonb(v_check),'claimed',false);
  end if;
  if v_check.run_key<>p_run then raise exception 'This run belongs to another browser. Resume explicitly.' using errcode='40001'; end if;
  if p_operation='claim' then
    if v_check.version<>p_version or v_check.last_stage_key=p_key then raise exception 'This stage was already claimed. Reload its saved result.' using errcode='40001'; end if;
    if v_check.status<>'running' or v_check.stop_requested then return jsonb_build_object('check',to_jsonb(v_check),'claimed',false); end if;
    if v_check.lease_key is not null then raise exception 'Stage interrupted or still running. Resume explicitly.' using errcode='55P03'; end if;
    if (select count(*) from public.import_reorder_1688_checks where lease_key is not null and lease_until>now())>=3 then return jsonb_build_object('check',to_jsonb(v_check),'claimed',false,'busy',true); end if;
    v_stage:=v_check.evidence->'stages'->>v_check.cursor;
    if v_stage is null or v_stage is distinct from p_payload->>'stage' then raise exception 'Invalid stage transition'; end if;
    update public.import_reorder_1688_checks set lease_key=p_key,lease_until=now()+interval '75 seconds',last_stage_key=p_key,version=version+1,updated_at=now() where item_id=p_item returning * into v_check;
    return jsonb_build_object('check',to_jsonb(v_check),'claimed',true);
  end if;
  if p_operation='complete' then
    if v_check.lease_key is distinct from p_key then raise exception 'A newer stage claimed this result. Discarded.' using errcode='40001'; end if;
    v_status:=case when v_check.stop_requested then 'partial' else coalesce(p_payload->>'status','running') end;
    if v_status not in ('running','complete','partial','failed') then raise exception 'Invalid completion state'; end if;
    update public.import_reorder_1688_checks set evidence=p_payload->'evidence',cursor=cursor+1,status=v_status,version=version+1,lease_key=null,lease_until=null,updated_at=now(),finished_at=case when v_status<>'running' then now() else null end,
      previous_success=case when v_status='complete' then jsonb_build_object('evidence',p_payload->'evidence','context',context,'checkedAt',now()) else previous_success end
      where item_id=p_item returning * into v_check;
    return jsonb_build_object('check',to_jsonb(v_check),'claimed',false);
  end if;
  raise exception 'Invalid research operation';
end $$;
revoke all on function public.foreign_supplier_identity(uuid,text,text,jsonb,boolean),public.foreign_supplier_save_note(uuid,uuid,text,jsonb),public.foreign_supplier_observe(uuid,uuid,text,jsonb),public.import_reorder_1688_transition(uuid,uuid,integer,integer,integer,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.foreign_supplier_identity(uuid,text,text,jsonb,boolean),public.foreign_supplier_save_note(uuid,uuid,text,jsonb),public.foreign_supplier_observe(uuid,uuid,text,jsonb),public.import_reorder_1688_transition(uuid,uuid,integer,integer,integer,uuid,uuid,text,jsonb) to service_role;
