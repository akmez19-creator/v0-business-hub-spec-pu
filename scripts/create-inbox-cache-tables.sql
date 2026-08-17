-- Persist Messenger threads and Page comments so the inbox reads from Postgres
-- instead of re-walking the Graph API on every page load.
--
-- WHY: browsing the inbox fanned out hundreds of Graph calls across 6 pages,
-- which exhausted Meta's app-wide hourly cap and produced "(#4) Application
-- request limit reached". Reads now come from here; Graph is touched only on an
-- explicit refresh. Mirrors whatsapp_contacts / whatsapp_messages, which have
-- worked this way since the WhatsApp webhook went live.
--
-- All access is through the service-role admin client, so RLS is enabled with
-- no policies: service role bypasses RLS, and nothing else can read these.

-- ---------------------------------------------------------------------------
-- Messenger threads
-- ---------------------------------------------------------------------------
-- KEYED ON (page_id, psid), NOT on the Graph conversation id. The webhook only
-- ever tells us sender/recipient PSIDs - it never sends a conversation id - so
-- keying on t_<id> would make it impossible to upsert a live message. The Graph
-- id is stored separately and filled in by the refresh/backfill, purely so a
-- cached row can be matched back to the Graph thread it came from.
create table if not exists messenger_conversations (
  id uuid primary key default gen_random_uuid(),
  page_id text not null,
  psid text not null,
  -- Graph's t_<id>. Null until a refresh has seen this thread.
  conversation_id text unique,
  page_name text,
  customer_name text,

  last_message_at timestamptz,
  last_snippet text,
  -- The single most useful commercial signal: is this thread waiting on US?
  -- Maintained by the webhook - inbound sets true, an echo of our own reply
  -- sets false, so replying from Business Suite clears it here too.
  last_from_customer boolean not null default true,
  message_count integer not null default 0,
  unread_count integer not null default 0,

  -- Attribution, denormalised so the leads list needs no joins to render.
  ad_id text,
  ad_name text,
  product text,
  product_id uuid references products(id),
  campaign_id text,
  campaign_name text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (page_id, psid)
);

create index if not exists messenger_conversations_recent_idx
  on messenger_conversations (last_message_at desc nulls last);
-- Partial index: the default Leads view asks exactly this question.
create index if not exists messenger_conversations_awaiting_idx
  on messenger_conversations (last_message_at desc)
  where last_from_customer;
create index if not exists messenger_conversations_product_idx
  on messenger_conversations (product_id);

-- ---------------------------------------------------------------------------
-- Individual Messenger messages
-- ---------------------------------------------------------------------------
-- PK is Meta's own message id so redelivery is idempotent. Meta retries a
-- webhook until it gets a 200, so without this a single flaky response would
-- duplicate every message in the thread.
create table if not exists messenger_messages (
  mid text primary key,
  page_id text not null,
  -- Always the CUSTOMER's psid, whichever way the message travelled, so a
  -- thread is one simple lookup rather than an OR across two columns.
  psid text not null,
  direction text not null check (direction in ('in', 'out')),
  body text,
  attachments jsonb,
  -- True when this is Meta echoing back something WE sent. That is how a reply
  -- made in Business Suite or respond.io reaches this database at all.
  is_echo boolean not null default false,
  -- Which tool sent an outbound message (page inbox vs respond.io vs us).
  -- Null on inbound.
  app_id text,
  created_at timestamptz not null,
  raw jsonb,
  inserted_at timestamptz not null default now()
);

create index if not exists messenger_messages_thread_idx
  on messenger_messages (page_id, psid, created_at desc);

-- ---------------------------------------------------------------------------
-- Page comments
-- ---------------------------------------------------------------------------
create table if not exists page_comments (
  comment_id text primary key,
  post_id text not null,
  -- Set when this comment is a reply to another comment.
  parent_id text,
  page_id text not null,
  page_name text,
  -- Stays null for public commenters: Meta withholds `from` without Page
  -- Public Content Access. Expected, not a bug - do not chase it with scopes.
  author_id text,
  author_name text,
  message text,
  created_time timestamptz,
  -- True when the page itself wrote the comment (our own reply).
  from_page boolean not null default false,
  replied_at timestamptz,
  is_hidden boolean not null default false,
  -- Soft delete: Meta sends a 'remove' verb, and losing the row would make the
  -- comment reappear on the next backfill.
  is_deleted boolean not null default false,

  ad_id text,
  ad_name text,
  product text,
  product_id uuid references products(id),
  campaign_id text,
  campaign_name text,

  -- Denormalised post context, so rendering a comment needs no second lookup.
  permalink text,
  post_message text,
  post_permalink text,
  like_count integer not null default 0,

  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists page_comments_recent_idx
  on page_comments (created_time desc nulls last);
create index if not exists page_comments_post_idx on page_comments (post_id);
-- Drives the "needs reply" count: unanswered, not ours, still visible.
create index if not exists page_comments_needs_reply_idx
  on page_comments (created_time desc)
  where replied_at is null and not from_page and not is_deleted;

-- ---------------------------------------------------------------------------
-- Sync bookkeeping, so a refresh can be bounded and resumable
-- ---------------------------------------------------------------------------
-- Lets the backfill stop cleanly on a rate limit and pick up where it left off
-- instead of restarting and burning the cap again.
create table if not exists inbox_sync_state (
  key text primary key,
  cursor text,
  last_run_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

alter table messenger_conversations enable row level security;
alter table messenger_messages enable row level security;
alter table page_comments enable row level security;
alter table inbox_sync_state enable row level security;
