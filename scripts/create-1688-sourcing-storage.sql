create table public.import_reorder_1688_runs (
 id uuid primary key default gen_random_uuid(), request_key uuid not null unique, request_hash text not null,
 actor_id uuid references public.profiles(id) on delete set null, workflow_id text,
 status text not null default 'accepted' check(status in ('accepted','running','stopping','complete','paused','dispatch_unknown')),
 stop_requested boolean not null default false, reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.import_reorder_1688_jobs (
 id uuid primary key default gen_random_uuid(), run_id uuid not null references public.import_reorder_1688_runs(id) on delete restrict,
 item_id uuid references public.import_reorder_items(id) on delete restrict, position integer not null,
 status text not null default 'queued' check(status in ('queued','running','complete','partial','failed','stopped','stale','interrupted')),
 mode text not null check(mode in ('fresh','resume')), item_revision integer not null, generation integer not null, version integer not null,
 context jsonb not null, guard jsonb not null, check_generation integer, lease_key uuid, lease_until timestamptz,
 tmapi_reserved integer not null default 0 check(tmapi_reserved between 0 and 15), ai_reserved integer not null default 0 check(ai_reserved between 0 and 7),
 tmapi_actual integer not null default 0, ai_actual integer not null default 0,
 attempts jsonb not null default '[]' check(jsonb_typeof(attempts)='array' and jsonb_array_length(attempts)<=100),
 reason text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(run_id,position)
);
create unique index import_1688_one_active_job on public.import_reorder_1688_jobs(item_id) where status in ('queued','running');
create index import_1688_jobs_run on public.import_reorder_1688_jobs(run_id,position);
create unique index product_links_sourcing_identity on public.product_links(id,product_id);
create unique index product_variants_sourcing_identity on public.product_variants(id,product_id);
create table public.product_1688_preferences (
 product_id uuid primary key references public.products(id) on delete restrict,
 link_id uuid not null, offer_id text not null check(offer_id ~ '^\d{6,}$'), supplier_id uuid not null references public.foreign_supplier_profiles(id) on delete restrict,
 supplier_name text not null, listing_url text not null, revision integer not null default 1 check(revision>0),
 selected_by uuid references public.profiles(id) on delete set null, selected_at timestamptz not null default now(),
 foreign key(link_id,product_id) references public.product_links(id,product_id) on delete restrict
);
create table public.product_1688_sku_links (
 product_id uuid not null references public.products(id) on delete restrict, offer_id text not null,
 sku_key text not null, target_kind text not null check(target_kind in ('parent','variant')), variant_id uuid,
 source_spec jsonb not null, confirmed_by uuid references public.profiles(id) on delete set null, confirmed_at timestamptz not null default now(),
 primary key(product_id,offer_id,sku_key), foreign key(variant_id,product_id) references public.product_variants(id,product_id) on delete restrict,
 check((target_kind='parent' and variant_id is null) or (target_kind='variant' and variant_id is not null))
);
create unique index product_1688_one_destination on public.product_1688_sku_links(product_id,offer_id,coalesce(variant_id,product_id));
create table public.import_reorder_1688_selections (
 id uuid primary key default gen_random_uuid(), item_id uuid not null references public.import_reorder_items(id) on delete restrict,
 product_id uuid not null references public.products(id) on delete restrict, revision integer not null default 1 check(revision>0),
 status text not null default 'pending' check(status in ('pending','confirmed','cancelled')),
 preference_revision integer not null, snapshot jsonb not null, guard jsonb not null, photos jsonb not null default '{}', result jsonb,
 created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index import_1688_pending_selection on public.import_reorder_1688_selections(item_id) where status='pending';
create index import_1688_selection_item on public.import_reorder_1688_selections(item_id,created_at desc,id);
do $$ declare t text; begin
 foreach t in array array['import_reorder_1688_runs','import_reorder_1688_jobs','product_1688_preferences','product_1688_sku_links','import_reorder_1688_selections'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant select,insert,update on public.%I to service_role',t);
  execute format('create policy buyers_read on public.%I for select to authenticated using(exists(select 1 from public.profiles where id=(select auth.uid()) and role in (''admin'',''manager'')))',t);
 end loop;
end $$;
