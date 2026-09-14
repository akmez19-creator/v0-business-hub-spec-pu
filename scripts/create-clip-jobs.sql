-- Reels Studio: make clip downloads survive closing the dialog.
--
-- THE BUG THIS EXISTS FOR
-- Clicking "use" on a listing video ran the whole download inside the browser
-- tab, and the pending tiles lived in a single useState. The Studio is mounted
-- conditionally ({studioProduct && <ReelsStudioTab/>}), so closing the dialog
-- unmounted the component, React threw the pending list away and the in-flight
-- fetch was cancelled. Nothing had ever been written down, so nothing could
-- come back: three clips sat on "Processing" forever.
--
-- A job row is written BEFORE any downloading starts, so the work is a fact in
-- the database rather than a variable in a tab that may not exist a second
-- later.

create table if not exists public.clip_jobs (
  id           uuid primary key default gen_random_uuid(),

  -- Which product's feed this belongs to. product_name is kept alongside the
  -- id because older clips were saved before products carried an id through,
  -- and the clips route still falls back to the name (see clips/route.ts GET).
  product_id   uuid,
  product_name text not null default '',

  title        text not null,
  thumb_url    text,

  -- '1688' | 'tiktok' | 'facebook' | 'youtube' | 'link'
  source       text not null,
  -- The origin platform's own id, used to dedupe against product_clips
  source_id    text,
  -- The stable PAGE url. Signed CDN stream urls expire, so a retry has to be
  -- able to resolve a fresh one from this instead of reusing a dead link.
  source_url   text,
  -- Stream url resolved at enqueue time. Treated as a hint, never as truth.
  stream_url   text,

  status       text not null default 'queued'
                 check (status in ('queued', 'running', 'done', 'failed')),
  attempts     int  not null default 0,
  error        text,

  -- Set once the download lands in product_clips
  clip_id      uuid references public.product_clips(id) on delete set null,

  created_by   uuid,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);

-- The worker's own lookup: "what is waiting?"
create index if not exists clip_jobs_status_idx
  on public.clip_jobs (status);

-- The panel's lookup: this product's tiles, newest last (feed order)
create index if not exists clip_jobs_product_idx
  on public.clip_jobs (product_id, created_at desc);

-- Double-clicking "use", or a retried "Use all", must not queue the same clip
-- twice. Scoped to live jobs only: once a job is done or failed the same clip
-- may legitimately be queued again (a retry after a genuine failure).
-- NULL source_id (paste-a-link) is exempt, since NULLs are never equal.
create unique index if not exists clip_jobs_live_source_id_idx
  on public.clip_jobs (source_id)
  where source_id is not null and status in ('queued', 'running');

-- Reached only through service-role API routes, so deny-all to the anon key is
-- the correct posture: enable RLS and add no policies.
alter table public.clip_jobs enable row level security;
