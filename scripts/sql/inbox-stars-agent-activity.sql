-- Starred inbox threads: anyone signed in may flag a conversation, but ONLY
-- with a written explanation of the issue. One star per thread; the note is
-- what makes the Starred section useful to whoever picks it up next.
create table if not exists public.inbox_thread_stars (
  thread_key text primary key,
  note text not null check (char_length(btrim(note)) >= 20),
  thread_name text,
  channel text,
  starred_by text,
  starred_by_id uuid,
  starred_at timestamptz not null default now()
);
alter table public.inbox_thread_stars enable row level security;
drop policy if exists "inbox stars: authenticated read" on public.inbox_thread_stars;
create policy "inbox stars: authenticated read" on public.inbox_thread_stars
  for select to authenticated using (true);
drop policy if exists "inbox stars: authenticated write" on public.inbox_thread_stars;
create policy "inbox stars: authenticated write" on public.inbox_thread_stars
  for all to authenticated using (true) with check (true);

-- What an agent DID in the system, timestamped: a reply sent, a conversation
-- opened, a thread starred. Deliveries already carry created_by/created_at, so
-- order entries are not duplicated here. Entry Activity merges both to draw a
-- day and grade attendance against the 08:00-16:30 shift.
create table if not exists public.agent_activity_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  kind text not null check (kind in ('inbox_reply', 'thread_open', 'thread_star')),
  channel text,
  ref text,
  at timestamptz not null default now()
);
create index if not exists agent_activity_events_user_at on public.agent_activity_events (user_id, at);
alter table public.agent_activity_events enable row level security;
-- Written by the service role from API routes only; read by the Entry Activity
-- page through the service role as well. No direct client access.
