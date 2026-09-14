-- Additive provider observations only. No canonical messages, reads, sending or orders.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.whatsapp_green_bindings (
  phone_number_id text primary key references public.whatsapp_inbox_numbers(phone_number_id),
  instance_id text not null,
  account_id text not null,
  api_host text not null,
  version bigint not null check(version>0),
  enabled boolean not null default false,
  last_event_at timestamptz,
  last_reconcile_at timestamptz,
  connection_state text not null default 'unknown' check(connection_state in ('unknown','authorized','disconnected')),
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check(phone_number_id in ('968962882975955','1090043534186338'))
);
create table public.whatsapp_green_conversations (
  phone_number_id text not null references public.whatsapp_green_bindings(phone_number_id),
  wa_id text not null check(wa_id ~ '^[0-9]{5,20}$'),
  profile_name text,
  context_version bigint not null default 0,
  last_observed_at timestamptz,
  last_provider_accepted_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(phone_number_id,wa_id)
);
create table public.whatsapp_green_events (
  id uuid primary key,
  phone_number_id text not null references public.whatsapp_green_bindings(phone_number_id),
  instance_id text not null,
  event_key text not null,
  payload_hash text not null,
  origin text not null check(origin in ('webhook','history','journal')),
  event_type text not null,
  wa_id text,
  provider_chat_id text,
  provider_message_id text,
  received_at timestamptz not null,
  provider_timestamp timestamptz,
  state text not null check(state in ('processed','quarantined')),
  reason text,
  raw jsonb not null,
  unique(phone_number_id,instance_id,event_key)
);
create index whatsapp_green_events_scope on public.whatsapp_green_events(phone_number_id,wa_id,received_at desc);
create table public.whatsapp_green_messages (
  id uuid primary key,
  phone_number_id text not null,
  wa_id text not null,
  instance_id text not null,
  provider_chat_id text not null,
  provider_message_id text not null,
  direction text not null check(direction in ('in','out')),
  kind text not null check(kind in ('text','unsupported','deleted')),
  body text,
  provider_accepted_at timestamptz,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  edited boolean not null default false,
  conflicted boolean not null default false,
  deleted_observed boolean not null default false,
  semantic_hash text not null,
  first_event_id uuid not null references public.whatsapp_green_events(id),
  last_event_id uuid not null references public.whatsapp_green_events(id),
  unique(phone_number_id,instance_id,provider_chat_id,provider_message_id),
  foreign key(phone_number_id,wa_id) references public.whatsapp_green_conversations(phone_number_id,wa_id),
  check((kind='text' and body is not null and char_length(body) between 1 and 16000) or kind<>'text')
);
create index whatsapp_green_messages_scope on public.whatsapp_green_messages(phone_number_id,wa_id,first_observed_at desc,id desc);
alter table public.whatsapp_green_bindings enable row level security;
alter table public.whatsapp_green_conversations enable row level security;
alter table public.whatsapp_green_events enable row level security;
alter table public.whatsapp_green_messages enable row level security;
revoke all on public.whatsapp_green_bindings,public.whatsapp_green_conversations,public.whatsapp_green_events,public.whatsapp_green_messages from public,anon,authenticated,service_role;
grant select,insert,update on public.whatsapp_green_bindings,public.whatsapp_green_conversations,public.whatsapp_green_events,public.whatsapp_green_messages to service_role;
commit;
