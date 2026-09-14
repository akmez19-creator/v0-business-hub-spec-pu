-- Dormant internal pilot. No canonical messages, read state, sends, AI or orders change.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table if not exists public.whatsapp_web_recovery_controls (
  phone_number_id text not null,
  wa_id text not null check(wa_id='23052583671'),
  enabled boolean not null default false,
  response_surface text not null default 'business_suite' check(response_surface in ('business_suite','akmez_manual')),
  operator_user_id uuid references public.profiles(id) on delete set null,
  version bigint not null default 0 check(version>=0),
  updated_at timestamptz not null default clock_timestamp(),
  primary key(phone_number_id,wa_id),
  foreign key(phone_number_id,wa_id) references public.whatsapp_conversations(phone_number_id,wa_id) on delete cascade,
  check(phone_number_id in ('1090043534186338','968962882975955'))
);
create table if not exists public.whatsapp_web_recovery_jobs (
  id uuid primary key,
  phone_number_id text not null,
  wa_id text not null,
  state text not null check(state in ('queued','leased','partial','failed','paused')),
  reason text,
  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default clock_timestamp(),
  control_version bigint not null,
  claimed_by uuid references public.profiles(id) on delete set null,
  connection_id uuid,
  claim_hash text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  unique(id,phone_number_id,wa_id),
  foreign key(phone_number_id,wa_id) references public.whatsapp_web_recovery_controls(phone_number_id,wa_id) on delete cascade,
  check(state<>'leased' or (connection_id is not null and claim_hash is not null and claimed_at is not null and lease_expires_at is not null))
);
create unique index if not exists whatsapp_web_recovery_one_active on public.whatsapp_web_recovery_jobs(phone_number_id,wa_id) where state in ('queued','leased');
create index if not exists whatsapp_web_recovery_recent on public.whatsapp_web_recovery_jobs(phone_number_id,wa_id,requested_at desc,id desc);
create table if not exists public.whatsapp_web_snapshots (
  snapshot_id uuid primary key,
  phone_number_id text not null,
  wa_id text not null,
  job_id uuid not null,
  connection_id uuid not null,
  observed_by uuid references public.profiles(id) on delete set null,
  claim_hash text not null,
  payload_hash text not null,
  captured_at timestamptz not null,
  observed_at timestamptz not null default clock_timestamp(),
  coverage text not null check(coverage in ('unknown','partial')),
  stored_count integer not null check(stored_count between 0 and 40),
  duplicate_count integer not null check(duplicate_count between 0 and 40),
  unique(snapshot_id,phone_number_id,wa_id),
  foreign key(job_id,phone_number_id,wa_id) references public.whatsapp_web_recovery_jobs(id,phone_number_id,wa_id) on delete cascade,
  foreign key(phone_number_id,wa_id) references public.whatsapp_web_recovery_controls(phone_number_id,wa_id) on delete cascade,
  check(stored_count+duplicate_count between 1 and 40)
);
create index if not exists whatsapp_web_snapshots_recent on public.whatsapp_web_snapshots(phone_number_id,wa_id,observed_at desc,snapshot_id desc);
create table if not exists public.whatsapp_web_observations (
  phone_number_id text not null,
  wa_id text not null,
  source_message_id text not null check(char_length(source_message_id) between 1 and 600),
  direction text not null check(direction in ('in','out')),
  kind text not null check(kind in ('text','unsupported')),
  body text,
  sent_at timestamptz,
  displayed_sent_at text,
  unsupported_kind text,
  content_hash text not null,
  first_snapshot_id uuid not null,
  first_observed_at timestamptz not null default clock_timestamp(),
  primary key(phone_number_id,wa_id,source_message_id),
  foreign key(first_snapshot_id,phone_number_id,wa_id) references public.whatsapp_web_snapshots(snapshot_id,phone_number_id,wa_id) on delete cascade,
  foreign key(phone_number_id,wa_id) references public.whatsapp_web_recovery_controls(phone_number_id,wa_id) on delete cascade,
  check(body is null or char_length(body) between 1 and 4000),
  check(displayed_sent_at is null or char_length(displayed_sent_at) between 1 and 160),
  check((kind='text' and body is not null and unsupported_kind is null) or
        (kind='unsupported' and unsupported_kind is not null and char_length(unsupported_kind) between 1 and 80))
);
create index if not exists whatsapp_web_observations_recent on public.whatsapp_web_observations(phone_number_id,wa_id,first_observed_at desc,source_message_id desc);
alter table public.whatsapp_web_recovery_controls enable row level security;
alter table public.whatsapp_web_recovery_jobs enable row level security;
alter table public.whatsapp_web_snapshots enable row level security;
alter table public.whatsapp_web_observations enable row level security;
revoke all on public.whatsapp_web_recovery_controls,public.whatsapp_web_recovery_jobs,public.whatsapp_web_snapshots,public.whatsapp_web_observations from public,anon,authenticated,service_role;
grant select,insert,update on public.whatsapp_web_recovery_controls,public.whatsapp_web_recovery_jobs to service_role;
grant select,insert on public.whatsapp_web_snapshots,public.whatsapp_web_observations to service_role;
-- No trigger, RPC, provider credentials, device registration or Realtime content publication.
commit;
