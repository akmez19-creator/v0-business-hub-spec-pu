-- Links inbox attribution to the canonical product catalogue, and records the
-- campaign each ad belongs to.
--
-- Attribution already resolves a conversation to a post/ad exactly. What it
-- produced until now was a free-text label, so "Bamboo Charcoal Boards" and
-- "BUILDECO Boards" stayed two different things with no price, image or
-- category. These columns pin that label to a real products.id once, at cache
-- build time.

alter table page_post_ads
  add column if not exists product_id uuid references products(id),
  -- exact | strong | weak | manual. Rendered differently: a weak guess must
  -- never be displayed as confidently as an exact match.
  add column if not exists match_confidence text,
  add column if not exists campaign_id text,
  add column if not exists campaign_name text,
  add column if not exists campaign_objective text,
  -- ACTIVE | PAUSED | ARCHIVED ... Tells you whether a lead is repeatable.
  add column if not exists ad_status text;

create index if not exists page_post_ads_product_idx on page_post_ads (product_id);
create index if not exists page_post_ads_campaign_idx on page_post_ads (campaign_id);

-- Manual overrides for labels the matcher cannot resolve (~37%). Most of those
-- are products genuinely missing from the catalogue rather than matcher
-- failures, so this is also where a marketing name gets mapped onto a
-- catalogue item that is worded differently.
create table if not exists product_aliases (
  alias text primary key,
  product_id uuid references products (id) on delete cascade,
  created_at timestamptz default now()
);
