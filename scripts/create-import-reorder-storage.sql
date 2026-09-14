-- Applied through Supabase MCP as 20260909134227_add_manual_import_reorder_storage.
-- Retained source, not an instruction to rerun on an already-migrated database.
create table public.import_reorders (
 id uuid primary key default gen_random_uuid(), number bigint generated always as identity unique,
 supplier_name text not null default '', status text not null default 'draft' check (status in ('draft','awaiting_supplier','confirmed','cancelled')),
 revision integer not null default 1 check (revision>0), draft jsonb not null default '{}'::jsonb,
 requested_snapshot jsonb, supplier_snapshot jsonb, confirmed_snapshot jsonb,
 created_by uuid references public.profiles(id) on delete set null,
 approved_by uuid references public.profiles(id) on delete set null, approved_at timestamptz,
 confirmed_by uuid references public.profiles(id) on delete set null, confirmed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.import_reorder_lines (
 id uuid primary key, reorder_id uuid not null references public.import_reorders(id) on delete restrict,
 product_id uuid references public.products(id), variant_id uuid references public.product_variants(id) on delete set null,
 source_import_id uuid references public.purchase_orders(id) on delete set null,
 created_import_id uuid references public.purchase_orders(id) on delete set null unique,
 position integer not null, is_active boolean not null default true, line_data jsonb not null,
 created_at timestamptz not null default now()
);
create index import_reorder_lines_request_idx on public.import_reorder_lines(reorder_id,position);
create index import_reorder_lines_product_idx on public.import_reorder_lines(product_id);
create index import_reorder_lines_variant_idx on public.import_reorder_lines(variant_id);
create index import_reorder_lines_source_idx on public.import_reorder_lines(source_import_id);
create table public.import_reorder_items (
 id uuid primary key default gen_random_uuid(), product_id uuid references public.products(id),
 variant_id uuid references public.product_variants(id) on delete set null,
 source_import_id uuid references public.purchase_orders(id) on delete set null,
 supplier_name text not null default '', item jsonb not null,
 status text not null default 'active' check (status in ('active','deferred','excluded')),
 priority integer not null default 2 check (priority between 1 and 3), review_date date,
 revision integer not null default 1 check(revision>0),
 created_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index import_reorder_items_product_idx on public.import_reorder_items(product_id);
create index import_reorder_items_variant_idx on public.import_reorder_items(variant_id);
create index import_reorder_items_source_idx on public.import_reorder_items(source_import_id);
create table public.import_reorder_settings (
 id uuid primary key default gen_random_uuid(), product_id uuid references public.products(id) on delete cascade,
 supplier_name text, lead_days integer check(lead_days between 0 and 730),
 cover_days integer check(cover_days between 0 and 730), buffer_days integer check(buffer_days between 0 and 365),
 daily_units numeric check(daily_units>=0 and daily_units<=10000000), quantity_multiple integer check(quantity_multiple between 1 and 10000000),
 revision integer not null default 1 check(revision>0), updated_at timestamptz not null default now(),
 updated_by uuid references public.profiles(id) on delete set null,
 check(product_id is null or supplier_name is null),
 check(product_id is not null or (daily_units is null and quantity_multiple is null)),
 unique nulls not distinct(product_id,supplier_name)
);
create table public.import_purchase_events (
 id uuid primary key default gen_random_uuid(), reorder_id uuid references public.import_reorders(id) on delete restrict,
 import_id uuid references public.purchase_orders(id) on delete set null,
 event_type text not null, actor_id uuid references public.profiles(id) on delete set null,
 request_key uuid not null unique, request_hash text not null,
 before_snapshot jsonb, after_snapshot jsonb, reason text, result jsonb not null,
 created_at timestamptz not null default now()
);
create index import_purchase_events_request_idx on public.import_purchase_events(reorder_id,created_at);
create index import_purchase_events_import_idx on public.import_purchase_events(import_id,created_at);
create index import_purchase_events_actor_idx on public.import_purchase_events(actor_id);
create index import_reorders_creator_idx on public.import_reorders(created_by);
create index import_reorders_approver_idx on public.import_reorders(approved_by);
create index import_reorders_confirmer_idx on public.import_reorders(confirmed_by);
create index import_reorder_items_creator_idx on public.import_reorder_items(created_by);
create index import_reorder_settings_updater_idx on public.import_reorder_settings(updated_by);
alter table public.purchase_orders add column variant_id uuid references public.product_variants(id) on delete set null,
 add column variant_snapshot jsonb, add column reorder_line_id uuid references public.import_reorder_lines(id) on delete restrict unique,
 add column expected_arrival_date date;
create index purchase_orders_variant_idx on public.purchase_orders(variant_id);
alter table public.import_reorders enable row level security;
alter table public.import_reorder_lines enable row level security;
alter table public.import_reorder_items enable row level security;
alter table public.import_reorder_settings enable row level security;
alter table public.import_purchase_events enable row level security;
revoke all on public.import_reorders,public.import_reorder_lines,public.import_reorder_items,public.import_reorder_settings,public.import_purchase_events from anon,authenticated;
grant select on public.import_reorders,public.import_reorder_lines,public.import_reorder_items,public.import_reorder_settings,public.import_purchase_events to authenticated;
grant all on public.import_reorders,public.import_reorder_lines,public.import_reorder_items,public.import_reorder_settings to service_role;
grant select,insert on public.import_purchase_events to service_role;
grant usage,select on sequence public.import_reorders_number_seq to service_role;
create policy import_reorders_buyer_read on public.import_reorders for select to authenticated using(exists(select 1 from public.profiles where id=(select auth.uid()) and role in ('admin','manager')));
create policy import_reorder_lines_buyer_read on public.import_reorder_lines for select to authenticated using(exists(select 1 from public.profiles where id=(select auth.uid()) and role in ('admin','manager')));
create policy import_reorder_items_buyer_read on public.import_reorder_items for select to authenticated using(exists(select 1 from public.profiles where id=(select auth.uid()) and role in ('admin','manager')));
create policy import_reorder_settings_buyer_read on public.import_reorder_settings for select to authenticated using(exists(select 1 from public.profiles where id=(select auth.uid()) and role in ('admin','manager')));
create policy import_purchase_events_buyer_read on public.import_purchase_events for select to authenticated using(exists(select 1 from public.profiles where id=(select auth.uid()) and role in ('admin','manager')));
