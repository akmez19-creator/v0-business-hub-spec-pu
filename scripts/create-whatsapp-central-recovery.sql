-- New bounded central-browser session metadata only. No canonical message writes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.whatsapp_web_central_sessions (
  phone_number_id text not null check(phone_number_id in ('1090043534186338','968962882975955')),
  wa_id text not null check(wa_id='23052583671'),
  session_id uuid not null unique,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  generation bigint not null check(generation>0),
  connection_enabled boolean not null default false,
  phase text not null check(phase in ('starting','connecting','qr','linked','paused','failed','mismatch')),
  reason text,
  pair_hash text,
  pair_expires_at timestamptz,
  worker_hash text,
  worker_expires_at timestamptz,
  worker_instance_id uuid,
  worker_confirmed boolean not null default false,
  last_seen_at timestamptz,
  report_sequence bigint not null default 0 check(report_sequence>=0),
  observed_business_phone text,
  qr_png bytea,
  qr_nonce uuid,
  qr_expires_at timestamptz,
  operation_id uuid references public.whatsapp_web_recovery_jobs(id) on delete set null,
  request_id uuid,
  operation_state text check(operation_state in ('queued','copying','partial','failed','paused')),
  operation_expires_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(phone_number_id,wa_id),
  foreign key(phone_number_id,wa_id) references public.whatsapp_conversations(phone_number_id,wa_id) on delete cascade,
  check(qr_png is null or octet_length(qr_png)<=131072),
  check((qr_png is null and qr_nonce is null and qr_expires_at is null) or
    (qr_png is not null and qr_nonce is not null and qr_expires_at is not null and phase='qr')),
  check(pair_hash is null or pair_hash ~ '^[0-9a-f]{64}$'),
  check(worker_hash is null or worker_hash ~ '^[0-9a-f]{64}$')
);
alter table public.whatsapp_web_central_sessions enable row level security;
revoke all on public.whatsapp_web_central_sessions from public,anon,authenticated,service_role;
grant select,insert,update on public.whatsapp_web_central_sessions to service_role;
-- QR capability bytes are ephemeral: handlers clear on link/pause/mismatch/expiry.
-- No custom trigger, RPC, Realtime publication, provider or customer operations.
commit;
