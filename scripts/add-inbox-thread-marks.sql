-- Manual outcome an agent puts on a conversation from the inbox.
--
-- Its own table, NOT messenger_conversations.done_at: the Business Suite Done
-- sync rewrites done_at from Graph on every pass and would wipe a manual mark.
--
-- A mark is effective only while marked_at >= the thread's last activity; a
-- newer customer message reopens the chat without any write, exactly like Done.
create table if not exists public.inbox_thread_marks (
  thread_key text primary key,
  kind text not null check (kind in ('confirmed', 'not-interested', 'no-reply')),
  marked_at timestamptz not null default now(),
  marked_by text
);

comment on table public.inbox_thread_marks is 'Agent-set outcome per inbox thread (confirmed / not interested / no reply needed); effective until the customer writes again';

alter table public.inbox_thread_marks enable row level security;

drop policy if exists "inbox marks: authenticated read" on public.inbox_thread_marks;
create policy "inbox marks: authenticated read" on public.inbox_thread_marks
  for select to authenticated using (true);

drop policy if exists "inbox marks: authenticated write" on public.inbox_thread_marks;
create policy "inbox marks: authenticated write" on public.inbox_thread_marks
  for all to authenticated using (true) with check (true);
