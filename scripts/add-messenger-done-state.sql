-- Meta Business Suite "Done" folder state, mirrored onto the cached Messenger summary.
--
-- done_at         : updated_time of the conversation when it was last seen in the
--                   Page's `page_done` folder. A thread is "done" only while
--                   done_at >= last_message_at; a newer customer message reopens it
--                   without any write, exactly as Business Suite does.
-- done_checked_at : when this row's Done state was last verified against Graph.
alter table public.messenger_conversations
  add column if not exists done_at timestamptz,
  add column if not exists done_checked_at timestamptz;

comment on column public.messenger_conversations.done_at is 'updated_time of the conversation when it was last observed in the Meta Business Suite Done folder';
comment on column public.messenger_conversations.done_checked_at is 'last time the Done folder state was verified against Graph for this row';
