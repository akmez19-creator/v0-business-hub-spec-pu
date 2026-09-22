-- Public link + caption of the post each ad boosts, so the inbox AI can send
-- the customer the video they clicked on. Filled lazily per ad, refreshed daily.
alter table public.page_post_ads
  add column if not exists permalink_url text,
  add column if not exists post_message text,
  add column if not exists media_type text,
  add column if not exists post_fetched_at timestamptz;
